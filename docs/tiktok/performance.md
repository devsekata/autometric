# TikTok Deep › Section: Performance (KPI Cards)

5 kartu KPI. Empat dari **`l2_gold.tiktok_churn_daily`**, satu dari **`l1_silver.unified_post`**. Window current. Kode: `src/lib/dashboard/tiktok.ts` → `churnTotals()`, `avgCompletion()`, `dailySparks()`, `buildKpis()`.

## Tabel sumber per metric

| KPI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Total Video Views** | `tiktok_churn_daily` | `video_views_sum` | `SUM(video_views_sum)` |
| **New Followers** | `tiktok_churn_daily` | `new_followers` | `SUM(new_followers)` |
| **Lost Followers** | `tiktok_churn_daily` | `lost_followers` | `SUM(lost_followers)` (lower = better) |
| **Net Growth** | `tiktok_churn_daily` | `net_growth` | `SUM(net_growth)` |
| **Avg. Completion Rate** | `unified_post` | `completion_rate` (text) | `AVG(parse(completion_rate))` (tiktok) |

## Delta & spark

- **Delta:** rumus diulang di window previous. Views/New/Lost/Net → `%`; **Lost Followers** memakai `lowerIsGood` (turun = hijau). Completion → poin (`pts`).
- **Spark:** harian. Net Growth spark = **kumulatif** `net_growth`. Completion spark = avg harian dari `unified_post`.

## Contoh SQL (churn totals)

```sql
SELECT SUM(t.video_views_sum) views, SUM(t.new_followers) gained,
       SUM(t.lost_followers) lost, SUM(t.net_growth) net
FROM l2_gold.tiktok_churn_daily t
JOIN public.brands b ON b.id = t.brand_id
WHERE b.organization_id = $1 AND t.metric_date BETWEEN $2 AND $3
  AND ($4::uuid IS NULL OR t.brand_id = $4);
```

## Catatan

- `tiktok_churn_daily` unik untuk TikTok — tak ada platform lain di schema yang melacak churn segranular ini.
- `completion_rate` text `'58%'` diparse: `NULLIF(regexp_replace(completion_rate,'[^0-9.]','','g'),'')::numeric`.
