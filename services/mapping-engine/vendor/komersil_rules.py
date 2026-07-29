"""komersil_rules.py — Lapisan penerjemah versi komersil (v3: DB acuan baru).

Posisi di alur:
    file FPK → proses_mapping_data (kolom gaya DB LAMA)
             → to_komersil()  ← MODUL INI
             → DataFrame siap-insert ke l0_raw.* / l0_extra.* (DB komersil)

PERUBAHAN v3 (DB acuan baru — schema public + l0_raw + l0_extra):
  1. Sumber kebenaran pemetaan = BUILTIN_RULES di modul ini (disalin dari
     sheet 'panduan_db_komersil' file spec). DB acuan baru TIDAK punya tabel
     l0_raw.mapping_rules, jadi aturan dipindah ke kode. Bila suatu saat
     tabel l0_raw.mapping_rules dibuat lagi di DB, isinya OTOMATIS
     mengalahkan builtin (kompatibel mundur).
  2. social_account_id TIDAK lagi murni UUID karangan (uuid5). Sekarang
     di-resolve ke public.social_accounts.id yang ASLI, urutan:
       (a) platform_user_id file = social_accounts.platform_user_id
       (b) username file = social_accounts.username
       (c) brand UI → public.brands → brand_social_accounts (per platform)
       (d) self-heal: buat baris social_accounts baru (+ link ke brand)
       (e) fallback terakhir: UUID deterministik lama (utk DB tanpa master).
  3. _brand_id menyesuaikan public.brands baru (organization_id NOT NULL):
     lookup dulu; kalau belum ada, daftar otomatis memakai organisasi
     pertama; gagal → None (kolom brand_id dibiarkan kosong).
  4. Rute baru sesuai panduan:
       tiktok Total Followers        → l0_raw.tt_profile_snapshots.follower_count
       tiktok Video/Profile Views,
       Shares (harian, dari FPK)     → l0_extra.tt_profile_fpk (arahan mentor
                                       18/7: FPK tanpa kolom l0_raw → l0_extra)
       tiktok overview (file gabungan) → dipecah, hanya 3 metrik di atas yang
                                       punya rumah; sisanya GAP (jatah crawler)
       twitter (semua)               → GAP resmi: l0_raw tidak punya tabel
                                       Twitter → ditolak dengan pesan jelas.
  5. ig_stories.profile_activity = link_clicks + sticker_taps (melebur,
     sesuai panduan baris 53).

Tiga jalur tulis (tetap):
  1. KONTEN  (facebook_post, instagram_post, instagram_story)
     → rename kolom via rules; key upsert = post_id/media_id.
  2. PROFIL HARIAN → 1 baris/hari; 'date' lama menjadi fetched_at; key
     upsert = (social_account_id, fetched_at).
  3. AUDIENCE (instagram) → dilipat jsonb ke demographics_* di
     ig_profile_snapshots; file per-breakdown saling melengkapi (COALESCE).
"""

import json
import re
import uuid
from collections import Counter, namedtuple

import pandas as pd
from sqlalchemy import text

# Namespace tetap untuk UUID deterministik akun (fallback terakhir):
# input sama → UUID sama. JANGAN diubah — data lama bergantung padanya.
_ACCOUNT_NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")

# Kolom identitas akun di DataFrame gaya-lama (jalur konten), dicek berurutan.
_ACCOUNT_ID_CANDIDATES = ("page_id", "account_id", "profile_id", "open_id")

# breakdown_type (gaya lama) → kolom jsonb tujuan di ig_profile_snapshots
_AUDIENCE_COL = {
    "age": "demographics_age",
    "gender": "demographics_gender",
    "top_city": "demographics_city",
    "top_country": "demographics_country",
    "city": "demographics_city",
    "country": "demographics_country",
}

# ══════════════════════════════════════════════════════════════════════════
# ATURAN BAWAAN (dari sheet 'panduan_db_komersil' — jangan ubah tanpa
# menyesuaikan sheet-nya juga, keduanya harus sinkron).
# transform_type: 'rename'  = pindah nama kolom biasa
#                 'derive'  = sumber derivasi social_account_id (tidak
#                             di-rename langsung; dipakai resolver akun)
#                 'gap'     = tidak punya tujuan tulis (ditolak dgn pesan)
# ══════════════════════════════════════════════════════════════════════════
Rule = namedtuple(
    "Rule",
    "legacy_column target_schema target_table target_column transform_type status",
)


def _r(legacy, table, target, schema="l0_raw", transform="rename"):
    return Rule(legacy, schema, table, target, transform, "active")


BUILTIN_RULES = {
    # ── FACEBOOK: Content Performance → l0_raw.fb_post_snapshots ──
    "facebook_post": [
        _r("post_id", "fb_post_snapshots", "post_id"),
        _r("description", "fb_post_snapshots", "message"),
        _r("publish_time", "fb_post_snapshots", "posted_at"),
        _r("permalink", "fb_post_snapshots", "permalink_url"),
        _r("post_type", "fb_post_snapshots", "post_type"),
        _r("reactions", "fb_post_snapshots", "reactions_count"),
        _r("likes", "fb_post_snapshots", "likes_count"),
        _r("comments", "fb_post_snapshots", "comments_count"),
        _r("shares", "fb_post_snapshots", "shares_count"),
        _r("reach", "fb_post_snapshots", "reach"),
        _r("views", "fb_post_snapshots", "impressions"),      # organic impressions FPK
        _r("image_link", "fb_post_snapshots", "full_picture"),
        # ASUMSI (konfirmasi mentor): video view FB standar = 3-second views.
        # FPK menyediakan varian 3second/1minute; yang 3-second dipakai sbg
        # padanan kolom video_views API. Hapus 1 baris ini bila mentor
        # memutuskan lain.
        _r("video_views_3second", "fb_post_snapshots", "video_views"),
        _r("page_id", "fb_post_snapshots", "social_account_id", transform="derive"),
    ],
    # ── INSTAGRAM: Content Performance → l0_raw.ig_media_snapshots ──
    "instagram_post": [
        _r("post_id", "ig_media_snapshots", "media_id"),
        _r("account_id", "ig_media_snapshots", "social_account_id", transform="derive"),
        _r("description", "ig_media_snapshots", "caption"),
        _r("publish_time", "ig_media_snapshots", "posted_at"),
        _r("permalink", "ig_media_snapshots", "permalink"),
        _r("post_type", "ig_media_snapshots", "media_type"),
        _r("duration_sec", "ig_media_snapshots", "video_duration"),
        _r("views", "ig_media_snapshots", "views"),
        _r("reach", "ig_media_snapshots", "reach"),
        _r("likes", "ig_media_snapshots", "likes"),
        _r("comments", "ig_media_snapshots", "comments"),
        _r("shares", "ig_media_snapshots", "shares"),
        _r("saves", "ig_media_snapshots", "saved"),           # beda nama
        _r("follows", "ig_media_snapshots", "follows"),
        _r("repost", "ig_media_snapshots", "reposts"),        # beda nama
    ],
    # ── INSTAGRAM: Story Performance → l0_raw.ig_stories ──
    "instagram_story": [
        _r("post_id", "ig_stories", "media_id"),
        _r("account_username", "ig_stories", "username"),
        _r("publish_time", "ig_stories", "posted_at"),
        _r("post_type", "ig_stories", "media_type"),
        _r("duration_sec", "ig_stories", "video_duration"),
        _r("permalink", "ig_stories", "permalink"),
        _r("views", "ig_stories", "total_views"),
        _r("reach", "ig_stories", "reach"),
        _r("shares", "ig_stories", "shares"),
        _r("replies", "ig_stories", "replies"),
        _r("follows", "ig_stories", "follows"),
        _r("profile_visits", "ig_stories", "profile_visits"),
        _r("navigation", "ig_stories", "navigation"),
        # profile_activity = link_clicks + sticker_taps → dihitung khusus di
        # to_komersil (panduan baris 53). 'likes' = GAP (ig_stories tak punya).
    ],
    # ── FACEBOOK: Channel Performance harian → l0_raw.fb_profile_snapshots ──
    "facebook_profile_reach": [_r("profile_reach", "fb_profile_snapshots", "profile_reach")],
    "facebook_profile_visit": [_r("profile_visit", "fb_profile_snapshots", "page_views_total")],
    "facebook_link_clicks": [_r("link_clicks", "fb_profile_snapshots", "link_clicks")],
    "facebook_content_interactions": [
        _r("content_interactions", "fb_profile_snapshots", "content_interactions")],
    "facebook_content_views": [_r("content_views", "fb_profile_snapshots", "page_media_view")],
    "facebook_follows_increase": [
        _r("follows_increase", "fb_profile_snapshots", "page_daily_follows_unique")],
    "facebook_total_followers": [
        _r("total_followers", "fb_profile_snapshots", "followers_count")],
    # ── INSTAGRAM: Channel Performance harian → l0_raw.ig_profile_snapshots ──
    "instagram_profile_reach": [_r("profile_reach", "ig_profile_snapshots", "reach")],
    # Keputusan 19/7: kolom 'views' di ig_profile_snapshots = CONTENT VIEWS.
    # Profile Visit pindah ke l0_extra.ig_profile_fpk (pola tt_profile_fpk).
    "instagram_content_views": [_r("content_views", "ig_profile_snapshots", "views")],
    "instagram_profile_visit": [
        _r("profile_visit", "ig_profile_fpk", "profile_visit", schema="l0_extra")],
    "instagram_link_clicks": [_r("link_clicks", "ig_profile_snapshots", "profile_links_taps")],
    "instagram_content_interactions": [
        _r("content_interactions", "ig_profile_snapshots", "total_interactions")],
    "instagram_total_followers": [
        _r("total_followers", "ig_profile_snapshots", "followers_count")],
    # ── TIKTOK ──
    # Content Performance FPK → l0_raw.tt_video_snapshots (verifikasi DB
    # 20/7: tabel ADA; kolom = video_id, posted_at, description, duration,
    # cover_image_url, share_url, like/comment/share/view_count).
    # Metrik FPK TANPA kolom di tt_video_snapshots tapi PUNYA rumah di
    # l0_extra.tiktok_post_extra_attribute (avg_watch_time, reach_post,
    # completion_rate) → dibawa lewat INSERT KEDUA (lihat
    # _EXTRA_ATTR_TABLES). Sisanya GAP (saves, total watch time, follows/
    # profile views/website clicks via post, Spark Ads, viewer breakdown).
    "tiktok_post": [
        _r("post_id", "tt_video_snapshots", "video_id"),
        _r("account_id", "tt_video_snapshots", "social_account_id", transform="derive"),
        _r("description", "tt_video_snapshots", "description"),
        _r("publish_time", "tt_video_snapshots", "posted_at"),
        _r("permalink", "tt_video_snapshots", "share_url"),
        _r("image_link", "tt_video_snapshots", "cover_image_url"),
        _r("duration_sec", "tt_video_snapshots", "duration"),
        _r("likes", "tt_video_snapshots", "like_count"),
        _r("comments", "tt_video_snapshots", "comment_count"),
        _r("shares", "tt_video_snapshots", "share_count"),
        _r("views", "tt_video_snapshots", "view_count"),
    ],
    "tiktok_total_followers": [
        _r("total_followers", "tt_profile_snapshots", "follower_count")],
    # Arahan mentor 18/7: metrik FPK harian tanpa kolom di l0_raw → l0_extra
    "tiktok_video_views": [
        _r("video_views", "tt_profile_fpk", "video_views", schema="l0_extra")],
    "tiktok_profile_views": [
        _r("profile_views", "tt_profile_fpk", "profile_views", schema="l0_extra")],
    "tiktok_shares": [
        _r("shares", "tt_profile_fpk", "shares", schema="l0_extra")],
}

# Kategori GAP resmi (panduan): TIDAK punya tujuan tulis → tolak dgn pesan jelas.
GAP_NOTES = {
    "instagram_follows_increase": (
        "IG Follows Increase tidak punya kolom di ig_profile_snapshots. "
        "Gunakan file 'New Follows' dan 'Unfollows' (dilipat ke jsonb "
        "follows_and_unfollows)."
    ),
    "facebook_audience": (
        "GAP resmi panduan: fb_profile_snapshots tidak punya kolom demografi — "
        "Audience Facebook di-skip."
    ),
    "twitter_overview": (
        "GAP resmi panduan: DB komersil (l0_raw) tidak punya tabel Twitter/X — "
        "semua kategori Twitter di-skip."
    ),
    "twitter_content_analytics": (
        "GAP resmi panduan: DB komersil (l0_raw) tidak punya tabel Twitter/X — "
        "semua kategori Twitter di-skip."
    ),
}


def _legacy_key(channel, category):
    """'facebook' + 'Post' → 'facebook_post' (sama dgn penamaan legacy_table)."""
    s = f"{channel}_{category}".strip().lower()
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    return re.sub(r"_+", "_", s).strip("_")


def _account_uuid(seed):
    return str(uuid.uuid5(_ACCOUNT_NS, seed))


def _stringlock(out):
    """Pastikan semua identifier keluar sebagai string murni (aturan proyek)."""
    for c in ("post_id", "media_id", "video_id", "comment_id", "social_account_id"):
        if c in out.columns:
            out[c] = out[c].map(
                lambda v: None if v is None or (isinstance(v, float) and pd.isna(v))
                else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v))
            )
    return out


# ══════════════════════════════════════════════════════════════════════════
# RESOLUSI IDENTITAS — public.platforms / brands / social_accounts
# ══════════════════════════════════════════════════════════════════════════
_PLATFORM_CACHE = {}          # key/label lower → platform uuid (str)
_RESOLVE_CACHE = {}           # (channel, brand, username, puid) → uuid str
_BRAND_CACHE = {}             # brand name lower → brand uuid (str) / None


def _platform_id(engine, channel):
    """Cari uuid platform di public.platforms berdasarkan key/label.
    Return None bila tabel tidak ada / platform tak terdaftar."""
    ch = str(channel or "").strip().lower()
    if not ch:
        return None
    if not _PLATFORM_CACHE:
        try:
            with engine.connect() as conn:
                rows = conn.execute(
                    text("SELECT id, key, label FROM public.platforms")
                ).fetchall()
            for pid, k, label in rows:
                _PLATFORM_CACHE[str(k or "").strip().lower()] = str(pid)
                _PLATFORM_CACHE[str(label or "").strip().lower()] = str(pid)
        except Exception:
            _PLATFORM_CACHE["__failed__"] = None
    aliases = {"twitter": ("twitter", "x"), "x": ("x", "twitter")}
    for cand in aliases.get(ch, (ch,)):
        if cand in _PLATFORM_CACHE and _PLATFORM_CACHE[cand]:
            return _PLATFORM_CACHE[cand]
    return None


def _brand_id(engine, brand, org_id=None):
    """Lookup id brand di public.brands (arahan mentor: brand_id lookup ke
    public). Bila org_id diberikan (UI select organisasi), lookup DIBATASI ke
    organisasi itu — dua organisasi boleh punya brand bernama sama tanpa
    ketukar. Self-healing (daftar otomatis) hanya jalan bila brand belum ada:
    pakai org_id terpilih, atau organisasi pertama bila org_id kosong.
    Gagal → None (brand_id dibiarkan kosong, alur tidak macet)."""
    if brand is None or str(brand).strip() == "":
        return None
    bkey = (str(org_id or "").strip(), str(brand).strip().lower())
    if bkey in _BRAND_CACHE:
        return _BRAND_CACHE[bkey]
    result = None
    try:
        with engine.begin() as conn:
            if org_id:
                row = conn.execute(
                    text("SELECT id FROM public.brands "
                         "WHERE organization_id = :o AND lower(name) = :n"),
                    {"o": str(org_id), "n": bkey[1]},
                ).fetchone()
            else:
                row = conn.execute(
                    text("SELECT id FROM public.brands WHERE lower(name) = :n"),
                    {"n": bkey[1]},
                ).fetchone()
            if row:
                result = str(row[0])
            else:
                target_org = str(org_id) if org_id else None
                if target_org is None:
                    org = conn.execute(
                        text("SELECT id FROM public.organizations "
                             "ORDER BY created_at LIMIT 1")
                    ).fetchone()
                    target_org = str(org[0]) if org else None
                if target_org:
                    new_id = str(uuid.uuid4())
                    conn.execute(
                        text("INSERT INTO public.brands "
                             "(id, organization_id, name, created_at) "
                             "VALUES (:i, :o, :n, now())"),
                        {"i": new_id, "o": target_org, "n": str(brand).strip()},
                    )
                    result = new_id
    except Exception:
        result = None  # tabel brands/organizations tak ada → kolom dibiarkan kosong
    _BRAND_CACHE[bkey] = result
    return result


def _ensure_brand_link(engine, channel, brand, org_id, social_account_id):
    """Pastikan baris public.brand_social_accounts (brand ↔ akun) ADA.

    Penting utk tabel l0_extra.*_post_extra_attribute yang brand_id-nya
    ber-FK ke rantai brand/akun: tanpa baris link ini, insert atribut kena
    ForeignKeyViolation. Return True bila baris sudah ada / berhasil dibuat.
    """
    try:
        pid = _platform_id(engine, channel)
        bid = _brand_id(engine, brand, org_id=org_id)
        if not bid or not social_account_id:
            return False
        with engine.begin() as conn:
            params = {"b": bid, "s": str(social_account_id)}
            cond = "social_account_id = :s"
            if pid:
                cond += " OR platform_id = :p"
                params["p"] = pid
            dup = conn.execute(
                text("SELECT 1 FROM public.brand_social_accounts "
                     f"WHERE brand_id = :b AND ({cond})"),
                params,
            ).fetchone()
            if dup:
                return True
            if not pid:
                return False
            conn.execute(
                text("INSERT INTO public.brand_social_accounts "
                     "(id, brand_id, social_account_id, platform_id, created_at) "
                     "VALUES (:i, :b, :s, :p, now())"),
                {"i": str(uuid.uuid4()), "b": bid,
                 "s": str(social_account_id), "p": pid},
            )
        return True
    except Exception:
        return False


def _resolve_social_account_id(engine, channel, brand=None,
                               username=None, platform_user_id=None,
                               org_id=None):
    """Resolve identitas akun ke public.social_accounts.id yang ASLI.

    Urutan: platform_user_id → username → rantai brand → self-heal (buat baris
    baru + link brand_social_accounts) → fallback UUID deterministik lama.
    Hasil di-cache per kombinasi input (hemat query utk file ribuan baris).
    """
    ckey = (
        str(channel or "").strip().lower(),
        str(org_id or "").strip(),
        str(brand or "").strip().lower(),
        str(username or "").strip().lower(),
        str(platform_user_id or "").strip(),
    )
    if ckey in _RESOLVE_CACHE:
        return _RESOLVE_CACHE[ckey]

    resolved = None
    try:
        pid = _platform_id(engine, channel)
        pfilter = " AND platform_id = :p" if pid else ""
        params_p = {"p": pid} if pid else {}

        # ── ATURAN FINAL (konfirmasi 20/7 sore): akun = SATU baris global.
        # Satu akun BOLEH tersedia utk banyak organisasi; ketersediaannya
        # diatur lewat jembatan public.brand_social_accounts (pola akun
        # sekata_ai). Pemisahan data per organisasi/brand DITANGANI backend
        # website, bukan dgn menduplikasi akun. Maka lookup akun di sini
        # GLOBAL (per platform), tanpa filter organisasi.
        with engine.begin() as conn:
            if platform_user_id and str(platform_user_id).strip():
                row = conn.execute(
                    text("SELECT id FROM public.social_accounts "
                         "WHERE platform_user_id = :v" + pfilter),
                    {"v": str(platform_user_id).strip(), **params_p},
                ).fetchone()
                if row:
                    resolved = str(row[0])
            if resolved is None and username and str(username).strip():
                row = conn.execute(
                    text("SELECT id FROM public.social_accounts "
                         "WHERE lower(username) = lower(:v)" + pfilter),
                    {"v": str(username).strip(), **params_p},
                ).fetchone()
                if row:
                    resolved = str(row[0])
            if resolved is None and brand and str(brand).strip():
                params_b = {"b": str(brand).strip(), **params_p}
                org_filter = ""
                if org_id:
                    org_filter = " AND b.organization_id = :o"
                    params_b["o"] = str(org_id)
                row = conn.execute(
                    text(
                        "SELECT bsa.social_account_id "
                        "FROM public.brands b "
                        "JOIN public.brand_social_accounts bsa "
                        "  ON bsa.brand_id = b.id "
                        "WHERE lower(b.name) = lower(:b)" + org_filter
                        + (" AND bsa.platform_id = :p" if pid else "")
                        + " ORDER BY bsa.created_at LIMIT 1"
                    ),
                    params_b,
                ).fetchone()
                if row:
                    resolved = str(row[0])
            # ── self-heal: akun belum terdaftar → daftarkan minimal ──
            if resolved is None and pid:
                uname = (str(username).strip() if username and str(username).strip()
                         else (str(brand).strip() if brand and str(brand).strip()
                               else str(platform_user_id or "").strip()))
                if uname:
                    # Hormati UNIQUE (platform_id, username): akun dgn
                    # username ini mungkin SUDAH ada → PAKAI ULANG, apa pun
                    # organisasinya (aturan final 20/7: akun = 1 baris
                    # global, ketersediaan diatur lewat jembatan
                    # brand_social_accounts — bukan duplikasi akun).
                    row = conn.execute(
                        text(
                            "SELECT sa.id FROM public.social_accounts sa "
                            "WHERE sa.platform_id = :p "
                            "AND lower(sa.username) = lower(:u)"
                        ),
                        {"p": pid, "u": uname},
                    ).fetchone()
                    if row:
                        resolved = str(row[0])
                    else:
                        new_id = str(uuid.uuid4())
                        conn.execute(
                            text("INSERT INTO public.social_accounts "
                                 "(id, platform_id, platform_user_id, username, "
                                 " connected, created_at) "
                                 "VALUES (:i, :p, :pu, :u, false, now())"),
                            {"i": new_id, "p": pid,
                             "pu": (str(platform_user_id).strip()
                                    if platform_user_id else None),
                             "u": uname},
                        )
                        resolved = new_id
        # link brand ↔ akun (transaksi terpisah; gagal tidak menggagalkan resolve)
        if resolved is not None and brand and str(brand).strip():
            _ensure_brand_link(engine, channel, brand, org_id, resolved)
    except Exception:
        resolved = None

    if resolved is None:
        # Fallback terakhir: UUID deterministik lama (utk DB tanpa tabel master
        # public.* — perilaku & seed SAMA PERSIS dgn versi sebelumnya).
        if platform_user_id and str(platform_user_id).strip():
            resolved = _account_uuid(f"{channel}:{platform_user_id}")
        else:
            resolved = _account_uuid(f"{channel}:brand:{brand}")

    _RESOLVE_CACHE[ckey] = resolved
    return resolved


# ══════════════════════════════════════════════════════════════════════════
# ATURAN: DB (bila ada) mengalahkan builtin
# ══════════════════════════════════════════════════════════════════════════
def load_rules(engine, legacy_table):
    """Ambil aturan pemetaan. DB acuan baru TIDAK punya l0_raw.mapping_rules
    → pakai BUILTIN_RULES. Bila tabel itu ADA dan berisi baris utk
    legacy_table ini, isinya dipakai (override builtin, kompatibel mundur)."""
    q = text(
        "SELECT legacy_column, target_schema, target_table, target_column, "
        "       transform_type, status "
        "FROM l0_raw.mapping_rules "
        "WHERE legacy_table = :lt AND is_active = true"
    )
    try:
        with engine.connect() as conn:
            rows = conn.execute(q, {"lt": legacy_table}).fetchall()
        if rows:
            return rows
    except Exception:
        pass  # tabel mapping_rules tidak ada di DB acuan baru → builtin
    return list(BUILTIN_RULES.get(legacy_table, []))


# legacy_table → (kolom nilai di df lama, key di dalam jsonb)
_JSONB_FOLD = {
    "instagram_new_follows": ("new_follows", "follows"),
    "instagram_unfollows": ("unfollows", "unfollows"),
}

# Kolom TikTok Overview yang PUNYA rumah di l0_extra.tt_profile_fpk (panduan);
# kolom overview lain = GAP (jatah crawler / belum ada kolom tujuan).
_TT_OVERVIEW_KEEP = ("video_views", "profile_views", "shares")


def _fold_to_jsonb(df, channel, brand, value_col, json_key, engine=None,
                   org_id=None):
    """Lipat metrik harian tunggal → jsonb {key: nilai} per tanggal, tujuan
    ig_profile_snapshots.follows_and_unfollows. File follows & unfollows
    menulis key BERBEDA di kolom jsonb yg sama; mesin upsert (operator ||)
    menggabungkan keduanya di baris tanggal yg sama."""
    if "date" not in df.columns or value_col not in df.columns:
        raise ValueError(
            f"Data tidak lengkap: butuh kolom 'date' dan '{value_col}'. "
            "Cek baris spec native_column utk kategori ini."
        )
    if brand is None or str(brand).strip() == "":
        raise ValueError("Kategori ini butuh brand terpilih di UI.")
    work = df.copy()
    work["date"] = pd.to_datetime(work["date"], errors="coerce")
    work = work.dropna(subset=["date", value_col])
    out = pd.DataFrame({
        "fetched_at": work["date"],
        "follows_and_unfollows": work[value_col].map(
            lambda v: json.dumps({json_key: int(v)})
        ),
    })
    out["social_account_id"] = (
        _resolve_social_account_id(engine, channel, brand=brand, org_id=org_id)
        if engine is not None else _account_uuid(f"{channel}:brand:{brand}")
    )
    return out.reset_index(drop=True), "l0_raw", "ig_profile_snapshots", \
        ["social_account_id", "fetched_at"]


def _tiktok_overview_to_komersil(df, brand, engine, org_id=None):
    """TikTok Overview gabungan (wide harian) → l0_extra.tt_profile_fpk.

    Hanya 3 metrik yang punya kolom tujuan sesuai panduan (video_views,
    profile_views, shares). Metrik overview lain (likes, comments,
    reached_audience, dst.) = GAP resmi → di-drop, bukan ditulis asal."""
    if "date" not in df.columns:
        raise ValueError("TikTok Overview: kolom 'date' tidak ada di hasil gabung.")
    if brand is None or str(brand).strip() == "":
        raise ValueError("TikTok Overview butuh brand terpilih di UI.")
    keep = [c for c in _TT_OVERVIEW_KEEP if c in df.columns]
    if not keep:
        raise ValueError(
            "TikTok Overview: tidak ada metrik yang punya kolom tujuan "
            f"({', '.join(_TT_OVERVIEW_KEEP)}) di file-file ini. Metrik lain "
            "adalah GAP resmi panduan (jatah crawler)."
        )
    out = df[["date"] + keep].copy()
    out["fetched_at"] = pd.to_datetime(out.pop("date"), errors="coerce")
    out = out.dropna(subset=["fetched_at"])
    out = out.dropna(how="all", subset=keep).reset_index(drop=True)
    if out.empty:
        raise ValueError("TikTok Overview: data kosong setelah pembersihan.")
    out["social_account_id"] = _resolve_social_account_id(
        engine, "tiktok", brand=brand, org_id=org_id)
    bid = _brand_id(engine, brand, org_id=org_id)
    if bid:
        out["brand_id"] = bid
    return _stringlock(out), "l0_extra", "tt_profile_fpk", \
        ["social_account_id", "fetched_at"]


def to_komersil(df, channel, category, engine, brand=None, org_id=None):
    """Terjemahkan DataFrame gaya-lama → gaya DB acuan baru berdasarkan aturan.

    Returns: (df_baru, target_schema, target_table, key_cols)
    Raises : ValueError dgn pesan jelas bila kategori belum/tidak didukung.
    """
    legacy_table = _legacy_key(channel, category)

    # ── GAP resmi panduan: tolak lebih awal dgn pesan yang benar ─────────
    if legacy_table in GAP_NOTES:
        raise ValueError(GAP_NOTES[legacy_table])

    # ── Jalur 5: TIKTOK OVERVIEW gabungan → l0_extra.tt_profile_fpk ──────
    if legacy_table == "tiktok_overview":
        return _tiktok_overview_to_komersil(df, brand, engine, org_id=org_id)

    # ── Jalur 4: LIPAT KE JSONB (IG New Follows / Unfollows) ─────────────
    if legacy_table in _JSONB_FOLD:
        value_col, json_key = _JSONB_FOLD[legacy_table]
        return _fold_to_jsonb(df, channel, brand, value_col, json_key,
                              engine=engine, org_id=org_id)

    # ── Jalur 3: AUDIENCE ────────────────────────────────────────────────
    if legacy_table.endswith("_audience"):
        if str(channel).strip().lower() != "instagram":
            raise ValueError(GAP_NOTES["facebook_audience"])
        return _audience_to_jsonb(df, channel, brand, engine=engine,
                                  org_id=org_id)

    rules = load_rules(engine, legacy_table)
    active = [r for r in rules if r.status == "active"]
    if not rules:
        raise ValueError(
            f"Belum ada aturan komersil untuk '{legacy_table}' — kategori ini "
            "belum di-wiring ke DB acuan baru (cek BUILTIN_RULES di "
            "komersil_rules.py)."
        )

    direct = [
        r for r in active
        if r.target_column and r.transform_type in ("direct", "rename", "cast")
    ]
    if not direct:
        gap_notes = {r.transform_type for r in rules}
        raise ValueError(
            f"Kategori '{legacy_table}' tidak punya tujuan tulis langsung di DB "
            f"komersil (aturan: {sorted(gap_notes)}). Sesuai keputusan, kategori "
            "ini di-skip / menunggu kolom dari backend."
        )

    (target_schema, target_table), _ = Counter(
        (r.target_schema, r.target_table) for r in direct
    ).most_common(1)[0]

    rename = {
        r.legacy_column: r.target_column
        for r in direct
        if (r.target_schema, r.target_table) == (target_schema, target_table)
        and r.legacy_column in df.columns
        # social_account_id TIDAK PERNAH di-rename mentah dari file: kolom DB
        # bertipe uuid, sedangkan file membawa ID platform mentah (mis.
        # '1382748505'). Identitas akun SELALU lewat resolver — sumbernya
        # (account_id/page_id) dibiarkan di df agar resolver bisa memakainya.
        and r.target_column != "social_account_id"
    }
    if not rename:
        raise ValueError(
            f"Tidak ada kolom hasil mapping yang cocok dgn aturan '{legacy_table}'. "
            "Cek file spec native_column: kolom sumbernya mungkin belum terisi."
        )

    out = df[list(rename.keys())].rename(columns=rename).copy()

    # ── Derivasi khusus IG Story: profile_activity = link_clicks + sticker_taps
    if legacy_table == "instagram_story":
        parts = [c for c in ("link_clicks", "sticker_taps") if c in df.columns]
        if parts:
            total = None
            for c in parts:
                s = pd.to_numeric(df[c], errors="coerce")
                total = s if total is None else total.add(s, fill_value=0)
            out["profile_activity"] = total

    # ── Jalur 2: PROFIL HARIAN ───────────────────────────────────────────
    if target_table.endswith(("_profile_snapshots", "_profile_fpk")) and "date" in df.columns:
        out["fetched_at"] = pd.to_datetime(df["date"], errors="coerce")
        if brand is None or str(brand).strip() == "":
            raise ValueError(
                "Kategori profil harian butuh brand terpilih di UI untuk "
                "identitas akun (social_account_id), tapi brand kosong."
            )
        out["social_account_id"] = _resolve_social_account_id(
            engine, channel, brand=brand, org_id=org_id)
        # brand_id HANYA utk tabel l0_extra (mis. tt_profile_fpk). Tabel
        # l0_raw.*_profile_snapshots TIDAK punya kolom brand_id — identitas
        # akun cukup lewat social_account_id (relasi brand ada di
        # public.brand_social_accounts).
        if str(target_schema).lower() == "l0_extra":
            bid = _brand_id(engine, brand, org_id=org_id)
            if bid:
                out["brand_id"] = bid
        out = out.dropna(subset=["fetched_at"]).reset_index(drop=True)
        return _stringlock(out), target_schema, target_table, \
            ["social_account_id", "fetched_at"]

    # ── Jalur 1: KONTEN ──────────────────────────────────────────────────
    acct_src = next((c for c in _ACCOUNT_ID_CANDIDATES if c in df.columns), None)
    uname_src = "account_username" if "account_username" in df.columns else None
    if "social_account_id" not in out.columns:
        if acct_src is not None and df[acct_src].notna().any():
            # resolve per NILAI UNIK (bukan per baris) → hemat query
            uniq = {}
            for v in pd.unique(df[acct_src].dropna()):
                vv = str(int(v)) if isinstance(v, float) and float(v).is_integer() else str(v)
                uniq[v] = _resolve_social_account_id(
                    engine, channel, brand=brand, platform_user_id=vv,
                    org_id=org_id)
            fallback = (
                _resolve_social_account_id(engine, channel, brand=brand,
                                           org_id=org_id)
                if brand else None
            )
            out["social_account_id"] = df[acct_src].map(
                lambda v: uniq.get(v, fallback) if pd.notna(v) else fallback
            )
        elif uname_src is not None and df[uname_src].notna().any():
            uniq = {}
            for v in pd.unique(df[uname_src].dropna()):
                uniq[v] = _resolve_social_account_id(
                    engine, channel, brand=brand, username=str(v),
                    org_id=org_id)
            fallback = (
                _resolve_social_account_id(engine, channel, brand=brand,
                                           org_id=org_id)
                if brand else None
            )
            out["social_account_id"] = df[uname_src].map(
                lambda v: uniq.get(v, fallback) if pd.notna(v) else fallback
            )
        elif brand:
            # fallback: file konten tanpa kolom akun → pakai brand UI
            out["social_account_id"] = _resolve_social_account_id(
                engine, channel, brand=brand, org_id=org_id)
        else:
            raise ValueError(
                f"Kolom identitas akun ({'/'.join(_ACCOUNT_ID_CANDIDATES)}) "
                f"tidak ada/kosong di hasil mapping '{legacy_table}' dan brand "
                "UI kosong — social_account_id wajib diisi (NOT NULL)."
            )

    key_cols = None
    for cand in ("post_id", "media_id", "video_id"):
        if cand in out.columns:
            # Key komposit (akun + id post) — aman & lebih tepat drpd id
            # post saja; id post unik per akun/platform, bukan global.
            if "social_account_id" in out.columns:
                key_cols = ["social_account_id", cand]
            else:
                key_cols = [cand]
            break

    return _stringlock(out).reset_index(drop=True), \
        target_schema, target_table, key_cols


def _audience_to_jsonb(df, channel, brand, engine=None, org_id=None):
    """Lipat audience long-format lama → 1 baris/tanggal dgn kolom jsonb.

    Input  : kolom (date, breakdown_type, category, value[, percentage])
    Output : (date→fetched_at, social_account_id, demographics_<breakdown>)
             — hanya kolom breakdown yang ada di file ini yang terisi;
             file breakdown lain akan MELENGKAPI baris yg sama via UPSERT
             (operator || jsonb di sisi engine)."""
    need = {"date", "breakdown_type", "category", "value"}
    missing = need - set(map(str, df.columns))
    if missing:
        raise ValueError(
            f"Data audience tidak lengkap, kolom hilang: {sorted(missing)}."
        )
    if brand is None or str(brand).strip() == "":
        raise ValueError(
            "Kategori audience butuh brand terpilih di UI untuk identitas akun "
            "(social_account_id), tapi brand kosong."
        )

    work = df.copy()
    work["date"] = pd.to_datetime(work["date"], errors="coerce")
    work = work.dropna(subset=["date", "breakdown_type", "category"])
    if work.empty:
        raise ValueError("Data audience kosong setelah pembersihan tanggal.")

    rows = {}
    for (dt, br), grp in work.groupby(["date", work["breakdown_type"].str.strip().str.lower()]):
        col = _AUDIENCE_COL.get(br)
        if col is None:
            continue  # breakdown tak dikenal → lewati, jangan mengarang kolom
        payload = {}
        for _, r in grp.iterrows():
            val = r["value"]
            if pd.isna(val):
                continue
            payload[str(r["category"]).strip()] = (
                float(val) if not float(val).is_integer() else int(val)
            )
        if not payload:
            continue
        row = rows.setdefault(dt, {})
        row[col] = json.dumps(payload, ensure_ascii=False)

    if not rows:
        raise ValueError(
            "Tidak ada breakdown audience yang dikenali "
            f"(dikenali: {sorted(set(_AUDIENCE_COL))})."
        )

    out = pd.DataFrame(
        [{"fetched_at": dt, **cols} for dt, cols in sorted(rows.items())]
    )
    out["social_account_id"] = (
        _resolve_social_account_id(engine, channel, brand=brand, org_id=org_id)
        if engine is not None else _account_uuid(f"{channel}:brand:{brand}")
    )
    return out, "l0_raw", "ig_profile_snapshots", ["social_account_id", "fetched_at"]


# ══════════════════════════════════════════════════════════════════════════
# ATRIBUT MANUAL POST → l0_extra.<channel>_post_extra_attribute
# Kolom anotasi manual (content_pillar, brand_offering, format, is_*) TIDAK
# punya rumah di l0_raw — rumahnya tabel extra attribute di l0_extra
# (UNIQUE (brand_id, post_id) sudah ada di DB). Ditulis sebagai INSERT KEDUA
# setelah insert utama kategori Post.
# ══════════════════════════════════════════════════════════════════════════
_EXTRA_ATTR_TABLES = {
    "facebook": ("facebook_post_extra_attribute", [
        "content_pillar", "brand_offering", "format", "is_collab", "is_aon",
        "is_campaign", "is_boosted", "is_activity", "is_event"]),
    "instagram": ("instagram_post_extra_attribute", [
        "content_pillar", "brand_offering", "format", "is_collab", "is_aon",
        "is_campaign", "is_activity", "is_event", "is_boosted", "repost"]),
    "tiktok": ("tiktok_post_extra_attribute", [
        "content_pillar", "brand_offering", "format", "is_boosted",
        "is_collab", "is_aon", "is_campaign", "is_activity", "is_event",
        # 3 metrik FPK Content Performance yang rumahnya MEMANG di tabel
        # extra ini (verifikasi kolom DB 20/7) — ikut insert kedua:
        "avg_watch_time", "reach_post", "completion_rate"]),
}


_EXTRA_FK_CACHE = {}


def _extra_brand_fk_target(engine, table):
    """Deteksi tabel yang dirujuk FK kolom brand_id di l0_extra.<table>.

    TEMUAN DB 19 Jul: fk_facebook_post_extra_attribute_brand_id_social_account
    ternyata merujuk public.social_accounts(id) — kolom BERNAMA brand_id tapi
    isinya diharapkan id AKUN sosial. Supaya tidak bergantung pada penamaan
    yang menyesatkan (dan tetap benar bila backend kelak mengubah FK ke
    public.brands), target FK dideteksi langsung dari katalog.
    Return: 'social_accounts' / 'brands' / nama tabel lain / None (tanpa FK).
    """
    if table in _EXTRA_FK_CACHE:
        return _EXTRA_FK_CACHE[table]
    ref = None
    try:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT ccu.table_name "
                "FROM information_schema.table_constraints tc "
                "JOIN information_schema.key_column_usage kcu "
                "  ON tc.constraint_name = kcu.constraint_name "
                " AND tc.table_schema = kcu.table_schema "
                "JOIN information_schema.constraint_column_usage ccu "
                "  ON tc.constraint_name = ccu.constraint_name "
                "WHERE tc.constraint_type = 'FOREIGN KEY' "
                "  AND tc.table_schema = 'l0_extra' AND tc.table_name = :t "
                "  AND kcu.column_name = 'brand_id' LIMIT 1"), {"t": table}
            ).fetchone()
            if row:
                ref = str(row[0])
    except Exception:
        ref = None
    _EXTRA_FK_CACHE[table] = ref
    return ref


_BOOL_COLS_CACHE = {}


def _bool_columns_of(engine, schema, table):
    """Kolom bertipe boolean di schema.table (introspeksi katalog, di-cache).

    FIX 19/7 (DatatypeMismatch 'repost'): kolom is_* dan repost di
    l0_extra.*_post_extra_attribute bertipe BOOLEAN di DB komersil,
    sedangkan file bisa membawa angka (spec lama: repost = INTEGER jumlah
    repost). Kolom boolean dideteksi langsung dari katalog supaya tidak
    bergantung penamaan. Fallback (katalog tak terbaca): tebak dari nama.
    """
    key = (schema, table)
    if key in _BOOL_COLS_CACHE:
        return _BOOL_COLS_CACHE[key]
    cols = set()
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = :s AND table_name = :t "
                "  AND data_type = 'boolean'"), {"s": schema, "t": table})
            cols = {str(r[0]) for r in rows}
    except Exception:
        cols = set()
    if not cols:
        cols = {"repost", "is_collab", "is_aon", "is_campaign",
                "is_activity", "is_event", "is_boosted"}
    _BOOL_COLS_CACHE[key] = cols
    return cols


_BOOL_TRUE = {"true", "t", "yes", "y", "ya", "1", "on"}
_BOOL_FALSE = {"false", "f", "no", "n", "tidak", "0", "off"}


def _coerce_bool(v):
    """Nilai bebas → True/False/None untuk kolom boolean l0_extra.

    Aturan:
      • bool / 'yes' / 'no' / 'true' / 'false' / 1 / 0 → dipetakan wajar.
      • angka LAIN (mis. repost=11 dari FPK = JUMLAH repost) → None.
        JANGAN menebak count>0 berarti TRUE — 'direpost 11x' ≠ 'post ini
        repost'. Count-nya sudah punya rumah di ig_media_snapshots.reposts.
      • nilai tak dikenal / kosong / '-' → None (jangan gagalkan insert).
    """
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    s = str(v).strip().lower()
    if s in ("", "-", "nan", "none", "null"):
        return None
    if s in _BOOL_TRUE:
        return True
    if s in _BOOL_FALSE:
        return False
    try:
        f = float(s)
    except ValueError:
        return None
    if f == 0:
        return False
    if f == 1:
        return True
    return None


# ══════════════════════════════════════════════════════════════════════════
# METRIK FPK PER-POST TIKTOK → l0_extra.tt_post_fpk
# Metrik Content Performance yang TIDAK punya kolom di tt_video_snapshots
# maupun tiktok_post_extra_attribute. Keputusan 20/7 (melanjutkan pola
# tt_profile_fpk arahan mentor 18/7): simpan di tabel milik aplikasi.
# Nama kolom legacy = nama kolom DB (tanpa rename) supaya sederhana.
# ══════════════════════════════════════════════════════════════════════════
_TT_POST_FPK_COLS = (
    "saves", "total_watch_time", "new_follows", "profile_views",
    "website_clicks", "spark_ads", "viewer_follower", "viewer_non_follower",
    "viewer_new", "viewer_returning", "viewer_male", "viewer_female",
)


def tt_post_fpk_to_komersil(df, channel, category, engine,
                            brand=None, org_id=None):
    """Metrik FPK per-post TikTok tanpa rumah lain → l0_extra.tt_post_fpk.

    Return (df, schema, table, key_cols) atau None bila tidak relevan
    (bukan tiktok Post / tidak ada metrik berisi data).
    """
    if _legacy_key(channel, category) != "tiktok_post":
        return None
    if df is None or df.empty or "post_id" not in df.columns:
        return None
    present = [c for c in _TT_POST_FPK_COLS
               if c in df.columns and df[c].notna().any()]
    if not present:
        return None

    acct_src = next((c for c in _ACCOUNT_ID_CANDIDATES
                     if c in df.columns and df[c].notna().any()), None)
    keep = ["post_id"] + present + ([acct_src] if acct_src else [])
    work = df[keep].copy()
    work = work.dropna(subset=["post_id"]).reset_index(drop=True)
    if work.empty:
        return None

    fallback = (_resolve_social_account_id(engine, channel, brand=brand,
                                           org_id=org_id)
                if brand else None)
    if acct_src is not None:
        uniq = {}
        for v in pd.unique(work[acct_src].dropna()):
            vv = (str(int(v)) if isinstance(v, float)
                  and float(v).is_integer() else str(v))
            uniq[v] = _resolve_social_account_id(
                engine, channel, brand=brand, platform_user_id=vv,
                org_id=org_id)
        work["social_account_id"] = work[acct_src].map(
            lambda v: uniq.get(v, fallback) if pd.notna(v) else fallback)
        work = work.drop(columns=[acct_src])
    else:
        work["social_account_id"] = fallback
    if work["social_account_id"].isna().all():
        raise ValueError(
            "social_account_id tidak bisa di-resolve utk tt_post_fpk: file "
            "tanpa kolom identitas akun dan brand UI kosong."
        )
    work = work.dropna(subset=["social_account_id"]).reset_index(drop=True)

    bid = _brand_id(engine, brand, org_id=org_id)
    if bid:
        work["brand_id"] = bid

    # Key komposit (akun + post) — selaras UNIQUE (social_account_id,
    # post_id) di setup_tt_post_fpk.sql.
    return _stringlock(work), "l0_extra", "tt_post_fpk", \
        ["social_account_id", "post_id"]


def extra_attributes_to_komersil(df, channel, category, engine,
                                 brand=None, org_id=None):
    """Ambil kolom atribut manual dari DataFrame gaya-lama (SEBELUM
    to_komersil membuangnya) → siap-insert ke l0_extra.

    Return (df, schema, table, key_cols) atau None bila tidak relevan
    (bukan kategori Post / tidak ada kolom atribut berisi data).
    Raises ValueError bila brand tidak bisa di-resolve (brand_id NOT NULL).
    """
    ch = str(channel or "").strip().lower()
    if ch not in _EXTRA_ATTR_TABLES:
        return None
    if _legacy_key(channel, category) != f"{ch}_post":
        return None  # hanya kategori Post; Story dkk. tidak punya tabel extra
    if df is None or df.empty or "post_id" not in df.columns:
        return None
    table, attr_cols = _EXTRA_ATTR_TABLES[ch]
    present = [c for c in attr_cols if c in df.columns and df[c].notna().any()]
    if not present:
        return None  # file FPK murni: kolom anotasi kosong → tidak perlu insert
    acct_cols = [c for c in _ACCOUNT_ID_CANDIDATES if c in df.columns]
    uname_col = "account_username" if "account_username" in df.columns else None
    keep_cols = (["post_id"] + present + acct_cols
                 + ([uname_col] if uname_col else []))
    work = df[keep_cols].copy()
    work = work.dropna(subset=["post_id"]).reset_index(drop=True)
    if work.empty:
        return None

    ref_tbl = _extra_brand_fk_target(engine, table)
    fallback_sid = (_resolve_social_account_id(engine, channel, brand=brand,
                                               org_id=org_id)
                    if brand else None)

    if ref_tbl == "social_accounts":
        # FK brand_id → public.social_accounts(id): isi dgn id AKUN per baris
        # (persis derivasi social_account_id di insert utama).
        acct_src = next((c for c in acct_cols if work[c].notna().any()), None)
        if acct_src is not None:
            uniq = {}
            for v in pd.unique(work[acct_src].dropna()):
                vv = (str(int(v)) if isinstance(v, float)
                      and float(v).is_integer() else str(v))
                uniq[v] = _resolve_social_account_id(
                    engine, channel, brand=brand, platform_user_id=vv,
                    org_id=org_id)
            work["brand_id"] = work[acct_src].map(
                lambda v: uniq.get(v, fallback_sid) if pd.notna(v)
                else fallback_sid)
        elif uname_col and work[uname_col].notna().any():
            uniq = {}
            for v in pd.unique(work[uname_col].dropna()):
                uniq[v] = _resolve_social_account_id(
                    engine, channel, brand=brand, username=str(v),
                    org_id=org_id)
            work["brand_id"] = work[uname_col].map(
                lambda v: uniq.get(v, fallback_sid) if pd.notna(v)
                else fallback_sid)
        else:
            work["brand_id"] = fallback_sid
        if work["brand_id"].isna().all():
            raise ValueError(
                "brand_id (FK → social_accounts) tidak bisa di-resolve: file "
                "tanpa kolom identitas akun dan brand UI kosong."
            )
        work = work.dropna(subset=["brand_id"]).reset_index(drop=True)
    else:
        # FK brand_id → public.brands / tanpa FK: pakai id brand (panduan).
        bid = _brand_id(engine, brand, org_id=org_id)
        if not bid:
            raise ValueError(
                "brand_id tidak bisa di-resolve dari public.brands — kolom "
                "brand_id di l0_extra wajib terisi (NOT NULL). Pastikan brand "
                "terdaftar di organisasi terpilih."
            )
        work["brand_id"] = bid

    # rapikan master (best-effort): pastikan link brand ↔ akun tercatat
    _ensure_brand_link(engine, channel, brand, org_id, fallback_sid)

    # ── KOERSI BOOLEAN (fix 19/7): cegah DatatypeMismatch kolom repost/is_*
    bool_cols = _bool_columns_of(engine, "l0_extra", table)
    for c in [c for c in present if c in bool_cols]:
        work[c] = work[c].map(_coerce_bool)
        work[c] = work[c].astype(object).where(work[c].notna(), None)
    # kolom yang setelah koersi kosong semua → tidak usah dikirim
    present = [c for c in present
               if c not in bool_cols or work[c].notna().any()]
    if not present:
        return None  # tak ada atribut valid tersisa → l0_extra dilewati

    out = work[["post_id"] + present + ["brand_id"]]
    return _stringlock(out), "l0_extra", table, ["brand_id", "post_id"]