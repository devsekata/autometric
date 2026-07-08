# TikTok Deep › Section: Follower Churn Analysis

3 stat tile (gained/lost/net) + DivergingBars mingguan + insight. Window current. Kode: `src/lib/dashboard/tiktok.ts` → `churnWeekly()` (+ `churnTotals` untuk tile).

## Tabel sumber

Semua dari **`l2_gold.tiktok_churn_daily`**.

| Elemen UI | Kolom | Rumus |
|---|---|---|
| **Tile New Followers** | `new_followers` | `SUM` window |
| **Tile Followers Lost** | `lost_followers` | `SUM` window |
| **Tile Net Growth** | `net_growth` | `SUM` window |
| **Bar atas (gained)** | `new_followers` | `SUM` per minggu |
| **Bar bawah (lost)** | `lost_followers` | `SUM` per minggu |

`DivergingBars` menerima `{ label, gained, lost }[]` per minggu (`date_trunc('week', metric_date)`).

## Insight (teks otomatis)

- Cari minggu dengan **lonjakan lost terbesar** vs minggu sebelumnya.
- `≥ 20%` → *"Volume lost follower melonjak +`n`% di `Wk` — biasanya bertepatan dengan jeda posting; jaga ≥1 post/hari di TikTok."*; selain itu *"Churn follower relatif stabil…"*.

## Contoh SQL

```sql
SELECT date_trunc('week', t.metric_date) wk,
       SUM(t.new_followers)  gained,
       SUM(t.lost_followers) lost
FROM l2_gold.tiktok_churn_daily t
JOIN public.brands b ON b.id = t.brand_id
WHERE b.organization_id = $1 AND t.metric_date BETWEEN $2 AND $3
  AND ($4::uuid IS NULL OR t.brand_id = $4)
GROUP BY date_trunc('week', t.metric_date) ORDER BY wk;
```

## Catatan

- Minggu pertama/terakhir window bisa parsial (lebih sedikit hari).
- `net_growth` = `new_followers − lost_followers` di gold; tile Net memakai `SUM(net_growth)` langsung.
