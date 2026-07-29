"""kategori_detector.py — Pengenal jenis file FPK (revisi UX 2 kategori).

Revisi Mba Yunita (final): dropdown kategori disederhanakan jadi 3 —
  • Content Performance  → file Post                          → tabel post
  • Story Performance    → file Story                         → tabel story
  • Channel Performance  → file metrik akun (reach, visit,
    clicks, interactions, views, follows, audience)           → tabel profile

Konsekuensi: sistem harus mengenali jenis file SENDIRI. Caranya: file FPK
selalu membawa judul di dalam (baris ke-2 kolom ke-2), mis. "Top 5000 Posts
Overview", "Reach per day", "Age". Judul itu dipetakan balik ke kategori
internal lama, lalu seluruh pipeline lama berjalan TANPA berubah.

File dummy/native (tanpa metadata FPK) dikenali lewat nama kolomnya
(content_interactions, link_clicks, dst).
"""

import io
import re

# Kategori pseudo (pilihan UI baru) → dikenali & di-resolve di sini
PSEUDO_CONTENT = "content performance"
PSEUDO_STORY = "story performance"
PSEUDO_CHANNEL = "channel performance"

# bucket → kategori internal yang sah di dalamnya
_BUCKET_OF = {"Post": PSEUDO_CONTENT, "Story": PSEUDO_STORY}  # sisanya = channel

# Urutan PENTING (dicek atas → bawah, substring match pada judul file)
_TITLE_RULES = [
    ("posts overview",          "Post"),
    # Judul internal FPK TikTok post TERPOTONG oleh FPK sendiri menjadi
    # 'TikTok Content Perform...' (dgn elipsis literal) → cocokkan substring
    # pendeknya. Aman: file post FB/IG berjudul 'Posts Overview' sudah
    # tertangkap rule di atas.
    ("tiktok content perform",  "Post"),
    ("stories",                 "Story"),
    ("world map of followers",  "Audience"),
    ("top cities of followers", "Audience"),
    ("reach per day",           "Profile Reach"),
    ("profile views per day",   "Profile Visit"),
    ("daily views",             "Content Views"),
    ("daily post views",        "Video Views"),
    ("daily profile views",     "Profile Views"),
    ("daily shares",            "Shares"),
    ("total follower",          "Total Followers"),
    ("followers net",           "Follows Increase"),
    # varian judul FPK yg tidak konsisten: 'Instagram Followers' (tanpa kata
    # Total). HARUS di bawah 'followers net' & 'world map of followers' agar
    # tidak menyambar file net-growth / audience country.
    ("instagram followers",     "Total Followers"),
    ("facebook followers",      "Total Followers"),
    ("tiktok followers",        "Total Followers"),
    ("new follows",             "New Follows"),
    ("unfollows",               "Unfollows"),
    ("link click",              "Link Clicks"),
    ("interaction",             "Content Interactions"),
]
# Judul pendek yang harus SAMA PERSIS (bukan substring, biar tidak salah tangkap)
_TITLE_EXACT = {
    "age": "Audience",
    "gender": "Audience",
}

# Fallback utk file native/dummy: nama kolom khas → kategori
_COLUMN_RULES = [
    ("content_interactions", "Content Interactions"),
    ("link_clicks",          "Link Clicks"),
    ("content_views",        "Content Views"),
    ("profile_reach",        "Profile Reach"),
    ("profile_visit",        "Profile Visit"),
    ("new_follows",          "New Follows"),
    ("unfollows",            "Unfollows"),
    ("breakdown_type",       "Audience"),
]


def _baca_judul(raw_bytes, filename):
    """Ambil judul internal FPK (baris ke-2, kolom ke-2). Return '' bila tak ada."""
    name = str(filename or "").lower()
    try:
        if name.endswith((".xlsx", ".xls", ".xlsm")) or raw_bytes[:4] == b"PK\x03\x04":
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
            ws = wb[wb.sheetnames[0]]
            rows = list(ws.iter_rows(values_only=True, max_row=2, max_col=3))
            if len(rows) >= 2 and len(rows[1]) >= 2 and rows[1][1] is not None:
                return str(rows[1][1]).strip()
            return ""
        # CSV: delimiter bisa ';' (FPK overview) atau ','
        text = raw_bytes.decode("utf-8-sig", errors="replace")
        lines = text.splitlines()
        if len(lines) >= 2:
            line = lines[1]
            parts = line.split(";") if ";" in line else line.split(",")
            if len(parts) >= 2:
                return parts[1].strip().strip('"')
    except Exception:
        pass
    return ""


def _dari_kolom(raw_bytes):
    """Fallback file native/dummy: cari nama kolom khas di 8 baris pertama."""
    try:
        head = raw_bytes[:8000].decode("utf-8-sig", errors="replace").lower()
    except Exception:
        return None
    for token, kategori in _COLUMN_RULES:
        if token in head:
            return kategori
    return None


def resolve_kategori(raw_bytes, filename, channel, kategori_ui):
    """Terjemahkan pilihan UI (2 kategori baru) → kategori internal lama.

    Kategori lama dipilih langsung → diteruskan apa adanya (kompatibel mundur).
    Kategori pseudo → deteksi dari isi file + validasi bucket-nya.
    """
    kat_norm = str(kategori_ui).strip().lower()
    if kat_norm not in (PSEUDO_CONTENT, PSEUDO_STORY, PSEUDO_CHANNEL):
        return kategori_ui  # kategori lama/manual → tidak diubah

    if raw_bytes is None:
        raise ValueError(
            "Kategori Content/Channel Performance butuh file mentah untuk "
            "dideteksi jenisnya, tapi file tidak tersedia."
        )

    judul = _baca_judul(raw_bytes, filename)
    j = re.sub(r"\s+", " ", judul).strip().lower()

    kategori = _TITLE_EXACT.get(j)
    if kategori is None:
        for token, kat in _TITLE_RULES:
            if token in j:
                kategori = kat
                break
    if kategori is None:
        kategori = _dari_kolom(raw_bytes)
    if kategori is None:
        raise ValueError(
            f"Jenis file tidak dikenali (judul internal: '{judul or '-'}'). "
            "File FPK yang didukung: Posts Overview, Stories, Reach per day, "
            "Profile views per day, Daily Views, Followers Net, New Follows, "
            "Unfollows, Age, Gender, World Map / Top Cities of Followers."
        )

    # Validasi bucket: file harus di-upload lewat kategori yang sesuai jenisnya
    bucket_sah = _BUCKET_OF.get(kategori, PSEUDO_CHANNEL)
    if kat_norm != bucket_sah:
        nama_bucket = {
            PSEUDO_CONTENT: "Content Performance",
            PSEUDO_STORY: "Story Performance",
            PSEUDO_CHANNEL: "Channel Performance",
        }[bucket_sah]
        raise ValueError(
            f"File ini terdeteksi '{kategori}' — upload lewat kategori "
            f"{nama_bucket}."
        )
    return kategori