# Audit Discovery Filter System

**Tanggal audit:** 2026-09-04  
**Sifat audit:** read-only. Tidak ada kode dan tidak ada baris database yang diubah.  
**Cakupan:** hanya sistem filter di modul Discovery. Filter di luar Discovery tidak diaudit.

---

## 0. Peta permukaan filter

Discovery adalah satu route — `/organizations/[orgSlug]/discover` — dengan tab dan view di query string. Filter tersebar di **5 permukaan berbeda** yang memakai **3 sumber data berbeda** dan **2 database berbeda**. Ini bukan satu sistem filter, melainkan lima yang kebetulan hidup dalam satu modul.

| Permukaan | Route | Komponen | Endpoint | Database | Universe data | Cara filter |
| --- | --- | --- | --- | --- | ---: | --- |
| **A. Creator Database** | `?tab=directory&view=database` | `KolDirectoryFilters.tsx` + `KolDirectoryPage.tsx` | `/discover/kol-directory` | KOL (`kol` @ 10.100.14.216) | 7.720 baris aktif | **Server-side (SQL)** |
| **B. Tracked Accounts** | `?tab=directory&view=tracked` | `DiscoverDirectoryView.tsx` | `/discover/profiles` | Warehouse (`tsdb`) | 53 social_accounts / 23 org | **Client-side penuh** |
| **C. My Creators** | `?tab=directory&view=mine` | `CreatorRoster.tsx` | `/discover/creators` | Warehouse (`tsdb`) | 4 baris / 1 org | **Server-side (SQL)** |
| **D. Smart Discovery** | `?tab=directory&view=smart` | `SmartDiscovery.tsx` | `/discover/creators/similar` | KOL + Warehouse | 7.720 kandidat | Server-side + filter memori |
| **E. Discovery Hub** | `?tab=directory` (tanpa view) | `DiscoverHub.tsx` | `/discover/kol-directory` | KOL | — | Meneruskan `q` ke A |

**Sidebar filter yang dimaksud pertanyaan** — panel 248px sticky dengan section accordion — adalah **Permukaan A**. Panel di Permukaan B punya bentuk mirip tapi isi, sumber data, dan cara kerjanya sama sekali berbeda.

### Total filter yang ditemukan: **63**

| Permukaan | Jumlah filter |
| --- | ---: |
| A. Creator Database (sidebar 17 + toolbar 4 + preset 8) | 29 |
| B. Tracked Accounts | 19 |
| C. My Creators | 8 |
| D. Smart Discovery | 6 |
| E. Discovery Hub | 1 |
| **Total** | **63** |

---

## 1. Metodologi & basis angka

Setiap filter diperiksa dari empat lapis, berurutan, dan tidak ada satu pun yang dianggap berfungsi hanya karena kontrolnya tampil:

1. **UI Layer** — dibaca langsung dari source: jenis kontrol, daftar opsi, apakah opsi hardcoded atau dinamis, state disabled.
2. **Filter Logic Layer** — state React, fungsi filter, debounce, apakah client-side atau dikirim ke server, perilaku reset.
3. **Backend / API Layer** — endpoint, parameter yang benar-benar dibaca route, validasi, dan SQL yang dihasilkan.
4. **Database Layer** — tabel, kolom, join, lalu **query hitung nyata** untuk coverage.

### Denominator yang dipakai

| Permukaan | Denominator | Angka | Dari query |
| --- | --- | ---: | --- |
| A, D | Baris aktif di roster komersial | **7.720** | `SELECT COUNT(*) FROM public.kol_directory WHERE directory_status='active'` |
| B | Akun sosial di warehouse (semua org) | **53** | `SELECT COUNT(*) FROM public.social_accounts` |
| C | Creator milik org di warehouse | **4** | `SELECT COUNT(*) FROM public.discover_creators` |

Seluruh baris `kol_directory` berstatus `active` (tidak ada nilai `directory_status` lain), sehingga 7.720 sekaligus total tabel.

### Coverage kolom sumber (hasil query, bukan perkiraan)

| Kolom / sumber | Terisi | Coverage | Dipakai filter |
| --- | ---: | ---: | --- |
| `kol_directory.platform_id` | 7.496 | 7.496 / 7.720 = 97,1% | Platform |
| `kol_directory.followers_count` | 7.498 | 7.498 / 7.720 = 97,1% | Min. followers, Tier, Sort |
| `kol_directory.profile_url` | 7.498 | 7.498 / 7.720 = 97,1% | — (tampilan) |
| `kol_directory.username` | 7.498 | 7.498 / 7.720 = 97,1% | Search |
| band `kol_tiers` cocok | 7.194 | 7.194 / 7.720 = 93,2% | Tier |
| `kol_directory.category_ids`/`category_id` | 4.174 | 4.174 / 7.720 = 54,1% | Category |
| `kol_directory.engagement_rate` | 1.756 | 1.756 / 7.720 = 22,7% | Min. engagement, preset ER |
| `kol_directory.verified_status` (non-NULL) | 931 | 931 / 7.720 = 12,1% | Verified only |
| `kol_directory.verified_status` = verified | 454 | 454 / 7.720 = 5,9% | Verified only (hasil aktual) |
| `kol_directory.avatar_url` | 931 | 931 / 7.720 = 12,1% | — (tampilan) |
| `kol_directory.bio` | 902 | 902 / 7.720 = 11,7% | — (tidak dicari) |
| `kol_directory.creator_city` | 0 | 0 / 7.720 = 0,0% | Creator location, Smart Discovery Location |
| `l1_silver.unified_rate_card.fee` | 0 | 0 / 7.720 = 0,0% | Max. rate card, Cost Efficient, Campaign Ready |
| `public.campaign_kols` | 0 | 0 / 7.720 = 0,0% | Min. campaigns |
| `l2_gold.audience_demographics_daily` (gender) | 23 | 23 / 7.720 = 0,3% | Major Female/Male % |
| `l2_gold.audience_geo_daily` | 23 | 23 / 7.720 = 0,3% | Audience location |
| `l2_gold.audience_demographics_daily` (age) | 0 | 0 / 7.720 = 0,0% | Audience Age |

Tabel rate card diperiksa kelimanya, semuanya kosong: `l1_silver.unified_rate_card` 0, `l0_harmonization.instagram_rate_card` 0, `l0_harmonization.tiktok_rate_card` 0, `l0_extra.ig_rate_card` 0, `l0_extra.tt_rate_card` 0. Di warehouse, `public.discover_rate_cards` juga 0 baris (`public.discover_roster_rate_cards` punya 2 baris — lihat temuan P0-2).

### Klasifikasi status

| Status | Dipakai saat |
| --- | --- |
| 🟢 **YES** | UI ada, logic jalan, API mendukung, DB punya kolom, coverage memadai, mapping konsisten |
| 🟡 **PARTIAL** | Filter jalan tapi terbatas — coverage rendah, opsi UI tidak lengkap, atau sebagian logic tidak aktif |
| 🟠 **MISMATCH** | UI menjanjikan satu hal, backend/DB melakukan hal lain — termasuk filter yang menyaring nilai hasil generator |
| 🔴 **NOT AVAILABLE** | Tidak ada sumber data, tidak ada kolom, atau kontrol dirender disabled |

---

## 2. Tabel audit

Tabel lengkap 13 kolom tersedia di `discovery-filter-audit.csv`. Di bawah ini tabel yang sama dipecah per permukaan agar terbaca; kolom `Notes` dipindah ke bawah setiap tabel karena isinya panjang.

### A. Creator Database (sidebar)

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Platform** | Chips (single-select) | All Platform / Instagram / TikTok — daftar hardcoded `PLATFORMS`; angka count dinamis dari facets | Menyaring roster ke satu platform | GET /discover/kol-directory?platform=instagram → SQL `b.platform = $2` | `public.kol_directory → public.platforms` | `platform_id → key` | Ya | 7.496 / 7.720 = 97,1% | Param dikirim ke API, backend menerapkan WHERE. Count per chip diisi dari facets sesudah paint pertama. | YES | 🟢 YES |
| 2 | **Tier** | Chips (single-select), muncul hanya setelah Platform dipilih | All tiers + 5 band dinamis dari `kol_tiers` (Nano 1K–9.999, Micro 10K–49.999, Mid-tier 50K–99.999, Macro 100K–999.999, Mega 1M+) | Menyaring creator ke satu band follower | GET ...?tier=Micro → SQL `b.tier = ANY($4)` | `public.kol_directory ⋈ public.kol_tiers` | `followers_count BETWEEN min_followers AND max_followers → t.name` | Ya | 7.194 / 7.720 = 93,2% | Server-side. Count di tiap band roster-wide, bukan per platform yang sedang dipilih. | PARTIAL | 🟡 PARTIAL |
| 3 | **Format** | Chips (multi-select) — DIRENDER DISABLED | Instagram: All formats/Feed Post/Reels/Story/Carousel/Content · TikTok: All formats/Video/Photo — Hardcoded `FORMATS` | Menyaring creator berdasarkan format konten yang paling sering dipakai | No API integration — `onClick={() => {}}` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / 7.720 = 0% | Chip dirender `disabled` dengan teks alasan di bawahnya. Klik tidak melakukan apa-apa dan tidak ada network request. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 4 | **Min. followers** | Range Slider (12 langkah indeks) | 0 / 1K / 5K / 10K / 25K / 50K / 100K / 250K / 500K / 1M / 5M / 10M — Hardcoded `FOLLOWER_STEPS` | Menampilkan hanya creator dengan follower ≥ nilai slider | GET ...?follMin=1000000 → SQL `b.followers >= $9` | `public.kol_directory` | `followers_count` | Ya | 7.498 / 7.720 = 97,1% | Server-side. Slider menyimpan indeks, nilai absolut dikirim ke API. | PARTIAL | 🟡 PARTIAL |
| 5 | **Min. engagement** | Range Slider (0–10, step 0,1) | 0%–10% — Hardcoded | Menampilkan hanya creator dengan engagement rate ≥ nilai slider | GET ...?minEr=3 → SQL `b.er_pct >= $5` | `public.kol_directory` | `engagement_rate (satuan persen)` | Sebagian | 1.756 / 7.720 = 22,7% | Server-side. Absent ≠ 0 sudah ditangani benar di route (`num()` mengembalikan null untuk param kosong). | PARTIAL | 🟡 PARTIAL |
| 6 | **Max. rate card** | Range Slider (12 langkah indeks) | 0 / 500rb / 1jt / 2,5jt / 5jt / 10jt / 25jt / 50jt / 100jt / 250jt / 500jt / 1mlr — Hardcoded `RATE_STEPS` | Menampilkan hanya creator yang punya minimal satu deliverable dengan fee ≤ plafon | GET ...?maxRate=5000000 → SQL `EXISTS (... JOIN l1_silver.unified_rate_card u ... u.fee <= $11)` | `public.kol_social_account ⋈ l1_silver.unified_rate_card` | `u.fee` | Tidak | 0 / 7.720 = 0% | Query jalan dan valid, tapi `l1_silver.unified_rate_card` berisi 0 baris. Setiap kali slider digeser dari Any, grid langsung kosong total. | MISMATCH | 🟠 MISMATCH |
| 7 | **Audience — Age (top audience group)** | Chips (multi-select) — DIRENDER DISABLED | All / 13–17 / 18–24 / 25–34 / 35–44 / 45–54 / 55+ — Hardcoded `AGE_BANDS` | Menyaring creator berdasarkan kelompok umur audiens dominan | No API integration | `l2_gold.audience_demographics_daily` | `audience_type='age' — TIDAK ADA BARIS` | Tidak | 0 / 7.720 = 0% | Chip disabled, klik no-op. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 8 | **Audience — Major Female (%)** | Range Slider — DIRENDER DISABLED | 0–100%, value dipaku 0 | Menampilkan hanya creator dengan audiens perempuan ≥ N% | No API integration — `onChange={() => {}}` | `l2_gold.audience_demographics_daily` | `dimension_key='female'` | Sebagian | 23 / 7.720 = 0,3% | Slider disabled, value dipaku 0, onChange kosong. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 9 | **Audience — Major Male (%)** | Range Slider — DIRENDER DISABLED | 0–100%, value dipaku 0 | Menampilkan hanya creator dengan audiens laki-laki ≥ N% | No API integration | `l2_gold.audience_demographics_daily` | `dimension_key='male'` | Sebagian | 23 / 7.720 = 0,3% | Slider disabled, value dipaku 0, onChange kosong. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 10 | **Category** | Chips (single-select) | All + 28 kategori dinamis dari facets (Lifestyle 2.522, Beauty 1.271, Moms 581, Entertainment 476, Gen Z 150, dst.) | Menyaring creator ke satu kategori | GET ...?category=Beauty → SQL `$3 = ANY (b.categories)` | `public.kol_directory ⋈ public.kol_categories` | `COALESCE(category_ids, ARRAY[category_id]) → kc.name` | Sebagian | 4.174 / 7.720 = 54,1% | Server-side, opsi dinamis dari DB. Kolom lama `category_id` dan kolom baru `category_ids` dibaca dua-duanya. | YES | 🟡 PARTIAL |
| 11 | **Location — Creator location** | Select — DIRENDER DISABLED | Hanya satu opsi: 'All cities' — Hardcoded | Menyaring creator berdasarkan kota domisili | No API integration | `public.kol_directory` | `creator_city` | Tidak | 0 / 7.720 = 0% | Select dirender disabled karena tidak ada kota yang bisa jadi pilihan. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 12 | **Location — Audience location** | Select — DIRENDER DISABLED | Hanya satu opsi: 'All cities' — Hardcoded | Menyaring creator berdasarkan lokasi pengikut | No API integration | `l2_gold.audience_geo_daily` | `geo_key / geo_level` | Sebagian | 23 / 7.720 = 0,3% | Select dirender disabled. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 13 | **Other — Min. authenticity** | Range Slider — DIRENDER DISABLED | 0–100, value dipaku 0 | Menampilkan hanya creator dengan skor autentisitas ≥ N | No API integration | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / 7.720 = 0% | Slider disabled, onChange kosong. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 14 | **Other — Min. brand fit** | Range Slider — DIRENDER DISABLED | 0–100, value dipaku 0 | Menampilkan hanya creator dengan skor kecocokan brand ≥ N | No API integration | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / 7.720 = 0% | Slider disabled, onChange kosong. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 15 | **Other — Max. paid ratio** | Range Slider — DIRENDER DISABLED | 0–100%, value dipaku 100 | Menampilkan hanya creator dengan porsi konten berbayar ≤ N% | No API integration | `l2_gold.post_metric` | `is_sponsored` | Tidak | 30 / 7.720 = 0,4% | Slider disabled, onChange kosong. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 16 | **Other — Min. campaigns** | Range Slider — DIRENDER DISABLED | 0–15, value dipaku 0 | Menampilkan hanya creator yang pernah menjalankan ≥ N campaign | No API integration | `public.campaign_kols` | `campaign_id (count per kol)` | Tidak | 0 / 7.720 = 0% | Slider disabled, onChange kosong. | NOT AVAILABLE | 🔴 NOT AVAILABLE |
| 17 | **Verified creators only** | Toggle (switch) | on / off | Menampilkan hanya creator berstatus terverifikasi | GET ...?verified=1 → SQL `LOWER(COALESCE(verified_status,'')) IN ('verified','true','yes')` | `public.kol_directory` | `verified_status` | Sebagian | 454 / 7.720 = 5,9% (non-NULL: 931 = 12,1%) | Server-side. Menyala → hasil turun dari 7.720 ke 454 baris. | PARTIAL | 🟡 PARTIAL |

**Catatan teknis:**

* **1. Platform** — 224 baris aktif punya platform_id NULL dan tidak akan pernah muncul saat platform dipilih. Tabel `platforms` hanya berisi instagram+tiktok, jadi daftar hardcoded cocok dengan DB.
* **2. Tier** — 526 baris aktif tidak masuk band manapun (follower < 1.000 atau NULL) dan hilang dari semua pilihan tier. Angka count di samping band tidak ikut menyempit saat platform dipilih, jadi 'Micro 2.942' tetap tampil walau platform Instagram hanya punya sebagian darinya.
* **3. Format** — Tidak ada kolom format konten di `kol_directory` maupun tabel lain di database KOL pada level creator. `l2_gold.content_format_daily` punya media_type tapi hanya untuk 30 akun, bukan 7.720.
* **4. Min. followers** — Langkah tertinggi 10 juta sementara follower tertinggi di roster 685.896.635. 25 creator berada di atas 10M dan tidak bisa dipisahkan satu sama lain oleh slider ini.
* **5. Min. engagement** — 77,3% roster punya engagement_rate NULL, jadi menggeser slider satu tik saja langsung membuang 5.964 creator. Teks peringatan sudah ada di UI. Nilai maksimum di DB 223,41% — di luar jangkauan slider dan tidak masuk akal sebagai ER.
* **6. Max. rate card** — Teks di bawah slider mengklaim 'Rate card ada untuk 7.230 dari 7.718 creator'. Kelima tabel rate card di database KOL (`l1_silver.unified_rate_card`, `l0_harmonization.instagram_rate_card`, `tiktok_rate_card`, `l0_extra.ig_rate_card`, `tt_rate_card`) semuanya 0 baris. Angka 7.230 hardcoded di KolDirectoryFilters.tsx:355 dan tidak pernah dihitung dari DB.
* **7. Audience — Age (top audience group)** — Tabel `audience_demographics_daily` hanya menyimpan `audience_type='gender'` (69 baris total). Tidak ada satu pun baris umur untuk creator manapun.
* **8. Audience — Major Female (%)** — Teks UI bilang 'Roster KOL tidak menyimpan data audiens' — sekarang tidak akurat: 23 akun punya baris gender nyata. Tapi sampelnya 100 unit per akun dengan 61–85 di antaranya 'unknown', jadi tetap terlalu tipis untuk jadi filter.
* **9. Audience — Major Male (%)** — Sama dengan Major Female — sumbernya ada tapi hanya untuk 23 akun yang sama.
* **10. Category** — 45,9% roster tidak punya kategori sama sekali dan hilang begitu kategori apapun dipilih. Distribusi sangat timpang: 2 kategori teratas menampung 91% dari yang berkategori, 11 kategori punya ≤3 creator.
* **11. Location — Creator location** — Kolom `creator_city` ada di schema tapi NULL/kosong untuk seluruh 7.720 baris aktif. UI sudah jujur menyebutkan ini.
* **12. Location — Audience location** — Teks UI bilang 'Lokasi audiens tidak punya kolom sama sekali' — tidak akurat: `audience_geo_daily` ada dan berisi country+city untuk 23 akun. Tetap tidak layak jadi filter karena 84–97% sampelnya 'unknown'.
* **13. Other — Min. authenticity** — Tidak ada kolom autentisitas / deteksi follower palsu di manapun dalam database KOL.
* **14. Other — Min. brand fit** — Tidak ada kolom brand fit. `feature.brand_fit_analysis` ada sebagai tabel tapi bukan sumber yang dipakai filter ini dan tidak terhubung ke `kol_directory`.
* **15. Other — Max. paid ratio** — `is_sponsored` ada di post_metric tapi hanya 30 akun punya baris post sama sekali, dan masing-masing dibatasi 10 post — tidak cukup untuk menghitung rasio paid tingkat creator.
* **16. Other — Min. campaigns** — `public.campaign_kols` dan `public.campaigns` dua-duanya 0 baris. UI sudah menyebutkan ini dengan benar.
* **17. Verified creators only** — 6.789 baris punya verified_status NULL — belum pernah dicek, bukan 'tidak terverifikasi' — dan ikut tersembunyi. Nilai yang benar-benar ada di DB hanya 'verified' (454) dan 'unverified' (477); mapping backend menerima 'true'/'yes' yang tidak pernah muncul. Perlu dicatat juga: kolom ini berkonflik dengan `l1_silver.unified_profile.is_verified` yang false untuk semua akun.

### A. Creator Database (toolbar)

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | **Search (kotak pencarian)** | Text Input + debounce 350ms | Teks bebas | Mencari creator berdasarkan nama/handle | GET ...?q=raffi → SQL `b.username ILIKE '%' \|\| $1 \|\| '%'` | `public.kol_directory` | `username` | Ya | 7.498 / 7.720 = 97,1% | Server-side dengan debounce 350ms, reset ke halaman 1. `%` dan `_` di-escape jadi literal. | PARTIAL | 🟡 PARTIAL |
| 19 | **Category quick-chips** | Chips (single-select), 6 teratas | 6 kategori dengan count tertinggi dari facets | Pintasan untuk filter Category di sidebar | Sama dengan filter Category — `category=` | `public.kol_directory ⋈ public.kol_categories` | `category_ids → kc.name` | Sebagian | 4.174 / 7.720 = 54,1% | Berbagi state dengan sidebar; menekan chip mengubah filter yang sama. | YES | 🟡 PARTIAL |
| 20 | **Sort** | Dropdown (single-select) | Followers / Engagement / Last updated / Name — Hardcoded `SORTOPTS` | Mengurutkan hasil | GET ...?sort=followers&dir=desc → `ORDER BY <SCRAPED_FIRST>, col DIR NULLS LAST` | `public.kol_directory` | `followers_count / engagement_rate / last_refreshed_at / username` | Ya | 97,1% / 22,7% / 97,1% / 97,1% | Server-side. Setiap urutan selalu didahului grup provenance (Live → Calculated → Estimated). | PARTIAL | 🟡 PARTIAL |
| 21 | **Saved lists** | Dropdown + Text Input (simpan/terapkan) | Daftar yang dibuat user sendiri | Menyimpan kombinasi query+filter dan menerapkannya lagi | Client-side only — `localStorage['autometric.kolDirectory.lists.<orgId>']` | `NOT FOUND` | `NOT FOUND` | Tidak | Unknown (per-browser) | Disimpan hanya di localStorage browser. Tidak ada request ke API dan tidak ada tabel penyimpan. | NOT AVAILABLE | 🟡 PARTIAL |

**Catatan teknis:**

* **18. Search (kotak pencarian)** — Hanya mencocokkan `username`. Nama asli creator tersimpan di `agency_kol_accounts.label` untuk 7.684 baris dan tidak ikut dicari — mengetik 'Raffi Ahmad' mengembalikan 0 hasil padahal @raffinagita1717 ada di roster. Bio juga tidak dicari.
* **19. Category quick-chips** — Sengaja tidak dihitung di badge 'jumlah filter aktif' (`activeFilterCount` mengecualikan category) supaya tidak terhitung dua kali — konsisten, tapi berarti badge bisa menunjukkan 0 padahal grid sedang tersaring kategori.
* **20. Sort** — Backend mendukung kunci kelima `created` (`created_at`) yang tidak diekspos di dropdown — hanya dipakai shelf 'Recently added' di Hub. Karena `SCRAPED_FIRST` selalu jadi kunci pertama dan 0 baris berstatus Live, urutan efektifnya adalah 27 baris Calculated dulu, baru 7.693 Estimated.
* **21. Saved lists** — Berfungsi penuh untuk satu browser, tapi hilang saat ganti perangkat, ganti browser, atau clear site data. Tidak bisa dibagi antar anggota tim.

### A. Creator Database (preset)

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22 | **Preset: Best Performing** | Chip (single-select, toggle) | Hardcoded — 8 preset di `CREATOR_PRESETS` | Engagement di atas 3%, diurutkan dari skor kualitas tertinggi | Set `erMin: 3` → dikirim sebagai `minEr=3`; ranking `s.quality` client-side | `public.kol_directory` | `engagement_rate` | Sebagian | 219 / 7.720 = 2,8% | Filter server-side jalan benar. Ranking-nya dihitung ulang hanya atas 12 baris halaman yang sedang dimuat, memakai `quality` dari generator ber-seed. | PARTIAL | 🟡 PARTIAL |
| 23 | **Preset: High Engagement** | Chip (single-select, toggle) | Hardcoded | Engagement rate terukur di atas 4% — angka nyata dari platform | Set `erMin: 4` → `minEr=4`; ranking `erPct` client-side | `public.kol_directory` | `engagement_rate` | Sebagian | 178 / 7.720 = 2,3% | Filter server-side jalan, ranking memakai nilai terukur. | YES | 🟡 PARTIAL |
| 24 | **Preset: Fast Growing** | Chip (single-select, toggle) | Hardcoded | Diurutkan dari pertumbuhan follower bulanan tertinggi | `filters: {}` — TIDAK ADA parameter API. Ranking `s.growthMonthly` client-side | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / 7.720 = 0% | Menekan chip tidak mengubah query apapun. Yang terjadi hanya 12 baris di halaman aktif diurutkan ulang memakai angka pertumbuhan hasil generator ber-seed. | MISMATCH | 🟠 MISMATCH |
| 25 | **Preset: High Audience Quality** | Chip (single-select, toggle) | Hardcoded | Diurutkan dari skor kualitas audiens dan authenticity | `filters: {}` — TIDAK ADA parameter API. Ranking `(audienceQuality + authenticity)/2` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / 7.720 = 0% | Sama seperti Fast Growing: hanya menata ulang 12 baris halaman aktif dengan angka hasil generator. | MISMATCH | 🟠 MISMATCH |
| 26 | **Preset: Best Brand Fit** | Chip (single-select, toggle) | Hardcoded | Diurutkan dari kecocokan konten dan audiens dengan brand | `filters: {}` — TIDAK ADA parameter API. Ranking `s.brandFit` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / 7.720 = 0% | Hanya menata ulang 12 baris halaman aktif dengan `brandFit` hasil generator. | MISMATCH | 🟠 MISMATCH |
| 27 | **Preset: Emerging Creators** | Chip (single-select, toggle) | Hardcoded | Di bawah 100rb follower, diurutkan dari pertumbuhan tercepat | `filters: {}` — TIDAK ADA parameter API. Ranking memberi 0 ke creator ≥100rb follower | `public.kol_directory (hanya untuk followers)` | `followers_count` | Tidak | 0 / 7.720 = 0% | Batas 100rb follower TIDAK dikirim ke server. Grid tetap diurutkan followers desc, jadi baris teratas justru creator terbesar yang semuanya diberi rank 0. | MISMATCH | 🟠 MISMATCH |
| 28 | **Preset: Campaign Ready** | Chip (single-select, toggle) | Hardcoded | Terverifikasi dan sudah punya rate card — bisa langsung ditawar | Set `verifiedOnly: true` → `verified=1`; ranking `s.rateCount > 0 ? 100 : 0` | `public.kol_directory + l1_silver.unified_rate_card` | `verified_status + u.fee` | Sebagian | 454 / 7.720 = 5,9% (verified); 0 / 7.720 = 0% (rate card) | Separuh filternya jalan (verified), separuh lagi tidak: `rateCount` selalu 0 karena tabel rate card kosong, jadi seluruh hasil dapat rank 0 dan ranking-nya rata. | MISMATCH | 🟡 PARTIAL |
| 29 | **Preset: Cost Efficient** | Chip (single-select, toggle) | Hardcoded | Diurutkan dari biaya per 1.000 follower termurah — harga rate card nyata | `filters: {}` — TIDAK ADA parameter API. Ranking `cpmOf(s)` | `l1_silver.unified_rate_card` | `u.fee ÷ followers_count` | Tidak | 0 / 7.720 = 0% | `cpmOf()` mengembalikan null saat `rateFrom` falsy, dan `rateFrom` selalu null. Semua creator dapat rank 0, urutan grid tidak berubah sama sekali. | MISMATCH | 🟠 MISMATCH |

**Catatan teknis:**

* **22. Preset: Best Performing** — `quality` bersumber dari `sampleIntel()` di kolSample.ts — data demo deterministik, bukan pengukuran. Label preset menyebut 'skor kualitas' tanpa menandai bahwa skor itu dimodelkan (`basis: 'modelled'` ada di data tapi tidak ditampilkan di chip).
* **23. Preset: High Engagement** — Satu-satunya preset yang filter dan ranking-nya sama-sama dari data terukur. Tetap PARTIAL karena ranking hanya menata ulang 12 baris halaman aktif, bukan 178 baris hasil.
* **24. Preset: Fast Growing** — Tidak ada kolom pertumbuhan follower di `kol_directory`. `growthMonthly` seluruhnya berasal dari `sampleIntel()` — mulberry32 ber-seed id creator. Preset terlihat aktif (chip menyala, badge berubah) padahal tidak menyaring apa pun.
* **25. Preset: High Audience Quality** — `audienceQuality` dan `authenticity` dua-duanya dimodelkan. Tidak ada kolom autentisitas di database KOL, dan data audiens nyata (gender) hanya ada untuk 23 akun.
* **26. Preset: Best Brand Fit** — Tidak ada kolom brand fit dan tidak ada brand yang jadi acuan — preset tidak menerima parameter brand sama sekali, jadi 'kecocokan dengan brand' tidak punya lawan bicara.
* **27. Preset: Emerging Creators** — Ini yang paling menyesatkan dari delapan preset: deskripsi menjanjikan 'di bawah 100rb follower' tapi tanpa `follMin`/`follMax` di query, halaman pertama berisi creator ratusan juta follower. Seharusnya cukup ditambahkan batas atas follower ke `filters`.
* **28. Preset: Campaign Ready** — Deskripsi menjanjikan dua syarat, yang tercapai hanya satu. 'Sudah punya rate card' tidak pernah terpenuhi oleh siapa pun karena `unified_rate_card` 0 baris.
* **29. Preset: Cost Efficient** — Deskripsi secara eksplisit menyebut 'harga rate card nyata' padahal tidak ada satu pun harga di database KOL. Preset ini tidak melakukan apa-apa selain menyalakan chip.

### B. Tracked Accounts

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | **Pencarian (q)** | Text Input | Teks bebas | Mencari akun berdasarkan username atau nama brand | Client-side filter atas payload penuh dari GET /discover/profiles | `public.social_accounts / public.brands (warehouse)` | `username / b.name` | Ya | Semua akun ter-load (org-scoped) | Tidak ada network request per ketikan — seluruh roster org di-fetch sekali lalu difilter di memori. | YES | 🟢 YES |
| 31 | **Tipe akun** | Chips (single-select) | Semua / Brand / Kompetitor — Hardcoded | Memisahkan akun milik brand sendiri dari akun kompetitor | Client-side `a.relation !== filters.relation` | `public.brand_social_accounts / public.brand_competitors (warehouse)` | `relation (turunan SQL)` | Ya | 45 owned + 7 competitor links | Filter client-side atas nilai yang benar-benar dari SQL. | YES | 🟢 YES |
| 32 | **Platform** | Chips (single-select) | Dinamis dari akun yang ter-load | Menyaring akun ke satu platform | Client-side `a.platform !== filters.platform` | `public.social_accounts ⋈ public.platforms (warehouse)` | `platform_id → key` | Ya | Semua akun ter-load | Filter client-side atas nilai nyata; opsi chip diturunkan dari data yang ada. | YES | 🟢 YES |
| 33 | **Kategori** | Chips (single-select) | Fitness / Lifestyle / Beauty / Food / Tech / Fashion / Travel — Hardcoded `CATEGORIES` (vocab.ts) | Menyaring akun berdasarkan kategori konten | Client-side `p.category.value !== filters.category` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Filter memang menyaring, tapi nilai yang disaring dihasilkan `est(pick(seed,'cat',CATEGORIES))` — hash FNV-1a atas id akun. | MISMATCH | 🟠 MISMATCH |
| 34 | **Lifestyle** | Chips (single-select) | Urban Active / Family First / Health Conscious / Trend Seeker / Budget Savvy / Premium Buyer — Hardcoded `LIFESTYLES` | Menyaring akun berdasarkan lifestyle audiens | Client-side `p.lifestyle.value !== filters.lifestyle` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Menyaring nilai hasil hash `est(pick(seed,'life',LIFESTYLES))`. | MISMATCH | 🔴 NOT AVAILABLE |
| 35 | **Lokasi** | Chips (single-select) | Jakarta / Bandung / Surabaya / Medan / Yogyakarta / Bali / Makassar — Hardcoded `LOCATIONS` | Menyaring akun berdasarkan kota | Client-side `p.location.value !== filters.location` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Menyaring nilai hasil hash `est(pick(seed,'loc',LOCATIONS))`. | MISMATCH | 🔴 NOT AVAILABLE |
| 36 | **Tier** | Chips (single-select) | Nano / Micro / Mid-tier / Macro / Mega — Hardcoded `TIERS` | Menyaring akun berdasarkan band follower | Client-side `p.tier.value !== filters.tier` | `Turunan dari followers (yang sendirinya dimodelkan)` | `tierOf(followers)` | Sebagian | 0 / total akun = 0% (follower nyata) | `tier` ditandai `calc()` — dihitung dari `followers`, tapi `followers` sendiri `est()`: 'Diperkirakan dari rata-rata views (follower belum disinkronkan)'. | MISMATCH | 🟠 MISMATCH |
| 37 | **Umur dominan** | Chips (single-select) | 13-17 / 18-24 / 25-34 / 35-44 / 45-54 / 55+ — Hardcoded `AGE_BANDS` | Menyaring akun berdasarkan kelompok umur audiens terbesar | Client-side `p.topAge.value !== filters.age` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Menyaring `est(topAge)` dari distribusi umur hasil generator. | MISMATCH | 🔴 NOT AVAILABLE |
| 38 | **Gender mayoritas** | Chips (single-select) | Semua / Perempuan / Laki-laki — Hardcoded | Menampilkan hanya akun dengan audiens perempuan ≥50% atau laki-laki ≥50% | Client-side `p.genderSplit.value.female < 50` / `.male < 50` | `NOT FOUND (untuk akun warehouse)` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Ambang 50% diterapkan pada `est(genderSplit)` hasil generator. | MISMATCH | 🔴 NOT AVAILABLE |
| 39 | **Format konten** | Chips (single-select) | Dinamis dari format yang muncul di post akun ter-load | Menyaring akun berdasarkan format yang paling sering dipakai | Client-side `p.topFormat.value !== filters.format` | `l1_silver.unified_post (warehouse)` | `format / post_type` | Sebagian | 245 / 1.700 post = 14,4% punya kolom format | `topFormat` ditandai `live()` — dihitung dari post nyata milik akun. | PARTIAL | 🟡 PARTIAL |
| 40 | **Ambang: Followers** | Select (4 opsi) | Semua / ≥10K / ≥100K / ≥1M — Hardcoded `FOLLOWER_OPTS` | Menampilkan hanya akun dengan follower ≥ ambang | Client-side `p.followers.value < filters.followersMin` | `NOT FOUND (follower tidak disinkronkan)` | `diperkirakan dari avg views` | Tidak | 0 / total akun = 0% | Menyaring `est(followers)` — 'Diperkirakan dari rata-rata views (follower belum disinkronkan)'. | MISMATCH | 🟠 MISMATCH |
| 41 | **Ambang: Engagement rate** | Select (4 opsi) | Semua / ≥1% / ≥3% / ≥5% — Hardcoded `ER_OPTS` | Menampilkan hanya akun dengan ER ≥ ambang | Client-side `p.erPct.value < filters.erMin` | `l1_silver.unified_post (warehouse)` | `engagement per post ÷ views` | Ya | Dihitung dari post akun yang ada | `erPct` ditandai `live()` — rata-rata ER per post nyata. | YES | 🟢 YES |
| 42 | **Ambang: Est. reach** | Select (4 opsi) | Semua / ≥50K / ≥250K / ≥1M — Hardcoded `REACH_OPTS` | Menampilkan hanya akun dengan perkiraan reach ≥ ambang | Client-side `p.estimatedReach.value < filters.reachMin` | `l1_silver.unified_post (warehouse)` | `avg views × faktor reach` | Sebagian | Turunan dari views | `estimatedReach` ditandai `calc()` dengan basis 'Rata-rata views dikali faktor reach per akun'. | PARTIAL | 🟡 PARTIAL |
| 43 | **Ambang: Authenticity** | Select (4 opsi) | Semua / ≥75% / ≥85% / ≥90% — Hardcoded `AUTH_OPTS` | Menampilkan hanya akun dengan skor autentisitas ≥ ambang | Client-side `p.authenticity.value < filters.authMin` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Menyaring `est(authenticity)` hasil generator. | MISMATCH | 🔴 NOT AVAILABLE |
| 44 | **Ambang: Brand fit** | Select (4 opsi) | Semua / ≥50 / ≥65 / ≥80 — Hardcoded `FIT_OPTS` | Menampilkan hanya akun dengan skor brand fit ≥ ambang | Client-side `p.brandFit.value < filters.brandFitMin` | `Turunan campuran` | `audienceQuality 35% + authenticity 30% + ER 20% + konsistensi 15%` | Sebagian | Hanya komponen ER (20%) yang terukur | `brandFit` ditandai `calc()` dan formulanya ditampilkan di tooltip. | PARTIAL | 🟡 PARTIAL |
| 45 | **Ambang: Rasio paid** | Select (4 opsi) | Semua / ≤25% / ≤50% / ≤75% — Hardcoded `PAID_OPTS` | Menampilkan hanya akun dengan porsi konten berbayar ≤ ambang | Client-side `p.paidRatio.value > filters.paidMax` | `l1_silver.unified_post (warehouse)` | `penanda campaign/boosted per post` | Ya | Dihitung dari post akun yang ada | `paidRatio` ditandai `live()` — 'Bagian post bertanda campaign atau boosted'. | YES | 🟢 YES |
| 46 | **Hanya terverifikasi** | Toggle | on / off | Menampilkan hanya akun terverifikasi | Client-side `filters.verifiedOnly && !p.verified.value` | `NOT FOUND` | `NOT FOUND` | Tidak | 0 / total akun = 0% | Menyaring `est(rnd(seed,'ver') > 0.35)` — koin ber-seed dengan peluang menyala 65%. | MISMATCH | 🟠 MISMATCH |
| 47 | **Hanya yang punya rate card** | Toggle | on / off | Menampilkan hanya akun yang sudah punya harga | Client-side `filters.ratedOnly && !p.hasRate`; sumber `listRateCards(orgId)` | `public.discover_rate_cards (warehouse)` | `base_rate` | Tidak | 0 / total akun = 0% | `public.discover_rate_cards` berisi 0 baris, jadi `hasRate` selalu false dan toggle ini selalu mengosongkan grid. | MISMATCH | 🟠 MISMATCH |
| 48 | **Sort** | Select (10 opsi) | Best in campaign / Least in campaign / Best brand fit / Most followers / Highest reach / Highest ER / Most authentic / Highest EMV / Most posts / Name A–Z — Hardcoded `SORTS` | Mengurutkan hasil | Client-side `[...out].sort(cmp[filters.sort])` | `Campuran` | `campuran live/calculated/estimated` | Sebagian | 3 dari 10 kunci terukur (ER, posts, name) | Diurutkan di memori setelah filter. Default-nya `brandFit` — kunci yang dimodelkan. | PARTIAL | 🟡 PARTIAL |

**Catatan teknis:**

* **30. Pencarian (q)** — Aman karena jumlah akun per org kecil (53 social_accounts di 23 org). Pola ini tidak akan skala kalau sumbernya diganti ke roster 7.720.
* **31. Tipe akun** — Salah satu dari sedikit filter di layar ini yang bekerja atas data nyata.
* **32. Platform** — Opsi dinamis, jadi tidak mungkin muncul platform yang tidak punya akun.
* **33. Kategori** — Kategori tidak dibaca dari kolom manapun. Grup ini ditandai `estimated` di UI dan basis-nya berbunyi 'Belum ada klasifikasi konten — dimodelkan', tapi filternya tetap bisa dipakai dan hasilnya terlihat seperti hasil penyaringan sungguhan. Bandingkan dengan Creator Database yang punya 28 kategori nyata dari DB — dua layar dalam modul yang sama memakai taksonomi berbeda.
* **34. Lifestyle** — Tidak ada kolom lifestyle di warehouse maupun database KOL. Seluruh taksonomi ini hanya ada di vocab.ts.
* **35. Lokasi** — Tujuh kota hardcoded. Tidak ada kolom lokasi pada `social_accounts`; `kol_directory.creator_city` di database sebelah juga 0/7.720.
* **36. Tier** — Rantai turunannya menyesatkan: band tier terlihat seperti hasil hitungan (`calculated`) padahal input-nya perkiraan. Nama band-nya sama persis dengan `kol_tiers` di database KOL, sehingga mudah dikira sumbernya sama.
* **37. Umur dominan** — Tidak ada data umur audiens di kedua database. `l2_gold.audience_demographics_daily` hanya punya gender.
* **38. Gender mayoritas** — Data gender audiens nyata memang ada, tapi di database KOL untuk 23 akun roster — bukan untuk akun brand/kompetitor yang jadi isi layar ini.
* **39. Format konten** — Nilainya nyata, tapi hanya 245 dari 1.700 baris `unified_post` punya `format`; sisanya jatuh ke fallback 'Post'. Akun tanpa post sama sekali akan selalu ber-format 'Post'.
* **40. Ambang: Followers** — Follower adalah metrik paling dasar dan paling mudah dipercaya user, tapi di layar ini nilainya perkiraan dari views. Di Creator Database follower-nya nyata (97,1%) — dua layar, dua arti untuk kata yang sama.
* **41. Ambang: Engagement rate** — Nilai terukur. Akun tanpa post akan ber-ER 0 dan otomatis tersaring keluar oleh ambang manapun — perilaku ini benar tapi tidak dijelaskan di UI.
* **42. Ambang: Est. reach** — Turunan, bukan reach terukur — `reach` asli NULL di seluruh medallion. Ditandai `calculated` di UI, jadi jujur, tapi ambangnya (≥1M reach) mudah dikira angka platform.
* **43. Ambang: Authenticity** — Basis di UI berbunyi 'Deteksi follower palsu belum tersedia — dimodelkan'. Ambang seperti '≥90%' memberi kesan presisi yang tidak dimiliki angkanya.
* **44. Ambang: Brand fit** — Formulanya transparan, tapi 80% bobotnya berasal dari komponen yang dimodelkan (audienceQuality dan authenticity). Hanya bagian ER yang nyata.
* **45. Ambang: Rasio paid** — Nilai terukur dari post nyata.
* **46. Hanya terverifikasi** — Ini paling berbahaya di antara filter yang dimodelkan: verified adalah fakta biner yang user anggap pasti benar, tapi di sini ditentukan hash id akun. Basis-nya berbunyi 'Status verifikasi belum disinkronkan' dan hanya terlihat lewat tooltip badge.
* **47. Hanya yang punya rate card** — Tabelnya ada dan query-nya benar, datanya yang belum pernah diisi. Efeknya sama dengan 'Max. rate card' di Creator Database: dinyalakan → 0 hasil, tanpa penjelasan apa pun di UI.
* **48. Sort** — Urutan default layar ini adalah 'Best brand fit', yaitu skor yang 80% dimodelkan. Baris teratas yang dilihat user pertama kali ditentukan sebagian besar oleh generator.

### C. My Creators

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 49 | **Pencarian (q)** | Text Input + debounce | Teks bebas | Mencari creator milik org | GET /discover/creators?q= → SQL `(username ILIKE $n OR display_name ILIKE $n)` | `public.discover_creators (warehouse)` | `username, display_name` | Ya | 4 / 4 = 100% | Server-side. Mencari username DAN display_name — lebih lengkap dari Creator Database. | YES | 🟢 YES |
| 50 | **Platform** | Select | Dinamis dari facets org | Menyaring creator org ke satu platform | GET ...?platform= → SQL `platform = $n` | `public.discover_creators (warehouse)` | `platform` | Ya | 4 / 4 = 100% (semuanya instagram) | Server-side, opsi dari facets. | YES | 🟢 YES |
| 51 | **Kategori** | Select | Dinamis dari facets org | Menyaring creator org ke satu kategori | GET ...?category= → SQL `category = $n` | `public.discover_creators (warehouse)` | `category` | Tidak | 0 / 4 = 0% | Server-side dan benar, tapi dropdown-nya kosong karena facets tidak mengembalikan kategori apa pun. | YES | 🔴 NOT AVAILABLE |
| 52 | **Location** | Select | Dinamis dari facets org (`cityOptions`) | Menyaring creator org berdasarkan kota | GET ...?city= → SQL `city = $n` | `public.discover_creators (warehouse)` | `city` | Tidak | 0 / 4 = 0% | Server-side dan benar, dropdown kosong. | YES | 🔴 NOT AVAILABLE |
| 53 | **Tier** | Select | Dinamis dari facets org | Menyaring creator org ke satu band follower | GET ...?tier= → SQL `tier = $n` | `public.discover_creators (warehouse)` | `tier` | Ya | 4 / 4 = 100% | Server-side, opsi dari facets. | YES | 🟢 YES |
| 54 | **Status profiling** | Select | Dinamis dari data | Menyaring creator berdasarkan status profiling | GET ...?status= → SQL `profiling_status = $n` | `public.discover_creators (warehouse)` | `profiling_status` | Ya | 4 / 4 = 100% (semuanya 'ready') | Server-side. | YES | 🟢 YES |
| 55 | **Followers** | Select (SelectPill) | Hardcoded `FOLLOWER_STEPS` | Menampilkan hanya creator dengan follower ≥ ambang | GET ...?follMin= → SQL `followers >= $n` | `public.discover_creators (warehouse)` | `followers` | Ya | 4 / 4 = 100% | Server-side. | YES | 🟢 YES |
| 56 | **Engagement** | Select (SelectPill) | Hardcoded `ER_STEPS` | Menampilkan hanya creator dengan ER ≥ ambang | GET ...?minEr= → SQL `er_pct >= $n` | `public.discover_creators (warehouse)` | `er_pct` | Sebagian | 3 / 4 = 75% | Server-side, dengan penjagaan `if (f.minErPct && f.minErPct > 0)` sehingga 0 tidak ikut jadi kondisi. | YES | 🟢 YES |

**Catatan teknis:**

* **49. Pencarian (q)** — Implementasi paling benar di antara semua kotak pencarian Discovery. Pola ini yang sebaiknya dipakai juga di Creator Database.
* **50. Platform** — Hanya ada satu platform di data (instagram), jadi filter ini praktis tidak punya efek sampai ada creator tiktok.
* **51. Kategori** — Kolomnya ada, query-nya benar, isinya NULL untuk keempat creator. Profiling belum pernah mengisi `category`.
* **52. Location** — Sama dengan Kategori: kolom ada, data tidak ada. Berbeda dengan Smart Discovery yang memaksa 7 kota hardcoded ke dropdown yang sama-sama tidak berdata.
* **53. Tier** — Berfungsi penuh atas data nyata.
* **54. Status profiling** — Semua creator berstatus 'ready', jadi filter ini belum pernah menyaring apa pun dalam praktik.
* **55. Followers** — Berfungsi penuh.
* **56. Engagement** — Satu creator ber-er_pct NULL akan hilang begitu ambang dipasang — perilaku yang sama dengan Creator Database dan memang benar.

### D. Smart Discovery

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 57 | **Reference creator (pencarian)** | Text Input + hasil klik | Hasil dari Creator Database | Memilih creator acuan untuk pencarian kemiripan | GET /discover/kol-directory?q=&pageSize=12 | `public.kol_directory` | `username` | Ya | 7.498 / 7.720 = 97,1% | Server-side lewat endpoint Creator Database. | YES | 🟢 YES |
| 58 | **Platform** | Select (SelectPill) | Dinamis / default mengikuti platform acuan | Membatasi kandidat ke satu platform | GET /discover/creators/similar?platform= → diteruskan ke listKolDirectory | `public.kol_directory → public.platforms` | `platform_id → key` | Ya | 7.496 / 7.720 = 97,1% | Server-side. | YES | 🟢 YES |
| 59 | **Tier** | Select (SelectPill) | Any tier / Nano / Micro / Mid-tier / Macro / Mega — Hardcoded `TIERS` (vocab.ts) | Membatasi kandidat ke satu band follower | GET ...?tier= → diteruskan sebagai `tiers: [tier]` | `public.kol_directory ⋈ public.kol_tiers` | `followers_count → t.name` | Ya | 7.194 / 7.720 = 93,2% | Server-side. | PARTIAL | 🟡 PARTIAL |
| 60 | **Location** | Select (SelectPill) | Any location / Jakarta / Bandung / Surabaya / Medan / Yogyakarta / Bali / Makassar — Hardcoded `LOCATIONS` | Membatasi kandidat ke satu kota | GET ...?city= → `.filter(c => (c.city ?? '').toLowerCase() === city)` | `public.kol_directory / public.discover_creators` | `creator_city / city` | Tidak | 0 / 7.720 = 0% | Filter dieksekusi di server tapi atas kolom yang seluruhnya NULL. Memilih kota apa pun → 0 kandidat, tanpa penjelasan. | MISMATCH | 🟠 MISMATCH |
| 61 | **Rate card** | Select (SelectPill) | Any rate card / Under 5 juta / Under 10 juta / Under 25 juta / Under 50 juta — Hardcoded `RATE_STEPS` | Membatasi kandidat ke yang harganya di bawah plafon | GET ...?maxRate= → diteruskan ke listKolDirectory `maxRate` | `l1_silver.unified_rate_card` | `u.fee` | Tidak | 0 / 7.720 = 0% | Memilih plafon apa pun → 0 kandidat, karena tabel rate card kosong. | MISMATCH | 🟠 MISMATCH |
| 62 | **Lower price than the reference** | Chip / Toggle | on / off | Hanya menampilkan kandidat yang lebih murah dari creator acuan | GET ...?cheaper=1 → `maxRate = reference.rateFrom - 1` | `l1_silver.unified_rate_card` | `u.fee` | Tidak | 0 / 7.720 = 0% | `reference.rateFrom` selalu null, sehingga cabang ini tidak pernah memasang plafon dan toggle-nya jadi no-op diam. | MISMATCH | 🔴 NOT AVAILABLE |

**Catatan teknis:**

* **57. Reference creator (pencarian)** — Mewarisi keterbatasan yang sama: hanya mencari username, bukan nama asli.
* **58. Platform** — Default-nya mengikuti platform creator acuan, yang merupakan perilaku yang tepat.
* **59. Tier** — Daftar tier di sini hardcoded di vocab.ts, sementara Creator Database mengambilnya dinamis dari `kol_tiers`. Kebetulan kelima namanya identik hari ini — kalau band di DB diubah/ditambah, layar ini tidak ikut berubah.
* **60. Location** — Dropdown menawarkan 7 kota yang tidak satu pun punya creator. Ini kebalikan dari Creator Database yang justru mendisable kontrol lokasinya karena tahu datanya kosong — dua layar mengambil keputusan berbeda atas kolom yang sama.
* **61. Rate card** — Masalah yang sama dengan 'Max. rate card' di Creator Database, tapi di sini tanpa teks peringatan sama sekali.
* **62. Lower price than the reference** — Berbeda dari dua filter rate card lain: yang ini tidak mengosongkan grid, tapi juga tidak melakukan apa-apa. Toggle menyala, hasil tidak berubah — user tidak punya cara tahu.

### E. Discovery Hub

| # | Filter | UI Control | Options / Values | Expected Behavior | API / Logic | DB Table | DB Column | Data Available | Coverage | Actual Behavior | UI/DB Match | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 63 | **Search box (hub)** | Text Input + submit | Teks bebas | Mengantar query ke Creator Database | Menulis `?q=` ke URL → di-seed ke `query` dan `search` KolDirectoryPage | `public.kol_directory` | `username` | Ya | 7.498 / 7.720 = 97,1% | Bukan filter tersendiri — hanya meneruskan query ke Creator Database. Di-seed ke dua state sekaligus agar tidak memicu dua request. | YES | 🟢 YES |

**Catatan teknis:**

* **63. Search box (hub)** — Implementasinya benar. Mewarisi keterbatasan pencarian username-only.

---

## 3. Audit Summary

| Status | Count | % dari 63 |
| --- | ---: | ---: |
| 🟢 YES | 15 | 24% |
| 🟡 PARTIAL | 17 | 27% |
| 🟠 MISMATCH | 13 | 21% |
| 🔴 NOT AVAILABLE | 18 | 29% |
| **Total** | **63** | **100%** |

Dipecah per permukaan. Kolom terakhir menggabungkan YES + PARTIAL, yaitu filter yang **benar-benar menyaring data nyata** — PARTIAL di sini berarti terbatas karena coverage, bukan salah:

| Permukaan | Total | 🟢 YES | 🟡 PARTIAL | 🟠 MISMATCH | 🔴 NOT AVAILABLE | Menyaring data nyata |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A. Creator Database | 29 | 1 | 12 | 6 | 10 | 13/29 = 45% |
| B. Tracked Accounts | 19 | 5 | 4 | 5 | 5 | 9/19 = 47% |
| C. My Creators | 8 | 6 | 0 | 0 | 2 | 6/8 = 75% |
| D. Smart Discovery | 6 | 2 | 1 | 2 | 1 | 3/6 = 50% |
| E. Discovery Hub | 1 | 1 | 0 | 0 | 0 | 1/1 = 100% |
| **Total** | **63** | **15** | **17** | **13** | **18** | **32/63 = 51%** |

Perlu dibaca hati-hati: Permukaan A hanya punya **1 status YES murni**, tapi **13 dari 29 filternya menyaring data nyata**. Selisih itu hampir seluruhnya soal coverage kolom sumber, bukan soal implementasi — SQL-nya benar, datanya yang belum lengkap. Sebaliknya Permukaan C punya rasio YES tertinggi (75%) tapi hanya bekerja atas 4 baris data.

Dipecah per kategori filter yang diminta:

| Kategori filter | Ada di UI | 🟢 YES | Catatan |
| --- | ---: | ---: | --- |
| **Basic Creator** (platform, kategori, tier, followers, ER, search) | 6 | 4 | Fondasi Discovery, semuanya server-side di Permukaan A |
| **Creator Profile** (gender, umur, lokasi, verifikasi) | 4 | 0 | Gender & umur creator tidak ada kontrolnya sama sekali; lokasi 0% data; verifikasi 5,9% |
| **Audience** (gender, umur, lokasi, interest, quality, authenticity) | 9 | 0 | Semua disabled di Permukaan A, semua dimodelkan di Permukaan B |
| **Content** (topic, format, style, personality, posting frequency) | 3 | 1 | Format disabled di A, dimodelkan-sebagian di B; style & personality tidak ada kontrolnya |
| **Performance** (ER, avg likes/comments/views, growth, score) | 7 | 2 | Hanya ER yang terukur; growth & performance score seluruhnya dimodelkan |
| **Advanced** (rate card, brand fit, paid ratio, campaigns, authenticity, preset) | 14 | 0 | Blok paling bermasalah — 8 preset + 6 kontrol lanjutan |

Filter yang **diminta tapi sama sekali tidak punya kontrol di UI manapun**: Gender creator, Umur creator, Audience Interest, Content Style, Creator Personality, Posting Frequency, Average Likes, Average Comments, Average Views, Performance Score. (`l2_gold.audience_interest_daily` ada di database dengan 23 akun, tapi tidak ada kontrol yang membacanya.)

---

## 4. Critical Findings

### P0 — Critical: filter terlihat aktif tetapi tidak bekerja

**P0-1 · Lima dari delapan preset tidak mengirim satu pun parameter ke server.**  
`CREATOR_PRESETS` di `src/lib/discover/creatorMatch.ts:306` mendefinisikan delapan preset. Lima di antaranya — `growing` (Fast Growing), `audience` (High Audience Quality), `brandfit` (Best Brand Fit), `emerging` (Emerging Creators), `value` (Cost Efficient) — punya `filters: {}`. Menekan chip-nya menyalakan badge dan mengubah judul hasil, tapi query ke API sama persis dengan sebelum ditekan. Yang berubah hanya urutan **12 baris halaman yang sedang dimuat** (`rankedRows` di `KolDirectoryPage.tsx:443` — `[...rows].sort(...)`, bukan re-query).

Dampak paling tajam ada di **Emerging Creators**, yang deskripsinya berbunyi *"Di bawah 100rb follower, diurutkan dari pertumbuhan tercepat"*. Karena batas 100rb tidak pernah sampai ke SQL dan urutan default tetap `followers DESC`, halaman pertama justru diisi creator ratusan juta follower — yang semuanya diberi rank 0 oleh fungsi ranking-nya sendiri. Preset melakukan kebalikan dari yang dijanjikan namanya.

**P0-2 · Setiap filter rate card mengosongkan hasil, karena semua tabel harga kosong.**  
Empat kontrol bergantung pada harga: `Max. rate card` (A), preset `Cost Efficient` dan `Campaign Ready` (A), `Rate card` dan `Lower price than the reference` (D), serta `Hanya yang punya rate card` (B). SQL-nya benar dan sudah dioptimasi (EXISTS, terukur 19ms), tapi `l1_silver.unified_rate_card` berisi **0 baris**, begitu juga empat tabel rate card lain di database KOL dan `public.discover_rate_cards` di warehouse.

Akibatnya: menggeser slider `Max. rate card` satu tik dari *Any* → grid kosong total, tanpa penjelasan. Menyalakan `Hanya yang punya rate card` → grid kosong total. Preset `Cost Efficient` → tidak melakukan apa-apa karena `cpmOf()` mengembalikan null untuk semua orang.

Yang memperburuk: harga **yang ditampilkan** di kartu dan di modal pricing datang dari tabel yang **berbeda** — `public.discover_roster_rate_cards` di warehouse (2 baris, override per-org). Jadi sebuah creator bisa punya harga yang terlihat di keranjang, tapi tetap tersaring keluar oleh filter `Max. rate card` yang membaca tabel lain. Kolom `Rate card` di tabel hasil membaca `rateFrom` (tabel kosong) sehingga selalu `—`.

**P0-3 · Teks di UI menyebut angka coverage yang tidak pernah dihitung dari database.**  
`KolDirectoryFilters.tsx:355` menampilkan kalimat *"Rate card ada untuk 7.230 dari 7.718 creator; memasang plafon harga menyembunyikan sisanya."* Angka 7.230 hardcoded dan salah — nilai sebenarnya **0**. Angka 7.718 juga sudah tertinggal; roster aktif sekarang 7.720. User yang membaca kalimat itu akan menyimpulkan filter harga aman dipakai, padahal filter itu menghapus 100% hasil.

**P0-4 · `Lower price than the reference` menyala tapi tidak berefek sama sekali.**  
Di `creatorSimilar.ts:360`, plafon hanya dipasang bila `reference.rateFrom` terisi. Karena selalu null, cabang itu tidak pernah jalan. Berbeda dari dua filter harga lain yang setidaknya *terlihat* rusak (hasil jadi kosong), yang ini gagal secara diam-diam: chip menyala, hasil tidak berubah, dan tidak ada cara bagi user untuk menyadarinya.

### P1 — High: mapping UI dan database berbeda

**P1-1 · Panel Tracked Accounts menyaring 11 atribut yang seluruhnya dihasilkan generator ber-seed.**  
`src/lib/discover/profile.ts` membangun `KolProfile` dengan hash FNV-1a atas id akun. Yang ditandai `est()` — **kategori, lifestyle, lokasi, verified, followers, ageSplit, topAge, generation, genderSplit, authenticity** — tidak dibaca dari kolom manapun. Sebelas kontrol filter di panel itu menyaring nilai-nilai tersebut.

Modul ini jujur secara arsitektur: setiap nilai membawa `Confidence`, grup filternya diberi badge `estimated`, dan basis-nya dijelaskan di tooltip. Tapi dua di antaranya tetap berisiko tinggi karena user tidak memperlakukannya sebagai perkiraan:

* **`Hanya terverifikasi`** — nilainya `rnd(seed,'ver') > 0.35`, yaitu koin ber-seed dengan peluang menyala 65%. Verified adalah fakta biner yang diasumsikan pasti benar.
* **`Ambang: Followers`** — `est(followers)` diperkirakan dari rata-rata views. Di Permukaan A, follower adalah angka nyata dengan coverage 97,1%. Dua layar dalam modul yang sama memakai kata "followers" untuk dua hal berbeda.

**P1-2 · Dua taksonomi kategori yang tidak pernah dipetakan satu sama lain.**  
Permukaan A memakai **28 kategori nyata** dari `public.kol_categories` (Lifestyle 2.522, Beauty 1.271, Moms 581, Entertainment 476, Gen Z 150, …), diambil dinamis lewat facets. Permukaan B memakai **7 kategori hardcoded** di `vocab.ts` (Fitness, Lifestyle, Beauty, Food, Tech, Fashion, Travel). Hanya 4 nama yang beririsan, dan yang beririsan pun tidak menunjuk data yang sama. Tidak ada tabel atau fungsi mapping di antara keduanya.

**P1-3 · Smart Discovery menawarkan 7 kota untuk kolom yang 0% terisi.**  
Dropdown `Location` di Permukaan D memakai `LOCATIONS` hardcoded (Jakarta, Bandung, Surabaya, Medan, Yogyakarta, Bali, Makassar) dan meneruskannya ke filter atas `creator_city`, yang NULL untuk seluruh 7.720 baris. Memilih kota apa pun → 0 kandidat.

Permukaan A menghadapi kolom yang **persis sama** dan mengambil keputusan yang berbeda: kontrolnya dirender disabled dengan penjelasan *"Kolom kota creator sudah ada di roster, tapi belum terisi untuk satu pun creator aktif"*. Keputusan A benar; D belum menyusul.

**P1-4 · Definisi verified berbeda antara dua tabel di database yang sama.**  
Filter `Verified creators only` membaca `kol_directory.verified_status` (454 bernilai `verified`). Tapi `l1_silver.unified_profile.is_verified` bernilai `false` untuk **setiap** akun di database itu — termasuk @cristiano dan @instagram. Backend memetakan `'verified'|'true'|'yes'`, padahal nilai yang benar-benar ada hanya `'verified'` (454) dan `'unverified'` (477); 6.789 sisanya NULL, artinya *belum pernah dicek* — bukan *tidak terverifikasi* — dan ikut tersembunyi saat toggle dinyalakan.

**P1-5 · Pencarian tidak menemukan creator lewat namanya sendiri.**  
`q` hanya dipetakan ke `username ILIKE`. Nama asli tersimpan di `agency_kol_accounts.label` untuk **7.684 dari 7.720** baris dan tidak ikut dicari — mengetik "Raffi Ahmad" mengembalikan 0 hasil walau @raffinagita1717 ada di roster. Permukaan C sudah melakukannya dengan benar (`username ILIKE $n OR display_name ILIKE $n`); pola itu tinggal dibawa ke A.

### P2 — Medium: data ada tetapi coverage terlalu rendah

| Filter | Coverage | Efek saat dipakai |
| --- | ---: | --- |
| Min. engagement (A) | 1.756 / 7.720 = 22,7% | Satu tik dari 0 langsung membuang 5.964 creator yang ER-nya belum pernah diukur |
| Verified creators only (A) | 454 / 7.720 = 5,9% | Hasil turun dari 7.720 ke 454; 6.789 NULL ikut hilang |
| Category (A) | 4.174 / 7.720 = 54,1% | 45,9% roster tidak berkategori dan hilang dari kategori apa pun; 2 kategori teratas menampung 91% dari yang berkategori |
| Preset Best Performing (A) | 219 / 7.720 = 2,8% | Menyisakan di bawah 3% roster |
| Preset High Engagement (A) | 178 / 7.720 = 2,3% | Menyisakan di bawah 3% roster |
| Tier (A) | 7.194 / 7.720 = 93,2% | 526 baris tidak masuk band manapun (follower < 1.000 atau NULL) dan hilang dari semua pilihan tier |
| Format konten (B) | 245 / 1.700 post = 14,4% | Akun tanpa `format` jatuh ke fallback 'Post', termasuk akun yang belum punya post sama sekali |
| Kategori & Location (C) | 0 / 4 = 0% | Query benar, dropdown kosong — profiling belum pernah mengisi kolomnya |

**Catatan tambahan soal status provenance.** Badge Live/Calculated/Estimated dihitung di `kolDirectory.ts:186` dengan ambang 7 hari. Hasil query hari ini: **Live 0, Calculated 27, Estimated 7.693**. Karena `SCRAPED_FIRST` selalu menjadi kunci urutan pertama, urutan efektif setiap sort adalah 27 baris dulu, lalu 7.693 sisanya — apa pun kolom yang dipilih user.

### P3 — Low: taksonomi, opsi, dan UX

* **Slider follower berhenti di 10 juta** sementara nilai tertinggi di roster 685.896.635. Ada 25 creator di atas 10M yang tidak bisa dipisahkan satu sama lain.
* **`engagement_rate` maksimum di database 223,41%** — di luar jangkauan slider (0–10%) dan tidak masuk akal sebagai ER. Tidak ada validasi rentang.
* **Kunci sort `created` didukung backend tapi tidak diekspos** di dropdown Sort; hanya dipakai shelf "Recently added" di Hub.
* **Count tier tidak menyempit mengikuti platform.** Band Tier hanya muncul setelah platform dipilih, tapi angkanya roster-wide — "Micro 2.942" tetap tampil walau Instagram hanya punya sebagian darinya. Perilaku ini sudah didokumentasikan di komentar kode sebagai keputusan sadar.
* **Badge "jumlah filter aktif" tidak menghitung Category** (`activeFilterCount` sengaja mengecualikannya agar tidak dobel dengan chip toolbar). Konsisten, tapi badge bisa menunjukkan 0 padahal grid sedang tersaring.
* **Saved lists hanya di `localStorage`**, hilang saat ganti browser/perangkat dan tidak bisa dibagi antar anggota tim.
* **Dua komentar UI sudah tidak akurat.** Section `Audience` berbunyi *"Roster KOL tidak menyimpan data audiens"* dan section `Location` berbunyi *"Lokasi audiens tidak punya kolom sama sekali"*. Keduanya kini keliru: `l2_gold.audience_demographics_daily` (gender) dan `audience_geo_daily` (country + city) sudah terisi untuk 23 akun. Datanya masih terlalu tipis untuk jadi filter, tapi alasan yang ditulis di UI bukan lagi alasan yang benar.

---

## 5. Filter Recommendation

### Keep — menyaring data nyata, pertahankan (20)

Termasuk beberapa yang berstatus PARTIAL: keterbatasannya ada di coverage kolom, bukan di implementasi filternya.

| Permukaan | Filter | Status |
| --- | --- | --- |
| A | Platform | 🟢 YES |
| A | Tier | 🟡 PARTIAL — 526 baris di luar semua band |
| A | Min. followers | 🟡 PARTIAL — langkah berhenti di 10M |
| A | Category + quick-chips | 🟡 PARTIAL — 54,1% coverage |
| A | Min. engagement | 🟡 PARTIAL — 22,7% coverage, sudah ada peringatan di UI |
| A | Sort | 🟡 PARTIAL — kunci `created` belum diekspos |
| A | Search | 🟡 PARTIAL — lihat Fix, hanya username |
| B | Pencarian, Tipe akun, Platform | 🟢 YES |
| B | Ambang ER, Ambang Rasio paid | 🟢 YES |
| B | Format konten, Est. reach, Brand fit | 🟡 PARTIAL |
| C | Pencarian, Platform, Tier, Status, Followers, Engagement | 🟢 YES |
| D | Reference search, Platform | 🟢 YES |
| D | Tier | 🟡 PARTIAL — daftar hardcoded |
| E | Search box | 🟢 YES |

### Fix — punya data nyata, implementasinya yang bermasalah (9)

| Filter | Yang perlu diperbaiki | Perkiraan usaha |
| --- | --- | --- |
| Search (A) | Tambahkan `agency_kol_accounts.label` ke klausa pencarian — 7.684 nama asli langsung bisa dicari. Salin pola dari `creatorStore.ts:164` | Kecil (1 baris SQL + 1 join) |
| Preset Emerging Creators | Tambahkan batas atas follower ke `filters` supaya janji "di bawah 100rb" benar-benar sampai ke SQL. Perlu param `follMax` baru di route + query | Kecil |
| Preset Fast Growing / Audience Quality / Brand Fit | Turunkan ke bawah judul "Urutan (perkiraan)" dan beri badge `modelled` di chip-nya, atau sembunyikan sampai kolomnya ada | Kecil (UI) |
| Ranking preset secara umum | `rankedRows` hanya menata ulang 12 baris. Pindahkan ranking ke server, atau ganti label jadi "urutkan halaman ini" | Sedang |
| Teks coverage rate card (A) | Ganti kalimat hardcoded 7.230/7.718 dengan angka dari facets, atau hapus. Sekalian perbarui 7.718 → 7.720 di komentar dan copy | Kecil |
| Verified only (A) | Pisahkan "tidak terverifikasi" (477) dari "belum dicek" (6.789) — jadikan tri-state, atau beri tahu berapa yang tersembunyi | Kecil–sedang |
| Location (D) | Ganti dropdown hardcoded jadi disable + alasan, mengikuti keputusan yang sudah diambil Permukaan A | Kecil |
| Empty state filter harga | Saat hasil 0 karena `maxRate`, tampilkan alasan spesifik. `relaxSuggestions()` di `creatorMatch.ts:412` sudah menyiapkan mekanismenya | Kecil |

### Hide / Disable — sebaiknya tidak ditampilkan dulu (11)

| Filter | Alasan |
| --- | --- |
| Max. rate card (A) | 0/7.720 punya harga — dinyalakan = hasil kosong total |
| Preset Cost Efficient (A) | Bergantung penuh pada harga yang tidak ada; sekarang tidak melakukan apa-apa |
| Preset Campaign Ready (A) | Separuh janjinya (rate card) tidak mungkin terpenuhi siapa pun |
| Rate card + Lower price (D) | Sama, tanpa teks peringatan sama sekali |
| Hanya yang punya rate card (B) | `discover_rate_cards` 0 baris — dinyalakan = hasil kosong total |
| Location (D) | 7 kota untuk kolom 0% terisi |
| Hanya terverifikasi (B) | Nilainya koin ber-seed; risiko salah paham tertinggi di antara semua filter dimodelkan |
| Ambang Followers (B) | Follower diperkirakan dari views, bertabrakan dengan arti "followers" di Permukaan A |
| Kategori / Lifestyle / Umur / Gender (B) | Seluruhnya dari generator; kategorinya juga bertabrakan dengan taksonomi 28-kategori di Permukaan A |
| Ambang Authenticity (B) | Tidak ada kolom autentisitas di kedua database |
| Kategori & Location (C) | Kolom ada, 0/4 terisi — dropdown-nya kosong dan membingungkan |

### Future Data Pipeline — butuh pengumpulan data baru (mayoritas dari 18 NOT AVAILABLE)

| Kebutuhan data | Filter yang menunggu | Status sumber saat ini |
| --- | --- | --- |
| Umur audiens | Audience Age (A), Umur dominan (B) | `audience_demographics_daily` hanya punya `gender`; tidak ada satu pun baris umur |
| Gender audiens skala roster | Major Female/Male % (A), Gender mayoritas (B) | Ada untuk 23 akun, tapi 61–85 dari 100 unit sampelnya `unknown` |
| Lokasi audiens | Audience location (A) | `audience_geo_daily` ada untuk 23 akun; 84–97% `unknown` |
| Interest audiens | *(belum ada kontrolnya)* | `audience_interest_daily` sudah terisi untuk 23 akun — data ada, UI belum |
| Format konten per creator | Format (A), Format konten (B) | `content_format_daily` hanya 30 akun, dan tiap akun dibatasi 10 post |
| Kota creator | Creator location (A), Location (D) | Kolom `creator_city` ada, 0/7.720 terisi |
| Rate card | 6 filter di 3 permukaan | 5 tabel di DB KOL + 1 di warehouse, semuanya 0 baris |
| Riwayat campaign | Min. campaigns (A) | `campaign_kols` dan `campaigns` 0 baris |
| Autentisitas / brand fit | Min. authenticity, Min. brand fit (A), 2 ambang (B) | Tidak ada kolom di manapun |
| Pertumbuhan follower | Preset Fast Growing, Emerging (A) | Tidak ada kolom; `unified_profile.followers_growth` ada tapi hanya untuk akun yang di-harvest |
| Rasio paid skala roster | Max. paid ratio (A) | `post_metric.is_sponsored` ada untuk 30 akun saja |

---

## 6. Kesimpulan

**1. Filter mana yang benar-benar production-ready.**  
Inti Permukaan A — **Platform, Tier, Min. followers, Category, Sort, Search** — dibangun dengan benar: server-side SQL, parameter tervalidasi, absent dibedakan dari nol, paging dan sorting menyatu dalam satu round trip, dan opsi diambil dinamis dari database lewat facets. Permukaan C juga bersih seluruhnya; pencariannya bahkan lebih lengkap daripada A. Enam filter inilah yang layak jadi janji Discovery hari ini.

**2. Filter mana yang hanya UI/prototype.**  
**18 dari 63 filter (29%) tidak punya sumber data sama sekali.** Sepuluh di antaranya sudah ditangani dengan benar di Permukaan A — dirender disabled, diberi badge `Belum tersedia`, dan disertai kalimat alasan. Ini keputusan yang tepat dan sebaiknya dipertahankan. Sisanya, di Permukaan B, tetap bisa diklik dan tetap menghasilkan daftar yang terlihat meyakinkan — **11 kontrol menyaring nilai yang dihasilkan hash FNV-1a atas id akun**, bukan nilai yang pernah diukur.

**3. Filter mana yang mismatch UI vs DB.**  
**13 filter (21%)**. Dua kelompok besar: filter rate card (6 kontrol di 3 permukaan, semuanya membaca tabel kosong) dan atribut dimodelkan di Permukaan B (kategori, lifestyle, lokasi, tier, umur, gender, followers, verified). Ditambah dua kasus tersendiri: dropdown lokasi hardcoded di Smart Discovery, dan lima preset yang tidak mengirim parameter apa pun.

**4. Filter mana yang sebaiknya tidak ditampilkan ke user dulu.**  
Prioritas pertama adalah **enam filter rate card**, karena efeknya paling merusak kepercayaan: dinyalakan → nol hasil, tanpa penjelasan, padahal UI justru menyatakan datanya ada untuk 7.230 creator. Prioritas kedua **`Hanya terverifikasi` di Permukaan B**, karena verified adalah fakta biner yang tidak seorang pun akan menduga hasil undian. Prioritas ketiga **`Ambang Followers` di Permukaan B**, karena bertabrakan langsung dengan arti kata yang sama di layar sebelah.

**5. Prioritas perbaikan Discovery Filter System.**

| # | Tindakan | Dampak | Usaha |
| --- | --- | --- | ---: |
| 1 | Sembunyikan atau disable 6 filter rate card sampai tabelnya terisi | Menghapus satu-satunya cara user mendapat 0 hasil tanpa sebab yang bisa dipahami | Kecil |
| 2 | Perbaiki kalimat coverage rate card yang hardcoded (7.230 → nyata) | Menghentikan UI menyatakan hal yang tidak benar | Kecil |
| 3 | Tambahkan `agency_kol_accounts.label` ke pencarian | Membuka 7.684 nama asli untuk dicari — perbaikan terbesar per baris kode di seluruh audit | Kecil |
| 4 | Beri batas follower nyata pada preset Emerging Creators | Menghentikan satu preset yang hasilnya kebalikan dari namanya | Kecil |
| 5 | Tandai 5 preset tanpa parameter sebagai "urutan (perkiraan)", atau sembunyikan | Menghilangkan kesan menyaring pada kontrol yang tidak menyaring | Kecil |
| 6 | Disable dropdown Location di Smart Discovery, samakan dengan keputusan Permukaan A | Konsistensi antar layar atas kolom yang sama | Kecil |
| 7 | Buat empty-state yang menyebut filter penyebabnya (`relaxSuggestions()` sudah siap) | Setiap hasil kosong jadi bisa ditindaklanjuti | Kecil–sedang |
| 8 | Jadikan `Verified only` tri-state (verified / unverified / belum dicek) | Menghentikan 6.789 creator hilang diam-diam | Sedang |
| 9 | Pindahkan ranking preset ke server | 8 preset jadi mengurutkan 7.720 baris, bukan 12 | Sedang |
| 10 | Petakan taksonomi 7 kategori `vocab.ts` ke 28 kategori `kol_categories` | Menghentikan dua layar memberi arti berbeda pada kata yang sama | Sedang |
| 11 | Ganti atribut `est()` di Permukaan B dengan kolom nyata begitu tersedia | Memulangkan 11 kontrol dari generator ke database | Besar (butuh pipeline) |

Sepuluh dari sebelas tindakan pertama tidak menunggu data baru sama sekali — semuanya soal menyelaraskan apa yang dijanjikan UI dengan apa yang sudah dilakukan backend.

---

## Lampiran — permukaan yang berbatasan tetapi di luar cakupan

**Tab Content (`?tab=discovery`), `DiscoverContent.tsx`.** Ini penemuan **post**, bukan penemuan creator, sehingga tidak masuk hitungan 63 filter di atas. Diperiksa singkat untuk memastikan tidak ada filter creator yang terlewat: 13 filter (q, format, platform, pillar, type, source, erMin, likesMin, viewsMin, days, sort, page, pageSize), **seluruhnya server-side** lewat `/discover/content` atas `l1_silver.unified_post` (1.700 baris) dan `l1_silver.unified_competitor_post` (229 baris) di warehouse, org-scoped. Coverage yang perlu dicatat: hanya **245 / 1.700 = 14,4%** post punya `content_pillar` dan `format`, sehingga filter Category/Topic dan Format di tab itu bekerja atas seperlima data.

---

## Catatan metode

Seluruh angka dalam laporan ini dibaca langsung dari dua database dengan `SELECT`, dan seluruh perilaku filter dibaca langsung dari source code — tidak ada yang disimpulkan dari nama fungsi atau dari tampilan UI saja. Tidak ada baris database yang diubah dan tidak ada file di `src/` yang disentuh. Di mana sebuah nilai tidak ada, laporan menyebut jenis ketiadaannya: `NOT FOUND` (tidak ada kolom), `0 / N = 0%` (kolom ada, data kosong), atau `NOT AVAILABLE` (kontrol sengaja dimatikan).
