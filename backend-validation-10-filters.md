# Backend Validation — 10 Filter KOL Discovery

**Tanggal:** 2026-09-06 · **Branch:** engkol_v1 · **Sifat:** read-only, tidak ada kode/DB/Excel yang diubah.
**Database:** `kol` @ 10.100.14.216:5432 (`PG_*_KOL`, `@/lib/kolDb`) — **terhubung, seluruh angka di dokumen ini hasil query langsung hari ini.**

## 0. Status verifikasi

VPN nyala (`TcpTestSucceeded: True`), jadi versi ini **bukan lagi rekonstruksi dari sheet** — setiap nama table, nama column, dan setiap angka coverage di bawah diambil dari `information_schema` dan `COUNT(*)` di server KOL pada 2026-09-06.

Kode sumber yang dipakai: **[LIVE]** = hasil query hari ini · **[SQL]** = SQL yang dieksekusi aplikasi · **[XLS]** = sheet `Mapping Filter-DB`.

Denominator roster: **7.720** baris `public.kol_directory` aktif [LIVE].

### Yang berubah dibanding audit 4 September / sheet

| Hal | Sheet / audit lama | Hasil query hari ini |
| --- | --- | --- |
| Kolom `feature.*_audience_analysis` | tidak diketahui → `NEED VERIFICATION` | **Terverifikasi**: `social_account_id`, `audience_quality_score`, `authenticity_score`, `follower_quality_score` (integer, 100% terisi di 23 akun yang punya baris) |
| ER mustahil (>100%) | 83 nilai [XLS] | **7 nilai**, plus 46 di zona 20–100% |
| Sumber Save/Share Rate | hanya `l2_gold.post_metric` | **ada sumber kedua**: `feature.ig_/tt_engagement_analysis.total_saves`, `total_shares`, `total_views` — sudah teragregasi per akun |
| Denominator ER L2 | `content_format_daily.followers_denom_sum` | **salah pilih** — kolom itu hanya terisi 82 dari 300 baris. Yang benar `post_metric.followers_at_post_date` (159 dari 477, 140 lolos sample rule) |
| `feature.brand_fit_analysis` | "tidak ada kolom brand fit" | tabel ada dengan `partnership_score`, `audience_overlap_pct` — join lewat `agency_kol_accounts.id`, bukan `kol_directory` (di luar 10 filter ini, tapi audit lama salah) |
| `pg_trgm` | diasumsikan ada | **belum terpasang** — jadi dependency eksplisit BE-03 |
| Umur roster | tidak dicek | **beku**: `created_at` terbaru 2026-08-28, `last_refreshed_at` terbaru 2026-08-28. 0 creator masuk/di-refresh dalam 7 hari terakhir |

---

## 1. Tabel Validasi

| No | Filter | DB | Schema | Table | Column | Join | Logic | Backend Action | Dependency | Ready? |
| -- | --- | -- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Kategori KOL | kol | public | `kol_directory`, `kol_categories` | `kd.category_ids` (uuid[]), `kd.category_id`, `kc.id`, `kc.name` | `LATERAL kol_categories kc ON kc.id = ANY(COALESCE(kd.category_ids, ARRAY[kd.category_id]))` [SQL] | chip UI → 1..n `kc.id` via kamus alias; match = array overlap | multi-select param + alias mapping + bucket `Uncategorized` | alias taksonomi dari Product | **YES** |
| 2 | KOL Tier | kol | public | `kol_directory`, `kol_tiers` | `kd.followers_count`; `t.name`, `t.min_followers`, `t.max_followers` | `LEFT JOIN kol_tiers t ON kd.followers_count >= t.min_followers AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)` [SQL] | bucket dari lookup table (5 band, Nano mulai 1.000) | facet per-platform + bucket `Untiered` | — | **YES** |
| 3 | Keyword Search | kol | public | `kol_directory`, `agency_kol_accounts`, `kol_categories` | `kd.username`, `kd.username_normalized`, `kd.bio`, `a.label`, `kc.name` | `agency_kol_accounts a ON a.kol_account_id = kd.id` [LIVE] | OR 4 field + ranking relevansi | perluas `q` + index trigram + guard performa | **`CREATE EXTENSION pg_trgm` (DBA)** | **YES** |
| 4 | Section Tabs | kol | public | `kol_directory` | `kd.created_at`, `kd.last_refreshed_at` | — | window tanggal + sort key | expose `sort=created` + `createdAfter`/`refreshedAfter` | daftar 7 tab dari Product | **YES (2 dari 7)** |
| 5 | ER alternatif | kol | public | `kol_directory` | `kd.engagement_rate` (numeric, satuan %) | — | buang nilai mustahil sebelum filter/sort | turunan `er_pct_clean` + flag kualitas | ambang "suspect" dari Data/Product | **YES** |
| 6 | Audience Quality | kol | feature | `ig_audience_analysis`, `tt_audience_analysis` | `social_account_id`, `audience_quality_score`, `authenticity_score`, `follower_quality_score` (int) [LIVE] | `ksa ON ksa.social_account_id = f.social_account_id` → `kd.id = ksa.kol_id` [LIVE] | UNION 2 tabel, ambil skor per akun (1:1, tidak perlu agregasi) | **skema siap ditulis**; ditahan di coverage | coverage 23/7.720 dari Data Eng | **NO (data)** |
| 7 | Content Format | kol | l2_gold | `content_format_daily` | `social_account_id`, `media_type`, `post_count`, `posts_in_sample`, `engagement_sum`, `followers_denom_sum` | via `kol_social_account` [SQL] | format dominan = argmax SUM(post_count) per format ternormalisasi | kamus normalisasi 6 nilai + view `kol_dominant_format` | vocab Product + coverage Scrapper | **NO** |
| 8 | ER L2 | kol | l2_gold | `post_metric` (utama), `kol_metric_daily`, `content_format_daily` | `p.engagement_owned`, `p.followers_at_post_date`, `p.likes_hidden`, `p.is_collaboration`; `d.er_followers_daily` | via `kol_social_account` [SQL] | `SUM(engagement_owned)/SUM(followers_at_post_date) × 100` — **jangan AVG** kolom rasio | definisi metrik + fungsi agregasi | coverage 22/7.720 dari Scrapper | **NO** |
| 9 | Save Rate | kol | l2_gold / feature | `post_metric` · alt: `ig_/tt_engagement_analysis` | `p.saves`, `p.views`, `p.likes_hidden`, `p.is_collaboration` · alt: `total_saves`, `total_views` | via `kol_social_account` [SQL/LIVE] | `SUM(saves)/SUM(views)` setelah buang sample flag | ganti rumus prototype yang tidak baca kolom | coverage 11/7.720 + harvest IG | **NO** |
| 10 | Share Rate | kol | l2_gold / feature | `post_metric` · alt: `ig_/tt_engagement_analysis` | `p.shares`, `p.views`, … · alt: `total_shares`, `total_views` | via `kol_social_account` [SQL/LIVE] | `SUM(shares)/SUM(views)` setelah buang sample flag | sama dengan Save Rate | coverage 11/7.720 + harvest IG | **NO** |

### Data tersedia vs gap — semua angka [LIVE] 2026-09-06

| No | Filter | Terisi | Coverage | Gap utama |
| -- | --- | ---: | ---: | --- |
| 1 | Kategori KOL | 4.174 | 54,1% | 28 kategori master, **semuanya terpakai**. 1.183 creator punya >1 kategori (maks 5) → matching wajib overlap, bukan equality. `category_ids` dan `category_id` sama-sama 4.174 (redundan, COALESCE aman). Lifestyle+Beauty = 3.793 dari 4.174 (90,9%). Add KOL tidak pernah menulis kategori. |
| 2 | KOL Tier | 7.194 | 93,2% | 526 di luar band = 222 `followers_count` NULL + 304 di bawah 1.000. Jalur L2 (`kol_profile_card.tier`) hanya 1.976 akun = 25,6%. |
| 3 | Keyword Search | username 7.497 · label 7.684 · bio 902 | 97,1% / 99,5% / 11,7% | **3.463 creator (45%) punya nama asli yang berbeda dari username dan sama sekali tidak bisa dicari** — "Cristiano Ronaldo", "Raffi Ahmad", "Luna Maya", "Messi". `username_normalized` juga tersedia 7.497. `pg_trgm` belum terpasang. |
| 4 | Section Tabs | created_at 7.698 · last_refreshed_at 7.496 | 99,7% / 97,1% | **Roster beku**: 0 creator dibuat/di-refresh dalam 7 hari terakhir; 30 hari terakhir hanya 2 dibuat, 1.003 di-refresh. Window 7 hari akan render kosong. 5 dari 7 tab belum punya sumber. |
| 5 | ER alternatif | 1.756 | 22,7% | **7 nilai >100%** (maks 223,41% — `@rhasiebatara`, 116.777 follower), 46 nilai di zona 20–100%, 6 nilai tepat 0. Total 53 baris mencemari puncak `sort=engagement DESC`. |
| 6 | Audience Quality | 23 akun (13 IG + 10 TT) | 0,30% | Skema **lengkap dan 100% terisi**: aq 54–88 (avg 68), authenticity 29–92 (avg 61), follower quality 49–93 (avg 75). Semua 23 akun ada di roster aktif dan semuanya beririsan dengan 30 akun L2. Yang kurang murni jumlah creator. |
| 7 | Content Format | 30 akun | 0,39% | 6 nilai `media_type` saja: `VIDEO` (289 post/11 akun), `clips` (89/18), `carousel_container` (67/14), `feed` (22/11), `unknown` (8/3), `CAROUSEL` (2/2). **Tidak ada `story`** — chip Story di UI memang tanpa sumber. |
| 8 | ER L2 | 22 creator | 0,28% | `kol_metric_daily.er_followers_daily` hanya 73 dari 280 baris (26%), satuan fraksi (maks 0,161 = 16,1%). Denominator: `content_format_daily.followers_denom_sum` cuma 82/300 — **jangan dipakai**; `post_metric.followers_at_post_date` 159/477, dan 140 baris lolos sample rule. |
| 9 | Save Rate | 11 creator | 0,14% | `saves` terisi di **291 baris TikTok, 0 dari 186 baris Instagram**. IG tidak melaporkan saves sama sekali di harvest ini. Rumus UI sekarang (`kolSample.ts:342`) angka acak. |
| 10 | Share Rate | 11 creator | 0,09% | Identik Save Rate: 291 TikTok, 0 Instagram. |

**Catatan struktural [LIVE]:** `public.kol_social_account` berisi 7.496 baris dengan 7.496 `kol_id` unik dan 7.496 `social_account_id` unik — **relasinya 1:1 hari ini**, tidak ada creator yang punya dua akun. Kode sudah defensif terhadap fan-in dan itu tetap benar, tapi tidak ada yang fan-in sekarang.

**Sentinel terkonfirmasi:** `l2_gold.post_metric` punya 18 baris `likes_hidden = true` dan tepat 18 baris `likes = -1`. Angkanya cocok persis, jadi `likes = -1` memang sentinel dan ikut masuk `engagement_owned`.

---

## 2. Task Backend — yang siap dikerjakan

### BE-01 — Kategori KOL (multi-select + alias mapping)

* **DB:** `kol` · **Schema:** `public` · **Table:** `kol_directory` ⋈ `kol_categories`
* **Column:** `kol_directory.category_ids` (uuid[]), `kol_directory.category_id` (uuid) → `kol_categories.id`, `kol_categories.name`
* **Join:** `LEFT JOIN LATERAL (SELECT ARRAY_AGG(kc.name ORDER BY kc.name) FROM public.kol_categories kc WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))) cats ON TRUE` — sudah ada di `kolDirectory.ts:151-163`
* **Logic:**
  1. Chip UI = kumpulan `kol_categories.id`, disimpan sebagai kamus alias, bukan hardcode di TSX.
  2. Predikat `$3 = ANY(b.categories)` → `b.categories && $3::text[]`. **1.183 creator punya lebih dari satu kategori (maks 5)**, jadi overlap bukan optimasi, itu syarat kebenaran.
  3. Tambah `__uncategorized` untuk 3.546 baris tanpa kategori.
  4. `category_ids` dan `category_id` terisi di baris yang persis sama (4.174 keduanya) — COALESCE-nya aman dipertahankan, tidak perlu migrasi kolom.
* **Expected Output:** `?category=beauty,skincare` → `rows[].categories: string[]`, `facets.categories[] {name,count}` + `facets.uncategorized: number`
* **Acceptance Criteria:**
  * `?category=Beauty` = **1.271 baris** (identik implementasi lama, regresi nol).
  * `?category=Beauty,Lifestyle` = union, **≤ 3.793 baris** dan tidak ada creator dobel (harus lebih kecil dari 1.271+2.522 karena ada yang punya dua-duanya).
  * `?category=__uncategorized` = **3.546 baris**.
  * Ke-28 kategori master muncul di facet dengan count > 0 (sudah dipastikan semuanya terpakai).
  * Tidak ada LATERAL tambahan sebelum `LIMIT`; p95 endpoint tetap < 500 ms.

### BE-02 — KOL Tier (facet per platform + bucket Untiered)

* **DB:** `kol` · **Schema:** `public` · **Table:** `kol_directory` ⋈ `kol_tiers`
* **Column:** `kol_directory.followers_count` (integer); `kol_tiers.name`, `kol_tiers.min_followers`, `kol_tiers.max_followers`
* **Join:** range join di `kolDirectory.ts:167-170`
* **Logic:**
  1. **Tetap jalur `followers_count` → `kol_tiers` (93,2%), bukan `l2_gold.kol_profile_card.tier` (25,6%).** Band terverifikasi: Nano 1.000–9.999 · Micro 10.000–49.999 · Mid-tier 50.000–99.999 · Macro 100.000–999.999 · Mega 1.000.000+.
  2. Facet sekarang roster-wide, jadi "Micro 2.942" tetap tampil meski Instagram dipilih — hitung ulang dengan predikat platform aktif.
  3. Bucket `Untiered` untuk 526 baris, dipecah jelas: 222 tanpa `followers_count` dan 304 di bawah 1.000. Dua sebab berbeda, jangan digabung jadi satu label.
  4. Param `tier` sudah multi di backend (`b.tier = ANY($4)`); UI-nya yang single-select.
* **Expected Output:** `facets.tiers[] {name,count,min,max}` + `facets.untiered`, count menyesuaikan platform.
* **Acceptance Criteria:**
  * `SUM(facets.tiers[].count) + facets.untiered = 7.720` tanpa platform dipilih; `untiered = 526`.
  * Pilih Instagram → tiap count ≤ count roster-wide, totalnya = jumlah creator Instagram.
  * `?tier=Micro,Macro` = gabungan dua band.
  * Nol angka tier hardcoded di TS/TSX — semua dari `kol_tiers`.

### BE-03 — Keyword Search (username + nama asli + bio + kategori)

* **DB:** `kol` · **Schema:** `public` · **Table:** `kol_directory`, `agency_kol_accounts`, `kol_categories`
* **Column:** `kol_directory.username`, `kol_directory.username_normalized`, `kol_directory.bio`, `agency_kol_accounts.label` (varchar), `kol_categories.name`
* **Join:** `LEFT JOIN public.agency_kol_accounts a ON a.kol_account_id = kd.id` [LIVE]
* **Logic:**
  1. Predikat OR 4 field. `%` dan `_` tetap literal (`escapeLike`, sudah ada).
  2. **Nilai bisnisnya terukur: 3.463 creator (45% roster) punya `label` yang berbeda dari username** — "Cristiano Ronaldo", "Raffi Ahmad", "Luna Maya", "Messi" semuanya tidak bisa dicari hari ini.
  3. **Performa adalah inti task-nya.** `attachRosterExtras` sengaja memisah lookup agency ke round-trip kedua karena LATERAL sebelum `LIMIT` diukur **4,2 detik** (`kolDirectory.ts:207-219`). Menyeret `agency_kol_accounts` ke CTE `filtered` mengembalikan biaya itu ke setiap request.
     * **(a) Disarankan** — join hanya saat `q` ada, plus index GIN `pg_trgm` pada `kol_directory.username`, `kol_directory.bio`, `agency_kol_accounts.label`. **`pg_trgm` belum terpasang di server KOL** — perlu `CREATE EXTENSION pg_trgm` oleh DBA.

     **Dikoreksi 2026-09-06 saat implementasi:** `pg_trgm` ternyata bukan blocker performa. Diukur pada query yang sebenarnya, biaya search adalah **JIT compilation, bukan scanning** — 622ms dari 742ms dihabiskan Postgres untuk mengkompilasi rencana yang eksekusinya cuma ~100ms, karena OR dengan subquery membuat estimasi biaya melonjak ke ~2.000.000 (20x `jit_above_cost`). Dengan `SET LOCAL jit = off` khusus untuk statement search, p95 turun ke **213ms** tanpa extension apa pun. Index trigram tetap layak diminta — ia memperbaiki estimasi di akarnya dan membuat mitigasi ini bisa dihapus — tapi statusnya sekarang peningkatan, bukan prasyarat.
     * (b) Kolom `tsvector` ter-materialisasi — lebih cepat, butuh migration, dan migration masih terblokir (`047_org-limits` hilang dari repo).
  4. Ranking: exact username → prefix username → label → kategori → bio, hanya saat `q` aktif. `SCRAPED_FIRST` tetap kunci pertama.
  5. Dimensi "niche, topik, DNA, brand" yang dijanjikan UI tidak punya kolom — teksnya yang dikoreksi, bukan diimplementasikan.
* **Expected Output:** `?q=raffi+ahmad` → cocok username **atau** nama asli; response menambah `rows[].displayName`.
* **Acceptance Criteria:**
  * `q=Raffi Ahmad` mengembalikan `@raffinagita1717`; `q=Cristiano Ronaldo` mengembalikan `@cristiano`; `q=Messi` mengembalikan `@leomessi`. Ketiganya 0 hasil hari ini.
  * `q=raffi` tidak kehilangan satu pun hasil username yang lama.
  * `q=100%` diperlakukan literal, bukan wildcard.
  * p95 dengan `q` aktif < 800 ms pada roster 7.720, **diukur setelah index terpasang**.
  * Tanpa `q`, query plan identik dengan sekarang — nol join tambahan.

### BE-04 — Section Tabs (2 dari 7 tab yang punya sumber)

* **DB:** `kol` · **Schema:** `public` · **Table:** `kol_directory` · **Join:** tidak ada
* **Column:** `kol_directory.created_at`, `kol_directory.last_refreshed_at` (keduanya timestamptz)
* **Logic:**
  1. `sort=created` **sudah ada di backend** (`SORT_COLUMNS.created`, `kolDirectory.ts:110-113`) tapi tidak diekspos di dropdown — tab "Recently Added" praktis gratis.
  2. Tambah `createdAfter` / `refreshedAfter` (absent ≠ 0, ikut pola `num()` di route).
  3. **Roster beku — ini yang menentukan desain tab.** `created_at` terbaru 2026-08-28, `last_refreshed_at` terbaru 2026-08-28; dalam 7 hari terakhir **nol** creator masuk dan **nol** di-refresh. Window 7 hari akan menghasilkan tab kosong permanen sampai pipeline jalan lagi. Pakai window 30 hari (2 dibuat, 1.003 di-refresh) atau tab berbasis urutan ("100 terbaru") yang tidak pernah kosong.
  4. 5 tab lain menunggu nama dari Product — daftar 7 tab tidak ada di repo ini.
* **Expected Output:** `?sort=created&dir=desc&createdAfter=2026-08-07`
* **Acceptance Criteria:**
  * "Recently Added" ≠ "Recently Updated" untuk minimal 1 creator — dua kolom beda, bukan alias.
  * Window 30 hari: `createdAfter` = **2 baris**, `refreshedAfter` = **1.003 baris**.
  * Tab tidak pernah render kosong pada data hari ini — kalau desainnya window 7 hari, ditolak.
  * Param kosong = tanpa filter, bukan epoch 0. Tanggal invalid → 400, bukan 500.

### BE-05 — Engagement Rate alternatif (validasi & cleaning)

* **DB:** `kol` · **Schema:** `public` · **Table:** `kol_directory` · **Join:** tidak ada
* **Column:** `kol_directory.engagement_rate` (numeric, satuan persen — 0,98 berarti 0,98%)
* **Logic:**
  1. Ekspresi turunan di `BASE`, **tanpa mengubah kolom di DB**:
     `CASE WHEN kd.engagement_rate > 0 AND kd.engagement_rate <= 100 THEN kd.engagement_rate END AS er_pct_clean`
  2. Yang dibuang cuma **7 baris** — `@rhasiebatara` 223,41%, `@nikma.rahmaa` 174,85%, `@faniaelizaa` 173,36%, `@winnylieyantii` 127,34%, `@bjawato` 115,41%, `@skupingg` 113,60%, `@putrikurniads_` 109,56%. Kecil jumlahnya, tapi ketujuhnya adalah nilai **tertinggi** di kolom itu, jadi mereka menempati baris teratas `sort=engagement DESC` dan preset "Best Performing". Ditambah 46 baris di zona 20–100%, ada 53 baris yang mencemari puncak sort paling sering dipakai.
  3. Zona 20–100% ditandai `erQuality: 'suspect'`, tidak dibuang — ambang ini keputusan Data/Product, jadi dari konfigurasi bukan konstanta di kode.
  4. 6 baris bernilai tepat 0 diperlakukan sebagai belum terukur, bukan "engagement nol".
  5. Absent ≠ 0 tetap berlaku: `minEr=0` tidak boleh membuang 5.964 creator ber-ER NULL.
* **Expected Output:** `rows[].erPct` (bersih) · `rows[].erRaw` · `rows[].erQuality: 'measured' | 'suspect' | null`
* **Acceptance Criteria:**
  * Tidak ada `erPct > 100` di response manapun.
  * Creator dengan `erPct` non-null = **1.743** (1.756 − 7 mustahil − 6 nol). Dikoreksi 2026-09-06 saat implementasi: versi sebelumnya menulis 1.749 karena lupa bahwa 6 nilai nol dibuang oleh aturan yang sama.
  * `?sort=engagement&dir=desc` halaman 1 tidak berisi ketujuh username di atas.
  * `minEr` kosong dan `minEr=0` menghasilkan jumlah baris yang sama.
  * `erQuality='suspect'` tepat **46** baris.

---

## 3. Task yang masih menunggu

| Task | Filter | Menunggu | Alasan | Yang sudah pasti |
| --- | --- | --- | --- | --- |
| BE-06 | Audience Quality | **Data (coverage) — bukan lagi verifikasi** | Coverage 23 dari 7.720 = 0,30%. Sebagai filter, menggeser slider akan membuang 99,7% roster. | **Skema lengkap dan bisa ditulis hari ini**: `feature.ig_audience_analysis` UNION `feature.tt_audience_analysis`, kolom `social_account_id`, `audience_quality_score`, `authenticity_score`, `follower_quality_score` — semua integer, 100% terisi, 1 baris per akun (tidak perlu agregasi). Join: `ksa.social_account_id = f.social_account_id` → `kd.id = ksa.kol_id`. Semua 23 akun ada di roster aktif. Rentang: aq 54–88, authenticity 29–92, follower quality 49–93. **Ini juga sumber nyata untuk filter "Min. authenticity" yang audit lama sebut NOT FOUND.** |
| BE-07 | Content Format | **Product + Scrapper** | Coverage 30 akun. Normalisasi sengaja tidak dibuat di kode karena keputusan produk (`kolGold.ts:196-199`). | Vocab-nya **tertutup dan kecil — tepat 6 nilai**: `VIDEO` (289 post), `clips` (89), `carousel_container` (67), `feed` (22), `unknown` (8), `CAROUSEL` (2). Product tinggal memutuskan pengelompokan; tidak ada nilai kejutan. Chip "Story" memang tanpa sumber — hapus, jangan tunggu. |
| BE-08 | ER L2 | **Scrapper (coverage)** | 22 creator = 0,28%. Tidak bisa menggantikan `kol_directory.engagement_rate` (22,7%). | Definisi metrik bisa difinalkan sekarang: `SUM(engagement_owned) / NULLIF(SUM(followers_at_post_date),0) × 100` dari `post_metric`, dengan `WHERE NOT likes_hidden AND NOT is_collaboration` — 140 baris lolos di 22 creator. **Jangan pakai `content_format_daily.followers_denom_sum`** (hanya 82 dari 300 baris) dan **jangan AVG `er_followers_daily`** — rasio tidak bisa dirata-rata. |
| BE-09 | Save Rate | **Scrapper (coverage + platform)** | 11 creator. `saves` terisi di 291 baris TikTok dan **0 dari 186 baris Instagram** — ini gap platform, bukan gap volume. | `post_metric.saves` / `post_metric.views`, buang sample flag. **Sumber kedua yang lebih murah:** `feature.ig_engagement_analysis` / `tt_engagement_analysis` punya `total_saves`, `total_views`, `posts_analyzed_count` sudah teragregasi per akun — tidak perlu menulis agregasi sendiri kalau coverage-nya nanti setara. |
| BE-10 | Share Rate | **Scrapper (coverage + platform)** | Identik BE-09: 291 TikTok, 0 Instagram. | `post_metric.shares`, atau `total_shares` di tabel feature yang sama. Catatan: `shares` **sudah termasuk** di `engagement_owned` (Like+Comment+Share), `saves` tidak — dua rate ini tidak simetris dan tidak boleh dijumlahkan. |
| — | Alias kategori (input BE-01) | **Product** | Chip UI mana → `kol_categories` mana. | 28 kategori master, semuanya terpakai, distribusinya sangat timpang (Lifestyle+Beauty 90,9%). |
| — | Daftar 7 Section Tab (input BE-04) | **Product** | Daftarnya tidak ada di repo. | 2 tab yang punya sumber sudah teridentifikasi, plus kendala roster beku yang membatasi desain window. |
| — | `CREATE EXTENSION pg_trgm` (input BE-03) | **DBA** | Belum terpasang di server KOL. | Ajukan sekarang supaya tidak jadi blocker saat BE-03 mulai. |
| — | Add KOL menulis kategori | **Scrapper / Data Eng** | Pipeline berhenti di `l1_silver`; `category_id`/`category_ids` dan `creator_city` tidak pernah ditulis. | Ini yang menahan coverage kategori naik dari 54,1%. |
| — | Roster berhenti di-refresh | **Scrapper / Data Eng** | Tidak ada creator masuk atau di-refresh sejak 2026-08-28. | Bukan cuma soal Section Tabs: seluruh badge provenance "Live" (refresh < 7 hari) sekarang nol untuk semua creator. |

### Blocker lintas-task

1. **Migration terblokir** — `047_org-limits` tercatat applied di `pgmigrations` tapi filenya tidak ada di repo, jadi `npm run migrate:up` selalu gagal. Relevan kalau BE-03 memilih opsi (b); opsi (a) menghindarinya.
2. **`post_metric.likes = -1`** sentinel untuk like tersembunyi, **dijumlahkan ke `engagement_owned`**. Terkonfirmasi hari ini: 18 baris `likes_hidden`, 18 baris `likes = -1`, cocok persis. Setiap agregasi di BE-08/09/10 wajib `WHERE NOT likes_hidden` — kalau tidak, angkanya salah, bukan sekadar kurang lengkap.
3. **Coverage L2 mentok di 30 akun.** Empat dari lima task yang tertahan (BE-06 s/d BE-10) menunggu satu hal yang sama: pipeline Dagster memperluas cakupan dari 30 akun ke roster. Itu satu percakapan dengan tim Scrapper, bukan lima.

---

## 4. Urutan final

```
BE-05 (ER cleaning) → BE-03 (Keyword Search) → BE-02 (Tier) → BE-01 (Kategori) → BE-04 (Section Tabs, 2 tab) → Testing
```

Paralel sejak hari pertama, karena keduanya milik orang lain dan punya lead time: **ajukan `CREATE EXTENSION pg_trgm` ke DBA** (input BE-03) dan **minta alias kategori + daftar 7 tab ke Product** (input BE-01 dan BE-04).

Setelah pipeline memperluas coverage:

```
BE-07 (Content Format) → BE-06 (Audience Quality) → BE-08 (ER L2) → BE-09 (Save Rate) → BE-10 (Share Rate)
```

**Alasan urutan:**

* **BE-05 duluan** — perubahannya satu ekspresi `CASE`, bisa selesai setengah hari, dan memperbaiki filter yang sudah live dan sedang salah. Skalanya memang lebih kecil dari dugaan sheet (7 baris mustahil, bukan 83), tapi ketujuhnya nilai tertinggi di kolomnya, jadi merekalah yang muncul di baris teratas sort engagement dan preset "Best Performing".
* **BE-03 kedua** — dampak user terbesar dan terukur: 3.463 creator (45% roster) punya nama asli yang tidak bisa dicari. Butuh perhatian performa dan menunggu DBA memasang `pg_trgm`, jadi pengajuannya dimulai bareng BE-05.
* **BE-02 ketiga** — sudah jalan 93,2%, yang dikerjakan penyempurnaan; risiko rendah, tidak memblokir siapa pun.
* **BE-01 keempat** — kerangka backend bisa jalan dengan identity mapping sambil menunggu daftar alias dari Product.
* **BE-04 terakhir** — 5 dari 7 tab belum punya nama, dan roster yang beku membatasi desain window, jadi yang bisa dikirim baru sebagian.
* **BE-06 naik ke posisi kedua di gelombang dua** (dari sebelumnya paling akhir) karena skemanya sudah terverifikasi lengkap dan 100% terisi — begitu coverage naik, ini yang paling cepat jadi.

## 5. PIC

Nama orang tidak tercatat di repo — di bawah ini peran:

| Task | PIC |
| --- | --- |
| BE-01 … BE-05 | Backend Engineer (repo `autometric`) |
| BE-06 … BE-10 | Backend Engineer, setelah Data Engineer / Scrapper (repo Dagster) |
| `CREATE EXTENSION pg_trgm` + index GIN (BE-03) | DBA / Data Engineer |
| Alias kategori, daftar 7 section tab, ambang ER "suspect", pengelompokan 6 `media_type` | Product |
| Coverage `l2_gold` + `feature.*`, Add KOL menulis kategori, roster refresh jalan lagi | Data Engineer / Scrapper |
| Acceptance criteria per task | QA |
