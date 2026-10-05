# Discovery Page — Interactive Element & Filter Audit

**Tanggal audit:** 2026-09-04  
**Sifat:** read-only. Tidak ada kode maupun baris database yang diubah.  
**Sumber kebenaran:** source code yang berjalan hari ini, ditambah query langsung ke dua database. Tidak ada daftar filter yang diasumsikan di muka — seluruh inventaris di bawah diturunkan dari pembacaan komponen.

**Cakupan.** Discovery adalah satu route `/organizations/[orgSlug]/discover` dengan tab & view di query string. Audit ini mencakup shell (`DiscoverWorkspace`) dan lima view penemuan creator — Hub, Creator Database, Tracked Accounts, My Creators, Smart Discovery — beserta modal yang dipanggil dari sana. Tab lain dalam route yang sama (Compare, Negotiation, Ordering, Reports, Settings, Content, Audience, Assistant) adalah alur terpisah dan tidak dihitung; disinggung hanya saat sebuah kontrol di Discovery mengarah ke sana.

**File pendamping (siap dibuka di Excel):**

| File | Isi |
| --- | --- |
| `discovery-ui-inventory.csv` | 126 baris — inventaris seluruh elemen interaktif (Fase 1 & 2) |
| `discovery-ui-buttons.csv` | 26 baris — audit tombol & aksi non-filter (Fase 4) |
| `discovery-filter-audit.csv` | 63 baris — audit filter 13 kolom lengkap (Fase 3), sudah dihasilkan sebelumnya |

---

## 1. Discovery UI Inventory

126 entri kontrol. Beberapa entri adalah **grup** — misalnya "Preset chips ×8" adalah satu entri tapi delapan tombol. Kontrol yang disabled dan kontrol prototipe tetap dimasukkan.

| No | UI Element | Type | Location | Purpose | Component/File | Grup |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Breadcrumb link | Button | Shell — atas halaman | Kembali ke tab/view induk | `DiscoverWorkspace.tsx:347` | A |
| 2 | Sidebar nav — Discover + 7 anak | Nav links | Sidebar kiri (global) | Pindah tab Discovery | `layout/OrgNav.tsx:43` | A |
| 3 | TabStrip (sub-tab per tab) | Tabs | Shell — bawah header | Pindah view dalam satu tab | `ui.tsx:189 · DiscoverWorkspace.tsx:400` | A |
| 4 | Add KOL | Button (primary) | Shell — header kanan | Buka modal tambah KOL (`?add=1`) | `DiscoverWorkspace.tsx:376` | B |
| 5 | Cart + badge jumlah | Button (kondisional) | Shell — header kanan | Ke tab Ordering › Cart | `DiscoverWorkspace.tsx:649` | B |
| 6 | Ordering Flow | Button (kondisional) | Shell — header kanan | Ke alur pemesanan | `DiscoverWorkspace.tsx:659` | B |
| 7 | Purchase History | Button (ghost) | Shell — header kanan | Ke riwayat order | `DiscoverWorkspace.tsx:665` | B |
| 8 | Shelf action (`Lihat semua →`) | Button | Hub — kanan tiap shelf | Ke Smart Discovery / Creator Database | `DiscoverHub.tsx:221` | A |
| 9 | Hub creator card | Card (clickable) | Hub — dalam shelf | Buka creator | `DiscoverHub.tsx:259` | B |
| 10 | Find similar (ikon kartu) | Icon Button | Hub — pojok kartu | Cari creator serupa | `DiscoverHub.tsx:270` | B |
| 11 | Compare | Button (ghost) | Creator Database — toolbar | Ke tab Compare | `KolDirectoryPage.tsx:596` | B |
| 12 | Add KOL | Button (primary) | Creator Database — toolbar | Buka AddKolDirectoryModal | `KolDirectoryPage.tsx:603` | B |
| 13 | Preset chips ×8 | Chips (single, toggle) | Creator Database — toolbar | Terapkan preset filter+ranking | `KolDirectoryPage.tsx:617 · creatorMatch.ts:306` | C |
| 14 | Search input | Text Input (debounce 350ms) | Creator Database — toolbar | Cari creator | `KolDirectoryPage.tsx:657` | C |
| 15 | Clear search (×) | Icon Button | Creator Database — toolbar | Kosongkan kotak pencarian | `KolDirectoryPage.tsx:666` | C |
| 16 | Category quick-chips (All + 6) | Chips (single) | Creator Database — toolbar | Filter kategori cepat | `KolDirectoryPage.tsx:674` | C |
| 17 | Filter panel toggle | Pill Button | Creator Database — toolbar | Tampil/sembunyikan sidebar filter | `KolDirectoryPage.tsx:681` | C |
| 18 | Clear filters | Pill Button (kondisional) | Creator Database — toolbar | Reset semua filter | `KolDirectoryPage.tsx:688` | C |
| 19 | Saved lists | Pill Button → Dropdown | Creator Database — toolbar | Buka daftar tersimpan | `KolDirectoryPage.tsx:692` | C |
| 20 | Apply saved list | Dropdown row | Creator Database — toolbar | Terapkan kombinasi filter tersimpan | `KolDirectoryPage.tsx:707` | C |
| 21 | Delete saved list (×) | Icon Button | Creator Database — toolbar | Hapus daftar tersimpan | `KolDirectoryPage.tsx:714` | C |
| 22 | Save current as list | Button (+) | Creator Database — toolbar | Simpan filter aktif | `KolDirectoryPage.tsx:720` | C |
| 23 | Sort | Pill Button → Dropdown (4 opsi) | Creator Database — toolbar | Ubah urutan hasil | `KolDirectoryPage.tsx:735` | D |
| 24 | Column chooser (8 checkbox) | Pill → Checkbox list | Creator Database — toolbar | Pilih kolom tabel | `KolDirectoryPage.tsx:758` | D |
| 25 | View toggle Card / Table | Segmented Button | Creator Database — toolbar | Ganti tampilan daftar | `KolDirectoryPage.tsx:779` | D |
| 26 | Result count line | Text (dinamis) | Creator Database — toolbar | Jumlah hasil + favorit + compare | `KolDirectoryPage.tsx:590` | D |
| 27 | Collapse sidebar (chevron) | Icon Button | Creator Database — filter sidebar | Tutup panel jadi tab vertikal | `KolDirectoryFilters.tsx:266` | C |
| 28 | Filter tab (state tertutup) | Vertical Tab Button | Creator Database — tepi kanan | Buka kembali panel | `KolDirectoryFilters.tsx:446` | C |
| 29 | Clear all (dalam panel) | Text Button | Creator Database — filter sidebar | Reset semua filter | `KolDirectoryFilters.tsx:264` | C |
| 30 | Section accordion ×7 | Accordion Header | Creator Database — filter sidebar | Buka/tutup section filter | `KolDirectoryFilters.tsx:170` | C |
| 31 | Platform chips (All + 2) | Chips (single) | Creator Database — filter sidebar | Filter platform | `KolDirectoryFilters.tsx:279` | C |
| 32 | Tier chips (All + 5 dinamis) | Chips (single) | Creator Database — filter sidebar | Filter band follower | `KolDirectoryFilters.tsx:303` | C |
| 33 | Format chips (6 IG / 3 TT) | Chips — DISABLED | Creator Database — filter sidebar | Filter format konten | `KolDirectoryFilters.tsx:330` | C |
| 34 | Min. followers | Range Slider (12 langkah) | Creator Database — filter sidebar | Ambang follower | `KolDirectoryFilters.tsx:343` | C |
| 35 | Min. engagement | Range Slider (0–10%) | Creator Database — filter sidebar | Ambang engagement rate | `KolDirectoryFilters.tsx:346` | C |
| 36 | Max. rate card | Range Slider (12 langkah) | Creator Database — filter sidebar | Plafon harga | `KolDirectoryFilters.tsx:349` | C |
| 37 | Audience Age chips ×7 | Chips — DISABLED | Creator Database — filter sidebar | Filter umur audiens | `KolDirectoryFilters.tsx:366` | C |
| 38 | Major Female (%) | Range Slider — DISABLED | Creator Database — filter sidebar | Ambang audiens perempuan | `KolDirectoryFilters.tsx:369` | C |
| 39 | Major Male (%) | Range Slider — DISABLED | Creator Database — filter sidebar | Ambang audiens laki-laki | `KolDirectoryFilters.tsx:371` | C |
| 40 | Category chips (All + 28 dinamis) | Chips (single) | Creator Database — filter sidebar | Filter kategori | `KolDirectoryFilters.tsx:382` | C |
| 41 | Creator location | Select — DISABLED | Creator Database — filter sidebar | Filter kota creator | `KolDirectoryFilters.tsx:395` | C |
| 42 | Audience location | Select — DISABLED | Creator Database — filter sidebar | Filter lokasi audiens | `KolDirectoryFilters.tsx:395` | C |
| 43 | Min. authenticity | Range Slider — DISABLED | Creator Database — filter sidebar | Ambang autentisitas | `KolDirectoryFilters.tsx:411` | C |
| 44 | Min. brand fit | Range Slider — DISABLED | Creator Database — filter sidebar | Ambang brand fit | `KolDirectoryFilters.tsx:412` | C |
| 45 | Max. paid ratio | Range Slider — DISABLED | Creator Database — filter sidebar | Plafon rasio konten berbayar | `KolDirectoryFilters.tsx:413` | C |
| 46 | Min. campaigns | Range Slider — DISABLED | Creator Database — filter sidebar | Ambang jumlah campaign | `KolDirectoryFilters.tsx:414` | C |
| 47 | Verified creators only | Toggle (switch) | Creator Database — filter sidebar | Hanya creator terverifikasi | `KolDirectoryFilters.tsx:431` | C |
| 48 | Retry (error state) | Button | Creator Database — area hasil | Muat ulang direktori | `KolDirectoryPage.tsx:804` | E |
| 49 | Clear filters (empty state) | Button | Creator Database — area hasil | Reset saat hasil kosong | `KolDirectoryPage.tsx:819` | E |
| 50 | Pagination prev / next / nomor | Pagination Buttons | Creator Database — area hasil | Pindah halaman (server-side) | `KolDirectoryPage.tsx:840` | D |
| 51 | Select-all halaman | Checkbox | Creator Database — area hasil (tabel) | Pilih semua baris di halaman | `KolDirectoryPage.tsx:1163` | B |
| 52 | Row checkbox | Checkbox | Creator Database — area hasil (tabel) | Pilih satu creator | `KolDirectoryPage.tsx:1182` | B |
| 53 | Column header sort | Sort Control | Creator Database — area hasil (tabel) | Urutkan lewat header kolom | `KolDirectoryPage.tsx:1144` | D |
| 54 | Creator card / row (klik) | Card / Row | Creator Database — area hasil | Buka panel Quick Insight | `KolDirectoryPage.tsx:972 · 1177` | B |
| 55 | Favorite (hati) | Icon Toggle | Creator Database — area hasil (kartu) | Tandai creator sebagai favorit | `KolDirectoryPage.tsx:981` | B |
| 56 | Add to compare | Icon Toggle | Creator Database — area hasil (kartu) | Masukkan ke perbandingan | `KolDirectoryPage.tsx:982` | B |
| 57 | Add to cart | Icon Toggle | Creator Database — area hasil (kartu & tabel) | Masukkan ke keranjang | `KolDirectoryPage.tsx:984 · 1220` | B |
| 58 | Find similar | Icon Button | Creator Database — area hasil (kartu & tabel) | Ke Smart Discovery dengan acuan ini | `KolDirectoryPage.tsx:990 · 1213` | B |
| 59 | Bulk: Add to Compare | Button | Creator Database — area hasil (bulk bar) | Tambah semua terpilih ke compare | `KolDirectoryPage.tsx:860` | B |
| 60 | Bulk: Add to Cart | Button | Creator Database — area hasil (bulk bar) | Tambah semua terpilih ke keranjang | `KolDirectoryPage.tsx:861` | B |
| 61 | Bulk: Export CSV | Button | Creator Database — area hasil (bulk bar) | Unduh terpilih sebagai CSV | `KolDirectoryPage.tsx:862` | B |
| 62 | Bulk: Export Excel | Button | Creator Database — area hasil (bulk bar) | Unduh terpilih sebagai Excel | `KolDirectoryPage.tsx:865` | B |
| 63 | Bulk: Clear | Button | Creator Database — area hasil (bulk bar) | Kosongkan pilihan | `KolDirectoryPage.tsx:868` | B |
| 64 | Quick Insight — Close | Icon Button | Panel Quick Insight | Tutup panel | `CreatorQuickInsight.tsx:105` | E |
| 65 | Quick Insight — Shortlist | Action Button | Panel Quick Insight | Toggle favorit (state yang sama) | `CreatorQuickInsight.tsx:265` | B |
| 66 | Quick Insight — Compare | Action Button | Panel Quick Insight | Toggle compare | `CreatorQuickInsight.tsx:267` | B |
| 67 | Quick Insight — View Full Profile | Action Button | Panel Quick Insight | Buka halaman creator | `CreatorQuickInsight.tsx:270` | B |
| 68 | Quick Insight — Start Collaboration | Action Button (primary) | Panel Quick Insight | Masukkan ke keranjang | `CreatorQuickInsight.tsx:272` | B |
| 69 | Pricing modal — input harga | Number Input | Modal harga roster | Isi base rate creator | `KolDirectoryPage.tsx:891` | B |
| 70 | Pricing modal — Simpan | Button (primary) | Modal harga roster | PUT rate card org | `KolDirectoryPage.tsx:1524` | B |
| 71 | Pricing modal — Batal / × | Button | Modal harga roster | Tutup modal | `KolDirectoryPage.tsx:1479 · 1520` | E |
| 72 | Add KOL — pilih platform | Chips (single) | AddKolDirectoryModal | Pilih Instagram / TikTok | `AddKolDirectoryModal.tsx:368` | B |
| 73 | Add KOL — input username/URL | Text Input | AddKolDirectoryModal | Identitas creator baru | `AddKolDirectoryModal.tsx` | B |
| 74 | Add KOL — Check | Button | AddKolDirectoryModal | POST /api/kol-directory/add/check | `AddKolDirectoryModal.tsx:146` | B |
| 75 | Add KOL — Add / Edit / Try Again | Button (primary) | AddKolDirectoryModal | POST /api/kol-directory/add | `AddKolDirectoryModal.tsx:165 · 553` | B |
| 76 | Add KOL — Close / Cancel | Button | AddKolDirectoryModal | Tutup modal | `AddKolDirectoryModal.tsx:225 · 244` | E |
| 77 | Search input | Text Input | Tracked Accounts — toolbar | Cari akun (client-side) | `DiscoverDirectoryView.tsx:409` | C |
| 78 | Reset filter | Button (ghost) | Tracked Accounts — toolbar | Kembalikan filter ke default | `DiscoverDirectoryView.tsx:417` | C |
| 79 | Saved lists | Button → Dropdown | Tracked Accounts — toolbar | Simpan/terapkan set filter | `DiscoverDirectoryView.tsx:423` | C |
| 80 | Column chooser (15 kolom) | Button → Checkbox list | Tracked Accounts — toolbar | Pilih kolom tabel | `DiscoverDirectoryView.tsx:457` | D |
| 81 | Sort select (10 opsi) | Select | Tracked Accounts — toolbar | Ubah urutan hasil | `DiscoverDirectoryView.tsx:445` | D |
| 82 | View toggle Card / Table | Segmented Button | Tracked Accounts — toolbar | Ganti tampilan | `DiscoverDirectoryView.tsx:476` | D |
| 83 | Export CSV | Button | Tracked Accounts — toolbar | Unduh hasil sebagai CSV | `DiscoverDirectoryView.tsx:485` | B |
| 84 | Export Excel | Button | Tracked Accounts — toolbar | Unduh hasil sebagai Excel | `DiscoverDirectoryView.tsx:488` | B |
| 85 | Buka panel filter | Button | Tracked Accounts — toolbar | Tampilkan panel filter | `DiscoverDirectoryView.tsx:492` | C |
| 86 | Category quick-chips (7) | Chips (single) | Tracked Accounts — strip | Filter kategori cepat | `DiscoverDirectoryView.tsx:503` | C |
| 87 | Panel: Reset / Tutup | Text Button ×2 | Tracked Accounts — panel | Reset filter / tutup panel | `DiscoverDirectoryView.tsx:600` | C |
| 88 | Panel: 9 grup chips | Chips (single) ×9 | Tracked Accounts — panel | Tipe akun, platform, kategori, lifestyle, lokasi, tier, umur, gender, format | `DiscoverDirectoryView.tsx:607-665` | C |
| 89 | Panel: 6 SelectPill ambang | Select ×6 | Tracked Accounts — panel | Followers, ER, reach, authenticity, brand fit, rasio paid | `DiscoverDirectoryView.tsx:674-685` | C |
| 90 | Panel: 2 Toggle | Toggle ×2 | Tracked Accounts — panel | Hanya terverifikasi / hanya punya rate card | `DiscoverDirectoryView.tsx:690` | C |
| 91 | Bulk: Tambah ke shortlist | Button | Tracked Accounts — bulk bar | Masukkan terpilih ke shortlist | `DiscoverDirectoryView.tsx:519` | B |
| 92 | Bulk: Bookmark | Button | Tracked Accounts — bulk bar | Bookmark terpilih | `DiscoverDirectoryView.tsx:522` | B |
| 93 | Bulk: Add to campaign | Button (primary) | Tracked Accounts — bulk bar | Ke alur ordering dengan terpilih | `DiscoverDirectoryView.tsx:526` | B |
| 94 | Bulk: Bersihkan | Button (ghost) | Tracked Accounts — bulk bar | Kosongkan pilihan | `DiscoverDirectoryView.tsx:530` | B |
| 95 | Card checkbox | Checkbox | Tracked Accounts — kartu | Pilih akun | `DiscoverDirectoryView.tsx:750` | B |
| 96 | Card Bookmark / Shortlist | Icon Toggle ×2 | Tracked Accounts — kartu | Tandai akun | `DiscoverDirectoryView.tsx:756` | B |
| 97 | Card Order | Button | Tracked Accounts — kartu | Masukkan ke keranjang | `DiscoverDirectoryView.tsx:835` | B |
| 98 | Card Analisis / Detail | Button / Link | Tracked Accounts — kartu | Buka workspace atau halaman detail | `DiscoverDirectoryView.tsx:843 · 848` | B |
| 99 | Pagination Prev / Next | Button ×2 | Tracked Accounts — bawah | Pindah halaman (client-side) | `DiscoverDirectoryView.tsx:565` | D |
| 100 | Reset filter (empty state) | Button | Tracked Accounts — empty state | Reset saat hasil kosong | `DiscoverDirectoryView.tsx:542` | E |
| 101 | Add creator (header + empty state) | Button ×2 | My Creators | Buka alur tambah creator | `CreatorRoster.tsx:213 · 331` | B |
| 102 | Reset filters ×2 | Button | My Creators | Kembalikan filter ke default | `CreatorRoster.tsx:271 · 344` | C |
| 103 | Search input | Text Input + debounce | My Creators | Cari creator org | `CreatorRoster.tsx:251` | C |
| 104 | Platform chips | Chips (single, dinamis) | My Creators | Filter platform | `CreatorRoster.tsx:287` | C |
| 105 | Category chips | Chips (single, dinamis) | My Creators | Filter kategori | `CreatorRoster.tsx:297` | C |
| 106 | Tier chips | Chips (single, dinamis) | My Creators | Filter tier | `CreatorRoster.tsx:306` | C |
| 107 | Location select | Select (dinamis) | My Creators | Filter kota | `CreatorRoster.tsx:262` | C |
| 108 | Followers select | Select | My Creators | Ambang follower | `CreatorRoster.tsx:264` | C |
| 109 | Engagement select | Select | My Creators | Ambang ER | `CreatorRoster.tsx:266` | C |
| 110 | Card open / Profile | Card + Button | My Creators — kartu | Buka detail creator | `CreatorRoster.tsx:399 · 464` | B |
| 111 | Follow run | Card Action | My Creators — kartu | Buka layar profiling berjalan | `CreatorRoster.tsx:462` | B |
| 112 | Refresh | Button | My Creators — kartu | POST refresh profiling | `CreatorRoster.tsx:474` | B |
| 113 | Monitoring toggle | Toggle | My Creators — kartu | PATCH monitoringEnabled | `CreatorRoster.tsx:480` | B |
| 114 | Find similar | Button | My Creators — kartu | Ke Smart Discovery | `CreatorRoster.tsx:490` | B |
| 115 | Reference search input | Text Input | Smart Discovery | Cari creator acuan di roster | `SmartDiscovery.tsx:219` | C |
| 116 | Reference result pick | Row (clickable) | Smart Discovery | Pilih creator acuan | `SmartDiscovery.tsx:547` | B |
| 117 | Clear reference | Button | Smart Discovery | Hapus acuan & hasil | `SmartDiscovery.tsx:301` | B |
| 118 | Platform chips (+ Same as reference) | Chips (single) | Smart Discovery | Batasi platform kandidat | `SmartDiscovery.tsx:401` | C |
| 119 | Tier select | Select (hardcoded) | Smart Discovery | Batasi tier kandidat | `SmartDiscovery.tsx:384` | C |
| 120 | Location select | Select (hardcoded 7 kota) | Smart Discovery | Batasi kota kandidat | `SmartDiscovery.tsx:389` | C |
| 121 | Rate card select | Select (hardcoded 5 opsi) | Smart Discovery | Plafon harga kandidat | `SmartDiscovery.tsx:380` | C |
| 122 | Lower price than reference | Chip / Toggle | Smart Discovery | Hanya kandidat lebih murah | `SmartDiscovery.tsx:393` | C |
| 123 | Find similar (jalankan) | Button (primary) | Smart Discovery | GET /discover/creators/similar | `SmartDiscovery.tsx:413` | B |
| 124 | Go to roster | Button | Smart Discovery | Ke My Creators | `SmartDiscovery.tsx:351` | A |
| 125 | Go to compare | Button | Smart Discovery | Ke tab Compare | `SmartDiscovery.tsx:462` | A |
| 126 | Result card — Compare / Open | Button ×2 | Smart Discovery — kartu hasil | Bandingkan / buka creator | `SmartDiscovery.tsx:635 · 647` | B |

**Sebaran per layar:**

| Layar / area | Jumlah entri |
| --- | ---: |
| Shell | 6 |
| Sidebar kiri (global) | 1 |
| Hub | 3 |
| Creator Database | 53 |
| Panel Quick Insight | 5 |
| Modal harga roster | 3 |
| AddKolDirectoryModal | 5 |
| Tracked Accounts | 24 |
| My Creators | 14 |
| Smart Discovery | 12 |
| **Total** | **126** |

---

## 2. Pengelompokan kontrol

| Grup | Jumlah | Isi |
| --- | ---: | --- |
| **A. Navigation** | 6 | Breadcrumb, sidebar nav, TabStrip, shelf action Hub, Go to roster/compare |
| **B. Discovery Actions** | 50 | Add KOL, Add creator, cart, compare, favorite, bookmark, find similar, bulk action, export, pricing modal, refresh, monitoring |
| **C. Search & Filtering** | 54 | Semua kotak pencarian, chip, slider, select, toggle filter, preset, saved lists, panel toggle |
| **D. Sorting & Display** | 10 | Sort dropdown, column header sort, column chooser, view toggle, pagination, result count |
| **E. Other** | 6 | Close/cancel modal, retry, empty-state action |
| **Total** | **126** | |

Yang masuk **audit filter (Fase 3)** adalah grup C yang benar-benar menyaring hasil — 63 filter. Kontrol grup C yang bukan filter (panel toggle, collapse, accordion, clear, saved lists) diaudit sebagai aksi di Fase 4.

---

## 3. Discovery Filter Audit

63 filter ditemukan dari inventaris di atas, tersebar di 5 permukaan, 3 sumber data, 2 database. Tabel 13 kolom penuh ada di `discovery-filter-audit.csv`; di bawah ini bentuk ringkasnya agar terbaca di satu halaman.

| Permukaan | Endpoint | Database | Universe | Cara filter |
| --- | --- | --- | ---: | --- |
| A. Creator Database | `/discover/kol-directory` | KOL (`kol` @ 10.100.14.216) | 7.720 baris aktif | Server-side SQL |
| B. Tracked Accounts | `/discover/profiles` | Warehouse (`tsdb`) | 53 akun / 23 org | Client-side penuh |
| C. My Creators | `/discover/creators` | Warehouse (`tsdb`) | 4 baris / 1 org | Server-side SQL |
| D. Smart Discovery | `/discover/creators/similar` | KOL + Warehouse | 7.720 kandidat | Server + filter memori |
| E. Discovery Hub | — | — | — | Tidak ada kontrol filter (lihat 4.3) |

### A. Creator Database (sidebar)

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Platform** | Chips (single-select) | All Platform / Instagram / TikTok — daftar hardcoded `PLATFORMS`; angka count dinamis dari | GET /discover/kol-directory?platform=instagram → SQL `b.platform = $2` | `platform_id → key` | 7.496 / 7.720 = 97,1% | Param dikirim ke API, backend menerapkan WHERE. Count per chip diisi dari facets sesudah paint pertama. | 🟢 YES |
| 2 | **Tier** | Chips (single-select), muncul hanya setelah Platform dipilih | All tiers + 5 band dinamis dari `kol_tiers` (Nano 1K–9.999, Micro 10K–49.999, Mid-tier 50K | GET ...?tier=Micro → SQL `b.tier = ANY($4)` | `followers_count BETWEEN min_followers AND max_followers → t.name` | 7.194 / 7.720 = 93,2% | Server-side. Count di tiap band roster-wide, bukan per platform yang sedang dipilih. | 🟡 PARTIAL |
| 3 | **Format** | Chips (multi-select) — DIRENDER DISABLED | Instagram: All formats/Feed Post/Reels/Story/Carousel/Content · TikTok: All formats/Video/ | No API integration — `onClick={() => {}}` | `NOT FOUND` | 0 / 7.720 = 0% | Chip dirender `disabled` dengan teks alasan di bawahnya. Klik tidak melakukan apa-apa dan tidak ada network request. | 🔴 NOT AVAILABLE |
| 4 | **Min. followers** | Range Slider (12 langkah indeks) | 0 / 1K / 5K / 10K / 25K / 50K / 100K / 250K / 500K / 1M / 5M / 10M — Hardcoded `FOLLOWER_S | GET ...?follMin=1000000 → SQL `b.followers >= $9` | `followers_count` | 7.498 / 7.720 = 97,1% | Server-side. Slider menyimpan indeks, nilai absolut dikirim ke API. | 🟡 PARTIAL |
| 5 | **Min. engagement** | Range Slider (0–10, step 0,1) | 0%–10% — Hardcoded | GET ...?minEr=3 → SQL `b.er_pct >= $5` | `engagement_rate (satuan persen)` | 1.756 / 7.720 = 22,7% | Server-side. Absent ≠ 0 sudah ditangani benar di route (`num()` mengembalikan null untuk param kosong). | 🟡 PARTIAL |
| 6 | **Max. rate card** | Range Slider (12 langkah indeks) | 0 / 500rb / 1jt / 2,5jt / 5jt / 10jt / 25jt / 50jt / 100jt / 250jt / 500jt / 1mlr — Hardco | GET ...?maxRate=5000000 → SQL `EXISTS (... JOIN l1_silver.unified_rate_card u .. | `u.fee` | 0 / 7.720 = 0% | Query jalan dan valid, tapi `l1_silver.unified_rate_card` berisi 0 baris. Setiap kali slider digeser dari Any, grid langsung koson | 🟠 MISMATCH |
| 7 | **Audience — Age (top audience group)** | Chips (multi-select) — DIRENDER DISABLED | All / 13–17 / 18–24 / 25–34 / 35–44 / 45–54 / 55+ — Hardcoded `AGE_BANDS` | No API integration | `audience_type='age' — TIDAK ADA BARIS` | 0 / 7.720 = 0% | Chip disabled, klik no-op. | 🔴 NOT AVAILABLE |
| 8 | **Audience — Major Female (%)** | Range Slider — DIRENDER DISABLED | 0–100%, value dipaku 0 | No API integration — `onChange={() => {}}` | `dimension_key='female'` | 23 / 7.720 = 0,3% | Slider disabled, value dipaku 0, onChange kosong. | 🔴 NOT AVAILABLE |
| 9 | **Audience — Major Male (%)** | Range Slider — DIRENDER DISABLED | 0–100%, value dipaku 0 | No API integration | `dimension_key='male'` | 23 / 7.720 = 0,3% | Slider disabled, value dipaku 0, onChange kosong. | 🔴 NOT AVAILABLE |
| 10 | **Category** | Chips (single-select) | All + 28 kategori dinamis dari facets (Lifestyle 2.522, Beauty 1.271, Moms 581, Entertainm | GET ...?category=Beauty → SQL `$3 = ANY (b.categories)` | `COALESCE(category_ids, ARRAY[category_id]) → kc.name` | 4.174 / 7.720 = 54,1% | Server-side, opsi dinamis dari DB. Kolom lama `category_id` dan kolom baru `category_ids` dibaca dua-duanya. | 🟡 PARTIAL |
| 11 | **Location — Creator location** | Select — DIRENDER DISABLED | Hanya satu opsi: 'All cities' — Hardcoded | No API integration | `creator_city` | 0 / 7.720 = 0% | Select dirender disabled karena tidak ada kota yang bisa jadi pilihan. | 🔴 NOT AVAILABLE |
| 12 | **Location — Audience location** | Select — DIRENDER DISABLED | Hanya satu opsi: 'All cities' — Hardcoded | No API integration | `geo_key / geo_level` | 23 / 7.720 = 0,3% | Select dirender disabled. | 🔴 NOT AVAILABLE |
| 13 | **Other — Min. authenticity** | Range Slider — DIRENDER DISABLED | 0–100, value dipaku 0 | No API integration | `NOT FOUND` | 0 / 7.720 = 0% | Slider disabled, onChange kosong. | 🔴 NOT AVAILABLE |
| 14 | **Other — Min. brand fit** | Range Slider — DIRENDER DISABLED | 0–100, value dipaku 0 | No API integration | `NOT FOUND` | 0 / 7.720 = 0% | Slider disabled, onChange kosong. | 🔴 NOT AVAILABLE |
| 15 | **Other — Max. paid ratio** | Range Slider — DIRENDER DISABLED | 0–100%, value dipaku 100 | No API integration | `is_sponsored` | 30 / 7.720 = 0,4% | Slider disabled, onChange kosong. | 🔴 NOT AVAILABLE |
| 16 | **Other — Min. campaigns** | Range Slider — DIRENDER DISABLED | 0–15, value dipaku 0 | No API integration | `campaign_id (count per kol)` | 0 / 7.720 = 0% | Slider disabled, onChange kosong. | 🔴 NOT AVAILABLE |
| 17 | **Verified creators only** | Toggle (switch) | on / off | GET ...?verified=1 → SQL `LOWER(COALESCE(verified_status,'')) IN ('verified','tr | `verified_status` | 454 / 7.720 = 5,9% (non-NULL: 931 = 12,1%) | Server-side. Menyala → hasil turun dari 7.720 ke 454 baris. | 🟡 PARTIAL |

### A. Creator Database (toolbar)

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | **Search (kotak pencarian)** | Text Input + debounce 350ms | Teks bebas | GET ...?q=raffi → SQL `b.username ILIKE '%' \|\| $1 \|\| '%'` | `username` | 7.498 / 7.720 = 97,1% | Server-side dengan debounce 350ms, reset ke halaman 1. `%` dan `_` di-escape jadi literal. | 🟡 PARTIAL |
| 19 | **Category quick-chips** | Chips (single-select), 6 teratas | 6 kategori dengan count tertinggi dari facets | Sama dengan filter Category — `category=` | `category_ids → kc.name` | 4.174 / 7.720 = 54,1% | Berbagi state dengan sidebar; menekan chip mengubah filter yang sama. | 🟡 PARTIAL |
| 20 | **Sort** | Dropdown (single-select) | Followers / Engagement / Last updated / Name — Hardcoded `SORTOPTS` | GET ...?sort=followers&dir=desc → `ORDER BY <SCRAPED_FIRST>, col DIR NULLS LAST` | `followers_count / engagement_rate / last_refreshed_at / username` | 97,1% / 22,7% / 97,1% / 97,1% | Server-side. Setiap urutan selalu didahului grup provenance (Live → Calculated → Estimated). | 🟡 PARTIAL |
| 21 | **Saved lists** | Dropdown + Text Input (simpan/terapkan) | Daftar yang dibuat user sendiri | Client-side only — `localStorage['autometric.kolDirectory.lists.<orgId>']` | `NOT FOUND` | Unknown (per-browser) | Disimpan hanya di localStorage browser. Tidak ada request ke API dan tidak ada tabel penyimpan. | 🟡 PARTIAL |

### A. Creator Database (preset)

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 22 | **Preset: Best Performing** | Chip (single-select, toggle) | Hardcoded — 8 preset di `CREATOR_PRESETS` | Set `erMin: 3` → dikirim sebagai `minEr=3`; ranking `s.quality` client-side | `engagement_rate` | 219 / 7.720 = 2,8% | Filter server-side jalan benar. Ranking-nya dihitung ulang hanya atas 12 baris halaman yang sedang dimuat, memakai `quality` dari  | 🟡 PARTIAL |
| 23 | **Preset: High Engagement** | Chip (single-select, toggle) | Hardcoded | Set `erMin: 4` → `minEr=4`; ranking `erPct` client-side | `engagement_rate` | 178 / 7.720 = 2,3% | Filter server-side jalan, ranking memakai nilai terukur. | 🟡 PARTIAL |
| 24 | **Preset: Fast Growing** | Chip (single-select, toggle) | Hardcoded | `filters: {}` — TIDAK ADA parameter API. Ranking `s.growthMonthly` client-side | `NOT FOUND` | 0 / 7.720 = 0% | Menekan chip tidak mengubah query apapun. Yang terjadi hanya 12 baris di halaman aktif diurutkan ulang memakai angka pertumbuhan h | 🟠 MISMATCH |
| 25 | **Preset: High Audience Quality** | Chip (single-select, toggle) | Hardcoded | `filters: {}` — TIDAK ADA parameter API. Ranking `(audienceQuality + authenticit | `NOT FOUND` | 0 / 7.720 = 0% | Sama seperti Fast Growing: hanya menata ulang 12 baris halaman aktif dengan angka hasil generator. | 🟠 MISMATCH |
| 26 | **Preset: Best Brand Fit** | Chip (single-select, toggle) | Hardcoded | `filters: {}` — TIDAK ADA parameter API. Ranking `s.brandFit` | `NOT FOUND` | 0 / 7.720 = 0% | Hanya menata ulang 12 baris halaman aktif dengan `brandFit` hasil generator. | 🟠 MISMATCH |
| 27 | **Preset: Emerging Creators** | Chip (single-select, toggle) | Hardcoded | `filters: {}` — TIDAK ADA parameter API. Ranking memberi 0 ke creator ≥100rb fol | `followers_count` | 0 / 7.720 = 0% | Batas 100rb follower TIDAK dikirim ke server. Grid tetap diurutkan followers desc, jadi baris teratas justru creator terbesar yang | 🟠 MISMATCH |
| 28 | **Preset: Campaign Ready** | Chip (single-select, toggle) | Hardcoded | Set `verifiedOnly: true` → `verified=1`; ranking `s.rateCount > 0 ? 100 : 0` | `verified_status + u.fee` | 454 / 7.720 = 5,9% (verified); 0 / 7.720 = 0% (rate card) | Separuh filternya jalan (verified), separuh lagi tidak: `rateCount` selalu 0 karena tabel rate card kosong, jadi seluruh hasil dap | 🟡 PARTIAL |
| 29 | **Preset: Cost Efficient** | Chip (single-select, toggle) | Hardcoded | `filters: {}` — TIDAK ADA parameter API. Ranking `cpmOf(s)` | `u.fee ÷ followers_count` | 0 / 7.720 = 0% | `cpmOf()` mengembalikan null saat `rateFrom` falsy, dan `rateFrom` selalu null. Semua creator dapat rank 0, urutan grid tidak beru | 🟠 MISMATCH |

### B. Tracked Accounts

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | **Pencarian (q)** | Text Input | Teks bebas | Client-side filter atas payload penuh dari GET /discover/profiles | `username / b.name` | Semua akun ter-load (org-scoped) | Tidak ada network request per ketikan — seluruh roster org di-fetch sekali lalu difilter di memori. | 🟢 YES |
| 31 | **Tipe akun** | Chips (single-select) | Semua / Brand / Kompetitor — Hardcoded | Client-side `a.relation !== filters.relation` | `relation (turunan SQL)` | 45 owned + 7 competitor links | Filter client-side atas nilai yang benar-benar dari SQL. | 🟢 YES |
| 32 | **Platform** | Chips (single-select) | Dinamis dari akun yang ter-load | Client-side `a.platform !== filters.platform` | `platform_id → key` | Semua akun ter-load | Filter client-side atas nilai nyata; opsi chip diturunkan dari data yang ada. | 🟢 YES |
| 33 | **Kategori** | Chips (single-select) | Fitness / Lifestyle / Beauty / Food / Tech / Fashion / Travel — Hardcoded `CATEGORIES` (vo | Client-side `p.category.value !== filters.category` | `NOT FOUND` | 0 / total akun = 0% | Filter memang menyaring, tapi nilai yang disaring dihasilkan `est(pick(seed,'cat',CATEGORIES))` — hash FNV-1a atas id akun. | 🟠 MISMATCH |
| 34 | **Lifestyle** | Chips (single-select) | Urban Active / Family First / Health Conscious / Trend Seeker / Budget Savvy / Premium Buy | Client-side `p.lifestyle.value !== filters.lifestyle` | `NOT FOUND` | 0 / total akun = 0% | Menyaring nilai hasil hash `est(pick(seed,'life',LIFESTYLES))`. | 🔴 NOT AVAILABLE |
| 35 | **Lokasi** | Chips (single-select) | Jakarta / Bandung / Surabaya / Medan / Yogyakarta / Bali / Makassar — Hardcoded `LOCATIONS | Client-side `p.location.value !== filters.location` | `NOT FOUND` | 0 / total akun = 0% | Menyaring nilai hasil hash `est(pick(seed,'loc',LOCATIONS))`. | 🔴 NOT AVAILABLE |
| 36 | **Tier** | Chips (single-select) | Nano / Micro / Mid-tier / Macro / Mega — Hardcoded `TIERS` | Client-side `p.tier.value !== filters.tier` | `tierOf(followers)` | 0 / total akun = 0% (follower nyata) | `tier` ditandai `calc()` — dihitung dari `followers`, tapi `followers` sendiri `est()`: 'Diperkirakan dari rata-rata views (follow | 🟠 MISMATCH |
| 37 | **Umur dominan** | Chips (single-select) | 13-17 / 18-24 / 25-34 / 35-44 / 45-54 / 55+ — Hardcoded `AGE_BANDS` | Client-side `p.topAge.value !== filters.age` | `NOT FOUND` | 0 / total akun = 0% | Menyaring `est(topAge)` dari distribusi umur hasil generator. | 🔴 NOT AVAILABLE |
| 38 | **Gender mayoritas** | Chips (single-select) | Semua / Perempuan / Laki-laki — Hardcoded | Client-side `p.genderSplit.value.female < 50` / `.male < 50` | `NOT FOUND` | 0 / total akun = 0% | Ambang 50% diterapkan pada `est(genderSplit)` hasil generator. | 🔴 NOT AVAILABLE |
| 39 | **Format konten** | Chips (single-select) | Dinamis dari format yang muncul di post akun ter-load | Client-side `p.topFormat.value !== filters.format` | `format / post_type` | 245 / 1.700 post = 14,4% punya kolom format | `topFormat` ditandai `live()` — dihitung dari post nyata milik akun. | 🟡 PARTIAL |
| 40 | **Ambang: Followers** | Select (4 opsi) | Semua / ≥10K / ≥100K / ≥1M — Hardcoded `FOLLOWER_OPTS` | Client-side `p.followers.value < filters.followersMin` | `diperkirakan dari avg views` | 0 / total akun = 0% | Menyaring `est(followers)` — 'Diperkirakan dari rata-rata views (follower belum disinkronkan)'. | 🟠 MISMATCH |
| 41 | **Ambang: Engagement rate** | Select (4 opsi) | Semua / ≥1% / ≥3% / ≥5% — Hardcoded `ER_OPTS` | Client-side `p.erPct.value < filters.erMin` | `engagement per post ÷ views` | Dihitung dari post akun yang ada | `erPct` ditandai `live()` — rata-rata ER per post nyata. | 🟢 YES |
| 42 | **Ambang: Est. reach** | Select (4 opsi) | Semua / ≥50K / ≥250K / ≥1M — Hardcoded `REACH_OPTS` | Client-side `p.estimatedReach.value < filters.reachMin` | `avg views × faktor reach` | Turunan dari views | `estimatedReach` ditandai `calc()` dengan basis 'Rata-rata views dikali faktor reach per akun'. | 🟡 PARTIAL |
| 43 | **Ambang: Authenticity** | Select (4 opsi) | Semua / ≥75% / ≥85% / ≥90% — Hardcoded `AUTH_OPTS` | Client-side `p.authenticity.value < filters.authMin` | `NOT FOUND` | 0 / total akun = 0% | Menyaring `est(authenticity)` hasil generator. | 🔴 NOT AVAILABLE |
| 44 | **Ambang: Brand fit** | Select (4 opsi) | Semua / ≥50 / ≥65 / ≥80 — Hardcoded `FIT_OPTS` | Client-side `p.brandFit.value < filters.brandFitMin` | `audienceQuality 35% + authenticity 30% + ER 20% + konsistensi 15%` | Hanya komponen ER (20%) yang terukur | `brandFit` ditandai `calc()` dan formulanya ditampilkan di tooltip. | 🟡 PARTIAL |
| 45 | **Ambang: Rasio paid** | Select (4 opsi) | Semua / ≤25% / ≤50% / ≤75% — Hardcoded `PAID_OPTS` | Client-side `p.paidRatio.value > filters.paidMax` | `penanda campaign/boosted per post` | Dihitung dari post akun yang ada | `paidRatio` ditandai `live()` — 'Bagian post bertanda campaign atau boosted'. | 🟢 YES |
| 46 | **Hanya terverifikasi** | Toggle | on / off | Client-side `filters.verifiedOnly && !p.verified.value` | `NOT FOUND` | 0 / total akun = 0% | Menyaring `est(rnd(seed,'ver') > 0.35)` — koin ber-seed dengan peluang menyala 65%. | 🟠 MISMATCH |
| 47 | **Hanya yang punya rate card** | Toggle | on / off | Client-side `filters.ratedOnly && !p.hasRate`; sumber `listRateCards(orgId)` | `base_rate` | 0 / total akun = 0% | `public.discover_rate_cards` berisi 0 baris, jadi `hasRate` selalu false dan toggle ini selalu mengosongkan grid. | 🟠 MISMATCH |
| 48 | **Sort** | Select (10 opsi) | Best in campaign / Least in campaign / Best brand fit / Most followers / Highest reach / H | Client-side `[...out].sort(cmp[filters.sort])` | `campuran live/calculated/estimated` | 3 dari 10 kunci terukur (ER, posts, name) | Diurutkan di memori setelah filter. Default-nya `brandFit` — kunci yang dimodelkan. | 🟡 PARTIAL |

### C. My Creators

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 49 | **Pencarian (q)** | Text Input + debounce | Teks bebas | GET /discover/creators?q= → SQL `(username ILIKE $n OR display_name ILIKE $n)` | `username, display_name` | 4 / 4 = 100% | Server-side. Mencari username DAN display_name — lebih lengkap dari Creator Database. | 🟢 YES |
| 50 | **Platform** | Select | Dinamis dari facets org | GET ...?platform= → SQL `platform = $n` | `platform` | 4 / 4 = 100% (semuanya instagram) | Server-side, opsi dari facets. | 🟢 YES |
| 51 | **Kategori** | Select | Dinamis dari facets org | GET ...?category= → SQL `category = $n` | `category` | 0 / 4 = 0% | Server-side dan benar, tapi dropdown-nya kosong karena facets tidak mengembalikan kategori apa pun. | 🔴 NOT AVAILABLE |
| 52 | **Location** | Select | Dinamis dari facets org (`cityOptions`) | GET ...?city= → SQL `city = $n` | `city` | 0 / 4 = 0% | Server-side dan benar, dropdown kosong. | 🔴 NOT AVAILABLE |
| 53 | **Tier** | Select | Dinamis dari facets org | GET ...?tier= → SQL `tier = $n` | `tier` | 4 / 4 = 100% | Server-side, opsi dari facets. | 🟢 YES |
| 54 | **Status profiling** | Select | Dinamis dari data | GET ...?status= → SQL `profiling_status = $n` | `profiling_status` | 4 / 4 = 100% (semuanya 'ready') | Server-side. | 🟢 YES |
| 55 | **Followers** | Select (SelectPill) | Hardcoded `FOLLOWER_STEPS` | GET ...?follMin= → SQL `followers >= $n` | `followers` | 4 / 4 = 100% | Server-side. | 🟢 YES |
| 56 | **Engagement** | Select (SelectPill) | Hardcoded `ER_STEPS` | GET ...?minEr= → SQL `er_pct >= $n` | `er_pct` | 3 / 4 = 75% | Server-side, dengan penjagaan `if (f.minErPct && f.minErPct > 0)` sehingga 0 tidak ikut jadi kondisi. | 🟢 YES |

### D. Smart Discovery

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 57 | **Reference creator (pencarian)** | Text Input + hasil klik | Hasil dari Creator Database | GET /discover/kol-directory?q=&pageSize=12 | `username` | 7.498 / 7.720 = 97,1% | Server-side lewat endpoint Creator Database. | 🟢 YES |
| 58 | **Platform** | Select (SelectPill) | Dinamis / default mengikuti platform acuan | GET /discover/creators/similar?platform= → diteruskan ke listKolDirectory | `platform_id → key` | 7.496 / 7.720 = 97,1% | Server-side. | 🟢 YES |
| 59 | **Tier** | Select (SelectPill) | Any tier / Nano / Micro / Mid-tier / Macro / Mega — Hardcoded `TIERS` (vocab.ts) | GET ...?tier= → diteruskan sebagai `tiers: [tier]` | `followers_count → t.name` | 7.194 / 7.720 = 93,2% | Server-side. | 🟡 PARTIAL |
| 60 | **Location** | Select (SelectPill) | Any location / Jakarta / Bandung / Surabaya / Medan / Yogyakarta / Bali / Makassar — Hardc | GET ...?city= → `.filter(c => (c.city ?? '').toLowerCase() === city)` | `creator_city / city` | 0 / 7.720 = 0% | Filter dieksekusi di server tapi atas kolom yang seluruhnya NULL. Memilih kota apa pun → 0 kandidat, tanpa penjelasan. | 🟠 MISMATCH |
| 61 | **Rate card** | Select (SelectPill) | Any rate card / Under 5 juta / Under 10 juta / Under 25 juta / Under 50 juta — Hardcoded ` | GET ...?maxRate= → diteruskan ke listKolDirectory `maxRate` | `u.fee` | 0 / 7.720 = 0% | Memilih plafon apa pun → 0 kandidat, karena tabel rate card kosong. | 🟠 MISMATCH |
| 62 | **Lower price than the reference** | Chip / Toggle | on / off | GET ...?cheaper=1 → `maxRate = reference.rateFrom - 1` | `u.fee` | 0 / 7.720 = 0% | `reference.rateFrom` selalu null, sehingga cabang ini tidak pernah memasang plafon dan toggle-nya jadi no-op diam. | 🔴 NOT AVAILABLE |

### E. Discovery Hub

| # | Filter | UI Control | Options | API / Logic | DB Column | Coverage | Actual Behavior | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 63 | **Search box (hub)** | Text Input + submit | Teks bebas | Menulis `?q=` ke URL → di-seed ke `query` dan `search` KolDirectoryPage | `username` | 7.498 / 7.720 = 97,1% | Bukan filter tersendiri — hanya meneruskan query ke Creator Database. Di-seed ke dua state sekaligus agar tidak memicu dua request | 🟢 YES |

Kolom `Expected Behavior`, `DB Table`, `Data Available`, `UI/DB Match`, dan `Notes` lengkap ada di CSV.

---

## 4. Discovery Button & Action Audit

26 aksi non-filter, ditelusuri dari UI sampai database.

| UI Element | Type | Expected Behavior | Actual Behavior | Frontend File | API / Logic | Database Impact | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Add KOL (shell + Creator Database)** | Button | Buka alur tambah KOL dan simpan creator baru | Membuka modal, memvalidasi handle lewat /check, lalu POST menulis 3 tabel dan memulai scrape latar | `DiscoverWorkspace.tsx:376 · KolDirectoryPage.tsx:603 · AddKolDirectoryModal.tsx` | POST /api/kol-directory/add/check → POST /api/kol-directory/add → polling GET .../status | INSERT `kol_directory` + `social_account` + `kol_social_account` (DB KOL) | 🟢 YES |
| **Favorite (ikon hati, kartu creator)** | Icon Toggle | Menandai creator sebagai favorit dan menyimpannya | Mengubah `useState` biasa dan menampilkan toast. Hilang saat refresh atau pindah view. Tidak ada layar/filter yang membacanya | `KolDirectoryPage.tsx:266, 557, 981` | No API — state komponen murni | Tidak ada | 🟣 UI ONLY |
| **Quick Insight — Shortlist** | Action Button | Menambahkan creator ke shortlist | Menoggle `favorites` — set yang sama persis dengan tombol Favorite di kartu | `KolDirectoryPage.tsx:912-917 · CreatorQuickInsight.tsx:265` | No API | Tidak ada | 🟣 UI ONLY |
| **Add to compare (kartu + bulk)** | Icon Toggle / Button | Menambahkan creator ke perbandingan | Menulis ke localStorage bucket `compare` per org; tab Compare membacanya dan mengambil datanya lewat `?ids=` | `KolDirectoryPage.tsx:982, 860 · useDiscoverSelection.ts` | GET /discover/kol-directory?ids=<uuid,…> | Tidak ada tulis DB; baca via `?ids=` (maks 50, tervalidasi UUID) | 🟢 YES |
| **Add to cart (kartu + Quick Insight)** | Icon Toggle / Button | Menambahkan creator ke keranjang order | Kalau creator sudah punya harga org → masuk keranjang. Kalau belum → membuka modal harga, bukan gagal diam | `KolDirectoryPage.tsx:495-510, 984` | Baca GET /discover/rates; simpan di localStorage | Tidak menulis; harga dihitung ulang server saat checkout | 🟡 PARTIAL |
| **Bulk: Add to Cart** | Button | Menambahkan semua creator terpilih ke keranjang | Menambahkan hanya yang sudah berharga; sisanya dilewati diam-diam dengan hitungan di toast | `KolDirectoryPage.tsx:524-540, 861` | localStorage cart | Tidak ada | 🟡 PARTIAL |
| **Pricing modal — Simpan** | Button (primary) | Menyimpan base rate creator untuk org ini | PUT tervalidasi: id roster dicek keberadaannya dulu, lalu upsert, lalu daftar harga dikembalikan segar | `KolDirectoryPage.tsx:1524 · rates/route.ts:59` | PUT /api/organizations/[id]/discover/rates | UPSERT `public.discover_roster_rate_cards` (warehouse) | 🟠 MISMATCH |
| **Bulk: Export CSV / Excel** | Button ×2 | Mengekspor hasil Discovery | Mengunduh file dari baris **terpilih saja**; kalau tidak ada yang dipilih bulk bar tidak muncul sehingga ekspor tidak bisa diakses | `KolDirectoryPage.tsx:862, 865 · exportData.ts` | Client-side blob download | Tidak ada | 🟡 PARTIAL |
| **Compare (toolbar)** | Button | Membuka tab Compare berisi creator terpilih | Navigasi ke `?tab=compare`; isinya dibaca dari bucket localStorage yang sama | `KolDirectoryPage.tsx:596` | router.push(tabHref(orgSlug,'compare')) | Tidak ada | 🟢 YES |
| **Find similar (kartu, tabel, hub)** | Icon Button | Mencari creator serupa dengan acuan ini | Navigasi ke Smart Discovery dengan `?creator=<id>&refsrc=roster`, lalu layar itu memuat acuannya sendiri | `KolDirectoryPage.tsx:990, 1213 · DiscoverWorkspace.tsx:202` | GET /discover/kol-directory?ids= lalu GET /discover/creators/similar | Baca dari DB KOL + warehouse | 🟢 YES |
| **Quick Insight (buka kartu creator)** | Card click → Panel | Menampilkan ringkasan creator | Panel terbuka **tanpa satu pun network request**; seluruh isinya dihitung dari `sampleIntel(creator)` | `KolDirectoryPage.tsx:556, 909 · CreatorQuickInsight.tsx:60` | No API — `sampleIntel()` dari kolSample.ts | Tidak ada | 🟡 PARTIAL |
| **Saved lists (simpan / terapkan / hapus)** | Button + Dropdown | Menyimpan kombinasi pencarian & filter | Menulis dan membaca `localStorage['autometric.kolDirectory.lists.<orgId>']`; menerapkan set filter kembali dengan benar | `KolDirectoryPage.tsx:313-323, 692-724` | No API | Tidak ada | 🟡 PARTIAL |
| **Pagination (Creator Database)** | Buttons | Pindah halaman hasil | Mengirim `page=` ke API; total dihitung server dengan `COUNT(*) OVER()` di round trip yang sama | `KolDirectoryPage.tsx:840 · kolDirectory.ts:298` | GET …?page=&pageSize=12 | Query DB KOL | 🟢 YES |
| **Pagination (Tracked Accounts)** | Buttons | Pindah halaman hasil | Memotong array hasil di memori; seluruh roster org sudah di-fetch sekali di awal | `DiscoverDirectoryView.tsx:565` | Tidak ada request per halaman | Tidak ada | 🟢 YES |
| **View toggle Card / Table (2 layar)** | Segmented Button | Mengganti tampilan daftar | Berganti seketika; di Creator Database state-nya tidak persisten, di Tracked Accounts ikut tersimpan di filter | `KolDirectoryPage.tsx:779 · DiscoverDirectoryView.tsx:476` | No API | Tidak ada | 🟡 PARTIAL |
| **Column chooser (2 layar)** | Checkbox list | Memilih kolom tabel yang tampil | Berfungsi; Tracked Accounts menyimpan sebagai daftar kolom yang **disembunyikan** agar kolom baru tetap muncul untuk semua orang | `KolDirectoryPage.tsx:758 · DiscoverDirectoryView.tsx:457` | No API | Tidak ada | 🟡 PARTIAL |
| **Refresh creator (My Creators)** | Button | Menjalankan ulang profiling satu creator | POST nyata, lalu daftar dimuat ulang dan dipoll tiap 4 detik selama masih berjalan | `CreatorRoster.tsx:167` | POST /discover/creators/[id]/refresh | Tulis `discover_creator_runs`, update `discover_creators` (warehouse) | 🟢 YES |
| **Monitoring toggle (My Creators)** | Toggle | Menyalakan/mematikan monitoring creator | PATCH nyata, daftar dimuat ulang setelahnya | `CreatorRoster.tsx:181` | PATCH /discover/creators/[id] | UPDATE `discover_creators.monitoring_enabled` (warehouse) | 🟢 YES |
| **Bookmark / Shortlist (Tracked Accounts)** | Icon Toggle + Bulk | Menandai akun untuk ditinjau nanti | Menulis ke localStorage bucket `fav` dan `compare`; bertahan antar reload | `DiscoverDirectoryView.tsx:264-265, 519, 522, 756` | No API | Tidak ada | 🟡 PARTIAL |
| **Add to campaign (Tracked Accounts, bulk)** | Button | Mengirim akun terpilih ke alur ordering | Menambahkan id ke bucket shortlist lalu navigasi ke `?tab=order&view=ordering` | `DiscoverDirectoryView.tsx:526 · DiscoverWorkspace.tsx:466` | No API di titik ini | Tidak ada | 🟢 YES |
| **Find similar — Jalankan (Smart Discovery)** | Button (primary) | Mencari kandidat serupa | GET nyata dengan constraint; skor kemiripan dihitung server dari tier, platform, kategori, kota | `SmartDiscovery.tsx:413, 243` | GET /discover/creators/similar?ref=&source=&platform=&city=&tier=&maxRate=&cheaper= | Baca `kol_directory` (KOL) + `discover_creators` (warehouse) | 🟡 PARTIAL |
| **Shelf action + kartu (Hub)** | Button / Card | Membuka shelf lengkap atau creator | Navigasi benar; shelf diisi dari 3 query terpisah (`sort=created`, similar, populer) | `DiscoverHub.tsx:89, 111, 121, 221` | GET /discover/kol-directory + /discover/creators/similar | Baca DB KOL | 🟢 YES |
| **Search box Hub** | Text Input | Mengirim query ke Creator Database lewat `?q=` | **Tidak ada di UI.** `page.tsx` membaca, memangkas, dan membatasi `?q=` sampai 200 karakter, lalu men-seed-nya ke dua state agar tidak memicu dua request — tapi tidak ada satu pun komponen yang menulis parameter itu | `DiscoverWorkspace.tsx:138 (komentar) · discover/page.tsx:98` | Jalur ada, penulis tidak ada | Tidak ada | 🔴 NOT AVAILABLE |
| **Reset / Clear filters (semua layar)** | Button | Mengembalikan filter ke default | Berfungsi di keempat layar; Creator Database juga mereset halaman ke 1 dan membatalkan preset | `KolDirectoryPage.tsx:688, 393-395 · DiscoverDirectoryView.tsx:417 · CreatorRoster.tsx:271` | No API (memicu ulang fetch lewat perubahan state) | Tidak ada | 🟢 YES |
| **Retry (error state, Creator Database)** | Button | Memuat ulang setelah gagal | Menaikkan counter `reload` yang jadi dependensi effect fetch | `KolDirectoryPage.tsx:804, 386` | Mengulang GET /discover/kol-directory | Baca DB KOL | 🟢 YES |
| **Breadcrumb / TabStrip / Sidebar nav** | Nav controls | Berpindah antar tab dan view Discovery | Berfungsi; alias URL lama tetap teratasi lewat `resolveTabParams`, dan tab khusus Admin dijaga di server | `DiscoverWorkspace.tsx:347, 400 · tabs.ts:471 · OrgNav.tsx` | Navigasi Next.js | Tidak ada | 🟢 YES |

**Catatan teknis per aksi:**

* **Add KOL (shell + Creator Database)** — Alur paling lengkap di seluruh Discovery: cek duplikat, reuse baris lama yang belum ter-scrape, progres di-poll. Satu catatan: resolusi agency best-effort karena `public.user` masih kosong, jadi insert ke `agency_kol_accounts` dilewati.
* **Favorite (ikon hati, kartu creator)** — `favorites` di baris 266 adalah `useState<Set<string>>(new Set())` tanpa efek persistensi apa pun — `grep localStorage` di file ini hanya menemukan saved lists dan compare. Hook `useDiscoverSelection(orgId,'fav')` yang justru dibuat untuk ini sudah ada dan dipakai Tracked Accounts sebagai 'bookmarks', tapi tidak dipakai di sini. Hitungan '· N favorites' di baris 590 selalu kembali 0 setiap kali halaman dimuat ulang.
* **Quick Insight — Shortlist** — Satu state, dua nama: kartu menyebutnya 'favorit' (toast: 'Ditambahkan ke favorit'), panel menyebutnya 'shortlist' (toast: 'Ditambahkan ke shortlist'). Keduanya sama-sama tidak persisten. Nama 'shortlist' juga dipakai Tracked Accounts untuk hal berbeda (bucket `compare` yang persisten).
* **Add to compare (kartu + bulk)** — Bertahan antar layar dan antar reload, per org. Id roster disimpan berprefiks `roster:` supaya tidak tertukar dengan id akun warehouse.
* **Add to cart (kartu + Quick Insight)** — Logikanya benar, tapi `public.discover_roster_rate_cards` hanya berisi 2 baris untuk seluruh instalasi — jadi hampir setiap klik Add to Cart berakhir di modal harga, bukan di keranjang. Bukan bug, tapi jalur 'senang' hampir tidak pernah terjadi.
* **Bulk: Add to Cart** — Dengan 2 baris harga di seluruh instalasi, memilih 12 creator lalu menekan tombol ini secara praktis menghasilkan '0 masuk keranjang · 12 dilewati karena belum ada harga'. Toast-nya jujur, tapi tidak menawarkan jalan keluar (tidak ada bulk-pricing).
* **Pricing modal — Simpan** — Tombolnya benar dan menulis dengan aman. Masalahnya lintas-sistem: harga ini masuk ke `discover_roster_rate_cards` di warehouse, sementara filter 'Max. rate card' membaca `l1_silver.unified_rate_card` di database KOL. Jadi setelah user memberi harga, creator itu **tetap** tersaring keluar oleh filter harga, dan kolom 'Rate card' di tabel **tetap** menampilkan '—' karena kolom itu membaca `rateFrom` dari tabel yang kosong.
* **Bulk: Export CSV / Excel** — Implementasinya bagus — BOM UTF-8, `sep=` eksplisit untuk Excel Indonesia, dan proteksi formula injection (`=`,`+`,`-`,`@` diberi prefix kutip). Tapi tidak ada cara mengekspor seluruh hasil filter: user harus mencentang baris dulu, dan centang hanya bisa di tampilan tabel. Tracked Accounts justru sebaliknya — mengekspor semua hasil filter kalau tidak ada yang dipilih (`DiscoverDirectoryView.tsx:398`). Dua layar, dua arti untuk tombol bernama sama.
* **Compare (toolbar)** — Berfungsi. Tombol tidak dinonaktifkan saat belum ada yang dipilih, jadi bisa membuka tab Compare kosong — minor.
* **Find similar (kartu, tabel, hub)** — Alur lengkap dan benar, termasuk membedakan acuan dari roster (`refsrc=roster`) dan dari creator org.
* **Quick Insight (buka kartu creator)** — Followers, ER, dan Tier ditandai `real` dan memang datang dari baris roster. Tapi tiga section penuh — Audience, Content, Brand fit — ditandai `modelled` dan seluruhnya dihasilkan generator ber-seed, termasuk 'Konten terbaik' yang menampilkan judul post beserta angka views dan ER yang tidak pernah ada. Blok rate card di baris 168 tidak pernah tampil karena `s.rateFrom` selalu null.
* **Saved lists (simpan / terapkan / hapus)** — Berfungsi penuh dalam satu browser. Hilang saat ganti perangkat/browser atau clear site data, dan tidak bisa dibagi ke rekan tim. Tracked Accounts punya mekanisme serupa dengan key berbeda (`autometric:discover:lists:<orgId>`) yang juga tidak dibagi — dua daftar tersimpan yang tidak saling kenal.
* **Pagination (Creator Database)** — Server-side dan benar. Pilihan checkbox bertahan lintas halaman karena disimpan sebagai Map.
* **Pagination (Tracked Accounts)** — Aman untuk skala saat ini (53 akun di 23 org). Pola ini akan gagal kalau sumbernya diganti ke roster 7.720.
* **View toggle Card / Table (2 layar)** — Di Creator Database, checkbox bulk hanya ada di tampilan tabel — sehingga Export dan semua aksi bulk tidak bisa diakses sama sekali dari tampilan kartu, yang merupakan tampilan default.
* **Column chooser (2 layar)** — Creator Database menyimpan pilihan sebagai state komponen (hilang saat pindah view); Tracked Accounts menyimpannya di filter yang persisten. Kolom 'Rate card' di Creator Database selalu '—' karena membaca tabel kosong.
* **Refresh creator (My Creators)** — Termasuk sapuan `expireStaleRuns()` di endpoint list, sehingga run yang prosesnya mati tidak menggantung selamanya di status 'profiling'.
* **Monitoring toggle (My Creators)** — Berfungsi penuh.
* **Bookmark / Shortlist (Tracked Accounts)** — Persisten, tapi tidak ada satu pun filter atau layar yang menampilkan 'hanya yang di-bookmark'. `DEFAULT_FILTERS` tidak punya field bookmark. Jadi setelah menandai 20 akun, tidak ada cara memanggilnya kembali selain memindai daftar dan melihat ikonnya.
* **Add to campaign (Tracked Accounts, bulk)** — Berfungsi; alur ordering yang membaca shortlist-nya.
* **Find similar — Jalankan (Smart Discovery)** — Mesin kemiripannya nyata dan skornya beralasan. Tapi tiga dari lima constraint-nya (Location, Rate card, Lower price) tidak punya data sama sekali — memasang salah satunya menghasilkan 0 kandidat atau tidak berefek.
* **Shelf action + kartu (Hub)** — Berfungsi. Shelf 'Recommended' memakai kunci sort `created` yang tidak diekspos di dropdown Sort mana pun.
* **Search box Hub** — Komentar di `DiscoverWorkspace.tsx:138` berbunyi '`?q=` — what the hub\'s search box was submitted with', dan `DiscoverHub.tsx` tidak punya satu pun elemen `<input>`. Pencarian dari beranda Discovery hanya bisa dilakukan dengan mengetik URL sendiri. Parameter `?url=` (seed input Add KOL) juga tidak punya penulis di UI mana pun.
* **Reset / Clear filters (semua layar)** — `resetAll()` di Creator Database juga mengosongkan kotak pencarian — perilaku yang benar dan tidak selalu ada di layar lain.
* **Retry (error state, Creator Database)** — Pesan errornya juga informatif di development (host KOL tidak terjangkau, `PG_*_KOL` hilang, kredensial salah) alih-alih sekadar kode status.
* **Breadcrumb / TabStrip / Sidebar nav** — Proteksi rutenya nyata, bukan sekadar menyembunyikan menu: `mayOpenTab(tab, role)` di `page.tsx` mengalihkan Member yang mengetik URL tab Admin.

---

## 5. Broken / UI-Only Features

### 5.1 🟣 Favorite — menyimpan ke tempat yang tidak ada

`KolDirectoryPage.tsx:266` mendeklarasikan `const [favorites, setFavorites] = useState<Set<string>>(new Set())`. Tidak ada `useEffect` yang membacanya dari penyimpanan dan tidak ada yang menulisnya — `grep localStorage` di file itu hanya menemukan *saved lists* (baris 317, 323) dan *compare* (lewat hook terpisah).

Akibatnya, ikon hati di setiap kartu creator:

* menyala saat diklik dan memunculkan toast *"Ditambahkan ke favorit"*;
* ikut dihitung di baris ringkasan `· N favorites` (baris 590);
* **hilang total** saat halaman di-refresh atau saat berpindah view;
* **tidak dibaca oleh apa pun** — tidak ada filter "hanya favorit", tidak ada layar daftar favorit.

Yang membuat ini menonjol: hook persistensi untuk keperluan persis ini **sudah ada dan sudah dipakai** — `useDiscoverSelection(orgId, 'fav')` menyimpan ke `localStorage['autometric:discover:fav:<orgId>']`, dan Tracked Accounts memakainya sebagai *bookmarks* (`DiscoverDirectoryView.tsx:265`). Creator Database tidak memanggilnya.

Ditambah satu kebingungan penamaan: state yang sama disebut **favorit** di kartu dan **shortlist** di panel Quick Insight (`KolDirectoryPage.tsx:917`), sementara kata *shortlist* di Tracked Accounts menunjuk hal yang berbeda lagi (bucket `compare` yang justru persisten).

### 5.2 🔴 Search box Hub — parameter tanpa penulis

`DiscoverWorkspace.tsx:138` mendokumentasikan *"`?q=` — what the hub's search box was submitted with"*, dan `discover/page.tsx:98` menangani parameter itu dengan rapi: di-trim, dibatasi 200 karakter, lalu di-seed ke `query` **dan** `search` sekaligus supaya debounce tidak memicu request kedua.

Tetapi `DiscoverHub.tsx` **tidak punya satu pun elemen `<input>`**, dan pencarian seluruh source tidak menemukan komponen mana pun yang menulis `q=` ke URL Discovery. Beranda Discovery — layar yang dituju `?tab=directory` polos — tidak punya kotak pencarian sama sekali. Jalur parameternya hidup, penulisnya tidak pernah dibuat.

Parameter `?url=` (`addInput`, untuk men-seed input Add KOL) berada dalam kondisi yang sama: dibaca di `page.tsx`, diteruskan sampai `AddKolDirectoryModal`, tapi tidak ada UI yang menulisnya.

### 5.3 Kontrol yang sengaja dimatikan (bukan bug)

Sepuluh kontrol di sidebar Creator Database dirender `disabled`, diberi badge `Belum tersedia`, dan disertai kalimat alasan: Format (6/3 chip), Audience Age (7 chip), Major Female %%, Major Male %%, Creator location, Audience location, Min. authenticity, Min. brand fit, Max. paid ratio, Min. campaigns. `onClick`-nya `() => {}` dan `onChange`-nya kosong. Ini keputusan yang benar dan sebaiknya dipertahankan — dicatat di sini karena diminta, bukan sebagai temuan negatif.

Dua kalimat alasannya kini sudah tidak akurat: section Audience berbunyi *"Roster KOL tidak menyimpan data audiens"* dan section Location berbunyi *"Lokasi audiens tidak punya kolom sama sekali"*, padahal `l2_gold.audience_demographics_daily` (gender) dan `audience_geo_daily` (country + city) sudah terisi untuk 23 akun.

### 5.4 Kontrol yang bergantung pada tabel kosong

| Kontrol | Layar | Tabel yang dibaca | Baris | Efek saat dipakai |
| --- | --- | --- | ---: | --- |
| Max. rate card | Creator Database | `l1_silver.unified_rate_card` | 0 | Hasil kosong total |
| Preset Cost Efficient | Creator Database | idem | 0 | Tidak berefek (semua rank 0) |
| Preset Campaign Ready | Creator Database | idem | 0 | Ranking rata; hanya filter verified yang jalan |
| Kolom tabel "Rate card" | Creator Database | idem | 0 | Selalu `—` |
| Rate card | Smart Discovery | idem | 0 | 0 kandidat |
| Lower price than reference | Smart Discovery | idem | 0 | No-op diam |
| Hanya yang punya rate card | Tracked Accounts | `public.discover_rate_cards` | 0 | Hasil kosong total |
| Min. campaigns | Creator Database | `public.campaign_kols` | 0 | Sudah disabled — benar |

### 5.5 Data yang dihasilkan generator, bukan dibaca

| Permukaan | Yang dihasilkan generator | Modul |
| --- | --- | --- |
| Panel Quick Insight | Audience (gender, umur, lokasi, minat, quality, authenticity), Content (format, topik, **konten terbaik lengkap dengan views & ER**), Brand fit | `kolSample.ts` — `sampleIntel()` |
| 5 dari 8 preset | growthMonthly, audienceQuality, authenticity, brandFit | `kolSample.ts` via `creatorSignals()` |
| 11 filter Tracked Accounts | kategori, lifestyle, lokasi, verified, followers, ageSplit, topAge, generation, genderSplit, authenticity | `profile.ts` — `est()` + hash FNV-1a |

Ketiganya menandai dirinya di UI (`modelled`, badge `estimated`, tooltip basis), sehingga tidak ada yang menyamar sebagai pengukuran. Yang tetap berisiko adalah dua kasus di Tracked Accounts — **`Hanya terverifikasi`** (nilainya `rnd(seed,'ver') > 0.35`) dan **`Ambang Followers`** (diperkirakan dari rata-rata views) — karena keduanya adalah angka yang user perlakukan sebagai fakta pasti.

---

## 6. UI vs Backend vs Database Mismatch

| # | Inkonsistensi | UI mengatakan | Backend / DB melakukan | Bukti |
| ---: | --- | --- | --- | --- |
| 1 | Harga ditulis ke satu tabel, difilter dari tabel lain | "Simpan harga" berhasil, creator dihargai | `PUT` menulis `discover_roster_rate_cards` (warehouse, 2 baris); filter `maxRate` membaca `l1_silver.unified_rate_card` (DB KOL, 0 baris); kolom tabel membaca `rateFrom` dari tabel yang sama | `rates/route.ts:85` vs `kolDirectory.ts:290` |
| 2 | Klaim coverage rate card hardcoded | "Rate card ada untuk 7.230 dari 7.718 creator" | Nilai sebenarnya 0; roster aktif 7.720, bukan 7.718 | `KolDirectoryFilters.tsx:355` |
| 3 | 5 preset tampak menyaring | Chip menyala, judul hasil berubah | `filters: {}` — query identik; hanya 12 baris halaman aktif diurutkan ulang | `creatorMatch.ts:332,342,352,364,381` |
| 4 | Preset Emerging Creators | "Di bawah 100rb follower" | Batas tidak pernah sampai ke SQL; urutan tetap `followers DESC` sehingga halaman 1 berisi creator terbesar | `creatorMatch.ts:358` |
| 5 | Definisi verified berbeda antar tabel | Toggle "Verified creators only" | `kol_directory.verified_status` = 454 verified; `l1_silver.unified_profile.is_verified` = false untuk **semua** akun | query DB |
| 6 | Dua taksonomi kategori | Chip kategori di dua layar | Creator Database: 28 kategori dinamis dari `kol_categories`; Tracked Accounts: 7 kategori hardcoded di `vocab.ts` — tanpa mapping | `kolDirectory.ts:205` vs `vocab.ts:24` |
| 7 | Dua arti untuk "followers" | Ambang follower di dua layar | Creator Database: kolom nyata, 97,1%%; Tracked Accounts: `est()` diperkirakan dari rata-rata views | `profile.ts:317` |
| 8 | Lokasi: dua keputusan atas kolom yang sama | Creator Database men-disable; Smart Discovery menawarkan 7 kota | `creator_city` NULL untuk seluruh 7.720 baris di kedua kasus | `KolDirectoryFilters.tsx:395` vs `SmartDiscovery.tsx:389` |
| 9 | Pencarian tidak menemukan nama asli | Kotak pencarian creator | `q` hanya ke `username ILIKE`; nama asli ada di `agency_kol_accounts.label` untuk 7.684 baris dan tidak dicari | `kolDirectory.ts:279` |
| 10 | "Export" berarti dua hal berbeda | Tombol export di dua layar | Creator Database: hanya baris terpilih, dan hanya bisa diakses dari tampilan tabel; Tracked Accounts: semua hasil filter | `KolDirectoryPage.tsx:862` vs `DiscoverDirectoryView.tsx:398` |
| 11 | Favorite tampak tersimpan | Toast "Ditambahkan ke favorit", hitungan di header | `useState` biasa; hilang saat reload; tidak ada pembacanya | `KolDirectoryPage.tsx:266` |
| 12 | Search box Hub didokumentasikan tapi tidak ada | Komentar kode menyebutnya | Tidak ada `<input>` di `DiscoverHub.tsx`; tidak ada penulis `?q=` | `DiscoverWorkspace.tsx:138` |

---

## 7. Data Coverage Report

Denominator: **7.720** baris `public.kol_directory` berstatus `active` (seluruh tabel — tidak ada status lain). Semua angka dari `SELECT COUNT(*)` langsung, bukan perkiraan.

### Coverage memadai — filter aman dipakai

| Filter | Kolom | Terisi | Coverage |
| --- | --- | ---: | ---: |
| Platform | `platform_id` | 7.496 | 97,1% |
| Min. followers / Sort followers | `followers_count` | 7.498 | 97,1% |
| Search | `username` | 7.498 | 97,1% |
| Tier | `kol_tiers band` | 7.194 | 93,2% |

### Coverage rendah — filter menyembunyikan sebagian besar roster

| Filter | Kolom | Terisi | Coverage | Yang tersembunyi saat dipakai |
| --- | --- | ---: | ---: | ---: |
| Category | `category_ids / category_id` | 4.174 | 54,1% | 3.546 |
| Min. engagement | `engagement_rate` | 1.756 | 22,7% | 5.964 |
| Verified only | `verified_status = verified` | 454 | 5,9% | 7.266 |

### Coverage nol — filter tidak bisa mengembalikan hasil

| Filter | Sumber | Baris |
| --- | --- | ---: |
| Max. rate card / Cost Efficient / Campaign Ready (ranking) | `l1_silver.unified_rate_card` | 0 |
| Rate card + Lower price (Smart Discovery) | idem | 0 |
| Hanya punya rate card (Tracked Accounts) | `public.discover_rate_cards` | 0 |
| Creator location / Location (Smart Discovery) | `kol_directory.creator_city` | 0 |
| Min. campaigns | `public.campaign_kols` | 0 |
| Audience Age | `audience_demographics_daily` (age) | 0 |
| Kategori & Location (My Creators) | `discover_creators.category` / `.city` | 0 dari 4 |

### Coverage terlalu tipis untuk jadi filter

| Data | Sumber | Akun | Catatan |
| --- | --- | ---: | --- |
| Gender audiens | `l2_gold.audience_demographics_daily` | 23 / 7.720 | Sampel 100 unit per akun, 61–85 di antaranya `unknown` |
| Geo audiens | `l2_gold.audience_geo_daily` | 23 / 7.720 | 84–97%% `unknown` |
| Interest audiens | `l2_gold.audience_interest_daily` | 23 / 7.720 | **Datanya ada tapi tidak ada kontrol UI yang membacanya** |
| Format konten | `l2_gold.content_format_daily` | 30 / 7.720 | Tiap akun dibatasi 10 post |
| Rasio paid | `l2_gold.post_metric.is_sponsored` | 30 / 7.720 | idem |

### Catatan provenance

Badge Live/Calculated/Estimated dihitung dengan ambang 7 hari di `kolDirectory.ts:186`. Hasil hari ini: **Live 0 · Calculated 27 · Estimated 7.693**. Karena `SCRAPED_FIRST` selalu jadi kunci urutan pertama, setiap pilihan Sort efektifnya menampilkan 27 baris itu dulu, baru sisanya.

---

## 8. Final Summary

| Category | Total | Working | Partial | Broken | UI Only | Not Available | Mismatch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Filters** (Fase 3) | 63 | 15 | 17 | 0 | 0 | 18 | 13 |
| **Buttons & Actions** (Fase 4) | 26 | 13 | 9 | 0 | 2 | 1 | 1 |
| **Total** | 89 | 28 | 26 | 0 | 2 | 19 | 14 |

Tidak ada satu pun kontrol berstatus **BROKEN** — tidak ditemukan tombol tanpa handler, handler yang melempar error, atau endpoint yang salah alamat. Setiap masalah yang ditemukan adalah *ketiadaan data*, *ketiadaan persistensi*, atau *janji UI yang melampaui yang dilakukan backend*.

Satu klarifikasi yang perlu dicatat: `DiscoverDirectoryView.tsx:848` memuat `<Btn>` tanpa `onClick`, tetapi tombol itu dibungkus `<Link href={href}>` sehingga navigasinya ditangani Link — **bukan** tombol mati.

### Sebaran per permukaan (filter saja)

| Permukaan | Total | 🟢 YES | 🟡 PARTIAL | 🟠 MISMATCH | 🔴 NOT AVAILABLE | Menyaring data nyata |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A. Creator Database | 29 | 1 | 12 | 6 | 10 | 13/29 = 45% |
| B. Tracked Accounts | 19 | 5 | 4 | 5 | 5 | 9/19 = 47% |
| C. My Creators | 8 | 6 | 0 | 0 | 2 | 6/8 = 75% |
| D. Smart Discovery | 6 | 2 | 1 | 2 | 1 | 3/6 = 50% |

---

## 9. Priority Fix List

### P0 — terlihat berfungsi tetapi tidak

| # | Masalah | Lokasi | Perbaikan | Usaha |
| ---: | --- | --- | --- | --- |
| P0-1 | Favorite tidak menyimpan apa pun dan tidak ada pembacanya | `KolDirectoryPage.tsx:266` | Ganti `useState` dengan `useDiscoverSelection(orgId,'fav')` yang sudah ada, lalu tambahkan filter "hanya favorit" | Kecil |
| P0-2 | 5 preset tidak mengirim parameter apa pun | `creatorMatch.ts:332-390` | Beri filter nyata, atau ubah label jadi "urutkan halaman ini (perkiraan)" | Kecil |
| P0-3 | Preset Emerging Creators menghasilkan kebalikan dari namanya | `creatorMatch.ts:358` | Tambahkan `follMax` ke route + query dan pasang batas 100rb | Kecil |
| P0-4 | Harga yang disimpan user tidak pernah lolos filter harga | `rates/route.ts:85` vs `kolDirectory.ts:290` | Satukan sumber harga, atau jadikan `discover_roster_rate_cards` ikut dibaca filter `maxRate` | Sedang |
| P0-5 | 6 filter rate card mengosongkan hasil tanpa penjelasan | 3 permukaan | Sembunyikan/disable sampai tabelnya terisi | Kecil |
| P0-6 | Teks "7.230 dari 7.718 creator" tidak benar | `KolDirectoryFilters.tsx:355` | Ambil dari facets atau hapus | Kecil |
| P0-7 | `Lower price than reference` no-op diam | `creatorSimilar.ts:360` | Disable saat `reference.rateFrom` null | Kecil |

### P1 — kontrol/filter tanpa integrasi backend yang utuh

| # | Masalah | Lokasi | Perbaikan | Usaha |
| ---: | --- | --- | --- | --- |
| P1-1 | Beranda Discovery tidak punya kotak pencarian; `?q=` tanpa penulis | `DiscoverHub.tsx` | Tambahkan input yang menulis `?q=` — jalur backend sudah siap seluruhnya | Kecil |
| P1-2 | Pencarian tidak menemukan nama asli creator | `kolDirectory.ts:279` | Tambahkan `agency_kol_accounts.label` ke klausa `ILIKE`; salin pola `creatorStore.ts:164` | Kecil |
| P1-3 | Bookmark/shortlist persisten tapi tidak ada layar yang memanggilnya kembali | `DiscoverDirectoryView.tsx:265` | Tambahkan filter "hanya bookmark" ke `DirectoryFilters` | Kecil |
| P1-4 | Export tidak bisa diakses dari tampilan kartu (tampilan default) | `KolDirectoryPage.tsx:862` | Pindahkan Export ke toolbar dan ekspor semua hasil filter bila tak ada yang dipilih | Kecil |
| P1-5 | Dropdown Location Smart Discovery menawarkan 7 kota tanpa data | `SmartDiscovery.tsx:389` | Disable + alasan, samakan dengan keputusan Creator Database | Kecil |
| P1-6 | Saved lists hanya per-browser, dua daftar terpisah yang tidak saling kenal | 2 layar | Simpan di database per org agar bisa dibagi ke tim | Sedang |
| P1-7 | Bulk Add to Cart hampir selalu melewati semua baris | `KolDirectoryPage.tsx:524` | Tawarkan bulk-pricing, atau nonaktifkan tombol saat tak ada baris berharga | Sedang |
| P1-8 | 11 filter Tracked Accounts menyaring nilai generator | `profile.ts:311-322` | Sembunyikan `Hanya terverifikasi` dan `Ambang Followers` lebih dulu — dua yang paling mudah disalahpahami | Sedang |

### P2 — data & coverage database

| # | Masalah | Angka | Tindakan |
| ---: | --- | --- | --- |
| P2-1 | Semua tabel rate card kosong | 0 baris di 6 tabel (5 DB KOL + 1 warehouse) | Isi pipeline harga; ini membuka 6 filter sekaligus |
| P2-2 | Engagement rate hanya terukur 22,7%% | 1.756 / 7.720 | Perluas harvest; sementara itu pertahankan teks peringatan di UI |
| P2-3 | Kategori kosong untuk 45,9%% roster | 4.174 / 7.720 | Isi `category_ids`; 11 kategori punya ≤3 creator dan perlu konsolidasi |
| P2-4 | `verified_status` NULL untuk 6.789 baris | 931 non-NULL | Bedakan "belum dicek" dari "tidak terverifikasi" — jadikan filter tri-state |
| P2-5 | `creator_city` kosong seluruhnya | 0 / 7.720 | Sumber data kota creator belum ada |
| P2-6 | Data audiens hanya 23 akun & didominasi `unknown` | 23 / 7.720 | Belum layak jadi filter; `audience_interest_daily` bahkan belum punya kontrol UI |
| P2-7 | 0 baris berstatus Live | Live 0 · Calculated 27 · Estimated 7.693 | Jadwalkan refresh; badge provenance saat ini hampir tidak bervariasi |
| P2-8 | `engagement_rate` maksimum 223,41%% | 1 nilai di luar nalar | Tambahkan validasi rentang saat ingest |

### P3 — UX

* Slider follower berhenti di 10 juta; 25 creator di atasnya tidak bisa dibedakan (maksimum roster 685.896.635).
* Kunci sort `created` didukung backend tapi tidak ada di dropdown Sort — hanya dipakai shelf "Recently added".
* Tombol Compare tidak dinonaktifkan saat belum ada creator terpilih; bisa membuka tab Compare kosong.
* Badge "jumlah filter aktif" sengaja tidak menghitung Category, jadi bisa menunjukkan 0 padahal grid sedang tersaring.
* Satu state, tiga nama: *favorit* (kartu), *shortlist* (Quick Insight), *bookmark/shortlist* (Tracked Accounts, arti berbeda lagi).
* Column chooser Creator Database tidak persisten; Tracked Accounts persisten. Perilaku berbeda untuk kontrol yang sama.
* Dua kalimat alasan di sidebar sudah usang — data audiens dan geo kini ada untuk 23 akun.
* Angka 7.718 di komentar dan copy sudah tertinggal; roster aktif 7.720.

---

## Catatan metode

Inventaris dibangun dengan membaca setiap komponen Discovery dan mengekstrak seluruh `onClick`, `onChange`, `<input>`, `<select>`, `role="switch"`, dan `<button>` — bukan dari dokumentasi. Setiap tombol ditelusuri sampai handler-nya, setiap handler sampai endpoint-nya, setiap endpoint sampai SQL-nya, dan setiap kolom SQL dihitung coverage-nya dengan query langsung. Kontrol yang disabled, kontrol prototipe, dan kontrol yang isinya dihasilkan generator tetap dimasukkan dan ditandai. Tidak ada baris database yang diubah dan tidak ada file di `src/` yang disentuh.
