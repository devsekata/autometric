"""Scheduler Engine — satu eksekusi ONE-SHOT untuk uji end-to-end.

RUANG LINGKUP
=============
Satu eksekusi, dua pekerjaan atas SATU profil yang sama, lalu berhenti:

    PROFILE  1 KOL dari kol_directory yang BELUM pernah di-scrape
    POST     10 post terbaru DARI PROFIL YANG SAMA

Keduanya berasal dari SATU run actor: mode `details` Instagram mengembalikan
profil beserta `latestPosts` sekaligus. Jadi satu eksekusi = satu panggilan
actor = dua baris log.

Tidak ada loop, tidak ada cron, tidak ada retry otomatis. `MAX_RETRIES = 0`
dipasang di satu tempat supaya tidak bisa hidup lagi tanpa disengaja.

IDENTITY — INI BAGIAN YANG PALING MUDAH SALAH
=============================================
Username HANYA dipakai sebagai input ke actor. Ia TIDAK PERNAH dipakai untuk
menentukan `social_account_id`.

    public.kol_directory               siapa yang harus di-scrape
        -> public.kol_social_account   jembatan resmi, 1:1
        -> public.social_account       identitas seluruh warehouse
        -> l0_raw.*                    tujuan tulis

Audit membuktikan pencocokan username ambigu: `shalsarsyaa` dan
`sitisarahadiyastuti` masing-masing muncul dua kali pada platform yang sama,
sehingga join username menghasilkan 7.497 pasangan dari populasi 7.494. Karena
itu `social_account_id` dibawa dari hasil query kandidat sampai ke `insert_*`
lewat parameter `account_ids`.

PLATFORM
========
Selalu dari `kol_directory.platform_id` -> `platforms.key`. Tidak pernah ditebak
dari username, dan tidak pernah diasumsikan Instagram.

    instagram  -> apify/instagram-scraper    -> ig_profile_apify / ig_media_snapshots_apify
    tiktok     -> clockworks/tiktok-scraper  -> tt_profile_apify / tt_video_apify

SATU RUN ACTOR UNTUK DUA KATEGORI LOG
=====================================
Actor Instagram mode `details` mengembalikan profil DAN `latestPosts` sekaligus.
Untuk profil uji, satu run itu dipakai untuk kedua pekerjaan — tapi tetap dicatat
sebagai DUA baris `public.scheduler_logs` (`category='profile'` dan
`category='post'`) dengan `run_id` yang sama. Actor tidak pernah dipanggil dua
kali hanya demi menghasilkan dua baris log.

YANG DIPAKAI ULANG
==================
    apify_runner.ProfileScraper    pemanggilan actor (retry dimatikan)
    apify_posts.*                  bentuk input + pembacaan username per item
    raw_store / tt_raw_store       profil -> l0_raw
    post_raw_store                 post   -> l0_raw + deduplication
    post_errors                    klasifikasi kegagalan
    scrape_log.ScrapeLogger        public.scheduler_logs (satu-satunya tempat log)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from apify_posts import (
    DEFAULT_IG_POST_ACTOR,
    DEFAULT_TT_VIDEO_ACTOR,
    InstagramDetailsScraper,
    TikTokVideoScraper,
)
from config import Config, ConfigError, load_config
from db import connect
from post_errors import SUCCESS, classify_exception
from post_raw_store import (
    IG_TABLE,
    TT_TABLE,
    insert_ig_posts,
    insert_tt_videos,
    split_new_and_duplicate,
)
from raw_store import insert_profiles as insert_ig_profiles
from scrape_log import (
    SCHEDULER_CATEGORY_POST,
    SCHEDULER_CATEGORY_PROFILE,
    SCHEDULER_JOB_NAME,
    ScrapeLogger,
)
from transform import normalize_username
from tt_raw_store import insert_profiles as insert_tt_profiles

logger = logging.getLogger("scheduler_engine")

# --- batas eksekusi ---------------------------------------------------------

#: Profil yang di-scrape per eksekusi KALAU tidak ada yang menentukan lain.
#: Tetap 1: menaikkan angka ini tidak boleh terjadi diam-diam lewat deploy.
#: Batch yang lebih besar diminta SECARA SADAR lewat `--limit` atau
#: `SCRAPE_BATCH_SIZE` — lihat `resolve_batch_limit`.
PROFILE_TARGET_LIMIT = 1
#: Nama environment variable untuk ukuran batch.
BATCH_SIZE_ENV = "SCRAPE_BATCH_SIZE"
#: Post terbaru per target.
POSTS_PER_TARGET = 10
#: Retry actor otomatis DIMATIKAN — actor berbiaya, kegagalan dicatat lalu selesai.
MAX_RETRIES = 0
#: Profil yang tidak boleh terpilih sebagai kandidat uji profil, dan tidak
#: dihitung sebagai target post. `aamandazahra` adalah hasil uji sebelumnya,
#: bukan bagian dari 23 target awal.
EXCLUDED_USERNAMES = frozenset({"aamandazahra"})

FAILED = "failed"
PLATFORMS = ("instagram", "tiktok")

PLATFORM_TABLES = {
    "instagram": {
        "profile_table": "l0_raw.ig_profile_apify",
        "post_table": IG_TABLE,
        "actor": DEFAULT_IG_POST_ACTOR,   # apify/instagram-scraper
        "posted_at_key": "timestamp",
    },
    "tiktok": {
        "profile_table": "l0_raw.tt_profile_apify",
        "post_table": TT_TABLE,
        "actor": DEFAULT_TT_VIDEO_ACTOR,  # clockworks/tiktok-scraper
        "posted_at_key": "createTimeISO",
    },
}


def resolve_batch_limit(cli_limit: int | None = None) -> int:
    """Berapa profil yang boleh diambil satu eksekusi.

    PRESEDENSI, dari yang paling kuat:

        1. `--limit` (argumen CLI / parameter `cli_limit`)
        2. environment `SCRAPE_BATCH_SIZE`
        3. `PROFILE_TARGET_LIMIT` (= 1)

    CLI menang atas environment DENGAN SENGAJA: environment adalah setelan
    mesin yang bisa terbawa dari deploy sebelumnya, sedangkan `--limit`
    diketik orang yang sedang menjalankan perintah itu. Yang paling dekat
    dengan keputusan manusia yang menang.

    Nilai tidak sah GAGAL KERAS, tidak pernah diam-diam jatuh ke 1. Batch yang
    salah baca berarti panggilan actor berbayar yang tidak diminta, jadi
    "0", "-5", "dua", dan "2.5" semuanya melempar `ValueError` — termasuk
    ketika datang dari environment, di mana salah ketik paling mudah lolos.
    """
    if cli_limit is not None:
        return _batas_sah(cli_limit, "--limit")

    mentah = os.getenv(BATCH_SIZE_ENV)
    if mentah is None or mentah.strip() == "":
        return PROFILE_TARGET_LIMIT
    return _batas_sah(mentah, BATCH_SIZE_ENV)


def _batas_sah(nilai, asal: str) -> int:
    """Integer >= 1, atau `ValueError` yang menyebut asal nilainya."""
    if isinstance(nilai, bool):  # bool adalah int di Python; bukan batas yang sah
        raise ValueError(f"{asal} harus bilangan bulat >= 1, dapat {nilai!r}")
    try:
        angka = int(str(nilai).strip())
    except (TypeError, ValueError):
        raise ValueError(
            f"{asal} harus bilangan bulat >= 1, dapat {nilai!r}"
        ) from None
    if angka < 1:
        raise ValueError(f"{asal} harus bilangan bulat >= 1, dapat {angka}")
    return angka


def actor_for(platform: str) -> str:
    """Actor yang WAJIB dipakai platform ini.

    Sengaja tidak membaca `APIFY_ACTOR_ID`/`TIKTOK_ACTOR_ID` dari .env: bentuk
    data yang masuk l0_raw tidak boleh berubah diam-diam. Khususnya
    `apify/instagram-profile-scraper` yang dipakai jalur lama TIDAK dipakai di
    sini.
    """
    try:
        return PLATFORM_TABLES[platform]["actor"]
    except KeyError:
        raise ValueError(f"platform '{platform}' tidak dikenal, pilih {PLATFORMS}") from None


def table_for(platform: str, jenis: str) -> str:
    """Tabel l0_raw untuk satu platform. `jenis` = 'profile_table' | 'post_table'."""
    if platform not in PLATFORM_TABLES:
        raise ValueError(f"platform '{platform}' tidak dikenal, pilih {PLATFORMS}")
    if jenis not in ("profile_table", "post_table"):
        raise ValueError(f"jenis tabel '{jenis}' tidak dikenal")
    return PLATFORM_TABLES[platform][jenis]


# --- bentuk data ------------------------------------------------------------


@dataclass(frozen=True)
class KolTarget:
    """Satu KOL beserta identitasnya yang sudah pasti.

    `social_account_id` SELALU berasal dari `public.kol_social_account`, tidak
    pernah dari pencocokan username. Nilai itu yang diteruskan sampai ke
    `insert_*`, sehingga hasil actor tidak bisa mendarat di akun lain.
    """

    kol_directory_id: str
    social_account_id: str
    platform: str
    username: str

    @property
    def actor(self) -> str:
        return actor_for(self.platform)


@dataclass
class JobResult:
    """Hasil satu pekerjaan (profile ATAU post) dalam satu eksekusi."""

    run_id: str
    category: str
    platform: str
    actor: str
    started_at: datetime
    finished_at: datetime | None = None
    username: str | None = None
    kol_directory_id: str | None = None
    status: str = FAILED
    profiles_processed: int = 0
    posts_fetched: int = 0
    posts_saved: int = 0
    duplicates_skipped: int = 0
    targets: int = 0
    failed_targets: int = 0
    error_message: str | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == SUCCESS

    @property
    def duration_seconds(self) -> float:
        akhir = self.finished_at or datetime.now(timezone.utc)
        return round((akhir - self.started_at).total_seconds(), 3)


# --- pembantu ---------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sort_key(item: dict, key: str) -> str:
    value = item.get(key)
    return value if isinstance(value, str) else ""


def latest_posts(items, posted_at_key: str, limit: int = POSTS_PER_TARGET) -> list[dict]:
    """`limit` post TERBARU dari satu akun, diurutkan waktu tayang menurun.

    Tetap dipakai walau actor sudah dibatasi `resultsLimit`: batas actor tidak
    menjamin urutan. Post tanpa timestamp diberi kunci kosong supaya selalu
    kalah dari post yang punya.
    """
    posts = [i for i in items if isinstance(i, dict)]
    posts.sort(key=lambda i: _sort_key(i, posted_at_key), reverse=True)
    return posts[:limit]


def count_rows(conn, table: str, social_account_id: str) -> int:
    """Jumlah baris di satu tabel l0_raw untuk satu akun."""
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT count(*) FROM {table} WHERE social_account_id = %s",
            (social_account_id,),
        )
        return int(cur.fetchone()[0])


# --- pemilihan target dari kol_directory ------------------------------------

# Jembatan resmi. Tidak ada pencocokan username di mana pun di query ini.
_DARI_DIREKTORI = """
    FROM public.kol_directory      k
    JOIN public.platforms          p ON p.id = k.platform_id
    JOIN public.kol_social_account b ON b.kol_id = k.id
    JOIN public.social_account     s ON s.id = b.social_account_id
                                    AND s.platform_id = k.platform_id
"""


CANDIDATE_ORDERS = {
    "followers": "k.followers_count DESC NULLS LAST, k.username ASC",
    "username": "k.username ASC",
}


def select_profile_targets(
    conn,
    limit: int = PROFILE_TARGET_LIMIT,
    platform: str | None = None,
    order: str = "followers",
    username: str | None = None,
) -> list[KolTarget]:
    """Pilih SAMPAI `limit` kandidat profil, berangkat dari `public.kol_directory`.

    Syarat kandidat sama persis dengan `select_profile_target` di bawah — yang
    berubah hanya BERAPA BANYAK yang dikembalikan, bukan SIAPA yang memenuhi
    syarat. Predikat WHERE tidak disentuh.

    KENAPA `limit` DIPAKAI DUA KALI
    ===============================
    Query per platform mengambil `limit` baris, lalu gabungannya dipotong lagi
    jadi `limit`. Dua platform berarti sampai `2 x limit` baris terbaca sebelum
    dipotong — itu disengaja. Memotong per platform saja akan membagi jatah
    setengah-setengah dan memaksa komposisi 50:50 yang tidak diminta siapa pun;
    memotong di akhir membiarkan urutan yang dipilih (`order`) yang menentukan
    komposisinya. Baris berlebih hanya dibaca, tidak pernah di-scrape.

    `followers_count` ikut diambil HANYA untuk pengurutan gabungan itu. Tanpa
    kolomnya, dua daftar yang masing-masing sudah urut tidak bisa digabung
    dengan benar dan `order='followers'` akan bohong di tingkat batch.

    Hasilnya deterministik dan bebas duplikat: satu `social_account_id` tidak
    pernah muncul dua kali dalam satu rencana.
    """
    batas = _batas_sah(limit, "limit")
    if platform is not None and platform not in PLATFORM_TABLES:
        raise ValueError(f"platform '{platform}' tidak dikenal, pilih {PLATFORMS}")
    if order not in CANDIDATE_ORDERS:
        raise ValueError(
            f"order '{order}' tidak dikenal, pilih {sorted(CANDIDATE_ORDERS)}"
        )

    kunci = normalize_username(username) if username else None
    if username and not kunci:
        raise ValueError(f"username '{username}' tidak valid")

    daftar = [platform] if platform else list(PLATFORMS)
    kandidat: list[tuple[int, KolTarget]] = []

    for plat in daftar:
        profile_table = table_for(plat, "profile_table")
        post_table = table_for(plat, "post_table")
        filter_username = (
            "\n              AND ltrim(lower(btrim(split_part(k.username, '?', 1))), '@') "
            "= %(username)s"
            if kunci
            else ""
        )
        query = f"""
            SELECT k.id::text, s.id::text, p.key, k.username, k.followers_count
            {_DARI_DIREKTORI}
            WHERE p.key = %(platform)s
              AND k.username IS NOT NULL
              AND btrim(k.username) <> ''
              AND lower(btrim(k.username)) <> ALL(%(dikecualikan)s){filter_username}
              AND NOT EXISTS (SELECT 1 FROM {profile_table} pr
                              WHERE pr.social_account_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM {post_table} po
                              WHERE po.social_account_id = s.id)
            ORDER BY {CANDIDATE_ORDERS[order]}
            LIMIT %(batas)s
        """
        params = {
            "platform": plat,
            "dikecualikan": sorted(EXCLUDED_USERNAMES),
            "batas": batas,
        }
        if kunci:
            params["username"] = kunci
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall() or []
        for row in rows:
            pengikut = row[4] if len(row) > 4 and row[4] is not None else -1
            kandidat.append((
                int(pengikut),
                KolTarget(
                    kol_directory_id=row[0],
                    social_account_id=row[1],
                    platform=row[2],
                    username=normalize_username(row[3]) or row[3],
                ),
            ))

    # Urutan gabungan mengikuti `order` yang diminta; `username` tetap pemecah
    # seri, sama seperti CANDIDATE_ORDERS di SQL.
    if order == "followers":
        kandidat.sort(key=lambda p: (-p[0], p[1].username))
    else:
        kandidat.sort(key=lambda p: p[1].username)

    terpilih: list[KolTarget] = []
    sudah: set[str] = set()
    for _, target in kandidat:
        if target.social_account_id in sudah:
            continue
        sudah.add(target.social_account_id)
        terpilih.append(target)
        if len(terpilih) >= batas:
            break
    return terpilih


def select_profile_target(
    conn,
    platform: str | None = None,
    order: str = "followers",
    username: str | None = None,
) -> KolTarget | None:
    """Pilih SATU kandidat uji profil, berangkat dari `public.kol_directory`.

    Syarat kandidat, semuanya dibuktikan lewat query:

      1. ada di `kol_directory` dengan `platform_id` valid;
      2. punya baris di `kol_social_account` — tanpa itu `social_account_id`
         tidak ada dan barisnya tidak akan bisa ditulis ke l0_raw;
      3. username terisi;
      4. **BELUM punya satu pun baris di tabel PROFIL l0_raw platformnya** —
         ini kriteria utamanya. Sekitar 1.000 profil sudah pernah berhasil
         ditarik ke L0 RAW profile; kandidat uji diambil di luar itu.
         `kol_directory.scrape_status` SENGAJA TIDAK dipakai: ia menandai
         percobaan, bukan keberhasilan menulis ke L0, jadi bisa menyesatkan;
      5. BELUM punya baris di tabel POST l0_raw platformnya — supaya kandidat
         tidak berimpit dengan akun yang sudah jadi target post;
      6. bukan `aamandazahra`.

    `platform` boleh dibatasi; kalau None, kandidat dicari di kedua platform dan
    platform hasilnya ditentukan oleh baris yang terpilih — bukan diasumsikan.

    `username` mengunci kandidat ke satu akun tertentu. Syarat 4-6 di atas TETAP
    diberlakukan — akun yang dikunci tapi sudah punya data di L0 tidak akan
    terpilih, dan fungsi ini mengembalikan None. Jadi mengunci kandidat tidak
    melewati verifikasi apa pun, hanya mempersempit pencarian.

    `order` menentukan kandidat mana yang di depan:
        'followers' (default) followers terbanyak dulu. Akun besar hampir pasti
                              publik, jadi peluang run actor berhasil jauh lebih
                              tinggi — pelajaran dari kandidat 1.523 follower
                              yang ternyata tidak mengembalikan data profil.
        'username'            urut abjad.
    Keduanya deterministik: `username` selalu jadi pemecah seri.
    Implementasi tunggal ada di `select_profile_targets`; fungsi ini hanya
    mengambil yang pertama. Dipertahankan supaya pemanggil lama tidak perlu
    ikut berubah hanya karena batch ditambahkan.
    """
    terpilih = select_profile_targets(
        conn, limit=1, platform=platform, order=order, username=username
    )
    return terpilih[0] if terpilih else None


# --- pemanggilan actor ------------------------------------------------------


def _build_scraper(platform: str, cfg: Config):
    """Scraper untuk satu platform, dengan retry otomatis DIMATIKAN.

    `max_retries=0` menghentikan pengulangan level batch. Untuk TikTok,
    `retry_missing` juga dimatikan — ia mengirim ulang username yang tidak
    kembali, dan itu tetap panggilan actor berbayar.
    """
    if platform == "instagram":
        scraper = InstagramDetailsScraper(
            cfg.apify, results_limit=POSTS_PER_TARGET, max_retries=MAX_RETRIES
        )
    elif platform == "tiktok":
        scraper = TikTokVideoScraper(
            cfg.tiktok, results_per_page=POSTS_PER_TARGET, max_retries=MAX_RETRIES
        )
    else:
        raise ValueError(f"platform '{platform}' tidak dikenal, pilih {PLATFORMS}")
    scraper.retry_missing = False
    return scraper


def scrape_target(cfg: Config, target: KolTarget):
    """Satu run actor untuk satu target -> (item profil, item post, pembaca username).

    Instagram: satu item profil yang membawa `latestPosts`.
    TikTok   : daftar video; tiap video membawa `authorMeta` berisi profil, jadi
               daftar yang sama dipakai untuk kedua kebutuhan.

    Melempar RuntimeError kalau run gagal — pemanggil yang mencatatnya.
    """
    scraper = _build_scraper(target.platform, cfg)
    batch = scraper.scrape_batch([target.username], batch_index=0)
    if batch.error:
        raise RuntimeError(batch.error)

    items = list(batch.items)
    if target.platform == "instagram":
        posts: list[dict] = []
        for item in items:
            posts.extend(scraper.posts_of(item))
        return items, posts, scraper.item_username
    return items, items, scraper.item_username


# --- penulisan L0 -----------------------------------------------------------


def _simpan_profil(conn, target: KolTarget, items, run_id: str, scraped_at: datetime):
    """Tulis profil ke l0_raw, dengan social_account_id dari jembatan."""
    peta = {target.username: target.social_account_id}
    fn = insert_ig_profiles if target.platform == "instagram" else insert_tt_profiles
    return fn(
        conn,
        items,
        source_actor=target.actor,
        scraped_at=scraped_at,
        scrape_run_id=run_id,
        commit=True,
        account_ids=peta,
    )


def _simpan_post(conn, target: KolTarget, items, username_of, run_id: str, scraped_at: datetime):
    """Tulis post ke l0_raw setelah menyaring yang sudah ada.

    Mengembalikan `(stats, jumlah_duplikat)`. Deduplication di sisi aplikasi,
    bukan unique constraint baru — tabel ini snapshot append-only dan post yang
    sama boleh muncul lagi di tanggal scrape berbeda.
    """
    post_table = table_for(target.platform, "post_table")
    baru, duplikat = split_new_and_duplicate(
        conn, post_table, items, social_account_id=target.social_account_id
    )
    if not baru:
        return None, len(duplikat)

    peta = {target.username: target.social_account_id}
    fn = insert_ig_posts if target.platform == "instagram" else insert_tt_videos
    stats = fn(
        conn,
        baru,
        username_of=username_of,
        source_actor=target.actor,
        scraped_at=scraped_at,
        scrape_run_id=run_id,
        commit=True,
        account_ids=peta,
    )
    return stats, len(duplikat)


# --- logging ----------------------------------------------------------------


def write_log(cfg: Config | None, hasil: JobResult) -> bool:
    """Tulis satu baris ke public.scheduler_logs.

    Satu-satunya tempat log scheduler. Tidak ada schema `schedule`, tidak ada
    view, tidak ada tabel logging lain. Gagal menulis log tidak menggagalkan
    pekerjaan, tapi tetap dilaporkan supaya tidak hilang diam-diam.
    """
    if cfg is None:
        logger.error("Config tidak terbaca, pekerjaan %s tidak bisa dicatat", hasil.category)
        return False

    catatan = "; ".join(hasil.notes) if hasil.notes else None
    if hasil.error_message:
        pesan = hasil.error_message + (f" | catatan: {catatan}" if catatan else "")
    elif catatan:
        pesan = f"catatan: {catatan}"
    else:
        pesan = None

    try:
        with ScrapeLogger(
            cfg.postgres, run_id=hasil.run_id, job_name=SCHEDULER_JOB_NAME
        ) as slog:
            ditulis = slog.log_cycle(
                category=hasil.category,
                platform=hasil.platform,
                status=hasil.status,
                username=hasil.username,
                actor=hasil.actor,
                kol_directory_id=hasil.kol_directory_id,
                profiles_processed=hasil.profiles_processed,
                posts_fetched=hasil.posts_fetched,
                posts_saved=hasil.posts_saved,
                duplicates_skipped=hasil.duplicates_skipped,
                message=pesan,
                started_at=hasil.started_at,
                finished_at=hasil.finished_at,
            )
        if not ditulis:
            logger.error("Baris public.scheduler_logs (%s) GAGAL ditulis", hasil.category)
        return ditulis
    except Exception as exc:  # noqa: BLE001 - log gagal tidak boleh menjatuhkan eksekusi
        logger.error("Gagal menulis public.scheduler_logs (%s): %s", hasil.category, exc)
        return False


# --- pekerjaan PROFILE ------------------------------------------------------


def _alasan_profil_kosong(stats, target: KolTarget) -> str:
    """Terjemahkan `stats` jadi alasan yang bisa ditindaklanjuti.

    "0 baris masuk" saja tidak cukup untuk mendiagnosis tanpa memanggil actor
    lagi — dan memanggil actor lagi berbiaya. Angka penyaringan di `stats` sudah
    menyimpan sebabnya, jadi diterjemahkan di sini.
    """
    if stats.skipped_failed:
        return (
            f"actor mengembalikan {stats.skipped_failed} item error untuk "
            f"'{target.username}' (akun private, tidak ada, atau tanpa data "
            "profil), jadi tidak ada baris yang layak masuk l0_raw"
        )
    if stats.skipped_no_username:
        return (
            f"{stats.skipped_no_username} item dari actor tidak membawa username "
            "yang bisa dibaca"
        )
    return "tidak ada baris profil yang masuk ke l0_raw tanpa sebab yang tercatat"


def run_profile_job(
    cfg: Config,
    conn,
    target: KolTarget,
    run_id: str,
    *,
    write: bool = True,
    scraped=None,
    started_at: datetime | None = None,
    actor_seconds: float | None = None,
):
    """Simpan profil untuk SATU target.

    `scraped` adalah `(profil_items, post_items, username_of)` dari run actor
    yang SUDAH dijalankan pemanggil. Kalau None, fungsi ini yang memanggil
    actor. Pemisahan itu penting: `run_once` memanggil actor tepat sekali per
    akun lalu menyuapkan hasilnya ke kedua pekerjaan, sehingga kegagalan
    penyimpanan profil tidak pernah memicu panggilan actor kedua.

    `started_at` adalah saat run actor DIMULAI, bukan saat fungsi ini dipanggil.
    Tanpa itu `duration_seconds` hanya mengukur waktu tulis ke database dan
    menyembunyikan bagian paling lambat dari pekerjaan ini. `actor_seconds`
    dicatat terpisah di pesan log supaya porsi actor tetap terbaca.

    Mengembalikan `(hasil, item_post, pembaca_username)`.
    """
    hasil = JobResult(
        run_id=run_id,
        category=SCHEDULER_CATEGORY_PROFILE,
        platform=target.platform,
        actor=target.actor,
        started_at=started_at or _now(),
        username=target.username,
        kol_directory_id=target.kol_directory_id,
        targets=1,
    )
    if actor_seconds is not None:
        hasil.notes.append(f"termasuk {actor_seconds:.2f}s run actor")
    post_items: list[dict] = []
    username_of = None
    try:
        logger.info(
            "PROFILE START | platform=%s username=%s actor=%s social_account_id=%s",
            target.platform, target.username, target.actor, target.social_account_id,
        )
        if scraped is None:
            profil_items, post_items, username_of = scrape_target(cfg, target)
        else:
            profil_items, post_items, username_of = scraped
        if not profil_items:
            raise RuntimeError("actor tidak mengembalikan satu pun item profil")

        if write:
            stats = _simpan_profil(conn, target, profil_items, run_id, _now())
            hasil.profiles_processed = stats.inserted
            if stats.inserted == 0:
                raise RuntimeError(_alasan_profil_kosong(stats, target))
            if stats.unlinked:
                hasil.notes.append(f"{stats.unlinked} baris tanpa social_account_id")
        else:
            hasil.profiles_processed = len(profil_items)
            hasil.notes.append("--no-write: l0_raw tidak disentuh")
        hasil.status = SUCCESS
    except Exception as exc:  # noqa: BLE001 - kegagalan dicatat, TIDAK di-retry
        _, pesan = classify_exception(exc)
        hasil.status = FAILED
        hasil.failed_targets = 1
        hasil.error_message = pesan
        logger.error("PROFILE FAILED | %s", pesan)

    hasil.finished_at = _now()
    return hasil, post_items, username_of


# --- pekerjaan POST ---------------------------------------------------------


def run_post_job(
    cfg: Config,
    conn,
    targets: list[KolTarget],
    run_id: str,
    *,
    write: bool = True,
    prescraped: dict | None = None,
    started_at: datetime | None = None,
    actor_seconds: float | None = None,
) -> JobResult:
    """Scrape dan simpan maksimal 10 post terbaru untuk setiap target.

    `prescraped` memetakan `social_account_id` -> `(item_post, pembaca_username)`
    yang SUDAH didapat dari run actor sebelumnya. Target di peta itu tidak
    memanggil actor lagi — inilah yang membuat satu run actor menghasilkan dua
    kategori log.

    Satu baris log untuk seluruh pekerjaan post, angkanya dijumlahkan. Kegagalan
    satu target tidak menghentikan target lain, dan tidak ada retry.
    """
    hasil = JobResult(
        run_id=run_id,
        category=SCHEDULER_CATEGORY_POST,
        platform=", ".join(sorted({t.platform for t in targets})) or "-",
        actor=", ".join(sorted({t.actor for t in targets})) or "-",
        started_at=started_at or _now(),
        username=(
            targets[0].username
            if len(targets) == 1
            else f"{len(targets)} target"
        ),
        kol_directory_id=targets[0].kol_directory_id if len(targets) == 1 else None,
        targets=len(targets),
    )
    if actor_seconds is not None:
        # Satu run actor melayani profile dan post, jadi porsi actor memang
        # muncul di kedua baris log. Disebutkan eksplisit supaya tidak terbaca
        # sebagai dua run terpisah.
        hasil.notes.append(f"termasuk {actor_seconds:.2f}s run actor (dipakai bersama)")
    prescraped = prescraped or {}
    gagal: list[str] = []

    for target in targets:
        try:
            if target.social_account_id in prescraped:
                items, username_of = prescraped[target.social_account_id]
                logger.info("POST | %s memakai hasil run actor sebelumnya", target.username)
                if username_of is None:
                    # Run actor untuk akun ini gagal. Tidak dipanggil ulang.
                    raise RuntimeError(
                        "run actor untuk akun ini gagal; post tidak bisa diambil "
                        "dan actor sengaja TIDAK dipanggil ulang"
                    )
            else:
                logger.info(
                    "POST START | platform=%s username=%s actor=%s",
                    target.platform, target.username, target.actor,
                )
                _, items, username_of = scrape_target(cfg, target)

            terbaru = latest_posts(
                items, PLATFORM_TABLES[target.platform]["posted_at_key"], POSTS_PER_TARGET
            )
            hasil.posts_fetched += len(terbaru)

            if not write:
                continue
            stats, duplikat = _simpan_post(conn, target, terbaru, username_of, run_id, _now())
            hasil.duplicates_skipped += duplikat
            if stats is not None:
                hasil.posts_saved += stats.inserted
                if stats.skipped_error:
                    hasil.notes.append(
                        f"{target.username}: {stats.skipped_error} item error disaring"
                    )
        except Exception as exc:  # noqa: BLE001 - satu target gagal, lanjut; TANPA retry
            _, pesan = classify_exception(exc)
            gagal.append(f"{target.username}: {pesan}")
            hasil.failed_targets += 1
            logger.error("POST FAILED | %s -> %s", target.username, pesan)

    if not write:
        hasil.notes.append("--no-write: l0_raw tidak disentuh")

    if not targets:
        hasil.status = SUCCESS
        hasil.notes.append("tidak ada target post")
    elif hasil.failed_targets == 0:
        hasil.status = SUCCESS
    elif hasil.failed_targets < len(targets):
        hasil.status = SUCCESS
        hasil.notes.append(f"{hasil.failed_targets} dari {len(targets)} target gagal")
        hasil.error_message = " | ".join(gagal[:5])
    else:
        hasil.status = FAILED
        hasil.error_message = " | ".join(gagal[:5])

    hasil.finished_at = _now()
    return hasil


# --- satu eksekusi ----------------------------------------------------------


@dataclass
class ExecutionPlan:
    """Apa yang AKAN dikerjakan. Ditampilkan sebelum actor dipanggil."""

    run_id: str
    #: Target pertama. Dipertahankan supaya pemanggil dan tes lama yang menulis
    #: `ExecutionPlan(profile_target=...)` tetap jalan tanpa diubah.
    profile_target: KolTarget | None = None
    post_targets: list[KolTarget] = field(default_factory=list)
    #: Baris profil L0 milik target pertama, sebelum eksekusi.
    profile_rows_before: int = 0
    post_rows_before: dict = field(default_factory=dict)
    #: Seluruh target batch. Inilah yang dibaca `run_once`.
    profile_targets: list[KolTarget] = field(default_factory=list)
    #: `social_account_id` -> jumlah baris profil L0 sebelum eksekusi.
    profile_rows_before_by_id: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Jaga `profile_target` dan `profile_targets` selalu sepakat.

        Satu rencana boleh dibangun dari salah satu sisi: jalur lama mengisi
        `profile_target`, jalur batch mengisi `profile_targets`. Yang kosong
        diturunkan dari yang terisi, jadi tidak ada rencana yang setengah jadi
        dan tidak ada pembaca yang perlu tahu lewat mana ia dibuat.
        """
        if not self.profile_targets and self.profile_target is not None:
            self.profile_targets = [self.profile_target]
        elif self.profile_targets and self.profile_target is None:
            self.profile_target = self.profile_targets[0]

    @property
    def actor_runs(self) -> int:
        """Berapa run actor yang akan terjadi.

        Dihitung per akun unik, bukan per pekerjaan. Profil uji yang juga jadi
        target post hanya menghasilkan SATU run — hasilnya dipakai ulang oleh
        pekerjaan post lewat `prescraped`.
        """
        ids = {t.social_account_id for t in self.post_targets}
        ids.update(t.social_account_id for t in self.profile_targets)
        return len(ids)


def build_plan(
    conn,
    platform: str | None = None,
    with_posts: bool = True,
    order: str = "followers",
    username: str | None = None,
    limit: int = PROFILE_TARGET_LIMIT,
) -> ExecutionPlan:
    """Susun rencana eksekusi dan buktikan kondisi awalnya lewat COUNT nyata.

    Target post adalah PROFIL YANG SAMA, bukan daftar akun lain. Karena mode
    `details` Instagram sudah membawa `latestPosts`, pekerjaan post tidak
    memanggil actor lagi — lihat `run_once`.

    `limit` default 1, jadi memanggil `build_plan` tanpa menyebutnya memberi
    rencana yang identik dengan sebelum batch ada.
    """
    run_id = str(uuid.uuid4())
    profil = select_profile_targets(
        conn, limit=limit, platform=platform, order=order, username=username
    )
    targets = list(profil) if with_posts else []

    plan = ExecutionPlan(run_id=run_id, profile_targets=profil, post_targets=targets)
    for t in profil:
        # Verifikasi kedua: jangan percaya pada NOT EXISTS saja.
        plan.profile_rows_before_by_id[t.social_account_id] = count_rows(
            conn, table_for(t.platform, "profile_table"), t.social_account_id
        )
    if profil:
        plan.profile_rows_before = plan.profile_rows_before_by_id[
            profil[0].social_account_id
        ]
    for t in targets:
        plan.post_rows_before[t.social_account_id] = count_rows(
            conn, table_for(t.platform, "post_table"), t.social_account_id
        )
    return plan


def run_once(
    cfg: Config | None = None,
    *,
    platform: str | None = None,
    with_posts: bool = True,
    write: bool = True,
    log: bool = True,
    plan: ExecutionPlan | None = None,
    limit: int = PROFILE_TARGET_LIMIT,
) -> list[JobResult]:
    """Jalankan SATU eksekusi: pekerjaan profile untuk tiap target, lalu post.

    Tidak pernah melempar. Setiap pekerjaan berakhir sebagai satu baris
    `public.scheduler_logs`, sukses maupun gagal. Tidak ada retry — kalau actor
    gagal, kegagalannya dicatat lalu lanjut ke target berikutnya.

    BERURUTAN, SATU ACTOR PER TARGET
    ================================
    Target diproses satu per satu, dan tiap target memakai `scrape_target` yang
    sudah ada — tidak ada panggilan paralel, dan `scrape_batch` TIDAK dijadikan
    satu panggilan raksasa berisi N username. Alasannya bukan kehati-hatian
    umum: `post_errors` mengklasifikasikan kegagalan per akun dan
    `scheduler_logs` menyimpan satu baris per akun, jadi menggabungkan N
    username ke satu run membuat `private_unavailable` atau `rate_limit`
    kehilangan alamat — kita tahu batch-nya gagal, tapi tidak tahu siapa.

    KEGAGALAN SATU TARGET TIDAK MENGHENTIKAN BATCH
    ==============================================
    Tiap target dibungkus penanganannya sendiri. Target ke-3 yang gagal tidak
    boleh membuat target ke-4 sampai ke-25 tidak pernah dicoba, karena target
    yang gagal tetap memenuhi syarat kandidat (`NOT EXISTS` di L0) dan akan
    terpilih lagi di batch berikutnya — itulah retry-nya, tanpa satu pun
    panggilan actor tambahan di eksekusi ini.

    LOG DITULIS SAAT ITU JUGA, BUKAN DI AKHIR BATCH
    ===============================================
    Dulu seluruh `write_log` menunggu sampai batch selesai. Dengan satu target
    itu tidak kelihatan; dengan 25 target artinya satu proses yang dimatikan di
    target ke-4 menghapus jejak tiga target yang SUDAH selesai. Itu benar-benar
    terjadi pada pilot 5F.2: tiga kegagalan nyata, `scheduler_logs` tetap 39
    baris, dan buktinya hanya tersisa di stdout.

    `write_log` sudah menulis satu baris per `JobResult` lewat `ScrapeLogger`
    yang autocommit, jadi memindahkan panggilannya ke dalam loop tidak menambah
    mekanisme apa pun — hanya memindahkan kapan barisnya mendarat. Kegagalan
    menulis log tetap ditelan di dalam `write_log` sendiri, jadi database yang
    sedang tidak bisa dihubungi tidak akan menjatuhkan batch yang berbiaya
    actor.
    """
    hasil_semua: list[JobResult] = []
    cfg_terpakai = cfg

    def catat(hasil: JobResult) -> None:
        """Simpan hasil satu pekerjaan, lalu langsung tulis barisnya.

        Ditulis sebagai closure supaya pasangan "append + write_log" tidak
        diulang di tiga tempat dan tidak bisa lepas sinkron — satu hasil selalu
        berarti satu baris, dan tidak pernah dua.
        """
        hasil_semua.append(hasil)
        if log:
            write_log(cfg_terpakai, hasil)

    try:
        if cfg_terpakai is None:
            cfg_terpakai = load_config()
        with connect(cfg_terpakai.postgres) as conn:
            rencana = plan or build_plan(conn, platform, with_posts, limit=limit)
            run_id = rencana.run_id

            prescraped: dict = {}
            mulai_actor = None
            detik_actor = None
            if not rencana.profile_targets:
                logger.warning("Tidak ada kandidat profil; pekerjaan profile dilewati")
            for urutan, target in enumerate(rencana.profile_targets, start=1):
                logger.info(
                    "Target %d/%d: %s (%s)",
                    urutan, len(rencana.profile_targets), target.username, target.platform,
                )
                # Actor dipanggil TEPAT SEKALI per target. Hasilnya — berhasil
                # maupun berisi item error — dipakai kedua pekerjaan. Kegagalan
                # menyimpan profil TIDAK boleh memicu panggilan actor kedua.
                mulai_target = _now()
                if mulai_actor is None:
                    mulai_actor = mulai_target
                try:
                    scraped = scrape_target(cfg_terpakai, target)
                except Exception as exc:  # noqa: BLE001
                    _, pesan = classify_exception(exc)
                    logger.error("Run actor gagal untuk %s: %s", target.username, pesan)
                    scraped = ([], [], None)
                    prescraped[target.social_account_id] = ([], None)
                else:
                    prescraped[target.social_account_id] = (scraped[1], scraped[2])
                # Diukur di sini, bukan di dalam pekerjaan: run actor terjadi
                # SEBELUM keduanya dan merupakan bagian paling lambat.
                detik_target = round((_now() - mulai_target).total_seconds(), 3)
                detik_actor = detik_target
                logger.info("Run actor selesai dalam %.2fs", detik_target)

                try:
                    hasil, _, _ = run_profile_job(
                        cfg_terpakai, conn, target, run_id, write=write, scraped=scraped,
                        started_at=mulai_target, actor_seconds=detik_target,
                    )
                except Exception as exc:  # noqa: BLE001
                    # Menyimpan hasil satu target gagal. Dicatat sebagai baris
                    # log target itu sendiri, lalu batch lanjut.
                    _, pesan = classify_exception(exc)
                    logger.exception(
                        "Pekerjaan profile gagal untuk %s: %s", target.username, pesan
                    )
                    hasil = JobResult(
                        run_id=run_id,
                        category=SCHEDULER_CATEGORY_PROFILE,
                        platform=target.platform,
                        actor=target.actor,
                        started_at=mulai_target,
                        finished_at=_now(),
                        status=FAILED,
                        error_message=pesan,
                        username=target.username,
                        kol_directory_id=target.kol_directory_id,
                    )
                catat(hasil)

            if rencana.post_targets:
                catat(
                    run_post_job(
                        cfg_terpakai,
                        conn,
                        rencana.post_targets,
                        run_id,
                        write=write,
                        prescraped=prescraped,
                        started_at=mulai_actor,
                        actor_seconds=detik_actor,
                    )
                )
    except Exception as exc:  # noqa: BLE001
        _, pesan = classify_exception(exc)
        logger.exception("Eksekusi gagal sebelum pekerjaan selesai: %s", pesan)
        if not hasil_semua:
            catat(
                JobResult(
                    run_id=str(uuid.uuid4()),
                    category=SCHEDULER_CATEGORY_PROFILE,
                    platform=platform or "-",
                    actor="(belum ditentukan)",
                    started_at=_now(),
                    finished_at=_now(),
                    status=FAILED,
                    error_message=pesan,
                )
            )

    # TIDAK ADA penulisan log di sini. Semua baris sudah ditulis oleh `catat`
    # saat hasilnya lahir; mengulanginya di sini akan menggandakan setiap baris.
    return hasil_semua


# --- CLI --------------------------------------------------------------------


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--platform", choices=PLATFORMS, default=None,
                   help="batasi kandidat profil ke satu platform")
    p.add_argument("--order", choices=sorted(CANDIDATE_ORDERS), default="followers",
                   help="urutan kandidat profil (default: %(default)s)")
    p.add_argument("--username", default=None,
                   help="kunci ke satu kandidat; syarat 'belum ada di L0' tetap berlaku")
    p.add_argument("--limit", type=str, default=None,
                   help=(
                       "berapa profil diambil satu eksekusi. Menang atas "
                       f"${BATCH_SIZE_ENV}; tanpa keduanya: {PROFILE_TARGET_LIMIT}. "
                       "Harus bilangan bulat >= 1"
                   ))
    p.add_argument("--no-posts", action="store_true",
                   help="pekerjaan profile saja, jangan simpan post")
    p.add_argument("--plan-only", action="store_true",
                   help="tampilkan rencana lalu berhenti; actor TIDAK dipanggil")
    p.add_argument("--no-write", action="store_true", help="scrape tapi jangan tulis ke l0_raw")
    p.add_argument("--no-log", action="store_true",
                   help="jangan tulis ke public.scheduler_logs")
    return p.parse_args(argv)


def print_plan(plan: ExecutionPlan) -> None:
    print("=" * 72)
    print("RENCANA EKSEKUSI (satu kali, tanpa retry)")
    print("=" * 72)
    print(f"run_id : {plan.run_id}")
    print(f"\n-- PROFILE TARGET -- {len(plan.profile_targets)} target")
    if not plan.profile_targets:
        print("   (tidak ada kandidat)")
    per_platform_profil: dict = {}
    for i, t in enumerate(plan.profile_targets, start=1):
        per_platform_profil[t.platform] = per_platform_profil.get(t.platform, 0) + 1
        sebelum = plan.profile_rows_before_by_id.get(t.social_account_id, 0)
        print(f"   [{i}] {t.platform:10s} {t.username}")
        print(f"       kol_directory_id : {t.kol_directory_id}")
        print(f"       social_account_id: {t.social_account_id}")
        print(f"       actor            : {t.actor}")
        print(f"       baris profil L0  : {sebelum}  (harus 0)")
    for plat in sorted(per_platform_profil):
        print(f"   total {plat:10s}: {per_platform_profil[plat]}")
    print(
        f"\n-- POST TARGET -- {len(plan.post_targets)} target "
        f"(profil yang sama), maks {POSTS_PER_TARGET} post terbaru"
    )
    per_platform: dict = {}
    for pt in plan.post_targets:
        per_platform[pt.platform] = per_platform.get(pt.platform, 0) + 1
    for plat in sorted(per_platform):
        print(f"   {plat:10s}: {per_platform[plat]}")
    for pt in plan.post_targets:
        print(
            f"      {pt.platform:10s} {pt.username:24s} "
            f"post_sekarang={plan.post_rows_before.get(pt.social_account_id, 0)}"
        )
    print(f"\nrun actor yang akan terjadi: {plan.actor_runs}")


def print_results(hasil_semua: list[JobResult]) -> None:
    print("\n" + "=" * 72)
    print("HASIL EKSEKUSI")
    print("=" * 72)
    for h in hasil_semua:
        print(f"\n[{h.category}] status={h.status} durasi={h.duration_seconds:.2f}s")
        print(f"   run_id             : {h.run_id}")
        print(f"   platform           : {h.platform}")
        print(f"   actor              : {h.actor}")
        print(f"   target             : {h.targets} (gagal: {h.failed_targets})")
        print(f"   profiles_processed : {h.profiles_processed}")
        print(f"   posts_fetched      : {h.posts_fetched}")
        print(f"   posts_saved        : {h.posts_saved}")
        print(f"   duplicates_skipped : {h.duplicates_skipped}")
        if h.notes:
            print(f"   catatan            : {'; '.join(h.notes)}")
        if h.error_message:
            print(f"   error              : {h.error_message}")


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s | %(message)s")
    args = parse_args(argv)

    # Batas diselesaikan SEBELUM apa pun yang berbiaya — termasuk sebelum
    # koneksi dibuka. Nilai tidak sah harus berhenti di sini, bukan setengah
    # jalan dengan sebagian target sudah di-scrape.
    try:
        batas = resolve_batch_limit(args.limit)
    except ValueError as exc:
        logger.error("%s", exc)
        return 2

    try:
        cfg = load_config()
    except ConfigError as exc:
        logger.error("%s", exc)
        return 1

    with connect(cfg.postgres) as conn:
        plan = build_plan(
            conn, args.platform, with_posts=not args.no_posts,
            order=args.order, username=args.username, limit=batas,
        )
    print_plan(plan)

    if args.plan_only:
        print("\n[--plan-only] actor TIDAK dipanggil.")
        return 0

    hasil = run_once(
        cfg,
        platform=args.platform,
        with_posts=not args.no_posts,
        write=not args.no_write,
        log=not args.no_log,
        plan=plan,
        limit=batas,
    )
    print_results(hasil)
    return 0 if all(h.ok for h in hasil) else 1


if __name__ == "__main__":
    sys.exit(main())
