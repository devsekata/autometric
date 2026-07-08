# Stories › Section: Story Performance Over Time

Multi-line chart mingguan: **Views, Exits, Swipe-Ups**. Window current. Kode: `src/lib/dashboard/stories.ts` → `overTime()`.

## Tabel sumber per garis

Dari **`l2_gold.story_metric_daily`**, di-bucket mingguan (`date_trunc('week', metric_date)`):

| Garis | Kolom | Warna |
|---|---|---|
| **Views** | `views_sum` | `#d23f6f` |
| **Exits** | `exits_sum` | `#e0a458` |
| **Swipe-Ups** | `swipe_up_sum` | `#5fa783` |

Label sumbu X = tanggal awal tiap minggu (format `D Mon`).

## Contoh SQL

```sql
SELECT date_trunc('week', s.metric_date) AS wk,
       SUM(s.views_sum)    AS views,
       SUM(s.exits_sum)    AS exits,
       SUM(s.swipe_up_sum) AS swipe
FROM l2_gold.story_metric_daily s
JOIN public.brands b ON b.id = s.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR s.platform = $2)
  AND s.metric_date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR s.brand_id = $5)
GROUP BY date_trunc('week', s.metric_date)
ORDER BY wk;
```

## Catatan

- Chart pakai `MultiLineChart` dengan `yAxis` + `dots` + `fmtY=fmtNum`.
- Minggu pertama/terakhir window bisa parsial → titik ujung bisa lebih rendah (lebih sedikit hari).
