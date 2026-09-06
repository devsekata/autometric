# Discovery, Filter & Add KOL Flow Audit

**Tanggal audit:** 2026-09-04  
**Sifat:** read-only. Tidak ada kode maupun baris database yang diubah.  
**Sumber kebenaran:** source code yang berjalan hari ini, endpoint, stored procedure, dan query langsung ke dua database — termasuk **log eksekusi nyata** dari tiga run Add KOL yang benar-benar pernah dijalankan.

**File pendamping (siap Excel):**

| File | Isi |
| --- | --- |
| `discovery-ui-inventory.csv` | 126 elemen interaktif (Bagian 1) |
| `discovery-filter-audit.csv` | 63 filter, 13 kolom (Bagian 2) |
| `discovery-ui-buttons.csv` | 26 aksi non-filter (Bagian 3) |
| `addkol-flow-audit.csv` | 78 baris Add KOL: end-to-end, validasi, duplikat, koleksi data, penyimpanan, gap (Bagian 4–11) |

---

## 1. Discovery UI Inventory

126 entri kontrol, diturunkan dengan mengekstrak setiap `onClick`, `onChange`, `<input>`, `<select>`, `role="switch"`, dan `<button>` dari tiap komponen Discovery — bukan dari dokumentasi. Beberapa entri adalah grup (mis. "Preset chips ×8" = satu entri, delapan tombol). Kontrol disabled dan prototipe ikut dimasukkan.

| Layar / area | Entri | Grup dominan |
| --- | ---: | --- |
| Shell | 6 | B. Discovery Actions |
| Sidebar kiri (global) | 1 | A. Navigation |
| Hub | 3 | B. Discovery Actions |
| Creator Database | 53 | C. Search & Filtering |
| Panel Quick Insight | 5 | B. Discovery Actions |
| Modal harga roster | 3 | B. Discovery Actions |
| AddKolDirectoryModal | 5 | B. Discovery Actions |
| Tracked Accounts | 24 | B. Discovery Actions |
| My Creators | 14 | C. Search & Filtering |
| Smart Discovery | 12 | C. Search & Filtering |
| **Total** | **126** | |

Pengelompokan: **A. Navigation** 6 · **B. Discovery Actions** 50 · **C. Search & Filtering** 54 · **D. Sorting & Display** 10 · **E. Other** 6.

Daftar lengkap 7 kolom (No · UI Element · Type · Location · Purpose · Component/File · Grup) ada di `discovery-ui-inventory.csv`.

---

## 2. Discovery Filter Audit

Dari inventaris di atas, **63 kontrol adalah filter**, tersebar di 5 permukaan yang memakai 3 sumber data di 2 database.

| Permukaan | Endpoint | Database | Universe | Cara filter |
| --- | --- | --- | ---: | --- |
| A. Creator Database | `/discover/kol-directory` | KOL (`kol` @ 10.100.14.216) | 7.720 | Server-side SQL |
| B. Tracked Accounts | `/discover/profiles` | Warehouse (`tsdb`) | 53 akun | Client-side penuh |
| C. My Creators | `/discover/creators` | Warehouse (`tsdb`) | 4 | Server-side SQL |
| D. Smart Discovery | `/discover/creators/similar` | KOL + Warehouse | 7.720 | Server + filter memori |
| E. Discovery Hub | — | — | — | Tidak punya kontrol filter |

| Status | Jumlah | Contoh |
| --- | ---: | --- |
| 🟢 YES | 15 | Platform, Tipe akun, ER (Tracked), enam filter My Creators |
| 🟡 PARTIAL | 17 | Tier, Min. followers, Category, Min. engagement, Sort, Search |
| 🟠 MISMATCH | 13 | Max. rate card, 5 preset tanpa parameter, 8 atribut generator di Tracked Accounts |
| 🔴 NOT AVAILABLE | 18 | Format, Audience Age/Gender, Location, Authenticity, Brand fit, Paid ratio, Min. campaigns |

Tabel 13 kolom penuh — `Expected Behavior`, `API/Logic`, `DB Table`, `DB Column`, `Data Available`, `Coverage`, `Actual Behavior`, `UI/DB Match`, `Notes` — ada di `discovery-filter-audit.csv`. Tiga temuan filter yang paling menentukan diringkas ulang di Bagian 11 karena bersinggungan langsung dengan Add KOL.

---

## 3. Discovery Button & Action Audit

26 aksi non-filter, ditelusuri dari UI sampai database.

| UI Element | Type | Expected Behavior | Actual Behavior | API / Logic | Database Impact | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Add KOL (shell + Creator Database) | Button | Buka alur tambah KOL dan simpan creator baru | Membuka modal, memvalidasi handle lewat /check, lalu POST menulis 3 tabel dan memulai scrape latar | POST /api/kol-directory/add/check → POST /api/kol-directory/add → polling GET .../status | INSERT `kol_directory` + `social_account` + `kol_social_account` (DB KOL) | 🟢 YES |
| Favorite (ikon hati, kartu creator) | Icon Toggle | Menandai creator sebagai favorit dan menyimpannya | Mengubah `useState` biasa dan menampilkan toast. Hilang saat refresh atau pindah view. Tidak ada layar/filter yang membacanya | No API — state komponen murni | Tidak ada | 🟣 UI ONLY |
| Quick Insight — Shortlist | Action Button | Menambahkan creator ke shortlist | Menoggle `favorites` — set yang sama persis dengan tombol Favorite di kartu | No API | Tidak ada | 🟣 UI ONLY |
| Add to compare (kartu + bulk) | Icon Toggle / Button | Menambahkan creator ke perbandingan | Menulis ke localStorage bucket `compare` per org; tab Compare membacanya dan mengambil datanya lewat `?ids=` | GET /discover/kol-directory?ids=<uuid,…> | Tidak ada tulis DB; baca via `?ids=` (maks 50, tervalidasi UUID) | 🟢 YES |
| Add to cart (kartu + Quick Insight) | Icon Toggle / Button | Menambahkan creator ke keranjang order | Kalau creator sudah punya harga org → masuk keranjang. Kalau belum → membuka modal harga, bukan gagal diam | Baca GET /discover/rates; simpan di localStorage | Tidak menulis; harga dihitung ulang server saat checkout | 🟡 PARTIAL |
| Bulk: Add to Cart | Button | Menambahkan semua creator terpilih ke keranjang | Menambahkan hanya yang sudah berharga; sisanya dilewati diam-diam dengan hitungan di toast | localStorage cart | Tidak ada | 🟡 PARTIAL |
| Pricing modal — Simpan | Button (primary) | Menyimpan base rate creator untuk org ini | PUT tervalidasi: id roster dicek keberadaannya dulu, lalu upsert, lalu daftar harga dikembalikan segar | PUT /api/organizations/[id]/discover/rates | UPSERT `public.discover_roster_rate_cards` (warehouse) | 🟠 MISMATCH |
| Bulk: Export CSV / Excel | Button ×2 | Mengekspor hasil Discovery | Mengunduh file dari baris **terpilih saja**; kalau tidak ada yang dipilih bulk bar tidak muncul sehingga ekspor tidak bisa diakses | Client-side blob download | Tidak ada | 🟡 PARTIAL |
| Compare (toolbar) | Button | Membuka tab Compare berisi creator terpilih | Navigasi ke `?tab=compare`; isinya dibaca dari bucket localStorage yang sama | router.push(tabHref(orgSlug,'compare')) | Tidak ada | 🟢 YES |
| Find similar (kartu, tabel, hub) | Icon Button | Mencari creator serupa dengan acuan ini | Navigasi ke Smart Discovery dengan `?creator=<id>&refsrc=roster`, lalu layar itu memuat acuannya sendiri | GET /discover/kol-directory?ids= lalu GET /discover/creators/similar | Baca dari DB KOL + warehouse | 🟢 YES |
| Quick Insight (buka kartu creator) | Card click → Panel | Menampilkan ringkasan creator | Panel terbuka **tanpa satu pun network request**; seluruh isinya dihitung dari `sampleIntel(creator)` | No API — `sampleIntel()` dari kolSample.ts | Tidak ada | 🟡 PARTIAL |
| Saved lists (simpan / terapkan / hapus) | Button + Dropdown | Menyimpan kombinasi pencarian & filter | Menulis dan membaca `localStorage['autometric.kolDirectory.lists.<orgId>']`; menerapkan set filter kembali dengan benar | No API | Tidak ada | 🟡 PARTIAL |
| Pagination (Creator Database) | Buttons | Pindah halaman hasil | Mengirim `page=` ke API; total dihitung server dengan `COUNT(*) OVER()` di round trip yang sama | GET …?page=&pageSize=12 | Query DB KOL | 🟢 YES |
| Pagination (Tracked Accounts) | Buttons | Pindah halaman hasil | Memotong array hasil di memori; seluruh roster org sudah di-fetch sekali di awal | Tidak ada request per halaman | Tidak ada | 🟢 YES |
| View toggle Card / Table (2 layar) | Segmented Button | Mengganti tampilan daftar | Berganti seketika; di Creator Database state-nya tidak persisten, di Tracked Accounts ikut tersimpan di filter | No API | Tidak ada | 🟡 PARTIAL |
| Column chooser (2 layar) | Checkbox list | Memilih kolom tabel yang tampil | Berfungsi; Tracked Accounts menyimpan sebagai daftar kolom yang **disembunyikan** agar kolom baru tetap muncul untuk semua orang | No API | Tidak ada | 🟡 PARTIAL |
| Refresh creator (My Creators) | Button | Menjalankan ulang profiling satu creator | POST nyata, lalu daftar dimuat ulang dan dipoll tiap 4 detik selama masih berjalan | POST /discover/creators/[id]/refresh | Tulis `discover_creator_runs`, update `discover_creators` (warehouse) | 🟢 YES |
| Monitoring toggle (My Creators) | Toggle | Menyalakan/mematikan monitoring creator | PATCH nyata, daftar dimuat ulang setelahnya | PATCH /discover/creators/[id] | UPDATE `discover_creators.monitoring_enabled` (warehouse) | 🟢 YES |
| Bookmark / Shortlist (Tracked Accounts) | Icon Toggle + Bulk | Menandai akun untuk ditinjau nanti | Menulis ke localStorage bucket `fav` dan `compare`; bertahan antar reload | No API | Tidak ada | 🟡 PARTIAL |
| Add to campaign (Tracked Accounts, bulk) | Button | Mengirim akun terpilih ke alur ordering | Menambahkan id ke bucket shortlist lalu navigasi ke `?tab=order&view=ordering` | No API di titik ini | Tidak ada | 🟢 YES |
| Find similar — Jalankan (Smart Discovery) | Button (primary) | Mencari kandidat serupa | GET nyata dengan constraint; skor kemiripan dihitung server dari tier, platform, kategori, kota | GET /discover/creators/similar?ref=&source=&platform=&city=&tier=&maxRate=&cheaper= | Baca `kol_directory` (KOL) + `discover_creators` (warehouse) | 🟡 PARTIAL |
| Shelf action + kartu (Hub) | Button / Card | Membuka shelf lengkap atau creator | Navigasi benar; shelf diisi dari 3 query terpisah (`sort=created`, similar, populer) | GET /discover/kol-directory + /discover/creators/similar | Baca DB KOL | 🟢 YES |
| Search box Hub | Text Input | Mengirim query ke Creator Database lewat `?q=` | **Tidak ada di UI.** `page.tsx` membaca, memangkas, dan membatasi `?q=` sampai 200 karakter, lalu men-seed-nya ke dua state agar tidak memicu dua request — tapi tidak ada satu pun komponen yang menulis parameter itu | Jalur ada, penulis tidak ada | Tidak ada | 🔴 NOT AVAILABLE |
| Reset / Clear filters (semua layar) | Button | Mengembalikan filter ke default | Berfungsi di keempat layar; Creator Database juga mereset halaman ke 1 dan membatalkan preset | No API (memicu ulang fetch lewat perubahan state) | Tidak ada | 🟢 YES |
| Retry (error state, Creator Database) | Button | Memuat ulang setelah gagal | Menaikkan counter `reload` yang jadi dependensi effect fetch | Mengulang GET /discover/kol-directory | Baca DB KOL | 🟢 YES |
| Breadcrumb / TabStrip / Sidebar nav | Nav controls | Berpindah antar tab dan view Discovery | Berfungsi; alias URL lama tetap teratasi lewat `resolveTabParams`, dan tab khusus Admin dijaga di server | Navigasi Next.js | Tidak ada | 🟢 YES |

Kolom `Frontend File` dan `Notes` lengkap ada di `discovery-ui-buttons.csv`.

---

## 4. Add KOL Flow Audit

### 4.1 Temuan struktural: ada DUA alur Add, keduanya berlabel "Add KOL"

| | Flow A | Flow B |
| --- | --- | --- |
| Tombol | Toolbar **Creator Database** | Header shell + **My Creators** |
| Label di UI | `Add KOL` | `Add KOL` |
| Dialog | `AddKolDirectoryModal.tsx` | `AddCreatorModal.tsx` |
| Endpoint | `/api/kol-directory/add/check` → `/add` → `/add/[kolId]/status` | `/api/organizations/[id]/discover/creators/check` → `POST /creators` |
| Database | **KOL** (`kol` @ 10.100.14.216) | **Warehouse** (`tsdb`) |
| Tabel utama | `public.kol_directory` (+ `social_account`, `kol_social_account`) | `public.discover_creators` |
| Cakupan | Roster komersial global — terlihat semua org | Roster milik satu organisasi |
| Deteksi kategori | **Tidak ada** | `identifyCategory()` — kata kunci bio + hashtag |
| Deteksi kota | **Tidak ada** | `identifyCity()` — kata kunci bio |
| Deteksi akun privat | **Tidak ada state khusus** | `visibility: public / private / unknown` |
| Monitoring | **Tidak ada** | `monitoring_enabled` + toggle + endpoint PATCH |
| Langkah progres | 9 (IG) / 8 (TikTok) | 7 (`PROFILING_STEPS`) |

Tidak ada apa pun di UI yang memberi tahu user bahwa dua tombol dengan label identik menulis ke database yang berbeda dan menghasilkan creator yang muncul di layar yang berbeda.

### 4.2 Bukti eksekusi nyata

Audit ini tidak hanya membaca kode — tiga run Add KOL yang benar-benar pernah dijalankan masih tercatat di database:

| Username | Ditambahkan | Source | Scrape steps | Pipeline steps | Hasil |
| --- | --- | --- | --- | --- | --- |
| `febbyrastanty` | 2026-08-27 10:12 | `excel_import` (baris lama **dipakai ulang**) | 3/3 success | 6/6 success | profil 2 · post 9 · follower 49 |
| `raditya_dika` | 2026-08-27 10:13 | `manual_add` | 3/3 success | 6/6 success | profil 1 · post 9 · follower 49 |
| `sekata_ai` | 2026-08-28 03:31 | `manual_add` | 3/3 success | 6/6 success | profil 1 · post 10 · follower 50 |

Sumber: 9 baris `public.add_kol_scrape_log` dan 18 baris `public.add_kol_pipeline_log`, semuanya `status='success'`, tanpa satu pun `error_message`. **Ketiganya Instagram — leg TikTok belum pernah dieksekusi satu kali pun.**

### 4.3 Tabel end-to-end (15 langkah)

| Step | User Action | Expected Behavior | Actual Behavior | API / Service | Database | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Open Add KOL | Tekan tombol Add KOL | Membuka dialog tambah creator | **Dua tombol berlabel sama membuka dua dialog berbeda.** Toolbar Creator Database → `AddKolDirectoryModal`; header shell & My Creators → `?add=1` → `AddCreatorModal` | Tidak ada request saat membuka | Belum ada | 🟠 MISMATCH |
| 2. Select Platform | Pilih Instagram / TikTok | Memilih platform yang didukung | Chip platform; pilihan hardcoded dan divalidasi ulang di server | Server menolak selain 'instagram'/'tiktok' dengan 400 | `public.platforms` lookup by key | 🟡 PARTIAL |
| 3. Account Input | Ketik username atau tempel URL profil | Menerima kedua bentuk, menormalkan jadi (platform, username) | `parseCreatorInput()` menangani URL dan handle, membuang `@` dan trailing slash, memvalidasi regex per platform, menolak URL post/reel | Diparse ulang di server, tidak percaya hasil klien | `username_normalized` disimpan lowercase | 🟢 YES |
| 4. Validate Input | Validasi sebelum request mahal | Menolak input tidak valid tanpa memanggil layanan eksternal | Tiga saringan berurutan: platform link vs platform terpilih → `parseCreatorInput` → baru cek roster, baru Apify | Belum ada network di tahap ini | Belum ada | 🟢 YES |
| 5. Check Account | Tekan Check / Cek | Memverifikasi akun benar-benar ada di platform | **Request nyata ke Apify.** Instagram: `apify/instagram-profile-scraper`. TikTok: `clockworks/tiktok-scraper` (5 post, `authorMeta` dibaca sebagai profil) | POST /api/kol-directory/add/check → `checkKolExists()` | Baca `public.kol_directory` + `l0_raw.*_followers_apify` | 🟢 YES |
| 6. Detect Account Status | Sistem menyimpulkan kondisi akun | Membedakan ada / tidak ada / privat / error sementara | Lima state: `invalid_input`, `already_in_directory`, `not_found`, `unverified`, `new`. **Akun privat tidak punya state sendiri** | Dibedakan dari `apifyItemError(...).gone` | Tidak menulis | 🟡 PARTIAL |
| 7. Duplicate Check | Sistem mencegah entri ganda | Menolak/menggabungkan handle yang sudah ada | Lookup `LOWER(username_normalized)` per platform, lalu `hasFollowerData()` menentukan apakah entri lama sudah lengkap. Yang belum lengkap dipakai ulang id-nya | Bagian dari /check | `SELECT ... FROM kol_directory JOIN platforms LEFT JOIN kol_social_account` | 🟢 YES |
| 8. Show Validation Result | UI menampilkan hasil pemeriksaan | Satu layar per hasil, dengan aksi lanjutan yang berbeda | Lima layar hasil dengan tombol berbeda: Edit / Try Again / Coba Lagi / Close / Add | — | — | 🟢 YES |
| 9. Collect Profile Data | Sistem menarik data creator | Profil, post, follower | 3 actor paralel (IG) atau 2 (TT). Ukuran sampel terukur dari log nyata: profil 1, post 9–10, follower 49–50 | Apify runs, dicatat per langkah | INSERT `l0_raw.ig_profile_apify` / `ig_media_snapshots_apify` / `ig_followers_apify` | 🟡 PARTIAL |
| 10. Process / Profile Creator | Data mentah diolah jadi profil | Harmonisasi dan agregasi sampai siap tampil | 6 langkah: 3 `CALL l0_harmonization.sp_sync_*` lalu 3 `SELECT l1_silver.sp_build_unified_*`. **Berhenti di L1 silver** | Stored procedure di DB KOL | Isi `l0_harmonization.*` dan `l1_silver.unified_profile/post/follower` | 🟡 PARTIAL |
| 11. Save to Database | Creator tersimpan permanen | Baris identitas + data terukur | Satu transaksi: `kol_directory` → `social_account` → `kol_social_account`, di-COMMIT sebelum scrape dimulai. Setelah scrape, `kol_directory` di-UPDATE dengan COALESCE | POST /api/kol-directory/add | INSERT 3 tabel + UPDATE `kol_directory` (8 kolom) | 🟡 PARTIAL |
| 12. Connect to Organization | Creator terhubung ke org/agency | Relasi kepemilikan terbentuk | `ensureAgencyLink()` best-effort — gagal diam bila user tidak ketemu | Bagian dari transaksi identitas | INSERT `public.agency_kol_accounts` (opsional) | 🟡 PARTIAL |
| 13. Enable Tracking / Monitoring | Creator masuk pemantauan berkala | Dijadwalkan refresh otomatis | **Tidak ada.** Flow A tidak menyetel flag monitoring apa pun; `kol_directory` tidak punya kolom monitoring | NOT FOUND | NOT FOUND | 🔴 NOT AVAILABLE |
| 14. Show in Discovery | Creator baru muncul di Discovery | Langsung terlihat dan bisa dicari | Muncul segera di Creator Database — `directory_status='active'` disetel saat INSERT, dan daftar dibaca server-side per request | GET /discover/kol-directory | Baca `kol_directory` | 🟢 YES |
| 15. Update Discovery Result | Data lengkap tersedia untuk filter & analitik | Filter dan layar analitik bisa menemukan creator baru | **Sebagian.** Filter Platform/Tier/Followers/Search/Verified langsung bekerja. Filter Category **tidak akan pernah** menemukannya. Layar berbasis `l2_gold` menunggu batch eksternal | — | `l2_gold.*` diisi proses di luar aplikasi | 🟡 PARTIAL |

**Catatan teknis per langkah:**

* **1. Open Add KOL** — Keduanya berlabel **Add KOL** tapi menulis ke database berbeda: Flow A ke `public.kol_directory` (server KOL), Flow B ke `public.discover_creators` (warehouse). Tidak ada di UI yang membedakan keduanya. Flow B menulis `?add=1` ke URL sehingga bisa di-bookmark; Flow A memakai state komponen.
* **2. Select Platform** — Dua platform di `CREATOR_PLATFORMS` untuk Flow A; `vocab`-nya juga mendefinisikan Facebook tapi Add KOL menolaknya secara eksplisit. Tabel `platforms` memang hanya berisi instagram + tiktok, jadi UI cocok dengan DB. YouTube tidak ada di UI maupun DB.
* **3. Account Input** — Termasuk detail yang jarang ditangani: regex per platform (IG 30 char, TT 24 char, tanpa spasi karena actor Apify menolak start), daftar `NOT_A_PROFILE` (`/p/`, `/reel/`, `/video/`, dst.) sehingga link post ditolak dengan alasan benar, dan `platformOfUrl()` yang mendeteksi link TikTok ditempel saat Instagram terpilih lalu menawarkan tukar platform.
* **4. Validate Input** — Urutan saringannya benar secara ekonomi: Apify run (yang berbayar) hanya jalan setelah dua saringan gratis lolos. Komentar kodenya menyatakan ini eksplisit.
* **5. Check Account** — Bukan mock. `APIFY_API_TOKEN` ada di `.env.local` dan `apifyKolActors.ts:52` melempar error eksplisit bila hilang. Bukti eksekusi nyata: 9 baris di `public.add_kol_scrape_log` dari 3 run (febbyrastanty, raditya_dika, sekata_ai), semuanya `status='success'`.
* **6. Detect Account Status** — Pembedaan error permanen (`gone` → `not_found`) vs sementara (→ `unverified`, 'coba lagi sebentar') sudah benar dan jarang ada. Tapi akun privat jatuh ke `not_found` di Instagram, dan di TikTok pesan errornya menggabungkan tiga sebab berbeda: 'may be new, private, or blocked to our region'. Flow B justru punya deteksi privat sungguhan (`visibility: public|private|unknown`).
* **7. Duplicate Check** — Definisi 'sudah pernah ditarik' sengaja **tidak** memakai `scrape_status` — kolom itu tidak pernah diisi leg TikTok pipeline Python lama. Yang dipakai adalah keberadaan baris di `l0_raw.*_followers_apify`. Terbukti bekerja: `febbyrastanty` yang tadinya `excel_import` dipakai ulang, bukan diduplikasi.
* **8. Show Validation Result** — Tiap state punya jalan keluar yang sesuai — link platform salah ditawari tukar platform, typo handle diperbaiki di tempat, error sementara ditawari ulangi.
* **9. Collect Profile Data** — Berjalan dan tercatat. Tapi sampelnya kecil dan tetap: 10 post dan ~50 follower per creator — label UI menjanjikan 'sampel 100 follower', log nyata menunjukkan 49, 49, 50. Re-run di hari yang sama menghapus-lalu-menulis-ulang (delete-then-insert) sehingga tidak menggandakan.
* **10. Process / Profile Creator** — Keenam prosedurnya terverifikasi ada di database (`pg_proc`). Tapi **tidak ada satu pun fungsi atau prosedur di schema `l2_gold`** — pipeline aplikasi tidak pernah membangun lapisan gold. Semua layar yang membaca `l2_gold.*` menunggu batch eksternal.
* **11. Save to Database** — Transaksinya benar (BEGIN/COMMIT/ROLLBACK) dan UPDATE-nya defensif — setiap kolom di-COALESCE sehingga scrape yang tidak mengembalikan satu field tidak menimpa nilai lama. Yang tidak pernah diisi: **`category_id` / `category_ids`** dan **`creator_city`**. Terbukti pada ketiga creator hasil Add KOL: category NULL, city NULL.
* **12. Connect to Organization** — Komentar di route menyatakan `public.user` masih kosong sehingga resolusi agency tidak akan menemukan siapa pun. Terbukti tidak konsisten pada data nyata: `raditya_dika` punya 1 agency link, `sekata_ai` punya 0. Roster KOL memang global (bukan per-org), jadi ini tidak memblokir — tapi creator tanpa link tidak punya jejak siapa yang menambahkannya.
* **13. Enable Tracking / Monitoring** — Flow B punya ini (`discover_creators.monitoring_enabled`, dengan toggle di kartu My Creators dan endpoint PATCH). Flow A tidak. Sekali ditambahkan, creator roster hanya di-refresh bila ada yang menekan Add KOL lagi atas handle itu. Terlihat pada data: `refreshed_within_7d = 0` untuk seluruh 7.720 baris.
* **14. Show in Discovery** — Tidak perlu refresh manual: modal mengakhiri alurnya dengan navigasi, dan daftar mengambil ulang dari server. Terverifikasi: ketiga creator ada di roster aktif dengan `source='manual_add'` (dua) dan `excel_import` (satu, dipakai ulang).
* **15. Update Discovery Result** — Lag gold terukur dari data: `raditya_dika` ditambahkan 2026-08-27 10:13, baris `kol_profile_card`-nya dibuat 2026-08-28 07:06 (**±21 jam**). `sekata_ai` ditambahkan 2026-08-28 03:31, gold 2026-08-28 07:06 (**±3,5 jam**). Keduanya dibuat pada timestamp yang sama persis — satu batch eksternal, bukan pemicu per-creator.

---

## 5. Account Validation Audit

Verifikasi akun **bukan mock**. `/check` memanggil Apify sungguhan, dan `apifyKolActors.ts:52` melempar error eksplisit bila `APIFY_API_TOKEN` tidak ada (token tersedia di `.env.local`). Actor yang dipakai:

| Platform | Langkah | Actor |
| --- | --- | --- |
| Instagram | Profil | `apify/instagram-profile-scraper` |
| Instagram | Post | `apify/instagram-scraper` |
| Instagram | Follower | `apify/instagram-followers-following-scraper` |
| TikTok | Profil + post (satu run) | `clockworks/tiktok-scraper` |
| TikTok | Follower | `clockworks/tiktok-followers-scraper` |

| Account Status | Detection Logic | API/Service | UI Result | Database Handling | Status |
| --- | --- | --- | --- | --- | --- |
| Account Found (baru) | Apify mengembalikan profil dengan `id` atau `followersCount` | apify/instagram-profile-scraper · clockworks/tiktok-scraper | Kartu pratinjau: nama, avatar, bio, follower + tombol Add | Belum ditulis; ditulis setelah user menekan Add | 🟢 YES |
| Account Not Found | `apifyItemError(...).gone === true`, atau profil kosong tanpa `id`/`followersCount` | sama | Layar error dengan pesan menyebut kode aslinya + tombol Edit | Tidak ditulis | 🟢 YES |
| Invalid Username | Regex per platform di `parseCreatorInput` (IG `^[A-Za-z0-9._]{1,30}$`, TT `{1,24}`) | Lokal, tanpa network | Pesan menyebut karakter apa yang boleh | Tidak ditulis | 🟢 YES |
| Invalid URL | `new URL()` gagal di `fromUrl()` | Lokal | Pesan menyarankan tempel link penuh atau ketik username | Tidak ditulis | 🟢 YES |
| Wrong-platform URL | `platformOfUrl()` dibandingkan platform terpilih | Lokal | Pesan menyebut platform asli link + tawaran tukar platform | Tidak ditulis | 🟢 YES |
| Not a profile URL (post/reel) | Segmen pertama path dicek terhadap `NOT_A_PROFILE` | Lokal | Pesan menyatakan link itu bukan link profil | Tidak ditulis | 🟢 YES |
| Already in directory (lengkap) | Ada baris `kol_directory` **dan** ada baris di `l0_raw.*_followers_apify` | Query DB KOL | Layar 'sudah ada' + data roster yang ada | Tidak ditulis ulang | 🟢 YES |
| Already in directory (belum lengkap) | Ada baris `kol_directory` tapi **tidak** ada follower row | Query DB KOL | Diperlakukan sebagai `new`; id lama dibawa agar tidak fork | Baris lama dipakai ulang, bukan INSERT baru | 🟢 YES |
| Private Account | **Tidak ada state khusus.** Instagram: jatuh ke `not_found`. TikTok: pesannya menggabung 'new, private, or blocked' | — | Ditampilkan sebagai akun tidak ditemukan | Tidak ditulis | 🔴 NOT AVAILABLE |
| Restricted / region-blocked | Tidak dibedakan; ikut ke `not_found` atau `unverified` | — | Pesan generik | Tidak ditulis | 🔴 NOT AVAILABLE |
| Suspended / Unavailable | Tidak dibedakan; `gone` → `not_found` | — | Sama dengan 'tidak ditemukan' | Tidak ditulis | 🔴 NOT AVAILABLE |
| Temporary platform error | `apifyItemError` tanpa `gone`, atau exception saat fetch | Apify | Layar `unverified`: 'coba lagi sebentar' + tombol Try Again | Tidak ditulis | 🟢 YES |
| Apify token hilang / invalid | `apifyKolActors.ts:52` melempar; token invalid → pesan khusus | Apify | Masuk ke jalur `unverified` | Tidak ditulis | 🟡 PARTIAL |

**Yang kuat:** pembedaan error permanen dari sementara. `apifyItemError(...).gone` menghasilkan `not_found` ("akun ini tidak ada"), sedangkan error lain menghasilkan `unverified` ("coba lagi sebentar"). Ini jarang ditemukan dan mencegah akun sah dicap tidak ada saat platform sedang bermasalah.

**Yang hilang:** akun privat tidak punya state sendiri. Di Instagram, profil privat yang tidak mengembalikan `id`/`followersCount` jatuh ke `not_found` — user diberi tahu akunnya tidak ada. Di TikTok, pesannya menggabungkan tiga sebab berbeda dalam satu kalimat: *"The account may be new, private, or blocked to our region."* Flow B justru sudah punya deteksi privat yang benar (`visibility`), termasuk catatan *"Account is private — its posts are not readable."*

---

## 6. Duplicate Detection Audit

Inti dedup Flow A ada di `addKolCheck.ts:63-104`. Definisi "sudah pernah ditarik" **sengaja tidak** memakai `kol_directory.scrape_status` — komentar kodenya menjelaskan kolom itu tidak pernah diisi leg TikTok pipeline Python lama (terbukti: 7.621 dari 7.720 baris roster ber-`scrape_status` NULL). Yang dipakai adalah keberadaan baris nyata di `l0_raw.ig_followers_apify` / `tt_followers_apify`.

| Duplicate Scenario | Detection Logic | DB Query | Actual Behavior | Status |
| --- | --- | --- | --- | --- |
| Handle sama, sudah lengkap | `findInDirectory()` + `hasFollowerData()` | `WHERE pl.key=$1 AND LOWER(kd.username_normalized)=LOWER($2)` lalu `EXISTS(l0_raw.*_followers_apify)` | State `already_in_directory`; UI menampilkan data roster yang ada, tidak menawarkan Add | 🟢 YES |
| Handle sama, belum pernah di-scrape | Sama, tapi `hasFollowerData()` false | Sama | Diperlakukan `new`, tapi `existingKolDirectoryId` dan `existingSocialAccountId` dibawa ke step Add sehingga baris lama di-UPDATE, bukan di-INSERT lagi | 🟢 YES |
| Beda kapitalisasi (@Raditya_Dika) | `LOWER()` di kedua sisi perbandingan | `LOWER(kd.username_normalized) = LOWER($2)` | Terdeteksi sebagai duplikat | 🟢 YES |
| Dengan / tanpa @ | `parseCreatorInput` membuang `^@` sebelum apa pun | — | Terdeteksi sebagai duplikat | 🟢 YES |
| URL vs username untuk akun sama | URL diparse jadi username dulu, baru dibandingkan | — | Terdeteksi sebagai duplikat | 🟢 YES |
| Handle sama di platform berbeda | Perbandingan selalu dipasangkan dengan `pl.key = $1` | `WHERE pl.key=$1 AND ...` | **Tidak** dianggap duplikat — dan itu benar | 🟢 YES |
| Dua user menekan Add bersamaan | **Tidak ada penjagaan di Flow A** | Tidak ada unique index pada `(platform_id, username_normalized)` | Dua baris `kol_directory` bisa terbentuk untuk handle yang sama | 🟡 PARTIAL |
| Handle berbeda, akun sama (URL redirect / username diganti) | **Tidak dicek** | — | Akan masuk sebagai creator baru | 🔴 NOT AVAILABLE |

**Catatan per skenario:**

* **Handle sama, sudah lengkap** — Jalur ini yang mencegah duplikat sungguhan.
* **Handle sama, belum pernah di-scrape** — Ini kasus mayoritas: 7.621 dari 7.720 baris roster punya `scrape_status` NULL. Terbukti pada `febbyrastanty` — `source` tetap `excel_import`, tidak ada baris kedua.
* **Beda kapitalisasi (@Raditya_Dika)** — `normalizeUsername()` juga menyimpan bentuk lowercase saat INSERT.
* **Dengan / tanpa @** — Berlaku untuk input handle maupun URL.
* **URL vs username untuk akun sama** — `fromUrl()` mengambil segmen path pertama sebagai handle.
* **Handle sama di platform berbeda** — Empat handle di roster memang punya baris IG dan TikTok terpisah (@instagram, @iben_ma, @inul.d, @saalhaerid). `kol_directory` memang berkunci handle-per-platform.
* **Dua user menekan Add bersamaan** — Flow B menangani ini dengan benar: komentar di `creators/route.ts` menyebut unique index sebagai penyelesai balapan, dan duplikat dijawab `created:false` + creator yang ada. Flow A tidak punya padanannya — jendela balapannya kecil (dua request harus berpapasan di antara /check dan /add) tapi nyata.
* **Handle berbeda, akun sama (URL redirect / username diganti)** — `platform_user_id` (id numerik platform) baru diisi **setelah** scrape, jadi tidak bisa dipakai untuk dedup di tahap check. Creator yang berganti username akan terdaftar dua kali dengan `platform_user_id` yang sama.

---

## 7. Data Collection & Profiling Audit

Sifat proses: **identity insert sinkron, sisanya background**. `scrapeNewKol()` menunggu satu transaksi identitas (karena route butuh `kolDirectoryId` untuk dijawab ke UI), lalu `runRestOfPipeline()` dilepas detached. Bukan queue dan bukan job runner — sebuah promise yang tidak di-await di dalam proses Next.js yang sama. Konsekuensinya: **restart server di tengah scrape mematikan pipeline tanpa penanda di baris roster** — itulah sebabnya endpoint status punya deteksi stall 3 menit.

| Data Type | Collection Source | Processing | DB Table/Column | Actual Availability | Status |
| --- | --- | --- | --- | --- | --- |
| Profil dasar (nama, bio, avatar) | apify/instagram-profile-scraper · clockworks/tiktok-scraper (authorMeta) | Background, per langkah tercatat | `l0_raw.ig_profile_apify` → `kol_directory.bio/avatar_url` | 1 item per run — terverifikasi | 🟢 YES |
| Followers count | Actor yang sama | COALESCE ke `kol_directory` | `kol_directory.followers_count` | Terisi untuk ketiganya | 🟢 YES |
| Following count | Actor profil | Masuk harmonisasi | `l1_silver.unified_profile.following_count` | Terisi | 🟢 YES |
| Engagement rate | Dihitung dari profil IG (`igEngagementRate()`) | COALESCE ke roster | `kol_directory.engagement_rate` | IG: terisi (0,12 / 0,29 / 9,42). **TikTok: tidak dihitung sama sekali** | 🟡 PARTIAL |
| Verifikasi | Field `verified` dari actor | Dipetakan ke 'verified'/'unverified' | `kol_directory.verified_status` | Terisi untuk ketiganya | 🟢 YES |
| Post (10 terbaru) | apify/instagram-scraper · clockworks/tiktok-scraper | Harmonisasi → silver | `l0_raw.ig_media_snapshots_apify` → `l1_silver.unified_post` | 9–10 post per creator | 🟡 PARTIAL |
| Sampel follower | apify/instagram-followers-following-scraper · clockworks/tiktok-followers-scraper | Delete-then-insert per hari | `l0_raw.ig_followers_apify` | 49–50 baris (UI menjanjikan 100) | 🟡 PARTIAL |
| Kategori / niche | **Tidak dikumpulkan di Flow A** | — | `kol_directory.category_id` / `category_ids` | NULL untuk ketiga creator hasil Add KOL | 🔴 NOT AVAILABLE |
| Lokasi creator | **Tidak dikumpulkan di Flow A** | — | `kol_directory.creator_city` | NULL — dan 0/7.720 di seluruh roster | 🔴 NOT AVAILABLE |
| Analisis audiens | **Tidak dikumpulkan** | — | `l2_gold.audience_demographics_daily` | 0 baris untuk ketiganya | 🔴 NOT AVAILABLE |
| Analisis konten / format | Tidak di pipeline aplikasi | Batch eksternal | `l2_gold.content_format_daily` | Menunggu batch | 🟡 PARTIAL |
| Metrik harian & post gold | Tidak di pipeline aplikasi | Batch eksternal (tidak ada proc `l2_gold` di DB) | `l2_gold.kol_metric_daily` · `post_metric` · `kol_profile_card` | Terisi 3,5–21 jam setelah Add | 🟡 PARTIAL |
| Rate card | Tidak dikumpulkan | — | `l1_silver.unified_rate_card` | 0 baris di seluruh tabel | 🔴 NOT AVAILABLE |
| Story / comment / tagged post | Tidak dipanggil Flow A (proc-nya ada) | — | `l0_harmonization.instagram_story/comment/tagged_post` | Tidak diisi oleh Add KOL | 🔴 NOT AVAILABLE |

### Enam prosedur harmonisasi — terverifikasi ada di database

`CALL l0_harmonization.sp_sync_{instagram|tiktok}_{profile,post,follower}()` lalu `SELECT l1_silver.sp_build_unified_{profile,post,follower}()`. Keenamnya dikonfirmasi lewat `pg_proc`.

### Yang tidak ada: pembangun lapisan gold

Query `pg_proc` atas schema `l2_gold` mengembalikan **nol fungsi dan nol prosedur**. Pipeline aplikasi berhenti di L1 silver. Seluruh isi `l2_gold.*` — `kol_profile_card`, `kol_metric_daily`, `post_metric`, `content_format_daily`, `audience_demographics_daily` — ditulis proses di luar aplikasi ini (repo scrapper/Dagster).

Lag-nya terukur dari data nyata:

| Creator | Add KOL selesai | Baris `kol_profile_card` dibuat | Lag |
| --- | --- | --- | ---: |
| `raditya_dika` | 2026-08-27 10:13 | 2026-08-28 07:06 | **± 21 jam** |
| `sekata_ai` | 2026-08-28 03:31 | 2026-08-28 07:06 | **± 3,5 jam** |

Keduanya dibuat pada timestamp yang identik (`2026-08-28 07:06:38`) — satu batch, bukan pemicu per-creator.

---

## 8. Database Integration Audit

| Data Saved | Table | Column | Required | Actual Behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Identitas roster | `public.kol_directory` | platform_id, username, username_normalized, source, directory_status, profile_url, created_at, updated_at | Ya | INSERT dalam transaksi; `source='manual_add'`, `directory_status='active'` | 🟢 YES |
| Akun sosial | `public.social_account` | platform_id, username, profile_url, data_source | Ya | INSERT dalam transaksi yang sama | 🟢 YES |
| Relasi roster↔akun | `public.kol_social_account` | kol_id, social_account_id, platform_id, created_at | Ya | INSERT dalam transaksi yang sama | 🟢 YES |
| Relasi agency | `public.agency_kol_accounts` | kol_account_id, agency_id, label | Tidak (best-effort) | Gagal diam bila user tak ditemukan; `public.user` kosong. Nyata: 1 dari 2 creator manual dapat link | 🟡 PARTIAL |
| Metrik profil | `public.kol_directory` | platform_user_id, followers_count, engagement_rate, avatar_url, bio, verified_status | Ya | UPDATE ber-COALESCE setelah scrape; ER hanya untuk Instagram | 🟡 PARTIAL |
| Status scrape | `public.kol_directory` | scrape_status, last_refreshed_at, updated_at | Ya | 'success' atau 'failed'; `last_refreshed_at = now()` | 🟢 YES |
| Kategori | `public.kol_directory` | category_id, category_ids | Seharusnya | **Tidak pernah ditulis** — NULL untuk semua creator hasil Add KOL | 🔴 NOT AVAILABLE |
| Lokasi | `public.kol_directory` | creator_city | Seharusnya | **Tidak pernah ditulis** | 🔴 NOT AVAILABLE |
| Data mentah | `l0_raw.ig_profile_apify` · `ig_media_snapshots_apify` · `ig_followers_apify` | raw_payload, scrape_run_id, scraped_at, source_actor | Ya | INSERT per item, delete-then-insert untuk re-run harian | 🟢 YES |
| Log per langkah | `public.add_kol_scrape_log` | run_id, step, actor, status, items_fetched, error_message, duration_seconds | Ya | 9 baris nyata dari 3 run, semuanya success | 🟢 YES |
| Log pipeline | `public.add_kol_pipeline_log` | run_id, step, status, started_at, finished_at | Ya | 18 baris nyata dari 3 run, semuanya success | 🟢 YES |
| Lapisan harmonisasi & silver | `l0_harmonization.*` · `l1_silver.unified_*` | — | Ya | Diisi oleh 6 stored procedure yang terverifikasi ada | 🟢 YES |
| Lapisan gold | `l2_gold.*` | — | Ya | **Tidak ditulis pipeline aplikasi.** Tidak ada satu pun fungsi/prosedur di schema `l2_gold` | 🟡 PARTIAL |
| Monitoring / tracking | NOT FOUND | NOT FOUND | Seharusnya | `kol_directory` tidak punya kolom monitoring; Flow A tidak menjadwalkan refresh apa pun | 🔴 NOT AVAILABLE |

**Kualitas transaksi.** `insertIdentity()` membungkus ketiga INSERT identitas dalam satu `BEGIN`/`COMMIT` dengan `ROLLBACK` di catch dan `client.release()` di finally — tidak ada jalan bagi baris `kol_directory` yatim tanpa `social_account`. UPDATE pasca-scrape memakai `COALESCE($n, k.kolom)` di setiap kolom, sehingga scrape yang tidak mengembalikan sebuah field tidak menimpa nilai lama dengan NULL.

**Yang tidak pernah ditulis:** `category_id`, `category_ids`, `creator_city`. Terbukti pada ketiga creator hasil Add KOL — ketiganya NULL. Ini berarti creator yang baru ditambahkan **tidak akan pernah muncul** saat user memakai filter Category, dan menambah baris ke 45,9%% roster yang sudah tanpa kategori.

---

## 9. Discovery Integration Audit

| Pertanyaan | Jawaban | Bukti |
| --- | --- | --- |
| Creator langsung muncul di Discovery? | **Ya**, seketika | `directory_status='active'` disetel saat INSERT; daftar dibaca server-side tiap request |
| Muncul di tab/list mana? | **Creator Database** (`?tab=directory&view=database`) | Roster global; juga muncul di shelf "Recently added" di Hub (`sort=created`) |
| Perlu refresh manual? | **Tidak** | Modal mengakhiri alur dengan navigasi, daftar mengambil ulang dari server |
| Data langsung lengkap? | **Tidak** | Identitas + follower + ER langsung ada; analitik gold menunggu 3,5–21 jam |
| Status masih processing? | Terlihat lewat polling | 9 langkah (IG) dengan status per langkah; stall > 3 menit dilaporkan gagal **di respons saja**, baris log tidak disentuh |
| Filter bisa menemukan akun baru? | **Sebagian** | Platform ✅ · Tier ✅ · Followers ✅ · Search ✅ · Verified ✅ · **Category ❌ (selalu NULL)** · Rate card ❌ (tabel kosong) |
| Masuk monitoring? | **Tidak** | Tidak ada kolom/mekanisme monitoring di Flow A |
| Badge provenance? | `Live` selama 7 hari, lalu turun | `kolDirectory.ts:186`; hari ini **0 dari 7.720** baris berstatus Live |

Konsekuensi gabungan yang perlu disorot: creator yang ditambahkan hari ini akan **berhenti disebut Live** dalam 7 hari, **tidak pernah** di-refresh otomatis, dan **tidak pernah** bisa ditemukan lewat filter Category. Discovery dan Add KOL memang satu sistem yang tersambung — tapi sambungannya satu arah dan sekali jalan.

---

## 10. Current Flow Diagram

Implementasi aktual, bukan desain. ✅ Working · ⚠️ Partial · ❌ Broken · ⬜ Not Implemented

```
FLOW A — Add KOL dari Creator Database  →  database KOL

  [Tombol "Add KOL" · toolbar]                            ✅
        ↓  setAddOpen(true)
  [AddKolDirectoryModal]                                  ✅
        ↓
  [Pilih platform: Instagram | TikTok]                     ✅  hardcoded, divalidasi ulang di server
        ↓
  [Input username / URL profil]                            ✅  parseCreatorInput: @ dibuang, regex per platform,
        ↓                                                      link post ditolak, link salah platform ditawari tukar
  [Cek roster lokal]                                       ✅  LOWER(username_normalized) + platform
        ↓
  ├── sudah lengkap ─────→ [already_in_directory]          ✅  tidak menawarkan Add
  ├── ada tapi belum di-scrape → bawa id lama ke bawah     ✅  mencegah fork duplikat
  └── belum ada ─────────→ lanjut
        ↓
  [Verifikasi ke platform via Apify]                       ✅  BUKAN mock — 9 baris log nyata
        ↓
  ├── gone         → [not_found]                           ✅
  ├── error lain   → [unverified: coba lagi]               ✅
  ├── akun privat  → jatuh ke [not_found]                  ⚠️  tidak dibedakan
  └── ok           → [preview: nama, avatar, bio, follower] ✅
        ↓  user menekan Add
  [POST /api/kol-directory/add]                            ✅  auth + validasi platform/username/profileUrl
        ↓
  [Transaksi identitas]                                    ✅  kol_directory → social_account → kol_social_account
        │                                                      BEGIN/COMMIT/ROLLBACK, id dikembalikan ke UI
        ├── ensureAgencyLink()                             ⚠️  best-effort, public.user kosong
        ↓  (respons dikirim; sisanya detached)
  [Scrape Apify paralel]                                   ✅  profil 1 · post 9-10 · follower 49-50
        │                                                  ⚠️  label UI menjanjikan 100 follower
        ↓  INSERT l0_raw.*  (delete-then-insert per hari)   ✅
  [Harmonisasi: 3 CALL sp_sync_*]                          ✅  prosedur terverifikasi ada
        ↓
  [Silver: 3 SELECT sp_build_unified_*]                    ✅
        ↓
  [UPDATE kol_directory ber-COALESCE]                      ✅  followers, ER, avatar, bio, verified, scrape_status
        │                                                  ❌  category_id / category_ids tidak pernah ditulis
        │                                                  ❌  creator_city tidak pernah ditulis
        │                                                  ⚠️  engagement_rate hanya untuk Instagram
        ↓
  [Lapisan L2 gold]                                        ⬜  TIDAK ADA di pipeline aplikasi
        │                                                      0 fungsi/prosedur di schema l2_gold
        ⋯ batch eksternal, lag terukur 3,5-21 jam ⋯        ⚠️
        ↓
  [Discovery · Creator Database]                           ✅  muncul seketika, tanpa refresh manual
        ├── filter Platform / Tier / Followers / Search    ✅
        ├── filter Category                                ❌  selalu NULL → tidak akan pernah ketemu
        ├── filter Rate card                               ❌  tabel kosong
        └── monitoring berkala                             ⬜  tidak ada

  [Polling status per langkah]                             ✅  9 langkah IG / 8 TikTok, stall 3 menit terdeteksi
                                                               tanpa merusak baris log sebagai bukti
  [Leg TikTok end-to-end]                                  ⬜  0 dari 3 run nyata; belum pernah dieksekusi


FLOW B — Add KOL dari header / My Creators  →  warehouse

  [Tombol "Add KOL" · header shell]                        ✅  label sama dengan Flow A
        ↓  ?add=1 (bisa di-bookmark)
  [AddCreatorModal]                                        ✅
        ↓
  [Platform → input → check]                               ✅  parser yang sama
        ↓
  [Deteksi privat]                                         ✅  visibility: public | private | unknown
        ↓
  [POST /discover/creators]                                ✅  handle diparse ULANG di server, tidak percaya klien
        │                                                  ✅  duplikat dijawab created:false, bukan error
        ↓
  [startProfiling — 7 langkah]                             ✅  profile → stats → collect → content →
        │                                                      category → generate → save
        ├── identifyCategory()                             ⚠️  ada, tapi 0/4 baris punya hasil
        ├── identifyCity()                                 ⚠️  ada, tapi 0/4 baris punya hasil
        └── monitoring_enabled                             ✅  toggle + PATCH tersedia
        ↓
  [Discovery · My Creators]                                ✅  4 baris total, 1 org
```

---

## 11. Expected vs Actual Gap Analysis

| Step | Expected Product Flow | Current Implementation | Gap | Priority |
| --- | --- | --- | --- | --- |
| Trigger Add KOL | Satu tombol, satu alur yang jelas | Dua tombol berlabel sama membuka dua dialog yang menulis ke dua database | User tidak bisa tahu ke mana creator-nya masuk | P0 |
| Check Account | Verifikasi nyata ke platform | Verifikasi nyata lewat Apify, dengan pembedaan error permanen vs sementara | Tidak ada gap | — |
| Private account detection | Membedakan privat dari tidak ada | Instagram: privat → 'tidak ditemukan'. TikTok: tiga sebab digabung dalam satu pesan | User diberi tahu akun tidak ada padahal ada tapi privat | P1 |
| Duplicate — race | Unique index menyelesaikan balapan | Flow B punya; Flow A tidak punya unique index pada `(platform_id, username_normalized)` | Dua request berpapasan bisa membuat dua baris roster | P1 |
| Duplicate — username berganti | Dedup lewat id platform | Hanya dedup lewat handle; `platform_user_id` baru terisi setelah scrape | Creator yang ganti username masuk dua kali | P2 |
| Kategori creator | Terdeteksi otomatis saat intake | Flow A tidak pernah menulis kategori. Flow B punya `identifyCategory()` berbasis kata kunci bio + hashtag | Creator baru tidak akan pernah ditemukan filter Category | P1 |
| Lokasi creator | Terdeteksi dari bio | Flow A tidak menulis. Flow B punya `identifyCity()` | `creator_city` tetap 0/7.720; filter lokasi tetap mati | P2 |
| Engagement rate TikTok | Dihitung untuk kedua platform | Hanya Instagram (`igEngagementRate`); update TikTok tidak menyentuh kolom ER | KOL TikTok baru selalu ber-ER NULL dan hilang begitu filter ER dipasang | P1 |
| Ukuran sampel follower | 100 follower seperti tertulis di UI | 49–50 pada ketiga run nyata | Label langkah menjanjikan lebih dari yang diambil | P2 |
| Lapisan gold | Tersedia segera setelah Add | Diisi batch eksternal; lag terukur 3,5–21 jam | Layar analitik kosong berjam-jam untuk creator yang baru ditambahkan | P1 |
| Monitoring | Creator baru masuk refresh berkala | Tidak ada mekanisme apa pun di Flow A | Data creator membeku sejak menit ia ditambahkan; 0/7.720 baris ter-refresh dalam 7 hari | P1 |
| Agency / ownership | Jejak siapa menambahkan | Best-effort dan gagal diam karena `public.user` kosong | Tidak ada attribusi yang bisa diandalkan | P2 |
| TikTok end-to-end | Terbukti jalan | 0 dari 3 run nyata memakai TikTok; leg TikTok belum pernah dieksekusi di produksi | Jalur TikTok belum tervalidasi sama sekali | P1 |
| Progress feedback | User tahu proses berjalan | Polling status per langkah, dengan deteksi stall 3 menit yang tidak merusak baris log | Tidak ada gap — ini salah satu bagian terkuat | — |

### Critical flow breakpoints

**P0**

* **Dua tombol "Add KOL" menulis ke dua database.** Satu-satunya masalah P0 di alur ini, dan bukan karena ada yang rusak — keduanya bekerja dengan benar, tapi user tidak punya cara tahu creator-nya akan mendarat di roster global atau di roster org-nya sendiri.

Yang **tidak** ditemukan meski dicari secara khusus, dan layak dicatat sebagai hasil negatif:

* Tombol Add KOL **menyimpan data sungguhan** — terbukti dari dua baris `source='manual_add'` di roster produksi.
* Validasi **bukan mock** — 9 baris log Apify nyata dengan nama actor dan jumlah item.
* Duplikat **tidak bisa masuk** lewat jalur normal — handle, kapitalisasi, `@`, dan URL semuanya dinormalkan ke satu bentuk.
* Creator **muncul setelah ditambahkan** — tanpa perlu refresh manual.

**P1**

* Akun privat dilaporkan sebagai "tidak ditemukan" (Instagram) atau digabung dengan dua sebab lain (TikTok).
* Kategori tidak pernah ditulis → creator baru tidak akan pernah ditemukan filter Category.
* Engagement rate tidak dihitung untuk TikTok → KOL TikTok baru hilang begitu filter ER dipasang.
* Tidak ada unique index pada `(platform_id, username_normalized)` → dua request berpapasan bisa membuat dua baris.
* Tidak ada monitoring/refresh berkala → data membeku sejak menit creator ditambahkan (0/7.720 ter-refresh dalam 7 hari).
* Lapisan gold menunggu batch eksternal 3,5–21 jam → layar analitik kosong selama itu.
* Leg TikTok belum pernah dieksekusi sekali pun di produksi.

**P2**

* Sampel follower 49–50 padahal label langkah menjanjikan 100.
* `creator_city` tidak pernah ditulis → filter lokasi tetap mati untuk creator baru.
* Attribusi agency gagal diam karena `public.user` kosong.
* Creator yang berganti username akan terdaftar dua kali (`platform_user_id` baru terisi setelah scrape).

**P3**

* Pesan error TikTok menggabungkan tiga sebab dalam satu kalimat.
* Pipeline detached di dalam proses Next.js — restart server mematikannya; hanya terlihat lewat deteksi stall 3 menit.

### Tiga temuan filter yang bersinggungan langsung dengan Add KOL

1. **Filter Category tidak akan pernah menemukan creator hasil Add KOL** — karena Flow A tidak pernah menulis kategori, dan filter itu sendiri sudah hanya mencakup 54,1%% roster.
2. **Filter rate card selalu mengosongkan hasil** — enam kontrol di tiga permukaan membaca tabel yang 0 baris, dan Add KOL tidak mengumpulkan harga sama sekali.
3. **Badge Live tidak pernah muncul** — 0 dari 7.720 baris ter-refresh dalam 7 hari, karena tidak ada monitoring; efeknya setiap urutan Sort selalu menampilkan 27 baris `Calculated` dulu, baru 7.693 `Estimated`.

---

## 12. Final Summary

| Category | Total | Working | Partial | Broken | UI Only | Not Available | Mismatch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Discovery Filters | 63 | 15 | 17 | 0 | 0 | 18 | 13 |
| Discovery Buttons & Actions | 26 | 13 | 9 | 0 | 2 | 1 | 1 |
| Add KOL — end-to-end steps | 15 | 6 | 7 | 0 | 0 | 1 | 1 |
| Add KOL — account validation | 13 | 9 | 1 | 0 | 0 | 3 | 0 |
| Add KOL — duplicate detection | 8 | 6 | 1 | 0 | 0 | 1 | 0 |
| Add KOL — data collection | 14 | 4 | 5 | 0 | 0 | 5 | 0 |
| Add KOL — database save | 14 | 8 | 3 | 0 | 0 | 3 | 0 |
| **Total** | **153** | **61** | **43** | **0** | **2** | **32** | **15** |

**Nol item berstatus BROKEN** di seluruh audit. Tidak ditemukan tombol tanpa handler, endpoint salah alamat, validasi mock, atau handler yang melempar error. Setiap masalah yang ditemukan berbentuk salah satu dari tiga hal: *ketiadaan data di database*, *ketiadaan persistensi di frontend*, atau *janji UI yang melampaui yang dikerjakan backend*.

### Jawaban atas pertanyaan audit

> *Apakah Discovery dan Add KOL benar-benar bekerja sebagai satu sistem end-to-end, atau hanya terlihat terhubung di UI?*

**Benar-benar terhubung** — dan itu terbukti, bukan disimpulkan. Dua creator di roster produksi hari ini (`raditya_dika`, `sekata_ai`) membawa `source='manual_add'`, punya baris di lima lapisan database, dan jejak 9 langkah pipeline yang seluruhnya sukses. Rantai UI → API → Apify → raw → harmonisasi → silver → Discovery nyata dan berjalan.

Tiga hal yang membuat sambungan itu **satu arah dan sekali jalan**:

1. **Rantainya berhenti di L1 silver.** Lapisan gold — yang menjadi sumber hampir semua layar analitik — diisi proses di luar aplikasi, dengan lag 3,5 sampai 21 jam.
2. **Tidak ada jalan kembali.** Sekali ditambahkan, creator tidak pernah di-refresh otomatis. Itulah kenapa 0 dari 7.720 baris berstatus `Live` hari ini.
3. **Dua field yang dibutuhkan Discovery tidak pernah diisi Add KOL.** Kategori dan kota — keduanya adalah filter yang tersedia di UI, keduanya tidak akan pernah menemukan creator yang baru ditambahkan.

Bagian yang justru paling matang di seluruh alur adalah yang biasanya paling sering diabaikan: normalisasi input, pembedaan error permanen dari sementara, dedup yang tidak mempercayai kolom status yang tidak reliabel, transaksi identitas yang benar, UPDATE ber-COALESCE, dan log per langkah yang menyimpan bukti di mana sebuah proses mati.

---

## Catatan metode

Inventaris UI dibangun dengan mengekstrak setiap handler dari tiap komponen Discovery. Setiap filter ditelusuri UI → state → parameter → route → SQL → kolom, lalu coverage kolomnya dihitung dengan `SELECT COUNT(*)` langsung. Alur Add KOL ditelusuri dari tombol sampai lima lapisan tabel, dan diverifikasi terhadap **log eksekusi nyata** yang tersimpan di `add_kol_scrape_log` dan `add_kol_pipeline_log`, bukan hanya terhadap kode. Keberadaan stored procedure dikonfirmasi lewat `pg_proc`. Tidak ada endpoint, tabel, atau kolom yang dikarang: yang tidak ditemukan ditulis `NOT FOUND` atau `NOT AVAILABLE`. Tidak ada baris database yang diubah dan tidak ada file di `src/` yang disentuh.
