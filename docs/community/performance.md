# Community › Section: Performance (KPI Cards)

4 kartu KPI dari **`l2_gold.comment_activity_daily`**, window current. Kode: `src/lib/dashboard/community.ts` → `kpiTotals()`, `kpiDaily()`, `buildKpis()`.

## Tabel sumber per metric

| KPI | Kolom | Rumus |
|---|---|---|
| **Total Comments Tracked** | `comment_count` | `SUM(comment_count)` (semua platform / sesuai filter) |
| **IG Avg. Replies/Comment** | `replies_sum`, `comment_count` (FILTER instagram) | `SUM(replies_sum)/SUM(comment_count)` |
| **TK Avg. Likes/Comment** | `likes_sum`, `comment_count` (FILTER tiktok) | `SUM(likes_sum)/SUM(comment_count)` |
| **FB Avg. Likes/Comment** | `likes_sum`, `comment_count` (FILTER facebook) | `SUM(likes_sum)/SUM(comment_count)` |

> `likes_sum`/`replies_sum` di tabel ini = like & reply **pada komentar** (bukan pada post).

## Delta & spark

- **Delta:** `%` vs window previous untuk semua KPI.
- **Spark:** harian (`GROUP BY metric_date`) — Total = jumlah komentar harian; rasio = nilai rasio harian.
- KPI per-platform memakai `FILTER (WHERE platform=…)`; saat toggle dipilih satu platform, KPI platform-lain ter-nol.

## Contoh SQL

```sql
SELECT
  SUM(c.comment_count)                                            total,
  SUM(c.replies_sum) FILTER (WHERE c.platform='instagram')        ig_rep,
  SUM(c.comment_count) FILTER (WHERE c.platform='instagram')      ig_com,
  SUM(c.likes_sum)   FILTER (WHERE c.platform='tiktok')           tk_lik,
  SUM(c.comment_count) FILTER (WHERE c.platform='tiktok')         tk_com,
  SUM(c.likes_sum)   FILTER (WHERE c.platform='facebook')         fb_lik,
  SUM(c.comment_count) FILTER (WHERE c.platform='facebook')       fb_com
FROM l2_gold.comment_activity_daily c
JOIN public.brands b ON b.id = c.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR c.platform = $2)
  AND c.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR c.brand_id = $5);
```

## Catatan

- "TK Comment-Like Ratio" pada desain awal di-relabel **"TK Avg. Likes/Comment"** (likes per komentar) karena rasio comment÷like menghasilkan angka <0.01 yang tidak terbaca.
