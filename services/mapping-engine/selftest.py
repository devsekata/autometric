"""Self-test service mapping engine — jalankan setelah vendor diperbarui.

    cd services/mapping-engine
    python selftest.py                  # cek rangkaian + transformasi (dry-run)
    python selftest.py --file X.csv --platform instagram --category "Profile Reach"
                                        # dry-run satu file NYATA, tanpa menulis

Tidak menulis apa pun ke database dalam mode apa pun. Yang diperiksa:

  A. Rangkaian jalan     — shim terpasang, vendor bisa diimpor, spec xlsx ketemu,
                           kredensial DB terbaca, koneksi hidup.
  B. Pagar keamanan      — self-heal pembuatan akun vendor benar-benar mati.
  C. Transformasi        — file contoh diubah menjadi rencana tulis yang benar,
                           termasuk pemecahan tiga arah untuk TikTok Post.

Yang TIDAK diperiksa di sini, dan harus diuji dengan file FPK sungguhan:
deteksi baris header FPK (4 baris metadata), perbaikan CSV whole-line-quoted,
unpivot wide + diff kumulatif, parser audience delimiter ';'. Pakai `--file`
untuk itu.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

# Kredensial dibaca dari .env.local repo supaya sama dengan yang dipakai aplikasi.
_ENV = REPO / ".env.local"
if _ENV.exists():
    for line in _ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            val = m.group(2).strip()
            if len(val) >= 2 and val[0] in "\"'" and val[-1] == val[0]:
                val = val[1:-1]
            os.environ.setdefault(m.group(1), val)

sys.path.insert(0, str(HERE))

PASS, FAIL = "  OK   ", "  GAGAL"
_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{PASS if ok else FAIL}  {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        _failures.append(label)


# ── A. Rangkaian ───────────────────────────────────────────────────────────
def suite_wiring() -> None:
    print("\nA. RANGKAIAN")
    from app import shim
    from app.bootstrap import ensure_ready

    ensure_ready()
    check("shim streamlit terpasang", sys.modules.get("streamlit") is shim)

    import komersil_rules
    check("resolver akun ditambal",
          komersil_rules._resolve_social_account_id.__module__ == "app.bootstrap")
    check("_brand_id ditambal",
          komersil_rules._brand_id.__module__ == "app.bootstrap")

    import proses_mapping_data_komersil as pmd
    check("spec xlsx ketemu", os.path.exists(pmd.SPEC_PATH),
          os.path.basename(pmd.SPEC_PATH))

    from postgres_addon_komersil import get_postgres_config
    cfg = get_postgres_config()
    check("kredensial DB terbaca dari DATABASE_URL",
          bool(cfg.get("host") and cfg.get("password")),
          f"{cfg.get('host')}/{cfg.get('database')} schema={cfg.get('schema')}")

    try:
        from postgres_addon_komersil import test_postgres_connection
        info = test_postgres_connection()
        check("koneksi DB hidup", True, json.dumps(info))
    except Exception as e:
        check("koneksi DB hidup", False, str(e)[:120])

    with shim.collect_messages() as msgs:
        import streamlit as st
        st.warning("uji")
    check("pesan diagnostik vendor terpungut", len(msgs) == 1)

    from app.categories import supported_categories
    cat = supported_categories()
    total = sum(len(v) for v in cat["categories"].values())
    check("katalog kategori terbentuk dari BUILTIN_RULES", total > 20,
          f"{total} kategori, {len(cat['gaps'])} GAP")


# ── B. Pagar keamanan ──────────────────────────────────────────────────────
def suite_guardrails() -> None:
    print("\nB. PAGAR KEAMANAN")
    import komersil_rules
    from app.bootstrap import IdentityNotPinned, pin_identity

    sid = "11111111-1111-1111-1111-111111111111"

    raised = False
    try:
        with pin_identity({"instagram": sid}, "brand-1"):
            komersil_rules._resolve_social_account_id(None, "tiktok")
    except IdentityNotPinned:
        raised = True
    check("self-heal pembuatan akun mati (platform tanpa id ditolak)", raised)

    with pin_identity({"instagram": sid}, "brand-1"):
        got = komersil_rules._resolve_social_account_id(None, "Instagram")
        bid = komersil_rules._brand_id(None, "apa saja")
    check("identitas yang dipasang Kepiai dipakai", got == sid and bid == "brand-1")

    from app.detect import detect_file
    d = detect_file("apa_ini.csv", b"kolom_aneh,entah\n1,2\n")
    check("file tak dikenali ditolak dengan alasan",
          not d["supported"] and bool(d["reason"]))

    # `uq_ig_media_snapshot` mengunci media_id SAJA, sedangkan aturan komersil
    # memakai key (social_account_id, media_id). Post yang sudah dimiliki akun
    # lain karena itu lolos anti-join lalu ditolak indeks — dan jejak psycopg2
    # tidak memberi tahu user apa pun yang bisa ditindaklanjuti.
    from app.ingest import explain_db_error
    raw = ('(psycopg2.errors.UniqueViolation) duplicate key value violates '
           'unique constraint "uq_ig_media_snapshot"\n'
           'DETAIL:  Key (media_id)=(18139696378503114) already exists.')
    friendly = explain_db_error(raw, "l0_raw.ig_media_snapshots")
    check("error unique-violation diterjemahkan",
          friendly != raw and "media_id" in friendly and "psycopg2" not in friendly,
          friendly[:96] + "…")
    check("error lain dibiarkan apa adanya",
          explain_db_error("connection refused", "l0_raw.ig_media_snapshots")
          == "connection refused")


# ── C. Transformasi ────────────────────────────────────────────────────────
DATES = ["2026-06-01", "2026-06-02", "2026-06-03"]

_TT_POST_COLS = [
    "post_id", "account_id", "account_username", "description", "publish_time",
    "date", "permalink", "image_link", "duration_sec", "likes", "comments",
    "shares", "views", "avg_watch_time", "reach_post", "completion_rate",
    "saves", "total_watch_time", "new_follows", "profile_views",
    "website_clicks", "spark_ads", "viewer_follower", "viewer_non_follower",
    "viewer_new", "viewer_returning", "viewer_male", "viewer_female",
    "content_pillar", "brand_offering", "format", "is_boosted", "is_campaign",
]


def _sample_files() -> dict[str, tuple[str, str, bytes]]:
    """nama → (platform, kategori, isi). Format native, yang juga didukung engine."""
    def daily(col: str, base: int) -> bytes:
        rows = "".join(f"{d},{base + i}\n" for i, d in enumerate(DATES))
        return (f"date,{col}\n" + rows).encode()

    tt_rows = []
    for i in range(3):
        tt_rows.append([
            f"vid{i:03d}", "tt-acct", "uji", f"caption {i}", DATES[i], DATES[i],
            f"https://tiktok.com/@x/video/vid{i:03d}", "http://img", 45,
            100 + i, 10 + i, 5 + i, 9000 + i, 12.5, 8000, "62%",
            30 + i, 120000, 15, 60, 3, 0,
            0.7, 0.3, 0.4, 0.6, 0.45, 0.55, "Edukasi", "Produk A", "video",
            "false", "true",
        ])
    tt = (",".join(_TT_POST_COLS) + "\n"
          + "".join(",".join(str(v) for v in r) + "\n" for r in tt_rows)).encode()

    return {
        "ig_profile_reach.csv":  ("instagram", "Profile Reach", daily("profile_reach", 1000)),
        "ig_profile_visit.csv":  ("instagram", "Profile Visit", daily("profile_visit", 500)),
        "ig_interactions.csv":   ("instagram", "Content Interactions", daily("content_interactions", 80)),
        "tt_post.csv":           ("tiktok", "Post", tt),
    }


# Tabel yang HARUS muncul di rencana tulis tiap kategori. Ini kontraknya: kalau
# vendor diperbarui dan salah satu berubah, angka di dashboard bergeser.
_EXPECTED = {
    "Profile Reach":        {"l0_raw.ig_profile_snapshots"},
    "Profile Visit":        {"l0_extra.ig_profile_fpk"},
    "Content Interactions": {"l0_raw.ig_profile_snapshots"},
    "Post":                 {"l0_raw.tt_video_snapshots",
                             "l0_extra.tiktok_post_extra_attribute",
                             "l0_extra.tt_post_fpk"},
}

ACCOUNTS = {
    "instagram": "11111111-1111-1111-1111-111111111111",
    "tiktok":    "22222222-2222-2222-2222-222222222222",
}


def suite_transform() -> None:
    print("\nC. TRANSFORMASI (dry-run, nol penulisan)")
    from app.detect import detect_file
    from app.ingest import run_batch

    samples = _sample_files()

    for name, (platform, category, raw) in samples.items():
        d = detect_file(name, raw)
        check(f"deteksi {name}",
              d["category"] == category,
              f"terdeteksi '{d['category']}' (dari {d['detected_from']}), "
              f"diharapkan '{category}'")

    items = [{"filename": n, "raw_bytes": raw, "platform": p, "category": c}
             for n, (p, c, raw) in samples.items()]
    results = run_batch(items, accounts=ACCOUNTS, brand="uji",
                        brand_id="33333333-3333-3333-3333-333333333333",
                        org_id=None, dry_run=True)

    for r in results:
        if not r.get("ok"):
            check(f"transformasi {r['file']}", False, (r.get("error") or "")[:160])
            continue
        tables = {f"{w['schema']}.{w['table']}" for w in r.get("planned_writes", [])}
        want = _EXPECTED.get(r["category"], set())
        check(f"tujuan tulis {r['file']}", want.issubset(tables),
              " + ".join(sorted(tables)) or "(kosong)")
        for w in r.get("planned_writes", []):
            if w["rows"] != 3:
                check(f"  jumlah baris {w['table']}", False,
                      f"{w['rows']} baris, diharapkan 3")


# ── mode file nyata ────────────────────────────────────────────────────────
def run_one_file(path: str, platform: str, category: str | None) -> None:
    from app.detect import detect_file
    from app.ingest import run_batch

    raw = Path(path).read_bytes()
    name = Path(path).name

    print(f"\nFILE: {name}  ({len(raw):,} byte)")
    d = detect_file(name, raw)
    print("  deteksi     :", json.dumps({
        "judul": d["title"], "platform": d["platform"], "kategori": d["category"],
        "bucket": d["bucket"], "dari": d["detected_from"], "baris": d["rows"],
        "didukung": d["supported"], "alasan": d["reason"],
    }, ensure_ascii=False, indent=None))

    platform = platform or d["platform"]
    category = category or d["category"]
    if not platform or not category:
        print("  → platform/kategori tidak bisa ditentukan; beri --platform / --category")
        return

    results = run_batch(
        [{"filename": name, "raw_bytes": raw, "platform": platform, "category": category}],
        accounts={platform: ACCOUNTS.get(platform, "11111111-1111-1111-1111-111111111111")},
        brand="uji", brand_id="33333333-3333-3333-3333-333333333333",
        org_id=None, dry_run=True)

    for r in results:
        print(f"  hasil       : {'OK' if r['ok'] else 'GAGAL'}")
        if r.get("error"):
            print("  error       :", r["error"][:400])
        for w in r.get("planned_writes", []):
            print(f"  -> {w['schema']}.{w['table']}  {w['rows']} baris  key={w['key_cols']}")
            print(f"     kolom: {', '.join(w['columns'])}")
            if w["sample"]:
                nonnull = {k: v for k, v in w["sample"][0].items() if v is not None}
                print(f"     contoh: {json.dumps(nonnull, default=str)[:400]}")
        for m in r.get("messages", []):
            if m["level"] in ("warning", "error"):
                print(f"     [{m['level']}] {m['message'][:200]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="dry-run satu file nyata (mis. export FPK)")
    ap.add_argument("--platform", help="instagram | facebook | tiktok")
    ap.add_argument("--category", help="kategori internal, mis. 'Profile Reach'")
    args = ap.parse_args()

    from app.bootstrap import ensure_ready
    ensure_ready()

    if args.file:
        run_one_file(args.file, args.platform, args.category)
        return 0

    suite_wiring()
    suite_guardrails()
    suite_transform()

    print()
    if _failures:
        print(f"{len(_failures)} pemeriksaan GAGAL:")
        for f in _failures:
            print(f"  - {f}")
        return 1
    print("Semua pemeriksaan lulus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
