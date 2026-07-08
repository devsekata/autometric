# Stories › Section: Performance (KPI Cards)

4 kartu KPI dari **`l2_gold.story_metric_daily`**, window current. Kode: `src/lib/dashboard/stories.ts` → `totals()`, `dailySparks()`, `buildKpis()`.

## Tabel sumber per metric

| KPI | Kolom | Rumus nilai |
|---|---|---|
| **Stories Published** | `story_count` | `SUM(story_count)` |
| **Avg. Story Reach** | `reach_sum`, `story_count` | `SUM(reach_sum) / SUM(story_count)` |
| **Swipe-Up Rate** | `swipe_up_sum`, `reach_sum` | `SUM(swipe_up_sum) / SUM(reach_sum) × 100` |
| **Exit Rate (avg)** | `exits_sum`, `views_sum` | `SUM(exits_sum) / SUM(views_sum) × 100` |

## Delta & spark

- **Delta:** rumus dijalankan ulang di window previous. Stories Published & Avg Reach pakai `%`; Swipe-Up & Exit Rate pakai poin (`pts`).
- **Exit Rate** = makin kecil makin baik (`lowerIsGood`): badge hijau saat turun, arah panah mengikuti perubahan.
- **Spark:** deret harian (`GROUP BY metric_date`) untuk tiap metric.

## Contoh SQL

```sql
SELECT COALESCE(SUM(s.story_count),0)  AS stories,
       COALESCE(SUM(s.reach_sum),0)    AS reach,
       COALESCE(SUM(s.views_sum),0)    AS views,
       COALESCE(SUM(s.exits_sum),0)    AS exits,
       COALESCE(SUM(s.swipe_up_sum),0) AS swipe
FROM l2_gold.story_metric_daily s
JOIN public.brands b ON b.id = s.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR s.platform = $2)
  AND s.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR s.brand_id = $5);
```

## Catatan

- Bila org/brand tak punya baris story pada window → payload `empty: true`, UI tampil state kosong.
- Swipe-Up Rate memakai basis **reach** (unique viewers); Exit Rate memakai basis **views**.
