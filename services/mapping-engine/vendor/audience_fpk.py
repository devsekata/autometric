"""audience_fpk.py — Pembaca khusus file Audience FPK (Age/Gender/City/Country).

File audience FPK bentuknya beda dari file lain:
  • CSV berpemisah ';' (atau xlsx), desimal pakai koma ('0,49085')
  • TIDAK ada deret tanggal — dia snapshot satu periode
    ('Feb 26, 2026 - Mar 25, 2026'); tanggal efektif = AKHIR periode
  • Ada baris '(Comparison period)' yang harus DIBUANG
  • Kategori di kolom B (13-17 / female / DE), nilai di kolom D

Output: DataFrame long-format (date, breakdown_type, category, value) —
format yang sudah dimengerti jalur audience→jsonb di komersil_rules.
"""

import io
import re

import pandas as pd

# judul internal file → breakdown_type
_TITLE_BREAKDOWN = [
    ("world map of followers", "country"),
    ("top cities of followers", "city"),
    ("gender", "gender"),
    ("age", "age"),
]


def _rows_from_bytes(raw_bytes, filename):
    """Baca file jadi list-of-lists, apa pun formatnya (xlsx / csv ; / csv ,)."""
    name = str(filename or "").lower()
    if name.endswith((".xlsx", ".xls", ".xlsm")) or raw_bytes[:4] == b"PK\x03\x04":
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        ws = wb[wb.sheetnames[0]]
        return [[c if c is not None else "" for c in r] for r in ws.iter_rows(values_only=True)]
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    delim = ";" if text.count(";") >= text.count(",") else ","
    return [line.split(delim) for line in text.splitlines()]


def _angka(v):
    """'1031' → 1031; '0,49085' → 0.49085; kosong → None."""
    s = str(v).strip().strip('"')
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".") if ("," in s and s.count(",") == 1) else s
    try:
        return float(s)
    except ValueError:
        return None


def parse_audience_fpk(raw_bytes, filename):
    rows = _rows_from_bytes(raw_bytes, filename)
    if len(rows) < 3:
        raise ValueError("File audience terlalu pendek / tidak terbaca.")

    # ── judul (baris 2 kolom 2) → breakdown_type ──
    judul = str(rows[1][1] if len(rows[1]) > 1 else "").strip().lower()
    breakdown = next((b for token, b in _TITLE_BREAKDOWN if token in judul), None)
    if breakdown is None:
        raise ValueError(
            f"Judul audience tidak dikenali: '{judul or '-'}' "
            "(didukung: Age, Gender, Top Cities of Followers, World Map of Followers)."
        )

    # ── tanggal efektif = akhir periode ('... - Mar 25, 2026') ──
    period_end = None
    for r in rows[:4]:
        for cell in r:
            m = re.search(r"-\s*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\s*$", str(cell).strip())
            if m:
                period_end = pd.to_datetime(m.group(1), errors="coerce")
                break
        if period_end is not None and not pd.isna(period_end):
            break
    if period_end is None or pd.isna(period_end):
        raise ValueError("Periode tidak ditemukan di header file audience.")

    # ── baris header data: kolom B == 'Profile' ──
    hdr_idx = next(
        (i for i, r in enumerate(rows)
         if len(r) > 1 and str(r[1]).strip().lower() == "profile"),
        None,
    )
    if hdr_idx is None:
        raise ValueError("Header data (kolom 'Profile') tidak ditemukan.")

    data = []
    for r in rows[hdr_idx + 1:]:
        if len(r) < 4:
            continue
        kategori = str(r[1]).strip().strip('"')
        if not kategori:
            continue
        # buang baris pembanding periode sebelumnya
        pembanding = "(comparison" in kategori.lower() or (
            len(r) > 4 and str(r[4]).strip().upper().endswith("_SECOND_TIME")
        )
        if pembanding:
            continue
        val = _angka(r[3])
        if val is None:
            continue
        data.append({
            "date": period_end,
            "breakdown_type": breakdown,
            "category": kategori,
            "value": val,
        })

    if not data:
        raise ValueError("Tidak ada baris data audience yang valid di file ini.")
    return pd.DataFrame(data)