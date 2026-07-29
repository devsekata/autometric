"""Pengenalan file: platform, kategori, dan pratinjau.

Streamlit menuntut user memilih Brand + Channel + Category untuk SETIAP file —
gap UX yang dicatat belum selesai di dokumentasi mapping engine. Di sini kita
tutup: `vendor/kategori_detector.py` sudah bisa mengenali jenis file dari judul
internal FPK, jadi grid di Kepiai bisa terisi sendiri dan user hanya
mengoreksi kalau salah.
"""

from __future__ import annotations

import csv
import io
import re

from .bootstrap import ensure_ready

# Judul FPK yang menyebut platform-nya sendiri. Banyak judul lain ("Reach per
# day", "Posts Overview") netral — platform dikembalikan None dan Kepiai yang
# menentukan dari konteks brand.
_PLATFORM_TOKENS = (
    ("instagram", "instagram"),
    ("facebook", "facebook"),
    ("tiktok", "tiktok"),
    ("twitter", "twitter"),
)

# Kategori yang hanya sah untuk satu platform → petunjuk platform tambahan.
_CATEGORY_PLATFORM_HINT = {
    "Video Views": "tiktok",
    "Profile Views": "tiktok",
    "Shares": "tiktok",
    "Story": "instagram",
    "Content Analytics": "twitter",
}

_UNSUPPORTED_PLATFORM = {
    "twitter": (
        "Twitter/X belum didukung — l0_raw tidak punya tabel Twitter. "
        "File ini tidak akan diproses."
    ),
}


def _guess_platform(title: str, filename: str, raw_bytes: bytes,
                    category: str | None) -> str | None:
    haystack = f"{title} {filename}".lower()
    for token, platform in _PLATFORM_TOKENS:
        if token in haystack:
            return platform
    if category and category in _CATEGORY_PLATFORM_HINT:
        return _CATEGORY_PLATFORM_HINT[category]
    # Terakhir: pindai metadata di kepala file (FPK menaruh nama profil/jaringan
    # di baris-baris awal).
    try:
        head = raw_bytes[:4000].decode("utf-8-sig", errors="replace").lower()
    except Exception:
        return None
    for token, platform in _PLATFORM_TOKENS:
        if token in head:
            return platform
    return None


# Tanda struktural file per-post/per-story. Dicek SEBELUM pencocokan kolom,
# karena file post membawa banyak kolom metrik yang juga muncul di file harian.
_STORY_MARKERS = ("sticker_taps", "navigation", "swipe_up", "taps_forward")
_POST_ID_MARKERS = ("post_id", "media_id", "video_id", "message_id", "message-id")

# Nama kolom → kategori, dicocokkan PERSIS (bukan substring).
#
# Fallback native vendor (`kategori_detector._dari_kolom`) memakai substring, dan
# itu salah kamar: file TikTok `app_download_link_clicks` tertangkap sebagai
# kategori "Link Clicks" karena mengandung potongan `link_clicks`. Akibatnya
# angka klik unduh aplikasi masuk ke kolom link clicks — tidak error, hanya
# salah. Karena itu pencocokan di sini eksak, dan tidak memakai `_dari_kolom`.
_COLUMN_EXACT = {
    "content_interactions": "Content Interactions",
    "link_clicks":          "Link Clicks",
    "content_views":        "Content Views",
    "profile_reach":        "Profile Reach",
    "profile_visit":        "Profile Visit",
    "profile_visits":       "Profile Visit",
    "new_follows":          "New Follows",
    "unfollows":            "Unfollows",
    "total_followers":      "Total Followers",
    "follows_increase":     "Follows Increase",
    "breakdown_type":       "Audience",
}

# TikTok Overview datang sebagai BANYAK file 1-metrik. Semuanya dipetakan ke
# 'overview' supaya digabung per tanggal dalam satu batch — termasuk
# video_views/profile_views/shares, yang walaupun punya kategori sendiri, lebih
# aman ikut jalur gabungan agar tidak terpecah jadi beberapa upsert terpisah.
# Metrik yang tidak punya kolom tujuan (likes, comments, website_clicks, dst.)
# memang dibuang oleh `_tiktok_overview_to_komersil` — itu GAP yang disengaja.
_TIKTOK_OVERVIEW_COLUMNS = {
    "video_views", "profile_views", "shares", "likes", "comments",
    "reached_audience", "website_clicks", "phone_number_clicks",
    "leads_submission", "app_download_link_clicks", "net_growth",
    "new_followers", "lost_followers",
}

# Potongan nama file → kategori. Prioritas PALING RENDAH: dipakai hanya untuk
# file format wide (tanggal jadi kolom), yang metriknya tidak muncul di header
# mana pun sehingga tidak ada sinyal lain. Selalu ditandai perlu konfirmasi.
_FILENAME_HINTS = (
    ("total_followers", "Total Followers"),
    ("followers_increase", "Total Followers"),
    ("follows_increase", "Follows Increase"),
    ("profile_reach", "Profile Reach"),
    ("profile_visit", "Profile Visit"),
    ("content_views", "Content Views"),
    ("content_interactions", "Content Interactions"),
    ("link_clicks", "Link Clicks"),
    ("new_follows", "New Follows"),
    ("unfollows", "Unfollows"),
)

_DATE_HEADER = re.compile(
    r"^(?:\d{4}-\d{2}-\d{2}"                                  # 2026-06-01
    r"|\d{1,2}/\d{1,2}/\d{2,4}"                               # 6/1/2026
    r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},?\s*\d{4}"
    r")$",
    re.IGNORECASE,
)


def _header_tokens(raw_bytes: bytes) -> set[str]:
    """Nama kolom di 8 baris pertama, dinormalkan.

    Dua kerumitan yang harus ditangani sekaligus:
      • Header wide FPK memuat koma DI DALAM kutip (`"May 24, 2026"`) — kalau
        dipisah naif, satu tanggal jadi dua token dan deteksi wide gagal. Jadi
        dipakai parser csv yang menghormati kutip.
      • CSV yang pernah disimpan ulang lewat Excel membungkus SELURUH baris dalam
        satu kutip (`"date,content_interactions"`) — parser csv membacanya
        sebagai satu field. Jadi field yang masih memuat pemisah dipecah lagi.
    """
    try:
        head = raw_bytes[:16000].decode("utf-8-sig", errors="replace")
    except Exception:
        return set()

    lines = head.splitlines()[:8]
    if not lines:
        return set()

    def norm(value: str) -> str | None:
        t = value.strip().strip('"').strip().lower().replace(" ", "_")
        return t if t and len(t) <= 40 else None

    tokens: set[str] = set()
    # Delimiter FPK bisa ';' — pilih yang menghasilkan lebih banyak kolom.
    delimiter = ";" if head.count(";") > head.count(",") else ","
    for row in csv.reader(lines, delimiter=delimiter):
        # Pecah lagi HANYA bila seluruh baris terbaca sebagai satu field —
        # ciri CSV whole-line-quoted. Kalau tidak dibatasi begini, header wide
        # `"May 24, 2026"` yang sudah benar justru terbelah jadi dua token.
        fields = re.split(r"[;,\t]", row[0]) if len(row) == 1 else row
        for field in fields:
            t = norm(field)
            if t:
                tokens.add(t)
    return tokens


def _from_structure(raw_bytes: bytes) -> str | None:
    tokens = _header_tokens(raw_bytes)
    if not any(m in tokens for m in _POST_ID_MARKERS):
        return None
    if any(m in tokens for m in _STORY_MARKERS):
        return "Story"
    return "Post"


def _from_columns(raw_bytes: bytes, platform: str | None) -> str | None:
    tokens = _header_tokens(raw_bytes)
    if platform == "tiktok":
        if "total_followers" in tokens:
            return "Total Followers"
        if tokens & _TIKTOK_OVERVIEW_COLUMNS:
            return "overview"
    for token, category in _COLUMN_EXACT.items():
        if token in tokens:
            return category
    return None


def _looks_like_date(token: str) -> bool:
    """Token sudah dinormalkan (spasi → `_`), jadi `"May 24, 2026"` masuk sebagai
    `may_24,_2026`. Dikembalikan dulu ke bentuk berspasi sebelum diuji."""
    plain = re.sub(r"\s+", " ", re.sub(r"[_,]+", " ", token)).strip()
    return bool(_DATE_HEADER.match(plain))


def _is_wide_dates(raw_bytes: bytes) -> bool:
    """Format wide: tanggal jadi nama kolom. Metriknya tidak muncul di header
    mana pun, jadi satu-satunya sinyal tersisa adalah nama file."""
    return sum(1 for t in _header_tokens(raw_bytes) if _looks_like_date(t)) >= 3


def _from_filename(filename: str) -> str | None:
    name = re.sub(r"[^a-z0-9]+", "_", str(filename or "").lower())
    for token, category in _FILENAME_HINTS:
        if token in name:
            return category
    return None


def _detect_category(raw_bytes: bytes, filename: str, title: str,
                     platform: str | None):
    """(kategori_internal | None, bucket | None, sumber_deteksi).

    Urutan sengaja dari sinyal paling kuat ke paling lemah:
      title     judul internal FPK — paling andal
      structure ada kolom identitas post → file per-post
      columns   nama kolom metrik, dicocokkan PERSIS
      filename  hanya untuk file wide, yang tidak punya sinyal lain
    """
    import kategori_detector as kd

    j = re.sub(r"\s+", " ", title).strip().lower()

    category = kd._TITLE_EXACT.get(j)
    source = "title" if category else None
    if category is None:
        for token, kat in kd._TITLE_RULES:
            if token in j:
                category, source = kat, "title"
                break
    if category is None:
        category = _from_structure(raw_bytes)
        if category:
            source = "structure"
    if category is None:
        category = _from_columns(raw_bytes, platform)
        if category:
            source = "columns"
    if category is None and _is_wide_dates(raw_bytes):
        category = _from_filename(filename)
        if category:
            source = "filename"

    bucket = None
    if category is not None:
        bucket = kd._BUCKET_OF.get(category, kd.PSEUDO_CHANNEL)
    return category, bucket, source


_BUCKET_LABEL = {
    "content performance": "Content Performance",
    "story performance": "Story Performance",
    "channel performance": "Channel Performance",
}


def _preview(raw_bytes: bytes, filename: str):
    """Baris & kolom nyata, memakai pembaca vendor (deteksi header otomatis:
    native baris-1 vs FPK baris-5, plus perbaikan CSV whole-line-quoted)."""
    from proses_mapping_data_komersil import _read_upload

    bio = io.BytesIO(raw_bytes)
    try:
        bio.name = filename
    except Exception:
        pass
    df = _read_upload(bio)
    if df is None:
        return 0, []
    return int(len(df)), [str(c) for c in df.columns][:60]


def detect_file(filename: str, raw_bytes: bytes) -> dict:
    ensure_ready()

    out: dict = {
        "filename": filename,
        "title": "",
        "platform": None,
        "category": None,
        "bucket": None,
        "rows": None,
        "columns": [],
        "supported": True,
        "reason": None,
        # 'title' = dari judul internal FPK (paling andal); 'structure' = dari
        # kolom identitas post; 'columns' = fallback nama kolom native (paling
        # lemah — UI sebaiknya minta konfirmasi user).
        "detected_from": None,
        "needs_confirmation": True,
    }

    try:
        import kategori_detector as kd
        title = kd._baca_judul(raw_bytes, filename)
        # Platform ditebak LEBIH DULU: pencocokan kolom bergantung padanya —
        # kolom `likes` berarti file TikTok Overview, tapi untuk IG/FB tidak ada
        # kategori harian bernama likes.
        platform = _guess_platform(title, filename, raw_bytes, None)
        category, bucket, source = _detect_category(raw_bytes, filename, title, platform)
        if platform is None:
            # Kategori tertentu hanya sah di satu platform — pakai itu sebagai
            # petunjuk terakhir.
            platform = _guess_platform(title, filename, raw_bytes, category)
    except Exception as e:
        out["supported"] = False
        out["reason"] = f"File tidak bisa dibaca: {e}"
        return out

    out["title"] = title
    out["category"] = category
    out["bucket"] = _BUCKET_LABEL.get(bucket, bucket)
    out["detected_from"] = source
    out["platform"] = platform
    out["needs_confirmation"] = source != "title" or platform is None

    if category is None:
        out["supported"] = False
        out["reason"] = (
            f"Jenis file tidak dikenali (judul internal: '{title or '-'}'). "
            "Pilih kategori manual, atau pastikan file ini export Fanpage Karma."
        )
        return out

    if out["platform"] in _UNSUPPORTED_PLATFORM:
        out["supported"] = False
        out["reason"] = _UNSUPPORTED_PLATFORM[out["platform"]]
        return out

    try:
        rows, columns = _preview(raw_bytes, filename)
        out["rows"] = rows
        out["columns"] = columns
    except Exception as e:
        # Deteksi tetap berlaku; pratinjau gagal bukan alasan menolak file,
        # karena beberapa format (audience ';', wide) butuh parser khusus yang
        # baru dipakai saat ingest.
        out["reason"] = f"Pratinjau tidak tersedia ({e}) — file tetap bisa diproses."

    return out
