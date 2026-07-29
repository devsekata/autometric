# -*- coding: utf-8 -*-
"""
fb_increase_service.py
======================

Service "FB Increase" (Follows / Followers Increase) dengan handling
CARRY-OVER antar-file yang ter-split.

Latar belakang
--------------
Data total followers FB sering dipecah jadi beberapa file CSV/XLSX karena
ukurannya besar, mis.:
    File 1: 1 Jan  - 24 Mei 2026
    File 2: 25 Mei - 31 Agu 2026

Metrik "FB Increase" = followers hari ini - followers hari kemarin.

Rule bisnis:
    1. Baris PERTAMA File 1 (1 Jan) BOLEH null/0 -> itu baseline paling awal.
    2. Baris PERTAMA File 2 (25 Mei) TIDAK boleh null. Nilainya harus dihitung
       dari: total(25 Mei) - total(24 Mei), di mana total(24 Mei) adalah data
       terakhir File 1 yang SUDAH masuk ke database.

Modul ini TIDAK mengubah logika lama. Ia MEMBUNGKUS hasil unpivot+diff yang
sudah ada (_handle_wide_category / replikasinya) lalu HANYA memperbaiki baris
pertama bila ditemukan total hari sebelumnya di DB.

Aman terhadap:
    - KeyError / "undefined index"  -> semua akses kolom pakai .get / cek dulu.
    - NoneType / null pointer        -> tiap nilai dicek None/NaN sebelum dipakai.
    - Division by zero               -> metrik ini PENGURANGAN, bukan pembagian;
                                        tidak ada operasi bagi. (Kalau nanti ada
                                        growth-rate %, helper _safe_div disediakan.)
"""

from __future__ import annotations

from io import BytesIO
from typing import Optional, Union

import pandas as pd

try:
    # reuse koneksi & util yang sudah ada; tidak mengubahnya
    from sqlalchemy import text
    from postgres_addon_komersil import (
        get_postgres_engine,
        normalize_sql_identifier,
        DEFAULT_DB_SCHEMA,
    )
    _HAS_PG = True
except Exception:  # pragma: no cover - biar modul tetap bisa di-import utk test
    _HAS_PG = False
    DEFAULT_DB_SCHEMA = "l0_raw"

    def normalize_sql_identifier(value, default="mapped_data"):
        import re
        v = str(value or "").strip().lower()
        v = re.sub(r"[^a-z0-9_]+", "_", v)
        v = re.sub(r"_+", "_", v).strip("_")
        return (v or default)[:63]


# ── util aman ────────────────────────────────────────────────────────────────
def _is_blank(v) -> bool:
    """True bila nilai dianggap kosong (None / NaN / NA / string kosong)."""
    if v is None:
        return True
    try:
        if pd.isna(v):
            return True
    except (TypeError, ValueError):
        pass
    if isinstance(v, str) and v.strip() == "":
        return True
    return False


def _to_number(v):
    """Konversi aman ke angka. Gagal -> None (bukan exception)."""
    if _is_blank(v):
        return None
    try:
        return pd.to_numeric(str(v).replace(",", ""), errors="coerce")
    except Exception:
        return None


def _safe_div(numerator, denominator):
    """Pembagian aman (disediakan kalau nanti butuh growth-rate persen).
    Pembagi 0/None/NaN -> None, bukan ZeroDivisionError."""
    n = _to_number(numerator)
    d = _to_number(denominator)
    if n is None or d is None or d == 0:
        return None
    return n / d


# ── query DB: cari TOTAL followers tanggal tertentu ──────────────────────────
def fetch_previous_total(
    target_date: Union[str, pd.Timestamp],
    schema_name: str = DEFAULT_DB_SCHEMA,
    raw_totals_table: str = "facebook_total_followers",
    date_col: str = "date",
    total_col: str = "total_followers",
) -> Optional[float]:
    """Ambil TOTAL followers (kumulatif, bukan delta) untuk `target_date` dari DB.

    PENTING soal desain:
    Tabel hasil 'facebook_follows_increase' menyimpan DELTA harian, bukan total
    kumulatif. Untuk carry-over kita butuh TOTAL kemarin (mis. total 24 Mei),
    jadi sumbernya harus tabel yang menyimpan TOTAL mentah
    (default: 'facebook_total_followers' dgn kolom 'date' + 'total_followers').

    Return:
        float total followers pada target_date, atau None bila:
        - koneksi/t“abel tidak tersedia,
        - tanggal tidak ada di DB,
        - nilainya null.
    Semua kegagalan -> None (tidak melempar error), sesuai kebutuhan robust.
    """
    if not _HAS_PG:
        return None

    sch = normalize_sql_identifier(schema_name, default=DEFAULT_DB_SCHEMA)
    tbl = normalize_sql_identifier(raw_totals_table, default="facebook_total_followers")
    dcol = normalize_sql_identifier(date_col, default="date")
    vcol = normalize_sql_identifier(total_col, default="total_followers")

    # normalisasi target_date -> 'YYYY-MM-DD'
    ts = pd.to_datetime(target_date, errors="coerce")
    if pd.isna(ts):
        return None
    date_str = ts.strftime("%Y-%m-%d")

    # nama identifier tidak bisa di-bind sbg parameter, tapi sudah dinormalisasi
    # (whitelist [a-z0-9_]) jadi aman dari injeksi. Nilai tanggal tetap di-bind.
    q = text(
        f'SELECT "{vcol}" FROM "{sch}"."{tbl}" '
        f'WHERE "{dcol}"::date = :d '
        f'ORDER BY "{dcol}" DESC LIMIT 1'
    )
    try:
        engine = get_postgres_engine()
        with engine.connect() as conn:
            row = conn.execute(q, {"d": date_str}).fetchone()
    except Exception:
        # tabel tidak ada / kolom beda / koneksi gagal -> carry-over dilewati
        return None

    if not row:
        return None
    return _to_number(row[0])


# ── inti service: terapkan carry-over ke hasil wide+diff ─────────────────────
def apply_carry_over(
    mapped_df: pd.DataFrame,
    raw_first_total: Optional[float] = None,
    *,
    date_col: str = "date",
    value_col: str = "follows_increase",
    schema_name: str = DEFAULT_DB_SCHEMA,
    raw_totals_table: str = "facebook_total_followers",
    raw_total_date_col: str = "date",
    raw_total_value_col: str = "total_followers",
) -> pd.DataFrame:
    """Perbaiki baris PERTAMA hasil mapping Follows Increase dgn carry-over.

    Parameters
    ----------
    mapped_df : DataFrame
        Hasil dari logika wide+diff yang SUDAH ADA (kolom date + follows_increase).
        Baris pertama biasanya NA (efek .diff()).
    raw_first_total : float, optional
        TOTAL followers mentah pada baris/tanggal PERTAMA file ini (mis. total
        25 Mei = 598032). Kalau diberikan, dipakai bersama total kemarin dari DB
        untuk menghitung increase baris pertama. Kalau None, fungsi mencoba tetap
        jalan (tetapi tanpa nilai total pertama, increase tak bisa dihitung ->
        baris pertama dibiarkan apa adanya).

    Logika:
        - Cari tanggal baris pertama (mis. 25 Mei) -> tanggal sebelumnya (24 Mei).
        - Query DB: total(24 Mei). Bila ADA dan raw_first_total ADA:
              follows_increase[0] = raw_first_total - total(24 Mei)
          -> File 2 baris pertama tidak lagi null.
        - Bila total kemarin TIDAK ada di DB (mis. ini File 1 / baseline awal):
              biarkan baris pertama apa adanya (null/0) -> sesuai rule #1.

    Tidak pernah melempar error karena data; semua kasus tepi -> no-op aman.
    """
    if mapped_df is None or mapped_df.empty:
        return mapped_df

    df = mapped_df.copy()

    # akses kolom AMAN (cegah undefined index)
    if date_col not in df.columns or value_col not in df.columns:
        # struktur tak terduga -> kembalikan apa adanya, jangan error
        return df

    # baris pertama berdasarkan tanggal paling awal (bukan sekadar index 0,
    # untuk jaga-jaga bila urutan tak tersortir)
    df = df.sort_values(date_col, kind="stable").reset_index(drop=True)

    first_idx = df.index[0]
    first_date = df.at[first_idx, date_col]
    first_val = df.at[first_idx, value_col]

    # Kalau baris pertama SUDAH terisi (bukan null), tidak perlu carry-over.
    if not _is_blank(first_val):
        return df

    # tanggal pertama harus valid
    ts_first = pd.to_datetime(first_date, errors="coerce")
    if pd.isna(ts_first):
        return df  # tak bisa hitung tanggal kemarin -> biarkan

    prev_date = ts_first - pd.Timedelta(days=1)

    # total kemarin dari DB (mis. total 24 Mei). None bila tak ada (baseline).
    prev_total = fetch_previous_total(
        prev_date,
        schema_name=schema_name,
        raw_totals_table=raw_totals_table,
        date_col=raw_total_date_col,
        total_col=raw_total_value_col,
    )

    first_total = _to_number(raw_first_total)

    # Hanya hitung bila DUA-DUANYA tersedia. Kalau salah satu None
    # (mis. File 1 baseline: prev_total None), biarkan baris pertama null/0.
    if prev_total is not None and first_total is not None:
        increase = first_total - prev_total
        df.at[first_idx, value_col] = int(increase) if float(increase).is_integer() else increase

    return df


def _extract_first_raw_total(uploaded_file) -> Optional[float]:
    """Ambil TOTAL followers mentah pada tanggal PERTAMA file wide.

    Dipakai supaya pemanggil tidak perlu menyuplai raw_first_total manual:
    kolom tanggal pertama (mis. 'May 25, 2026') -> nilai selnya = total 25 Mei.
    Gagal apa pun -> None (aman).
    """
    try:
        from proses_mapping_data_komersil import _read_upload_wide_aware
    except Exception:
        return None
    try:
        df, date_cols = _read_upload_wide_aware(uploaded_file)
    except Exception:
        return None
    if df is None or not date_cols:
        return None
    first_col = date_cols[0]
    if first_col not in df.columns:
        return None
    series = df[first_col].dropna()
    if series.empty:
        return None
    return _to_number(series.iloc[0])


def process_fb_increase(
    uploaded_file,
    channel: str = "facebook",
    category: str = "Follows Increase",
    *,
    schema_name: str = DEFAULT_DB_SCHEMA,
    raw_totals_table: str = "facebook_total_followers",
    raw_total_date_col: str = "date",
    raw_total_value_col: str = "total_followers",
) -> pd.DataFrame:
    """End-to-end: jalankan mapping wide+diff yang SUDAH ADA, lalu terapkan
    carry-over untuk baris pertama.

    Tidak mengubah proses_mapping_data; hanya memanggilnya lalu mem-post-process.
    """
    from proses_mapping_data_komersil import proses_mapping_data

    # 1) logika lama (unpivot + diff). Baris pertama -> NA (efek diff).
    mapped = proses_mapping_data(uploaded_file, channel, category)

    # 2) ambil total mentah baris pertama dari file (utk carry-over)
    #    reset pointer dulu kalau file-like
    try:
        uploaded_file.seek(0)
    except Exception:
        pass
    first_total = _extract_first_raw_total(uploaded_file)

    # 3) carry-over: baris pertama = total_hari_ini - total_kemarin(DB)
    return apply_carry_over(
        mapped,
        raw_first_total=first_total,
        schema_name=schema_name,
        raw_totals_table=raw_totals_table,
        raw_total_date_col=raw_total_date_col,
        raw_total_value_col=raw_total_value_col,
    )
