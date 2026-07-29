
import re
import pandas as pd
import os

# Path file acuan skema. Cari beberapa kemungkinan nama (1g / 2g, dll)
# supaya tidak gagal hanya karena beda satu huruf di nama file.
_SPEC_CANDIDATES = [
    "native_column_with_fpk_mappingg.xlsx",
    "native_column_with_fpk_mapping.xlsx",
    "native_column.xlsx",
]

def _find_spec_path():
    # 1) cari di folder kerja & folder skrip ini
    search_dirs = [os.getcwd(), os.path.dirname(os.path.abspath(__file__))]
    for d in search_dirs:
        for name in _SPEC_CANDIDATES:
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p
    # 2) fallback: nama pertama (akan error jelas kalau benar2 tak ada)
    return _SPEC_CANDIDATES[0]

SPEC_PATH = _find_spec_path()
SPEC_SHEET = "ig"

# Nilai yang dianggap "tidak ada sumber" di kolom 'metrics di fpk'
_NO_SOURCE = {"-", "", "nan", "none"}

# Frasa deskriptif (BUKAN nama kolom FPK) yang menandakan kolom tsb TIDAK
# punya sumber langsung di file FPK dan diisi rule internal / Mapping Engine,
# atau memang tidak tersedia. Jika 'metrics di fpk' mengandung salah satu
# frasa ini, kolom target dibiarkan NA — JANGAN dicoba fuzzy-match ke kolom
# manapun (mencegah salah-petakan kalimat panjang ke kolom acak).
_NO_SOURCE_MARKERS = (
    "tidak ada di fpk",
    "tidak ada direct",
    "tidak ada",
    "diisi/di-handle",
    "di-handle oleh mapping engine",
    "rule internal",
    "mapping engine",
)

# Penanda derivasi DESKRIPTIF (bukan rumus '+'): mis. 'Derived dari post type:
# ...' atau 'Derived dari Paid reach ... > 0'. Ini aturan turunan yang dihitung
# di luar pemetaan kolom sederhana → target dibiarkan NA di sini.
_DERIVED_RULE_MARKERS = (
    "derived dari",
    "derived from",
)


def _clean_spec_metric(metric_text):
    """Bersihkan teks 'metrics di fpk' jadi kandidat nama kolom FPK yang bisa
    dicocokkan. Menangani pola:
      - Catatan dalam kurung di akhir   : 'Profile (perlu cek: ...)' → 'Profile'
      - Penjelasan setelah ';'          : 'X; alternatif: Y' → bagian 'alternatif'
      - Prefix 'alternatif[ paid/organic]:' → ambil teks sesudahnya
    Return string kandidat (bisa kosong)."""
    text = str(metric_text).strip()

    # Jika ada klausa 'alternatif...: <kolom>', pakai bagian alternatifnya
    # sebagai sumber (mis. 'Tidak ada direct di Robz; alternatif: Views of
    # videos' → 'Views of videos').
    m = re.search(r"alternatif[^:]*:\s*(.+)$", text, flags=re.IGNORECASE)
    if m:
        text = m.group(1).strip()
    else:
        # buang penjelasan setelah ';' (biasanya catatan, bukan nama kolom)
        text = text.split(";")[0].strip()

    # buang catatan dalam kurung di akhir (mis. '(perlu cek: ...)', '(organic)'
    # TIDAK dibuang karena bagian nama; hanya buang kurung yang berisi catatan
    # berbahasa Indonesia / instruksi). Heuristik: buang kurung di ujung yang
    # mengandung kata catatan ('perlu', 'cek', 'biasanya', 'jika', 'kalau').
    text = re.sub(
        r"\s*\((?=[^)]*(?:perlu|cek|biasanya|jika|kalau|tersedia|bukan))[^)]*\)\s*$",
        "", text, flags=re.IGNORECASE,
    ).strip()
    return text


def _resolve_fpk_column(fpk_name, available_cols):
    """Cari kolom FPK di file. Urutan: (1) persis, (2) coba seluruh nama dulu,
    lalu pisah alternatif 'A / B', (3) fuzzy abaikan kata variasi & tanda baca.
    Return nama kolom asli di file, atau None."""
    def n(s):
        return re.sub(r"\s+", " ", str(s).strip().lower())
    avail_n = {n(c): c for c in available_cols}

    # bersihkan catatan/penjelasan agar tidak mengganggu pencocokan
    fpk_name = _clean_spec_metric(fpk_name)

    # (0) PERSIS sama persis (case-sensitive). WAJIB lebih dulu dari pencocokan
    #     lower-case: file FPK bisa punya DUA kolom yang beda HANYA di kapital,
    #     mis. 'network' (kecil) vs 'Network' (besar). Tanpa cek ini, dict
    #     lower-case (avail_n) akan menimpa salah satunya & spec bisa salah ambil.
    fpk_trim = re.sub(r"\s+", " ", str(fpk_name).strip())
    for c in available_cols:
        if re.sub(r"\s+", " ", str(c).strip()) == fpk_trim:
            return c

    # (1) persis lower-case (nama UTUH lebih dulu — penting utk kolom yang memang
    #     mengandung '/', mis. 'Number of Shares/Reposts/Quotes')
    if n(fpk_name) in avail_n:
        return avail_n[n(fpk_name)]

    # (2) alternatif dipisah '/': coba tiap bagian (hanya jika nama utuh gagal)
    for part in str(fpk_name).split("/"):
        part = part.strip()
        if part and n(part) in avail_n:
            return avail_n[n(part)]

    # (3) fuzzy: buang kata variasi & tanda baca, cocokkan inti kata
    STOPV = {"organic", "total", "per", "post", "posts", "of", "the", "based",
             "up", "summed", "number", "a"}
    def core(s):
        s = re.sub(r"[^a-z0-9 ]", " ", n(s))
        return set(w for w in s.split() if w and w not in STOPV)

    # Penanda 'organik' vs 'berbayar' bersifat diskriminatif & WAJIB:
    #   - Bila spesifikasi minta 'Paid ...', HANYA kolom yang juga 'Paid' yang
    #     boleh cocok. Kolom netral (mis. 'Impressions/views of posts' tanpa
    #     kata paid/organic) TIDAK boleh dipakai utk mengisi metrik paid —
    #     kalau tak ada kolom paid asli, kolom target dibiarkan NA.
    #   - Sebaliknya utk 'Organic ...'.
    #   - Spesifikasi netral tetap boleh cocok ke kolom netral MAUPUN organic
    #     (FPK Robz default-nya organic), tapi TIDAK ke kolom paid.
    def _polarity(s):
        sl = n(s)
        has_paid = "paid" in sl or "berbayar" in sl
        has_org = "organic" in sl or "organik" in sl
        if has_paid and not has_org:
            return "paid"
        if has_org and not has_paid:
            return "organic"
        return None
    tgt_pol = _polarity(fpk_name)

    target = core(fpk_name)
    if not target:
        return None
    best, best_score = None, 0.0
    for cn, orig in avail_n.items():
        cc = core(cn)
        if not cc:
            continue
        col_pol = _polarity(orig)
        if tgt_pol == "paid":
            # metrik paid HARUS dari kolom paid eksplisit
            if col_pol != "paid":
                continue
        elif tgt_pol == "organic":
            # metrik organic HARUS dari kolom organic eksplisit
            if col_pol != "organic":
                continue
        else:
            # spesifikasi netral: jangan ambil kolom paid
            if col_pol == "paid":
                continue
        j = len(target & cc) / len(target | cc)
        if j > best_score:
            best_score, best = j, orig
    # ambang 0.6 supaya tidak salah-cocok
    return best if best_score >= 0.6 else None


def _norm(s) -> str:
    """Samakan untuk pencocokan: lowercase + strip. Atasi trailing space &
    perbedaan kapitalisasi pada channel/kategori ('Post ' vs 'post')."""
    return str(s).strip().lower()


def _load_spec(spec_path: str = None, sheet: str = SPEC_SHEET) -> pd.DataFrame:
    """Baca sheet acuan & forward-fill channel/kategori (efek merged cell)."""
    if spec_path is None:
        spec_path = _find_spec_path()
    if not os.path.exists(spec_path):
        raise FileNotFoundError(
            f"File acuan skema tidak ditemukan. Dicari: {_SPEC_CANDIDATES} "
            f"di folder {os.getcwd()}. Pastikan file native_column ada di folder app."
        )
    spec = pd.read_excel(spec_path, sheet_name=sheet, engine="openpyxl")
    spec.columns = [str(c).strip().lower() for c in spec.columns]
    # ffill kolom yang terkena merged cell
    spec["channel"] = spec["channel"].ffill()
    spec["kategori"] = spec["kategori"].ffill()
    # bersihkan whitespace nilai teks
    for c in ["channel", "kategori", "kolom", "tipe data", "metrics di fpk"]:
        if c in spec.columns:
            spec[c] = spec[c].astype(str).str.strip()
    return spec


def _has_no_source(metric_text: str) -> bool:
    """True bila 'metrics di fpk' adalah frasa deskriptif tanpa sumber kolom
    langsung (diisi rule internal / tidak tersedia / aturan turunan deskriptif).
    Kolom seperti ini dibiarkan NA dan TIDAK dicoba dicocokkan ke kolom apapun."""
    s = str(metric_text).strip().lower()
    if s in _NO_SOURCE:
        return True
    # RUMUS DERIVED ('+') selalu menang: walau ada catatan '(... tidak ada
    # engagements direct)', kolom tetap dihitung dari komponen penyusunnya.
    # (mis. engagements Twitter = Likes + comments + Shares). Jangan dianggap
    # no-source hanya karena catatan mengandung kata 'tidak ada'.
    if "+" in s:
        return False
    # frasa 'tidak ada...', 'diisi/di-handle...', 'rule internal', dll
    for mark in _NO_SOURCE_MARKERS:
        if mark in s:
            # pengecualian: bila ada klausa 'alternatif: <kolom>', masih ada
            # sumber yang bisa dipakai → JANGAN anggap no-source.
            if "alternatif" in s and ":" in s.split("alternatif", 1)[1]:
                return False
            return True
    # 'Derived dari ...' deskriptif (BUKAN rumus '+') → aturan turunan,
    # tak ada kolom FPK langsung. (Rumus '+' ditangani _is_derived.)
    if "+" not in s:
        for mark in _DERIVED_RULE_MARKERS:
            if s.startswith(mark):
                return True
    return False


def _is_derived(metric_text: str) -> bool:
    """True bila instruksi mengandung penjumlahan beberapa metrik (tanda '+')."""
    return "+" in str(metric_text)


def _parse_derived_parts(metric_text: str) -> list:
    """Ambil daftar nama metrik penyusun dari instruksi derived.

    Contoh input:
      'Derived: Likes (total) + Comments (total) + Number of Shares'
    →  ['Likes (total)', 'Comments (total)', 'Number of Shares']

    Membuang prefix 'Derived:' dan keterangan dalam tanda kurung di AKHIR
    instruksi (mis. '... (FPK tidak ada engagements direct)') serta catatan
    setelah koma (mis. ', kalau ada yang gada ...').
    """
    text = str(metric_text)
    # buang prefix 'Derived:' (case-insensitive)
    text = re.sub(r"^\s*derived\s*:\s*", "", text, flags=re.IGNORECASE)
    # buang catatan setelah koma pertama (penjelasan, bukan bagian rumus)
    text = text.split(",")[0]
    # buang keterangan kurung di akhir yang merupakan komentar, BUKAN bagian nama
    # (heuristik: kurung yang muncul setelah seluruh rumus '+', biasanya komentar)
    parts = [p.strip() for p in text.split("+")]
    cleaned = []
    for p in parts:
        # buang komentar dalam kurung di ujung tiap bagian bila ada penjelasan FPK
        p = re.sub(r"\s*\(FPK[^)]*\)\s*$", "", p, flags=re.IGNORECASE).strip()
        if p:
            cleaned.append(p)
    return cleaned


def _numeric_from_excel(series: pd.Series) -> pd.Series:
    """Ubah series → numeric, AMAN untuk kolom angka yang dibaca pandas sebagai
    datetime.

    Penyebab: di file FPK, kolom angka kecil (mis. duration_sec, repost) sering
    tersimpan di Excel sebagai sel ber-FORMAT tanggal. pandas membacanya jadi
    Timestamp. Kalau langsung pd.to_numeric, datetime dikonversi ke epoch NANO-
    detik (mis. -2.2e18) → overflow kolom integer PostgreSQL.

    Yang dimaksud sebenarnya adalah ANGKA SERIAL Excel (1900-01-01 = 1,
    1900-04-09 = 100, dst). Jadi untuk nilai datetime kita pulihkan serial-nya:
        serial = (tanggal - 1899-12-30).days
    (basis 1899-12-30 mengikuti konvensi Excel termasuk bug tahun kabisat 1900).
    """
    s = series
    # Deteksi apakah ada nilai datetime di dalam kolom.
    if pd.api.types.is_datetime64_any_dtype(s):
        dt = pd.to_datetime(s, errors="coerce")
        base = pd.Timestamp("1899-12-30")
        return (dt - base).dt.days.astype("float")
    if s.dtype == object:
        # kolom campuran: konversi elemen Timestamp jadi serial, sisanya numeric
        base = pd.Timestamp("1899-12-30")
        def _conv(v):
            if isinstance(v, (pd.Timestamp,)) or hasattr(v, "to_pydatetime"):
                try:
                    return float((pd.Timestamp(v) - base).days)
                except Exception:
                    return pd.NA
            return v
        s = s.map(_conv)
    return pd.to_numeric(s, errors="coerce")


def _cast_series(series: pd.Series, tipe: str) -> pd.Series:
    """Type-cast satu kolom sesuai 'tipe data' di skema PostgreSQL."""
    t = str(tipe).strip().upper()
    try:
        if t.startswith("VARCHAR") or t == "TEXT" or t == "CHAR":
            def _to_str(v):
                if v is None or (isinstance(v, float) and pd.isna(v)):
                    return None
                # float bulat (mis. hasil derived 6.0) → '6', bukan '6.0'
                if isinstance(v, float) and v.is_integer():
                    return str(int(v))
                return str(v)
            return series.astype("object").where(series.notna(), None).apply(_to_str)
        if t == "INTEGER" or t == "INT" or t == "BIGINT" or t == "SMALLINT":
            # Int64 = integer nullable (boleh ada NA).
            # _numeric_from_excel: amankan kolom angka yang terbaca sbg datetime
            # (serial Excel) supaya tidak jadi epoch nanodetik → overflow integer.
            return _numeric_from_excel(series).round().astype("Int64")
        if t == "FLOAT" or t == "DOUBLE PRECISION" or t == "NUMERIC" or t == "DECIMAL" or t == "REAL":
            return _numeric_from_excel(series).astype("float")
        if t == "BOOLEAN" or t == "BOOL":
            return series.map(lambda v: _to_bool(v))
        if t in ("TIMESTAMP", "DATETIME", "DATE"):
            return pd.to_datetime(series, errors="coerce")
        # fallback: biarkan apa adanya sebagai string
        return series.astype("object")
    except Exception:
        # jangan sampai casting menggagalkan seluruh proses
        return series


def _to_bool(v):
    if pd.isna(v):
        return None
    s = str(v).strip().lower()
    if s in ("true", "1", "yes", "y", "t", "ya"):
        return True
    if s in ("false", "0", "no", "n", "f", "tidak"):
        return False
    return None


def _detect_header_row(uploaded_file, is_csv):
    """Tentukan indeks baris header file upload.

    DUA format didukung:
      • NATIVE (export platform / CSV dummy): header ada di BARIS 1 (index 0).
      • FPK (Fanpage Karma): ada 4 baris metadata di atas, header di BARIS 5
        (index 4) — biasanya baris yang memuat 'Date' + banyak kolom.

    Heuristik: baca mentah tanpa header, lalu pilih baris pertama (di antara 8
    baris awal) yang 'paling seperti header': sel-selnya non-kosong, pendek,
    bukan angka/tanggal, dan idealnya memuat token 'date'. Kalau tidak ada yang
    meyakinkan, fallback: index 0 (native) — lebih aman daripada header=4 yang
    akan menelan header asli file native.
    """
    import io
    def _seek0(f):
        try:
            f.seek(0)
        except Exception:
            pass
    _seek0(uploaded_file)
    try:
        if is_csv:
            raw = pd.read_csv(uploaded_file, header=None, dtype=object,
                              keep_default_na=False, nrows=8)
        else:
            raw = pd.read_excel(uploaded_file, header=None, dtype=object,
                                keep_default_na=False, engine="openpyxl", nrows=8)
    except Exception:
        return 0
    finally:
        _seek0(uploaded_file)

    def _is_label(v):
        s = str(v).strip()
        if s == "" or s.lower() in ("nan", "none"):
            return False
        # angka murni / tanggal → bukan label header
        if re.fullmatch(r"[-+]?\d+(\.\d+)?", s):
            return False
        if pd.notna(pd.to_datetime(s, errors="coerce")) and len(s) >= 6:
            return False
        return True

    best_i, best_score = None, -1
    for i in range(len(raw)):
        cells = raw.iloc[i].tolist()
        labels = [c for c in cells if _is_label(c)]
        nonempty = [c for c in cells if str(c).strip() != ""]
        if not nonempty:
            continue
        score = len(labels)
        # bonus kuat bila baris memuat token 'date' (penanda header umum)
        if any(str(c).strip().lower() == "date" for c in cells):
            score += 10
        # rasio label tinggi → makin yakin baris header
        if len(labels) == len(nonempty) and len(nonempty) >= 1:
            score += 2
        if score > best_score:
            best_score, best_i = score, i

    return best_i if best_i is not None else 0


def _repair_whole_line_quoted_csv(raw_bytes):
    """Excel kadang nyimpen ulang CSV dgn TIAP BARIS kebungkus 1 tanda kutip
    gede (mis. '"date,content_interactions"\\r\\n"2026-06-01,5827"\\r\\n...'),
    bikin pandas baca itu sbg 1 kolom doang (koma di dalam kutip dianggap
    bagian isi field, bukan pemisah). Deteksi pola ini & lucuti kutip
    pembungkusnya per baris SEBELUM di-parse pandas. Return None kalau file
    tidak menunjukkan pola ini (biar caller pakai bytes asli apa adanya)."""
    try:
        text = raw_bytes.decode("utf-8-sig")
    except Exception:
        return None
    lines = text.splitlines()
    if not lines:
        return None
    non_empty = [ln for ln in lines if ln.strip()]
    if not non_empty:
        return None
    if not all(ln.strip().startswith('"') and ln.strip().endswith('"') for ln in non_empty):
        return None
    repaired = "\n".join(ln.strip()[1:-1] for ln in non_empty)
    return repaired.encode("utf-8")


def _read_upload(uploaded_file):
    """Baca file upload dengan deteksi baris header otomatis (native baris-1 vs
    FPK baris-5). Dukung xlsx & csv. Untuk BytesIO/file-like, reset pointer
    sebelum tiap percobaan baca."""
    import io
    def _seek0(f):
        try:
            f.seek(0)
        except Exception:
            pass
    name = getattr(uploaded_file, "name", "")
    is_csv = _detect_is_csv(uploaded_file)

    if is_csv:
        _seek0(uploaded_file)
        try:
            raw_bytes = uploaded_file.read()
            if isinstance(raw_bytes, str):
                raw_bytes = raw_bytes.encode("utf-8")
            repaired = _repair_whole_line_quoted_csv(raw_bytes)
            if repaired is not None:
                uploaded_file = io.BytesIO(repaired)
                uploaded_file.name = name
        except Exception:
            pass
        _seek0(uploaded_file)

    hdr = _detect_header_row(uploaded_file, is_csv)

    if is_csv:
        _seek0(uploaded_file)
        return pd.read_csv(uploaded_file, header=hdr)
    try:
        _seek0(uploaded_file)
        return pd.read_excel(uploaded_file, header=hdr, engine="openpyxl")
    except Exception:
        _seek0(uploaded_file)
        return pd.read_csv(uploaded_file, header=hdr)



_WIDE_DIFF_CATEGORIES = {"follows increase", "followers increase", "follows_increase"}


def _looks_like_date(value):
    s = str(value).strip()
    if len(s) < 5:
        return False
    return pd.notna(pd.to_datetime(s, errors="coerce"))


def _parse_dates_robust(series):
    """Parse kolom tanggal dgn AMAN untuk label campuran bulan.

    Masalah: pd.to_datetime tanpa format akan 'mengunci' format dari elemen
    PERTAMA, lalu elemen bulan lain bisa gagal. Contoh nyata: header wide
    'May 25, 2026' ter-parse, tapi 'Jun 1, 2026' / 'Jul 1, 2026' / 'Aug 31, 2026'
    jadi NaT → date kosong & data terpotong.

    Solusi: pakai format='mixed' (parse tiap elemen mandiri). Bila versi pandas
    tak mendukung 'mixed', fallback ke parsing per-elemen.
    """
    s = pd.Series(series)
    try:
        return pd.to_datetime(s, errors="coerce", format="mixed")
    except (ValueError, TypeError):
        try:
            return pd.to_datetime(s, errors="coerce")
        except Exception:
            return s.map(lambda v: pd.to_datetime(v, errors="coerce"))


def _detect_is_csv(uploaded_file):
    """Tentukan apakah file CSV atau Excel, TAHAN tanpa .name.

    Urutan:
      1) Kalau ada .name → pakai ekstensi (.csv).
      2) Kalau tidak ada .name (mis. BytesIO mentah dari app) → sniff byte
         awal. XLSX adalah file ZIP → diawali 'PK\\x03\\x04'. Kalau bukan ZIP,
         anggap teks/CSV.
    Ini penting: app memanggil proses_mapping_data dgn BytesIO(raw_bytes) tanpa
    .name, sehingga file CSV WIDE (total followers) tadinya salah dibaca sebagai
    Excel → gagal → hasil kosong.
    """
    name = str(getattr(uploaded_file, "name", "")).lower()
    if name.endswith(".csv"):
        return True
    if name.endswith((".xlsx", ".xls", ".xlsm", ".xltx")):
        return False
    # tidak ada nama yang jelas → sniff magic bytes
    head = b""
    try:
        pos = uploaded_file.tell()
    except Exception:
        pos = None
    try:
        uploaded_file.seek(0)
        head = uploaded_file.read(4)
    except Exception:
        head = b""
    finally:
        try:
            uploaded_file.seek(pos if pos is not None else 0)
        except Exception:
            pass
    if isinstance(head, str):
        head = head.encode("utf-8", "ignore")
    # XLSX/zip signature
    if head[:4] == b"PK\x03\x04":
        return False
    # selain itu anggap teks/CSV
    return True


def _read_upload_wide_aware(uploaded_file):
    """Baca file mentah tanpa header utk mendeteksi baris header & kolom tanggal.

    Kembalikan (df_with_header, date_columns). Bila bukan format wide,
    date_columns akan kosong dan df dibaca seperti biasa (header=4)."""
    import io
    def _seek0(f):
        try:
            f.seek(0)
        except Exception:
            pass

    name = str(getattr(uploaded_file, "name", "")).lower()
    is_csv = _detect_is_csv(uploaded_file)

    # baca mentah tanpa header utk cari baris header (banyak kolom tanggal)
    _seek0(uploaded_file)
    try:
        if is_csv:
            raw = pd.read_csv(uploaded_file, header=None, dtype=object, keep_default_na=False)
        else:
            raw = pd.read_excel(uploaded_file, header=None, dtype=object,
                                keep_default_na=False, engine="openpyxl")
    except Exception:
        return None, []

    header_row = None
    for i in range(min(8, len(raw))):
        n_date = sum(1 for c in raw.iloc[i].tolist() if _looks_like_date(c))
        if n_date >= 3:
            header_row = i
            break
    if header_row is None:
        return None, []  # bukan wide

    _seek0(uploaded_file)
    if is_csv:
        df = pd.read_csv(uploaded_file, header=header_row)
    else:
        df = pd.read_excel(uploaded_file, header=header_row, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]
    date_cols = [c for c in df.columns if _looks_like_date(c)]
    return df, date_cols


def _handle_wide_category(uploaded_file, sub, kategori_pilihan):
    """Tangani file FPK WIDE utk kategori time-series single-metric.

    sub = baris spec (channel+kategori) yang sudah difilter. Kategori ini punya
    2 kolom target: 'date' (DATETIME) + satu kolom nilai (INTEGER).
    Mengembalikan DataFrame siap-insert, atau None bila file BUKAN format wide
    (biar alur normal yang menangani)."""
    df, date_cols = _read_upload_wide_aware(uploaded_file)
    if df is None or len(date_cols) < 3:
        return None

    target_cols = [str(c).strip() for c in sub["kolom"].tolist()]
    types = {str(r["kolom"]).strip(): str(r["tipe data"]).strip() for _, r in sub.iterrows()}

    # tentukan kolom tanggal & kolom nilai dari spec
    date_target = next((c for c in target_cols if types.get(c, "").upper() == "DATETIME"), None)
    value_targets = [c for c in target_cols if c != date_target]
    if date_target is None or not value_targets:
        return None
    value_col = value_targets[0]

    long = df[date_cols].melt(var_name=date_target, value_name=value_col)
    long[date_target] = _parse_dates_robust(long[date_target])
    long[value_col] = pd.to_numeric(
        long[value_col].astype(str).str.replace(",", "", regex=False), errors="coerce")
    long = long.sort_values(date_target).reset_index(drop=True)

    # Follows Increase: nilai sumber = TOTAL followers kumulatif → diff jadi
    # growth harian. TAPI bila nilainya sudah berupa delta (ada angka NEGATIF —
    # total kumulatif mustahil negatif), berarti sudah growth; jangan di-diff
    # lagi (mencegah double-diff). Pakai nilai apa adanya.
    if _norm(kategori_pilihan) in _WIDE_DIFF_CATEGORIES:
        numeric_vals = long[value_col].dropna()
        already_delta = len(numeric_vals) > 0 and (numeric_vals < 0).any()
        if not already_delta:
            long[value_col] = long[value_col].diff()
            # ATURAN OVERLAP 1-HARI (kesepakatan dgn client):
            # File ke-2 dst di-upload dgn menambah 1 hari di depan (hari terakhir
            # file sebelumnya) sbg JANGKAR untuk diff, supaya baris "asli" pertama
            # tidak null. Baris jangkar itu sendiri (hasil diff = NaN) TIDAK boleh
            # ikut masuk DB, karena:
            #   (a) nilainya null, dan
            #   (b) tanggal itu sudah ada dari import file sebelumnya → duplikat.
            # Jadi buang baris pertama HANYA bila memang NaN (efek diff/jangkar).
            if len(long) > 0 and pd.isna(long[value_col].iloc[0]):
                long = long.iloc[1:].reset_index(drop=True)

    out = pd.DataFrame(index=long.index)
    for col in target_cols:
        out[col] = long[col] if col in long.columns else pd.NA
    for col in out.columns:
        out[col] = _cast_series(out[col], types.get(col, "TEXT"))
    return out.reset_index(drop=True)

# ── Penanganan file FPK 'overview' SINGLE-METRIC utk Audience ─────────────
# Beberapa export FPK utk Audience datang sbg 4 FILE TERPISAH per breakdown
# (Age / Gender / World Map of Followers / Top Cities of Followers), BUKAN 1
# file gabungan spt dummy CSV. Formatnya: delimiter ';' (BUKAN ','), 4 baris
# metadata di atas, header asli di baris ke-5 ('Profile;Network;<value>;...'),
# & ada baris '(Comparison period)' yg harus dibuang.
#
# Keputusan produk (revisi): SEMUA kategori per file disimpan (bukan cuma yg
# paling dominan). Skema jadi LONG FORMAT: 1 baris = 1 kategori breakdown,
# kolom (date, breakdown_type, category, value, percentage). Key unik utk
# UPSERT = (date, breakdown_type, category) — bukan 'date' doang, krn 1
# tanggal sekarang boleh py banyak baris (satu per age range/gender/kota/
# negara). Ke-4 file (Age/Gender/World Map/Top Cities) tetap di-upload
# terpisah, tapi masing-masing SELF-CONTAINED (gak perlu saling melengkapi via
# COALESCE lagi) krn breakdown_type membedakan asal filenya.
_FPK_AUDIENCE_TITLE_MAP = {
    "age": "age",
    "gender": "gender",
    "world map of followers": "top_country",
    "top cities of followers": "top_city",
}
_FPK_AUDIENCE_LONG_COLS = ["date", "breakdown_type", "category", "value", "percentage"]


def _read_fpk_semicolon_raw(uploaded_file):
    """Baca file mentah dgn delimiter ';' (format FPK 'overview' report).
    Return None bila bukan CSV atau gagal parse (biar caller fallback aman)."""
    def _seek0(f):
        try:
            f.seek(0)
        except Exception:
            pass
    if not _detect_is_csv(uploaded_file):
        return None
    _seek0(uploaded_file)
    try:
        raw = pd.read_csv(uploaded_file, sep=";", header=None, dtype=str, encoding="utf-8-sig")
    except Exception:
        return None
    finally:
        _seek0(uploaded_file)
    return raw


def _handle_twitter_overview_direct(uploaded_file, sub, channel_pilihan, kategori_pilihan):
    """Tangani file Twitter/X 'Overview' yg SUDAH RAPI (header di baris
    pertama, nama kolom udah persis sama kayak kolom target DB - BUKAN
    format FPK ber-metadata 4-baris seperti kategori lain). Return None
    bila file INI BUKAN file Overview yg sah (mis. ternyata file
    follower-growth yg ke-upload sendirian tanpa pasangannya, atau kolom
    yg cocok kurang dari 4) - biar alur normal yg coba, DAN supaya file
    yg jelas bukan Overview tidak dipaksa diisi asal oleh fungsi ini.
    """
    if _norm(channel_pilihan) != "twitter" or _norm(kategori_pilihan) != "overview":
        return None

    def _seek0(f):
        try:
            f.seek(0)
        except Exception:
            pass

    # File follower-growth (dipakai jg utk Content Analytics) punya sheet
    # bernama persis ini - BUKAN file Overview, jangan dipaksa proses di sini.
    try:
        xl = pd.ExcelFile(uploaded_file)
        is_followers_file = "X Followers Net Growth" in xl.sheet_names
    except Exception:
        is_followers_file = False
    _seek0(uploaded_file)
    if is_followers_file:
        return None

    try:
        df = pd.read_excel(uploaded_file)
    except Exception:
        _seek0(uploaded_file)
        try:
            df = pd.read_csv(uploaded_file)
        except Exception:
            return None
    _seek0(uploaded_file)
    df.columns = [str(c).strip() for c in df.columns]

    target_cols = [str(c).strip() for c in sub["kolom"].tolist()]
    types = {str(r["kolom"]).strip(): str(r["tipe data"]).strip() for _, r in sub.iterrows()}

    # Minimal harus punya 'date' + setidaknya beberapa kolom metrik ASLI
    # (bukan cuma 1 kebetulan cocok) baru dianggap file Overview yg sah.
    matched = [c for c in target_cols if c in df.columns and c != "date"]
    if "date" not in df.columns or len(matched) < 4:
        return None

    out = pd.DataFrame({c: [pd.NA] * len(df) for c in target_cols})
    out["date"] = df["date"].values
    for c in matched:
        out[c] = df[c].values
    for col in out.columns:
        out[col] = _cast_series(out[col], types.get(col, "TEXT"))
    return out


def _handle_fpk_audience_breakdown(uploaded_file, sub):
    """Tangani file FPK 'overview' SINGLE-METRIC utk Audience (lihat catatan di
    atas). Mengembalikan DataFrame LONG FORMAT — 1 baris PER KATEGORI (semua
    age range / semua gender / semua kota / semua negara di file ini, bukan
    cuma yg dominan), kolom (date, breakdown_type, category, value,
    percentage). Return None bila file BUKAN format ini (biar alur normal yg
    menangani)."""
    raw = _read_fpk_semicolon_raw(uploaded_file)
    if raw is None or raw.shape[0] < 6 or raw.shape[1] < 4:
        return None

    title = str(raw.iat[1, 1]).strip().lower()
    breakdown = _FPK_AUDIENCE_TITLE_MAP.get(title)
    if breakdown is None:
        return None
    if str(raw.iat[4, 1]).strip() != "Profile":
        return None  # bukan struktur FPK overview yg dikenali

    target_cols = [str(c).strip() for c in sub["kolom"].tolist()]
    types = {str(r["kolom"]).strip(): str(r["tipe data"]).strip() for _, r in sub.iterrows()}
    if not set(_FPK_AUDIENCE_LONG_COLS).issubset(set(target_cols)):
        return None  # skema Audience blm format long → biar alur normal yg coba

    gen_date_cells = raw.iloc[1].dropna()
    gen_date = (
        pd.to_datetime(str(gen_date_cells.iloc[-1]).strip(), errors="coerce")
        if len(gen_date_cells) else pd.NaT
    )

    data = raw.iloc[5:].reset_index(drop=True)
    data = data.rename(columns={1: "label", 3: "raw_value"})[["label", "raw_value"]]
    data = data.dropna(subset=["label"])
    data = data[data["label"].astype(str).str.strip() != ""]
    data = data[~data["label"].astype(str).str.contains(r"\(Comparison period\)", na=False)]
    if data.empty:
        return None
    data["raw_value"] = pd.to_numeric(
        data["raw_value"].astype(str).str.replace(",", ".", regex=False), errors="coerce")
    data = data.dropna(subset=["raw_value"])
    if data.empty:
        return None

    if breakdown == "gender":
        # nilai FPK utk Gender SUDAH berupa fraksi (mis. 0,49085), bukan count
        data["pct"] = data["raw_value"]
    else:
        total = data["raw_value"].sum()
        data["pct"] = data["raw_value"] / total if total else 0.0

    # SEMUA kategori disimpan (bukan cuma yg paling dominan) — 1 baris/kategori
    out = pd.DataFrame({
        "date": gen_date,
        "breakdown_type": breakdown,
        "category": data["label"].astype(str).str.strip(),
        "value": data["raw_value"],
        "percentage": data["pct"],
    }).reset_index(drop=True)

    for col in out.columns:
        out[col] = _cast_series(out[col], types.get(col, "TEXT"))
    return out

def proses_mapping_data(uploaded_file, channel_pilihan, kategori_pilihan,
                        spec_path: str = None, spec_sheet: str = SPEC_SHEET):
    """
    Transformasi file FPK upload menjadi DataFrame siap-insert ke PostgreSQL.

    Parameters
    ----------
    uploaded_file : path / file-like / BytesIO
        File FPK yang di-upload user (xlsx). Data asli dimulai baris ke-4
        (header=4).
    channel_pilihan : str
        Channel dari UI (instagram/facebook/tiktok/twitter).
    kategori_pilihan : str
        Kategori dari UI (mis. 'Post', 'Content Views').
    spec_path, spec_sheet : str
        Lokasi & sheet file acuan skema.

    Returns
    -------
    pandas.DataFrame
        Kolom = nama kolom target database (sesuai 'kolom' di skema),
        tipe data sudah di-cast, kolom derived sudah dihitung.
    """
    # 1. PRE-PROCESSING SKEMA + ffill
    spec = _load_spec(spec_path, spec_sheet)

    # 2. FILTER skema utk channel + kategori terpilih (case/space-insensitive)
    mask = (spec["channel"].map(_norm) == _norm(channel_pilihan)) & \
           (spec["kategori"].map(_norm) == _norm(kategori_pilihan))
    sub = spec.loc[mask].copy()
    if sub.empty:
        raise ValueError(
            f"Skema untuk channel='{channel_pilihan}', "
            f"kategori='{kategori_pilihan}' tidak ditemukan di sheet '{spec_sheet}'."
        )

    # 2b. KASUS KHUSUS: file FPK format WIDE time-series (tanggal jadi kolom).
    #     Mis. Profile Reach / Profile Visit / Content Views / Follows Increase.
    #     Bila terdeteksi, unpivot (+ diff utk Follows Increase) & langsung
    #     kembalikan; alur normal (header=4, long) di-skip.
    wide_out = _handle_wide_category(uploaded_file, sub, kategori_pilihan)
    if wide_out is not None:
        return wide_out
    # 2c. KASUS KHUSUS: file FPK 'overview' single-metric utk Audience
    #     (Age / Gender / World Map of Followers / Top Cities of Followers).
    fpk_audience_out = _handle_fpk_audience_breakdown(uploaded_file, sub)
    if fpk_audience_out is not None:
        return fpk_audience_out
    # 2d. KASUS KHUSUS: Twitter/X 'Overview' - file SUDAH RAPI (header baris
    #     pertama, nama kolom persis sama kayak target DB), BUKAN format FPK
    #     ber-metadata. Ditangani terpisah SUPAYA TIDAK nyasar ke mesin fuzzy
    #     generic di bawah, yg bisa salah pasang metrik (mis. new_follows
    #     ke-tebak sbg impressions) kalau file di-upload tanpa pasangan file
    #     follower-growth-nya (lihat proses_mapping_twitter_overview di
    #     mapping_twitter.py utk jalur gabungan 2-file yg benar).
    twitter_overview_out = _handle_twitter_overview_direct(
        uploaded_file, sub, channel_pilihan, kategori_pilihan)
    if twitter_overview_out is not None:
        return twitter_overview_out
    # 3. BACA file upload (data mulai baris ke-4 → header=4)
    #    Dukung xlsx & csv. Untuk file-like (BytesIO) coba excel dulu, lalu csv.
    df_raw = _read_upload(uploaded_file)
    df_raw.columns = [str(c).strip() for c in df_raw.columns]

    # 4. Bangun DAFTAR pemetaan (db_col, fpk_name) utk kolom non-derived.
    #    Dipakai LIST, bukan dict {fpk:db}, supaya SATU sumber FPK bisa mengisi
    #    BANYAK kolom target (mis. 'Date' → publish_time DAN date). Dict tak bisa
    #    one-to-many karena key harus unik (target belakangan menimpa).
    pair_map = []            # list of (db_col, fpk_name)
    mapping_dict = {}        # disediakan utk kompat (fpk -> db terakhir)
    derived_specs = []       # (db_col, [parts], tipe)
    col_types = {}           # db_col -> tipe data
    for _, r in sub.iterrows():
        db_col = str(r["kolom"]).strip()
        metric = str(r["metrics di fpk"]).strip()
        tipe = str(r["tipe data"]).strip()
        col_types[db_col] = tipe

        if _has_no_source(metric):
            # kolom tanpa sumber FPK langsung (frasa deskriptif / rule internal /
            # aturan turunan deskriptif) → dibiarkan NA. TIDAK dicoba dicocokkan.
            continue
        if _is_derived(metric):
            parts = _parse_derived_parts(metric)
            derived_specs.append((db_col, parts, tipe))
        else:
            pair_map.append((db_col, metric))
            mapping_dict[metric] = db_col

    # 5. PETAKAN sumber → target via penyalinan per pasangan (one-to-many aman).
    #    Pakai _resolve_fpk_column: kalau nama persis tak ada, coba alternatif
    #    'A / B' & fuzzy (abaikan kata organic/total/per post).
    df = df_raw.copy()
    for db_col, fpk_name in pair_map:
        src = _resolve_fpk_column(fpk_name, df_raw.columns)
        if src is not None:
            df[db_col] = df_raw[src]
        # sumber tak ada di file → target tidak diisi (jadi NA di langkah 7)

    # 6. KOLOM DERIVED: jumlahkan komponen penyusun. Komponen dicari di df_raw
    #    berdasarkan nama FPK-nya; yang tidak ada → 0.
    #    CATATAN: bila SEMUA komponen tidak ditemukan di file, kolom derived akan
    #    bernilai 0 semua. Ini tidak diinginkan utk file NATIVE yang sudah memuat
    #    nilai jadi (mis. dummy 'content_interactions'); kasus itu ditangani oleh
    #    fallback nama-kolom-native di langkah 6b.
    derived_all_zero = set()
    for db_col, parts, tipe in derived_specs:
        total = pd.Series(0, index=df_raw.index, dtype="float")
        found_any = False
        for part in parts:
            src = _resolve_fpk_column(part, df_raw.columns)
            if src is not None:
                found_any = True
                total = total.add(
                    pd.to_numeric(df_raw[src], errors="coerce").fillna(0), fill_value=0)
            # kalau kolom penyusun tidak ada → kontribusinya 0 (diabaikan)
        df[db_col] = total
        if not found_any:
            derived_all_zero.add(db_col)

    # 6b. FALLBACK NAMA-KOLOM NATIVE.
    #     File NATIVE (mis. export platform / CSV dummy) sering memakai nama kolom
    #     yang SAMA PERSIS dengan nama kolom target DB (mis. 'content_interactions',
    #     'link_clicks', 'age', 'gender', 'percentage_city'). Spec FPK utk kolom
    #     ini bisa berisi catatan deskriptif ('Tidak ada direct di Robz...'),
    #     rumus derived, atau '-', sehingga jalur FPK biasa membiarkannya NA/0.
    #     Di sini kita coba cocokkan nama kolom target itu sendiri ke file:
    #     hanya mengisi kolom yang BELUM terisi dari jalur FPK, jadi tidak
    #     mengganggu perilaku file FPK (yang tak punya kolom bernama spt target DB).
    raw_cols_stripped = {str(c).strip(): c for c in df_raw.columns}
    handled_by_intercept = set()
    if "percentage_age" in raw_cols_stripped:
        df["percentage_age"] = df_raw[raw_cols_stripped["percentage_age"]]
        handled_by_intercept.add("percentage_age")


    all_target_cols = [str(c).strip() for c in sub["kolom"].tolist()]
    for db_col in all_target_cols:
        already = (db_col in df.columns) and (db_col not in derived_all_zero)
        if already:
            if db_col in handled_by_intercept:
                continue
        already = (db_col in df.columns) and (db_col not in derived_all_zero)   # baris lama, gak berubah
        if already:
            continue
        src = _resolve_fpk_column(db_col, df_raw.columns)
        if src is not None:
            df[db_col] = df_raw[src]

    # 7. Susun output: HANYA kolom target DB yang ada di skema, urut sesuai skema.
    target_cols = all_target_cols
    out = pd.DataFrame(index=df.index)
    for col in target_cols:
        if col in df.columns:
            out[col] = df[col]
        else:
            out[col] = pd.NA  # kolom tak terpetakan → NA (mis. kolom '-')

    # 8. PEMBERSIHAN token kosong FPK SEBELUM casting.
    #    FPK memakai '-' (dan variasinya) utk menandai "tidak ada data". Token ini
    #    HARUS jadi None, jika tidak akan lolos sebagai string '-' ke kolom INTEGER
    #    di PostgreSQL → error "invalid input syntax for type integer". Dibersihkan
    #    universal di sini supaya aman apa pun tipe/jalur kolomnya.
    _EMPTY_TOKENS = {"-", "–", "—", "", "n/a", "na", "nan", "none", "null", "#n/a", "-"}
    def _blank_empty(v):
        if v is None:
            return None
        if isinstance(v, float) and pd.isna(v):
            return None
        if str(v).strip().lower() in _EMPTY_TOKENS:
            return None
        return v
    for col in out.columns:
        out[col] = out[col].map(_blank_empty)

    # 9. TYPE CASTING tiap kolom sesuai tipe DB
    for col in out.columns:
        out[col] = _cast_series(out[col], col_types.get(col, "TEXT"))

    return out.reset_index(drop=True)