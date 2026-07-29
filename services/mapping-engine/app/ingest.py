"""Orkestrasi ingest headless.

Seluruh rantai transformasi + tulis-DB sudah ada di
`vendor/postgres_addon_komersil.render_postgres_insert_section()`:

    resolve_kategori → proses_mapping_data / parse_audience_fpk
      → to_komersil (tabel & key upsert ditentukan BUILTIN_RULES)
      → UPSERT l0_raw
      → INSERT KEDUA  l0_extra.<channel>_post_extra_attribute (atribut manual)
      → INSERT KETIGA l0_extra.tt_post_fpk (metrik TikTok per-post)

Fungsi itu dipanggil dengan `auto_insert=True` sehingga tidak merender apa pun
dan langsung mengeksekusi. Modul ini hanya menyiapkan argumen, memasang identitas
akun yang dikirim Kepiai, dan memungut pesan diagnostik vendor.
"""

from __future__ import annotations

import contextlib
import io
import re

from . import shim
from .bootstrap import ensure_ready, pin_identity

# Baris contoh yang dikembalikan dry-run — cukup untuk user memeriksa mata
# sendiri, tidak sampai membanjiri respons.
_DRY_SAMPLE_ROWS = 5


@contextlib.contextmanager
def capture_writes():
    """Jalankan jalur vendor UTUH tapi tahan penulisannya.

    Bukan dengan menyalin ulang langkah-langkah vendor (itu akan menjadi logika
    kedua yang gampang out-of-sync), melainkan dengan menukar dua fungsi tulis
    di modul vendor. Seluruh rantai — resolve_kategori, proses_mapping_data,
    to_komersil, INSERT KEDUA atribut, INSERT KETIGA tt_post_fpk — tetap jalan
    apa adanya, dan yang tertangkap adalah persis apa yang akan masuk database.

    Dry-run hanya melakukan query BACA (information_schema, l0_raw.mapping_rules).
    """
    import postgres_addon_komersil as pak

    captured: list[dict] = []

    def _fake(df, schema_name=None, table_name=None, **kw):
        cols = [str(c) for c in df.columns]
        captured.append({
            "schema": schema_name,
            "table": table_name,
            "rows": int(len(df)),
            "key_cols": list(kw.get("key_cols") or []),
            "columns": cols,
            "sample": df.head(_DRY_SAMPLE_ROWS)
                        .astype(object)
                        .where(df.head(_DRY_SAMPLE_ROWS).notna(), None)
                        .to_dict(orient="records"),
        })
        return {"schema": schema_name, "table": table_name, "rows": int(len(df))}

    real_upsert = pak.upsert_dataframe_to_postgres
    real_insert = pak.insert_dataframe_to_postgres
    pak.upsert_dataframe_to_postgres = _fake
    pak.insert_dataframe_to_postgres = _fake
    try:
        yield captured
    finally:
        pak.upsert_dataframe_to_postgres = real_upsert
        pak.insert_dataframe_to_postgres = real_insert

# Kategori TikTok yang datang sebagai kumpulan file 1-metrik dan harus digabung
# per tanggal sebelum ditulis. Kategori per-metrik hasil auto-deteksi
# (Video Views / Profile Views / Shares) TIDAK perlu jalur ini — masing-masing
# menulis ke l0_extra.tt_profile_fpk dengan key (social_account_id, fetched_at)
# sehingga menyatu sendiri lewat COALESCE.
_TT_OVERVIEW = "overview"


def _blank_frame():
    import pandas as pd

    return pd.DataFrame()


# ── penerjemah error database ──────────────────────────────────────────────
_UNIQUE_RE = re.compile(
    r'duplicate key value violates unique constraint "(?P<con>[^"]+)"'
    r'.*?Key \((?P<col>[^)]+)\)=\((?P<val>[^)]+)\) already exists',
    re.DOTALL,
)
_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _owner_of(table: str, column: str, value: str) -> str | None:
    """Akun pemilik baris yang bentrok — supaya pesannya bisa menyebut nama."""
    if "." not in table:
        return None
    schema, name = table.split(".", 1)
    if not all(_IDENT_RE.match(x) for x in (schema, name, column)):
        return None
    try:
        from sqlalchemy import text
        from postgres_addon_komersil import get_postgres_engine

        with get_postgres_engine().connect() as conn:
            row = conn.execute(
                text(f'SELECT sa.username, p.key AS platform '
                     f'FROM "{schema}"."{name}" t '
                     f'JOIN public.social_accounts sa ON sa.id = t.social_account_id '
                     f'LEFT JOIN public.platforms p ON p.id = sa.platform_id '
                     f'WHERE t."{column}"::text = :v LIMIT 1'),
                {"v": str(value)},
            ).fetchone()
        if row:
            return f"@{row[0]}" + (f" di {row[1]}" if row[1] else "")
    except Exception:
        pass
    return None


def explain_db_error(message: str, table: str | None) -> str:
    """Ubah error Postgres mentah menjadi kalimat yang bisa ditindaklanjuti.

    Kasus yang paling sering: `uq_ig_media_snapshot` mengunci `media_id` SAJA,
    sementara aturan komersil mendeklarasikan key `(social_account_id, media_id)`.
    Akibatnya sebuah post yang sudah terdaftar untuk akun LAIN tidak terlihat
    oleh anti-join, lalu ditolak indeks saat INSERT. Itu bukan kesalahan yang
    bisa disimpulkan user dari jejak psycopg2.
    """
    m = _UNIQUE_RE.search(message or "")
    if not m:
        return message

    col, val = m.group("col").strip(), m.group("val").strip()
    owner = _owner_of(table, col, val) if table else None
    milik = f" — sudah terdaftar untuk akun {owner}" if owner else ""

    return (
        f"Data dengan {col} = {val} sudah ada di database{milik}, "
        f"dan satu {col} hanya boleh dimiliki satu akun. "
        "Dua kemungkinan: file ini milik brand lain, atau akun yang sama "
        "terdaftar dua kali dengan username berbeda. "
        "Periksa dulu sebelum mengulang upload."
    )


def ingest_one(*, platform: str, category: str, filename: str, raw_bytes: bytes,
               brand: str | None, org_id: str | None,
               dry_run: bool = False) -> dict:
    """Proses satu file. Identitas akun harus sudah dipasang pemanggil."""
    from postgres_addon_komersil import render_postgres_insert_section

    stack = contextlib.ExitStack()
    with shim.collect_messages() as messages:
        planned = stack.enter_context(capture_writes()) if dry_run else None
        try:
            result = render_postgres_insert_section(
                platform,
                category,
                filename,
                _blank_frame(),   # source_df — hanya dipakai jalur fallback lama
                [],               # expected_columns — idem
                {},               # mapping_dict — idem
                0,                # filled_mapping — gate dilewati karena jalur
                                  # raw_bytes menghasilkan data (new_path_has_data)
                slugify_func=None,
                append_history_func=None,   # riwayat dicatat Kepiai, bukan jsonl
                selected_brand=brand,
                auto_insert=True,
                raw_bytes=raw_bytes,
                selected_org_id=org_id,
            )
        except Exception as e:
            result = {"ok": False, "error": str(e), "rows": 0,
                      "table": "-", "file": filename}
        finally:
            stack.close()

    result = dict(result or {})
    if not result.get("ok") and result.get("error"):
        raw_error = str(result["error"])
        result["error"] = explain_db_error(raw_error, result.get("table"))
        if result["error"] != raw_error:
            # Jejak aslinya tetap dibawa untuk diagnosa, tapi tidak jadi yang
            # dibaca user lebih dulu.
            result["error_detail"] = raw_error[:2000]
    result["file"] = filename
    result["platform"] = platform
    result["category"] = category
    result["messages"] = messages
    result["dry_run"] = dry_run
    if dry_run:
        result["planned_writes"] = planned or []
    if result.get("ok") is None:
        # Tidak seharusnya terjadi pada auto_insert=True, tapi jangan sampai
        # dilaporkan sebagai sukses.
        result["ok"] = False
        result.setdefault("error", "insert tidak dieksekusi")
    return result


def _ingest_tiktok_overview_group(items: list[dict], *, brand: str | None,
                                  org_id: str | None,
                                  dry_run: bool = False) -> dict:
    """Gabungkan beberapa file TikTok Overview 1-metrik, lalu satu kali upsert.

    Di-port dari `_try_process_tiktok_overview_group` di app Streamlit
    (app_mapping_engine_komersil.py:2124) — logikanya sama, tanpa render.
    """
    from komersil_rules import to_komersil
    from mapping_tiktok import proses_mapping_tiktok_overview
    from postgres_addon_komersil import get_postgres_engine

    label = " + ".join(i["filename"] for i in items)
    stack = contextlib.ExitStack()
    with shim.collect_messages() as messages:
        planned = stack.enter_context(capture_writes()) if dry_run else None
        try:
            # Diimpor DI DALAM blok supaya versi yang terambil adalah yang sudah
            # ditukar capture_writes() saat dry-run.
            from postgres_addon_komersil import upsert_dataframe_to_postgres
            file_objs = []
            for i in items:
                bio = io.BytesIO(i["raw_bytes"])
                try:
                    bio.name = i["filename"]
                except Exception:
                    pass
                file_objs.append(bio)

            df = proses_mapping_tiktok_overview(file_objs)
            if df is None or df.empty:
                raise ValueError(
                    "Tidak ada data yang berhasil dibaca dari file-file ini.")

            df_k, schema_k, table_k, key_k = to_komersil(
                df, "tiktok", _TT_OVERVIEW, get_postgres_engine(),
                brand=brand, org_id=org_id)
            res = upsert_dataframe_to_postgres(
                df_k, schema_name=schema_k, table_name=table_k,
                key_cols=key_k, require_existing_table=True)
            out = {"ok": True, "error": "", "rows": res["rows"],
                   "table": f"{res['schema']}.{res['table']}"}
        except Exception as e:
            out = {"ok": False, "error": str(e), "rows": 0,
                   "table": "l0_extra.tt_profile_fpk"}
        finally:
            stack.close()

    out.update({"file": label, "platform": "tiktok",
                "category": _TT_OVERVIEW, "messages": messages,
                "dry_run": dry_run,
                "grouped_files": [i["filename"] for i in items]})
    if dry_run:
        out["planned_writes"] = planned or []
    return out


def run_batch(items: list[dict], *, accounts: dict[str, str], brand: str | None,
              brand_id: str | None, org_id: str | None,
              dry_run: bool = False) -> list[dict]:
    """`items` = [{filename, raw_bytes, platform, category}], `accounts` =
    {platform: social_account_id}. Satu hasil per file, kecuali grup TikTok
    Overview yang dilaporkan sebagai satu hasil gabungan.

    `dry_run=True` menjalankan seluruh transformasi tapi tidak menulis apa pun;
    hasilnya memuat `planned_writes` — tabel tujuan, key upsert, kolom, dan
    beberapa baris contoh."""
    ensure_ready()

    group: list[dict] = []
    singles: list[dict] = []
    for it in items:
        is_tt_overview = (
            str(it.get("platform", "")).strip().lower() == "tiktok"
            and str(it.get("category", "")).strip().lower() == _TT_OVERVIEW
        )
        (group if is_tt_overview else singles).append(it)

    results: list[dict] = []
    with pin_identity(accounts, brand_id):
        if group:
            results.append(_ingest_tiktok_overview_group(
                group, brand=brand, org_id=org_id, dry_run=dry_run))
        for it in singles:
            results.append(ingest_one(
                platform=str(it["platform"]).strip().lower(),
                category=str(it["category"]).strip(),
                filename=it["filename"],
                raw_bytes=it["raw_bytes"],
                brand=brand,
                org_id=org_id,
                dry_run=dry_run,
            ))
    return results
