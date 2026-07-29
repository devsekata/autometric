
import pandas as pd


TIKTOK_OVERVIEW_COLUMNS = [
    "video_views", "reached_audience", "profile_views", "likes", "shares",
    "comments", "website_clicks", "phone_number_clicks", "leads_submission",
    "app_download_link_clicks", "net_growth", "new_followers", "lost_followers",
]


_TIKTOK_TITLE_TO_COLUMN = {
    "daily profile views": "profile_views",
    "daily shares": "shares",
    "daily post views": "video_views",
}


def _seek0(f):
    try:
        f.seek(0)
    except Exception:
        pass


def _parse_fpk_wide_metric(file_obj):
    """Format 1: FPK wide-date single-metric. Return DataFrame (date, <kolom>)
    atau None kalau bukan format ini / title-nya gak dikenali."""
    try:
        raw = pd.read_excel(file_obj, header=None)
    except Exception:
        return None
    finally:
        _seek0(file_obj)
    if raw.shape[0] < 6 or raw.shape[1] < 4:
        return None

    title = str(raw.iat[1, 1]).strip().lower()
    col_name = _TIKTOK_TITLE_TO_COLUMN.get(title)
    if col_name is None:
        return None
    if str(raw.iat[4, 1]).strip() != "Profile":
        return None

    header_row = raw.iloc[4]
    data_row = raw.iloc[5]
    dates, values = [], []
    for i in range(2, raw.shape[1]):
        d = pd.to_datetime(str(header_row[i]).strip(), errors="coerce")
        if pd.isna(d):
            continue
        v = pd.to_numeric(str(data_row[i]).replace(",", ""), errors="coerce")
        dates.append(d.date())
        values.append(v)
    if not dates:
        return None
    return pd.DataFrame({"date": dates, col_name: values})


def _repair_whole_line_quoted_csv(raw_bytes):
    """Excel kadang nyimpen ulang CSV dgn TIAP BARIS kebungkus 1 tanda kutip
    gede, bikin pandas baca itu sbg 1 kolom doang. Deteksi & lucuti kutip
    pembungkusnya per baris SEBELUM di-parse pandas. Return None kalau file
    tidak menunjukkan pola ini."""
    try:
        text = raw_bytes.decode("utf-8-sig")
    except Exception:
        return None
    lines = text.splitlines()
    non_empty = [ln for ln in lines if ln.strip()]
    if not non_empty:
        return None
    if not all(ln.strip().startswith('"') and ln.strip().endswith('"') for ln in non_empty):
        return None
    repaired = "\n".join(ln.strip()[1:-1] for ln in non_empty)
    return repaired.encode("utf-8")


def _read_csv_with_repair(file_obj):
    import io as _io
    try:
        raw_bytes = file_obj.read()
        if isinstance(raw_bytes, str):
            raw_bytes = raw_bytes.encode("utf-8")
    except Exception:
        raw_bytes = None
    _seek0(file_obj)
    if raw_bytes is not None:
        repaired = _repair_whole_line_quoted_csv(raw_bytes)
        if repaired is not None:
            return pd.read_csv(_io.BytesIO(repaired))
    return pd.read_csv(file_obj)


def _parse_simple_metric_file(file_obj):
    """Format 2: file simpel (date, <metric>) - kolom kedua HARUS persis
    nama kolom target skema tiktok/overview. Return None kalau tidak cocok."""
    df = None
    try:
        df = _read_csv_with_repair(file_obj)
    except Exception:
        _seek0(file_obj)
        try:
            df = pd.read_excel(file_obj)
        except Exception:
            return None
    finally:
        _seek0(file_obj)
    if df is None:
        return None
    df.columns = [str(c).strip() for c in df.columns]
    if "date" not in df.columns or len(df.columns) < 2:
        return None
    metric_cols = [c for c in df.columns if c != "date" and c in TIKTOK_OVERVIEW_COLUMNS]
    if not metric_cols:
        return None
    metric_col = metric_cols[0]
    out = df[["date", metric_col]].copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce").dt.date
    out[metric_col] = pd.to_numeric(out[metric_col], errors="coerce")
    return out.dropna(subset=["date"])


def proses_mapping_tiktok_overview(file_objs):
    """Gabungin BANYAK file single-metric TikTok Overview (campuran format 1
    & 2 boleh) jadi 1 DataFrame wide, 'date' sbg kunci gabung (outer join -
    tanggal yg cuma ada di sebagian file tetap masuk, kolom lain NULL utk
    tanggal itu, bukan hilang barisnya)."""
    parsed = []
    for f in file_objs:
        d = _parse_fpk_wide_metric(f)
        if d is None:
            d = _parse_simple_metric_file(f)
        if d is not None and not d.empty:
            parsed.append(d)

    if not parsed:
        return pd.DataFrame(columns=["date"] + TIKTOK_OVERVIEW_COLUMNS)

    result = parsed[0]
    for d in parsed[1:]:
        result = result.merge(d, on="date", how="outer")

    for col in TIKTOK_OVERVIEW_COLUMNS:
        if col not in result.columns:
            result[col] = pd.NA

    return result.sort_values("date").reset_index(drop=True)