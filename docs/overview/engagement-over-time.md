# Overview › Section: Engagement Over Time

Line chart multi-brand dengan toggle metrik **Engagement / Reach / Followers**. **Harian, mengikuti period** yang dipilih (7/30/90 hari) — satu titik per tanggal, sumbu-X = tanggal.

Kode: `src/lib/dashboard/overview.ts` → `engagementOverTime()`.

## Tabel sumber per metrik (toggle)

Tiap garis = satu **brand**, tiap titik = satu **tanggal** dalam window current.

| Metrik (toggle) | Tabel | Kolom | Rumus per titik (brand × tanggal) |
|---|---|---|---|
| **Engagement** | `l2_gold.brand_metric_daily` | `engagement_sum` | `SUM(engagement_sum)` per brand per `metric_date` |
| **Reach** | `l2_gold.brand_metric_daily` | `reach_sum` | `SUM(reach_sum)` per brand per `metric_date` |
| **Followers** | `l1_silver.unified_profile` | `follower_count` | `SUM(follower_count)` per brand per `profile_date` (1 baris/akun/hari) |

## Sumbu & garis

| Elemen | Asal / aturan |
|---|---|
| **Sumbu-X (label)** | Daftar tanggal `start..end` window current. Format `D Mon` (mis. `23 Jun`, `fmtDateLabel`). Label ditipiskan ~10 tick (`step = ceil(jumlahHari/10)`), tapi **semua tanggal tetap jadi titik data**. |
| **Garis (series)** | Hanya **top 4 brand** by total `engagement_sum` pada window (agar terbaca). Warna dari `PALETTE`. |
| **Hari tanpa data** | Diisi `0`. |

## Contoh SQL (Engagement, per brand per hari)

```sql
SELECT b.name AS brand,
       to_char(bmd.metric_date, 'YYYY-MM-DD') AS d,
       SUM(bmd.engagement_sum) AS eng
FROM l2_gold.brand_metric_daily bmd
JOIN public.brands b ON b.id = bmd.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR bmd.platform = $2)
  AND bmd.metric_date BETWEEN $3 AND $4           -- window current (sesuai period)
  AND ($5::uuid IS NULL OR bmd.brand_id = $5)      -- filter brand
GROUP BY b.name, bmd.metric_date
ORDER BY d;
```

## Contoh SQL (Followers, per brand per hari)

```sql
SELECT b.name AS brand,
       to_char(p.profile_date, 'YYYY-MM-DD') AS d,
       SUM(p.follower_count) AS f
FROM l1_silver.unified_profile p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR p.platform = $2)
  AND p.profile_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR bsa.brand_id = $5)      -- silver: scope brand via bsa
GROUP BY b.name, p.profile_date
ORDER BY d;
```

## Catatan

- Saat satu brand dipilih di switcher, chart menampilkan **1 garis** (brand itu saja).
- Followers diambil dari **silver** karena gold (`brand_metric_daily`) hanya menyimpan `net_growth_sum`, bukan jumlah follower absolut.
- Period `90 hari` menampilkan 90 titik; bila data seed < 90 hari, tanggal sebelum data tersedia bernilai 0.
