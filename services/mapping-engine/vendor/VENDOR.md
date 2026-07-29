# Vendored mapping engine (jangan diedit)

Isi folder ini adalah **salinan verbatim** dari proyek mapping engine:

| | |
|---|---|
| Sumber | `D:\alva\phase 2\mappingengine` |
| Commit | `ce480b96733026468ef21574f8561a6622e579d5` |
| Tanggal | 2026-07-24 — *Initial commit: mapping engine komersil* |
| Disalin | 2026-07-28 |

## Aturan

**Jangan mengedit file di folder ini.** Semua penyesuaian untuk berjalan tanpa
Streamlit dilakukan dari luar, di `../app/`:

- `app/shim.py` mendaftarkan modul `streamlit` tiruan ke `sys.modules` sebelum
  `postgres_addon_komersil` diimpor, sehingga file itu jalan **tanpa diubah**.
- `app/bootstrap.py` menambahkan folder ini ke `sys.path` (modul di sini
  saling mengimpor dengan nama telanjang, mis. `from komersil_rules import ...`)
  dan menambal `_resolve_social_account_id` / `_brand_id` supaya identitas akun
  datang dari Kepiai, bukan dari self-heal.

Kalau file di sini diedit, penyelarasan versi berikutnya jadi tebak-tebakan dan
angka bisa bergeser tanpa ada yang sadar.

## Cara memperbarui

1. Salin ulang file dari repo sumber, timpa apa adanya.
2. Perbarui commit & tanggal di tabel atas.
3. Jalankan `python selftest.py` dari `services/mapping-engine/`. Yang paling
   penting di situ bukan "tidak error", tapi bagian **C. TRANSFORMASI** — ia
   memeriksa tabel tujuan tiap kategori terhadap daftar `_EXPECTED`. Kalau
   `BUILTIN_RULES` berubah dan sebuah kategori pindah tabel, di situlah
   ketahuan. Kalau perubahannya memang disengaja, perbarui `_EXPECTED`.
4. Uji dengan file FPK NYATA — `python selftest.py --file <file>`; ini dry-run,
   tidak menulis apa pun. File contoh di selftest berformat *native*, jadi
   heuristik khas FPK (4 baris metadata, header baris 5, delimiter `;`, format
   wide, token kosong `-`) TIDAK tersentuh tanpa langkah ini.
5. Jalankan uji banding: proses file FPK yang sama lewat service ini dan lewat
   Streamlit asli, bandingkan baris yang masuk ke `l0_raw`/`l0_extra`. Angka
   harus identik.
6. Jalankan `npm run verify:fpk` dari root repo untuk memastikan rantai
   `l0_extra.*_fpk → harmonization → silver → gold` masih utuh.

## File yang TIDAK disalin (sengaja) — audit 2026-07-28

Jalur insert produksi di `app_mapping_engine_komersil.py` (blok submit ~baris 2320)
persis begini:

```
_try_process_twitter_content_pairs   → Twitter = GAP
_try_process_twitter_overview_group  → Twitter = GAP
_try_process_tiktok_overview_group   → DI-PORT ke app/ingest.py
for row: render_postgres_insert_section(..., raw_bytes=...)   → vendor, apa adanya
```

Selebihnya UI. `_is_tiktok_overview_row` di hulu = `str(s).strip().lower()`,
identik dengan port di `app/ingest.py`.

| File | Alasan (terverifikasi) |
|---|---|
| `app_mapping_engine_komersil.py` | Lapisan UI Streamlit. Satu fungsi yang tetap dibutuhkan sudah di-port. |
| `app.py` | Alat legacy mapping manual, bukan jalur produksi. |
| `mapping_twitter.py` | Hanya dipakai jalur Twitter/X = GAP resmi. |
| `db_writer.py` | **Nol referensi** di seluruh proyek hulu — kode mati. |
| `proses_mapping_audience.py` | **Nol referensi**; yang aktif `audience_fpk.py`. |
| `native column.xlsx` | Hanya dirujuk `app.py`. |

## Perbedaan perilaku yang DISENGAJA terhadap hulu

1. **Fallback fuzzy-mapping dimatikan.** `render_postgres_insert_section` jatuh ke
   `build_mapped_dataframe(source_df, expected_columns, mapping_dict)` bila
   `proses_mapping_data` melempar exception. `app/ingest.py` mengirim DataFrame
   kosong + mapping kosong ke parameter itu, jadi jalur tebakan itu tidak pernah
   aktif — file yang skemanya tidak dikenali **gagal dengan pesan jelas**, bukan
   ditebak kolomnya. Menebak kolom pada file tak dikenal adalah cara paling mudah
   menulis angka salah tanpa ketahuan. Kalau paritas penuh dengan hulu memang
   diinginkan, jalur baca UI (`read_uploaded_sources`, `suggest_source_column`,
   `get_expected_columns`) harus ikut di-port.
2. **Self-heal pembuatan akun dimatikan** — lihat `app/bootstrap.py`.
3. **Deteksi kategori diperketat** — lihat catatan `_dari_kolom` di bawah.

## Catatan temuan saat vendoring (2026-07-28)

- **`fb_increase_service.py` tidak dipanggil dari mana pun** di repo sumber
  (`grep -rn fb_increase_service --include=*.py` hanya menemukan definisinya
  sendiri). Artinya carry-over FB Follows Increase antar-file yang
  didokumentasikan di DOCUMENTATION.md §4.6 **tidak aktif** di versi komersil —
  FB Follows Increase jalan lewat `proses_mapping_data` + `BUILTIN_RULES` ke
  `fb_profile_snapshots.page_daily_follows_unique`. File tetap disalin agar
  selaras dengan hulu, tapi jangan berasumsi fiturnya hidup.
- **Key upsert komersil tidak cocok dengan constraint DB untuk post IG.**
  `komersil_rules` mendeklarasikan key `(social_account_id, media_id)` untuk
  `instagram_post`, tapi indeks di database adalah
  `uq_ig_media_snapshot ON l0_raw.ig_media_snapshots (media_id)` — **media_id
  saja**. Akibatnya post yang sudah terdaftar untuk akun LAIN tidak terlihat
  oleh anti-join `WHERE NOT EXISTS (...)`, lalu ditolak indeks saat INSERT
  dengan `UniqueViolation` mentah. Secara data constraint DB-nya benar (satu
  post IG memang milik satu akun), jadi vendor TIDAK diubah; yang diperbaiki
  adalah pesannya lewat `app/ingest.explain_db_error()`, yang menyebut post mana
  dan akun mana yang sudah memilikinya. Terjadi nyata saat file dummy yang sama
  diupload ke dua brand berbeda.
- **Fallback native `kategori_detector._dari_kolom()` bisa salah tangkap.** Ia
  memindai token kolom secara berurutan (`content_interactions`, `link_clicks`,
  …, `new_follows`, …), jadi file **post** yang punya kolom `new_follows`
  terdeteksi sebagai kategori "New Follows" dan akan ditulis ke tabel metrik
  harian yang salah. Ditangani di `app/detect.py` dengan uji struktur (adanya
  kolom `post_id`/`media_id`/`video_id`) yang dijalankan **sebelum** fallback
  itu. Vendor tidak diubah; jalur ingest memakai kategori yang sudah
  dikonfirmasi user, sehingga `_dari_kolom` tidak dipakai untuk memutuskan.
