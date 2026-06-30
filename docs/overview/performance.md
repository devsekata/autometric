# Overview › Section: Performance (KPI Cards)

5 kartu KPI di baris paling atas Overview. Semua diambil dari **`l2_gold.brand_metric_daily`**, diagregasi pada **window current** (lihat scoping di [README](./README.md)).

Kode: `src/lib/dashboard/overview.ts` → `totals()`, `dailySparks()`, `buildKpis()`.

## Tabel sumber per metric

| KPI (label UI) | Tabel | Kolom | Rumus nilai |
|---|---|---|---|
| **Total Reach** | `l2_gold.brand_metric_daily` | `reach_sum` | `SUM(reach_sum)` |
| **Total Engagement** | `l2_gold.brand_metric_daily` | `engagement_sum` | `SUM(engagement_sum)` |
| **Blended Eng. Rate** | `l2_gold.brand_metric_daily` | `engagement_sum`, `er_denominator_sum` | `SUM(engagement_sum) / SUM(er_denominator_sum) × 100` |
| **TK Video Views** | `l2_gold.brand_metric_daily` | `video_views_sum`, `platform` | `SUM(video_views_sum) FILTER (WHERE platform='tiktok')` |
| **Net Follower Growth** | `l2_gold.brand_metric_daily` | `net_growth_sum` | `SUM(net_growth_sum)` |

## Delta (badge naik/turun tiap kartu)

Dihitung dengan menjalankan rumus yang sama di **window previous**, lalu dibandingkan.

| KPI | Rumus delta |
|---|---|
| Reach, Engagement, TK Views, Net Growth | `(current − previous) / previous × 100` (persen) |
| Blended Eng. Rate | selisih poin: `ER_current − ER_previous` (`pts`) |

## Spark (mini-tren di kartu)

Deret **harian** pada window current — `GROUP BY metric_date` di `dailySparks()`.

| KPI | Isi spark per hari |
|---|---|
| Total Reach | `SUM(reach_sum)` per tanggal |
| Total Engagement | `SUM(engagement_sum)` per tanggal |
| Blended Eng. Rate | `SUM(engagement_sum)/SUM(er_denominator_sum)×100` per tanggal |
| TK Video Views | `SUM(video_views_sum) FILTER (tiktok)` per tanggal |
| Net Follower Growth | **kumulatif** `net_growth_sum` (akumulasi harian) |

## Contoh SQL (Total Reach)

```sql
SELECT COALESCE(SUM(bmd.reach_sum), 0) AS reach
FROM l2_gold.brand_metric_daily bmd
JOIN public.brands b ON b.id = bmd.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR bmd.platform = $2)        -- filter platform
  AND bmd.metric_date BETWEEN $3 AND $4         -- window current
  AND ($5::uuid IS NULL OR bmd.brand_id = $5);  -- filter brand
```

## Catatan

- `er_denominator_sum` = basis Engagement Rate per baris (mengikuti `engagement_rate_base`: `reach` atau `views`) yang sudah dijumlahkan di gold.
- Jika org/brand tidak punya baris gold pada window → KPI bernilai 0 (payload `empty: true`, UI tampil state kosong).
- Asal data gold: pipeline `L0 (seed) → CALL l1_silver.sp_sync_unified_*() → CALL l2_gold.sp_build_brand_metric_daily()`.
