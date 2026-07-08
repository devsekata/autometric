# Community › Section: Comment Volume by Platform

Multi-line jumlah komentar per minggu, satu garis per platform. Window current. Kode: `src/lib/dashboard/community.ts` → `commentVolume()`.

## Tabel sumber

`l2_gold.comment_activity_daily`, di-bucket mingguan per platform.

| Garis | Kolom | Warna |
|---|---|---|
| **Instagram** | `comment_count` | `#d23f6f` |
| **TikTok** | `comment_count` | `#111827` |
| **Facebook** | `comment_count` | `#3d7eea` |

Hanya platform yang punya data yang dijadikan garis. Label X = tanggal awal minggu (`D Mon`).

## Contoh SQL

```sql
SELECT c.platform, date_trunc('week', c.metric_date) wk, SUM(c.comment_count) c
FROM l2_gold.comment_activity_daily c
JOIN public.brands b ON b.id = c.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR c.platform = $2)
  AND c.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR c.brand_id = $5)
GROUP BY c.platform, date_trunc('week', c.metric_date)
ORDER BY wk;
```

## Catatan

- Mengikuti platform filter: bila toggle dipilih satu platform, hanya satu garis tampil.
