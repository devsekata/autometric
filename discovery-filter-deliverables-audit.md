# Creator Database Filter — Audit terhadap `deliv.xlsx`

**Tanggal audit:** 2026-09-08
**Sumber kebenaran:** sheet `DELIVERABLES` (baris 71–85, 118–125), `Mapping Filter-DB`, dan `Detail KOL`.
**Sifat:** setiap baris diverifikasi ulang terhadap aplikasi yang berjalan dan terhadap database KOL — status di spreadsheet tidak dipercaya begitu saja.

**Cara verifikasi.** Tiga lapis, semuanya dijalankan pada 8 Sep 2026:

1. **Query langsung ke database KOL** lewat `@/lib/kolDb` — coverage per kolom, dihitung terhadap 7.721 baris `kol_directory` berstatus `active`.
2. **`listKolDirectory()`** dipanggil langsung dengan tiap kombinasi filter, untuk membuktikan predikatnya benar-benar menyaring dan `total` bergerak (`npm run verify:kol-filters`, `npm run verify:filters`).
3. **Browser sungguhan** (Chrome via playwright-core) menekan tiap kontrol dan membaca baris hitungan hasil, yang berasal dari `COUNT(*) OVER()` di server — bukan dari jumlah kartu di layar.

Sebuah filter hanya dihitung **DONE** kalau seluruh rantai ini terbukti:
UI → state → query param → API → SQL → hasil yang benar-benar berubah.

---

## 1. Tabel audit — 3. DISCOVERY FILTER

| # | Deliverable | Perilaku yang diminta | Status di sheet | Status sebenarnya | Sumber data | Ketersediaan data | Hasil | Tindakan |
|---|---|---|---|---|---|---|---|---|
| 71 | Search Creator | Debounce 350ms, cari username, balik ke halaman 1 | DONE | Bekerja; juga mencari display name | `kol_directory.username` (+ nama dari `agency_kol_accounts.label`) | 97,1% | **DONE** | — (lebih luas dari deliverable, dilaporkan) |
| 72 | Platform | Chip All/Instagram/TikTok + jumlah per platform | DONE | Bekerja server-side, jumlah dari facet | `kol_directory.platform_id → platforms.key` | 7.497 / 7.721 (97,1%) | **DONE** | — |
| 73 | Tier | Muncul setelah platform dipilih; opsi & rentang dari DB | DONE | Bekerja; batas persis `kol_tiers` | Turunan `followers_count` terhadap `public.kol_tiers` | 7.195 bertier + 526 untiered | **DONE** | — |
| 74 | Category / Niche | 6 chip teratas di toolbar, daftar lengkap di panel | DONE | Bekerja; 28 kategori dari DB, multi-select | `category_ids → kol_categories` | 4.174 (54,1%) + chip "Belum berkategori" (3.547) | **DONE** | — |
| 75 | Minimum Followers | Slider bertingkat 0–10M | DONE | Bekerja server-side, halaman balik ke 1 | `kol_directory.followers_count` | 7.499 (97,1%) | **DONE** | — |
| 76 | Minimum Engagement Rate | Slider 0–10%, langkah 0,1% | DONE | Bekerja; nilai mustahil dibuang | `kol_directory.engagement_rate` | 1.744 terpakai (22,6%) | **DONE** | Angka coverage di panel dikoreksi |
| 77 | Max Rate Card | Slider 500rb–1 miliar | DONE | **Slider apa pun mengembalikan 0 hasil** | `l1_silver.unified_rate_card` **0 baris**; `kol_profile_card.rate_card_min_fee` null semua | **0%** | **BLOCKED BY DATA** | Dinonaktifkan + alasan ditulis di panel |
| 78 | Verified Creators Only | Toggle di bawah panel | DONE | Bekerja: 455 dari 7.721 | `kol_directory.verified_status` | 932 punya nilai (455 verified) | **DONE** | Teks bantuan diberi angka nyata |
| 79 | Content Format | Chip dalam kondisi **nonaktif** | DONE | Chip ada dan nonaktif — sesuai permintaan | `content_format_daily.media_type` | 56 creator (0,7%) | **DONE** | — |
| 80 | Audience Age | Chip umur, status **belum tersedia** | IN PROGRESS | Chip ada dan nonaktif | `audience_demographics_daily` (`type='age'`) | **0 baris age** | **BLOCKED BY DATA** | — (sudah jujur) |
| 81 | Audience Gender | Slider Major Female/Male **nonaktif** | IN PROGRESS | Slider ada dan nonaktif | `audience_demographics_daily` (gender) | 23 creator (0,30%) | **BLOCKED BY DATA** | — |
| 82 | Creator Location | Dropdown **nonaktif** | IN PROGRESS | Dropdown ada dan nonaktif | `kol_directory.creator_city` | **0% terisi** | **BLOCKED BY DATA** | — |
| 83 | Audience Location | Dropdown **nonaktif** | IN PROGRESS | Dropdown ada dan nonaktif | `audience_geo_daily.geo_key` | 23 creator; 9 dari 33 key salah level | **BLOCKED BY DATA** | — |
| 84 | Other Filters | 4 slider **nonaktif** | IN PROGRESS | Empat slider ada dan nonaktif | authenticity/quality 23 creator; `brand_fit_analysis` **0 baris**; paid ratio tanpa kolom; `campaign_kols` **0 baris** | 0–0,30% | **BLOCKED BY DATA** | — |
| 85 | Smart Preset | 8 preset; sebagian filter nyata, sebagian hanya mengurutkan | IN PROGRESS | 4 preset menyaring server-side, 4 dinonaktifkan | lihat §2 | sebagian | **PARTIAL → jujur** | 4 preset diperbaiki, 4 dinonaktifkan + alasan |

### Deliverable perilaku panel (baris 118–125)

| # | Deliverable | Status di sheet | Status sebenarnya | Hasil |
|---|---|---|---|---|
| 118 | Open / Collapse Filter Panel | DONE | Panel **tertutup secara default**; tombol Filters di toolbar + tab vertikal saat tertutup | **DONE** (lihat catatan) |
| 119 | Accordion Section | DONE | 6 section tampil awal; Tier & Format menyusul setelah platform dipilih (= 8) | **DONE** |
| 120 | Active Filter Count | DONE | Badge muncul di tombol Filters, di header section, dan di tab tertutup | **DONE** |
| 121 | Clear All | DONE | Ada di panel, di toolbar, di baris chip, dan di hasil kosong | **DONE** |
| 122 | Auto Apply | DONE | Tidak ada tombol Apply; tiap perubahan memanggil API dan halaman balik ke 1 | **DONE** |
| 123 | Saved Lists | DONE | Simpan / terapkan / hapus, tersimpan di database (migrasi 052) | **DONE** |
| 124 | Sort Hasil | DONE | Followers, Engagement, Last updated, Recently added, Name + sort kolom tabel | **DONE** |
| 125 | Saran Longgarkan Filter | DONE | Hasil kosong menyebut kriteria mana yang kemungkinan terlalu ketat | **DONE** |

**Catatan 118.** Panel Creator Database tertutup saat pertama dibuka. Deliverable 118 tidak menyebut default-nya, sementara deliverable 126 (Tracked Accounts) menyebut "terbuka secara default" secara eksplisit — jadi ini tidak dihitung pelanggaran, tapi perbedaannya disengaja atau tidak sebaiknya ditegaskan Product.

---

## 2. Smart Preset — audit per preset

| Preset | Logika backend | Sumber data | Ketersediaan | Menyaring atau mengurutkan? | Hasil |
|---|---|---|---|---|---|
| Best Performing | `erMin = 3` di SQL | `engagement_rate` | 22,6% | **Menyaring** seluruh roster, lalu diurutkan pakai kolom yang sama | **DONE** |
| High Engagement | `erMin = 5,5` di SQL | `engagement_rate` | 22,6% | **Menyaring** (130 creator) | **DONE** |
| Emerging Creators | `follMax = 100.000` di SQL | `followers_count` | 97,1% | **Menyaring** (5.896 creator) | **DONE** |
| Campaign Ready | `verifiedOnly = true` di SQL | `verified_status` | 455 creator | **Menyaring** | **DONE** |
| Fast Growing | — | `kol_profile_card.followers_growth` | **25 creator (0,3%)** | dulu hanya mengurutkan halaman | **BLOCKED BY DATA** — dinonaktifkan |
| High Audience Quality | — | `feature.{ig,tt}_audience_analysis` | **23 creator (0,3%)** | dulu hanya mengurutkan halaman | **BLOCKED BY DATA** — dinonaktifkan |
| Best Brand Fit | — | `feature.brand_fit_analysis` | **0 baris** | dulu hanya mengurutkan halaman | **BLOCKED BY DATA** — dinonaktifkan |
| Cost Efficient | — | rate card | **0 baris** | dulu hanya mengurutkan halaman | **BLOCKED BY DATA** — dinonaktifkan |

Empat preset yang dinonaktifkan sebelumnya memakai `sampleIntel()` — angka yang **dikarang deterministik dari hash id creator**. Itu persis kasus `SYNTHETIC` yang dilarang sheet `Mapping Filter-DB` (baris 11, 13, 18, 32) untuk dibawa ke produksi.

---

## 3. Tiga tempat spreadsheet/mapping tidak cocok dengan kenyataan

Diverifikasi ulang karena instruksi audit meminta status sheet tidak dipercaya begitu saja.

| Klaim | Sumbernya | Hasil pengukuran 8 Sep 2026 |
|---|---|---|
| "Max Rate Card — DONE" | `DELIVERABLES` baris 77 | **Salah.** `l1_silver.unified_rate_card` 0 baris; plafon harga apa pun mengembalikan 0 creator. |
| "Verified only — 0 KOL lolos, belum ada data untuk menjalankan filter" | `Mapping Filter-DB` baris 6 | **Tidak berlaku untuk implementasi ini.** Sheet memetakan filter ke `public.social_account.oauth_token` (memang 0 dari 7.497 terisi). Aplikasi memakai `kol_directory.verified_status`, dan filternya mengembalikan **455 creator**. |
| "engagement_rate — 83 di antaranya >100% (mustahil)" | `Mapping Filter-DB` baris 14b | **Angkanya 7, bukan 83.** 1.757 terisi, 7 di atas 100% (maks 223,41%), 6 bernilai ≤0; ketiganya sudah dibuang `ER_CLEAN`, menyisakan 1.744 nilai terpakai. |

Satu lagi yang berbeda arah: `Mapping Filter-DB` baris 14 menjadikan `kol_metric_daily.er_followers_daily` sumber utama ER dan `kol_directory.engagement_rate` sebagai "alternatif". Sumber utama itu hanya menjangkau **38 creator**; alternatifnya menjangkau **1.744**. Implementasi memakai yang kedua — pilihan yang benar, tapi terbalik dari sheet.

---

## 4. Ringkasan

**Sudah benar-benar selesai (11):** Search, Platform, Tier, Category, Min Followers, Min ER, Verified, dan seluruh perilaku panel (Open/Collapse, Accordion, Active Count, Clear All, Auto Apply, Saved Lists, Sort, Saran longgarkan).

**Diperbaiki pada pass ini dan pass sebelumnya (3):** Max Rate Card (dari "diam-diam mengosongkan hasil" → nonaktif + alasan), Smart Preset (4 dijadikan filter server-side, 4 dinonaktifkan), angka coverage di panel dikoreksi agar cocok dengan pengukuran.

**Terblokir data KOL (6):** Max Rate Card, Audience Age, Audience Gender, Creator Location, Audience Location, Other Filters (authenticity, brand fit, paid ratio, campaigns). Semuanya tampil sebagai kontrol nonaktif dengan alasan — tidak ada yang berpura-pura menyaring.

**Ditandai DONE padahal belum:** Max Rate Card (baris 77).

**Perlu pengembangan lanjutan (bukan pekerjaan front-end):** isi `unified_rate_card`; isi `brand_fit_analysis`; isi `audience_demographics_daily` dengan `audience_type='age'`; isi `creator_city`; perluas coverage `feature.*_audience_analysis` dan `kol_profile_card.followers_growth`; normalisasi `content_format_daily.media_type`; kebijakan interval refresh untuk Data Freshness.

**Sumber data:** Creator Database tetap membaca **database KOL** lewat `@/lib/kolDb` → `public.kol_directory`. Tidak ada koneksi baru, tidak ada TSDB di jalur filter Creator Database. Diverifikasi di browser: layar ini tidak memanggil endpoint warehouse mana pun.
