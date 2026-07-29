"""Service mapping engine — internal only.

Menerima file export Fanpage Karma dari Kepiai, menulis ke l0_raw + l0_extra di
database yang sama, mengembalikan status per file.

TIDAK boleh diekspos ke publik: endpoint menerima file arbitrer dan menulis ke
database produksi. Di docker-compose service ini sengaja tanpa `ports:`.

Autentikasi: Kepiai sudah memverifikasi sesi user dan hak akses brand sebelum
memanggil. Service ini hanya memeriksa shared secret opsional
(MAPPING_ENGINE_TOKEN) sebagai pagar tambahan bila jaringan internal tidak cukup
dipercaya.
"""

from __future__ import annotations

import json
import os

from fastapi import FastAPI, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .bootstrap import ensure_ready
from .categories import supported_categories
from .detect import detect_file
from .ingest import run_batch

MAX_FILE_BYTES = int(os.getenv("MAPPING_ENGINE_MAX_FILE_BYTES", 40 * 1024 * 1024))
MAX_FILES = int(os.getenv("MAPPING_ENGINE_MAX_FILES", 60))
TOKEN = os.getenv("MAPPING_ENGINE_TOKEN", "").strip()

app = FastAPI(title="Kepiai mapping engine", docs_url=None, redoc_url=None)


def _check_token(provided: str | None) -> None:
    if TOKEN and (provided or "").strip() != TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


async def _read_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang dikirim.")
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Terlalu banyak file dalam satu batch (maksimum {MAX_FILES}).",
        )
    out: list[tuple[str, bytes]] = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"{f.filename} melebihi batas {MAX_FILE_BYTES // (1024 * 1024)} MB.",
            )
        if not data:
            raise HTTPException(status_code=400, detail=f"{f.filename} kosong.")
        out.append((f.filename or "tanpa-nama", data))
    return out


@app.get("/health")
def health():
    """Cek liveness + apakah kredensial DB terbaca. Tidak menyentuh tabel."""
    ensure_ready()
    info: dict = {"ok": True}
    try:
        from postgres_addon_komersil import test_postgres_connection

        info["db"] = test_postgres_connection()
    except Exception as e:
        info["ok"] = False
        info["db_error"] = str(e)
    return JSONResponse(info, status_code=200 if info["ok"] else 503)


@app.get("/categories")
def categories(x_mapping_token: str | None = Header(default=None)):
    """Kategori yang punya tujuan tulis, diturunkan dari BUILTIN_RULES vendor."""
    _check_token(x_mapping_token)
    return supported_categories()


@app.post("/detect")
async def detect(
    files: list[UploadFile],
    x_mapping_token: str | None = Header(default=None),
):
    """Kenali platform + kategori tiap file, tanpa menulis apa pun ke database."""
    _check_token(x_mapping_token)
    payload = await _read_files(files)
    return {"files": [detect_file(name, data) for name, data in payload]}


@app.post("/ingest")
async def ingest(
    files: list[UploadFile],
    manifest: str = Form(...),
    x_mapping_token: str | None = Header(default=None),
):
    """Proses batch dan tulis ke database.

    `manifest` adalah JSON:
      {
        "brand":      "Nama Brand",            # opsional, untuk pesan & kolom brand
        "brand_id":   "<public.brands.id>",    # dipakai tabel l0_extra
        "org_id":     "<organizations.id>",    # opsional
        "accounts":   {"instagram": "<social_accounts.id>", ...},
        "assignments": [{"filename": "...", "platform": "...", "category": "..."}]
      }

    `accounts` wajib memuat setiap platform yang muncul di `assignments` — mesin
    ini tidak membuat akun sendiri (lihat bootstrap.pin_identity).

    `"dry_run": true` menjalankan seluruh transformasi tanpa menulis apa pun dan
    mengembalikan `planned_writes` (tabel tujuan, key upsert, kolom, baris
    contoh) — dipakai untuk pratinjau sebelum user menekan simpan.
    """
    _check_token(x_mapping_token)

    try:
        meta = json.loads(manifest)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"manifest bukan JSON valid: {e}")

    assignments = {
        str(a.get("filename")): a for a in (meta.get("assignments") or [])
    }
    accounts = {
        str(k).strip().lower(): str(v)
        for k, v in (meta.get("accounts") or {}).items() if v
    }

    payload = await _read_files(files)

    items: list[dict] = []
    skipped: list[dict] = []
    for name, data in payload:
        a = assignments.get(name)
        if not a:
            skipped.append({"file": name, "ok": False,
                            "error": "tidak ada assignment platform/kategori."})
            continue
        platform = str(a.get("platform") or "").strip().lower()
        category = str(a.get("category") or "").strip()
        if not platform or not category:
            skipped.append({"file": name, "ok": False,
                            "error": "platform atau kategori kosong."})
            continue
        if platform == "twitter":
            skipped.append({"file": name, "ok": False, "platform": platform,
                            "category": category,
                            "error": "Twitter/X belum didukung — l0_raw tidak "
                                     "punya tabel Twitter."})
            continue
        if platform not in accounts:
            skipped.append({"file": name, "ok": False, "platform": platform,
                            "category": category,
                            "error": f"social_account_id untuk '{platform}' "
                                     "tidak dikirim."})
            continue
        items.append({"filename": name, "raw_bytes": data,
                      "platform": platform, "category": category})

    dry_run = bool(meta.get("dry_run"))
    results = run_batch(
        items,
        accounts=accounts,
        brand=meta.get("brand"),
        brand_id=meta.get("brand_id"),
        org_id=meta.get("org_id"),
        dry_run=dry_run,
    ) if items else []

    all_results = results + skipped
    return {
        "results": all_results,
        "summary": {
            "files": len(payload),
            "ok": sum(1 for r in all_results if r.get("ok")),
            "failed": sum(1 for r in all_results if not r.get("ok")),
            "rows": sum(int(r.get("rows") or 0) for r in all_results),
            "dry_run": dry_run,
        },
    }
