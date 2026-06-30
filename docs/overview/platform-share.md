# Overview › Section: Platform Share

Donut "Platform Share · by reach" — porsi reach tiap platform pada window current.

Kode: `src/lib/dashboard/overview.ts` → `platformReachShare()`.

## Tabel sumber

| Elemen | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Reach per platform** | `l2_gold.brand_metric_daily` | `reach_sum`, `platform` | `SUM(reach_sum)` `GROUP BY platform` (window current) |
| **Nilai segmen (%)** | — (turunan) | — | `reach_platform / total_reach × 100`, dibulatkan |
| **Total (label tengah donut)** | — (turunan) | — | jumlah semua persentase (≈ `100%`) |

Catatan: platform dengan `reach = 0` tidak ditampilkan; segmen diurut menurun.

## Contoh SQL

```sql
SELECT bmd.platform, SUM(bmd.reach_sum) AS reach
FROM l2_gold.brand_metric_daily bmd
JOIN public.brands b ON b.id = bmd.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR bmd.platform = $2)
  AND bmd.metric_date BETWEEN $3 AND $4           -- window current
  AND ($5::uuid IS NULL OR bmd.brand_id = $5)      -- filter brand
GROUP BY bmd.platform;
```

Konversi ke persentase dilakukan di aplikasi (bukan SQL).

## Catatan

- Karena memakai `reach_sum`, platform dengan reach besar (mis. TikTok di data seed) akan mendominasi donut.
- Mengikuti filter brand & platform; bila filter platform ≠ `All`, donut hanya menampilkan 1 platform (100%).
