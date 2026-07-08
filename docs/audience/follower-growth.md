# Audience › Section: Follower Growth Trend

Multi-line follower per brand (mingguan) pada window. Kode: `src/lib/dashboard/audience.ts` → `followerTrend()`.

## Tabel sumber

`l1_silver.unified_profile` — `follower_count` per akun per hari.

| Langkah | Rumus |
|---|---|
| **Harian per brand** | `SUM(follower_count)` per (brand, profile_date) |
| **Mingguan** | `AVG(harian)` per (brand, `date_trunc('week', d)`) |
| **Garis** | top 4 brand (by follower tertinggi), data per minggu |

Label X = tanggal awal minggu (`D Mon`).

## Contoh SQL

```sql
WITH daily AS (
  SELECT b.name brand, p.profile_date d, SUM(p.follower_count) f
  FROM l1_silver.unified_profile p
  JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
  JOIN public.brands b ON b.id = bsa.brand_id
  WHERE b.organization_id = $1 AND ($2 = 'all' OR p.platform = $2)
    AND p.profile_date BETWEEN $3 AND $4
    AND ($5::uuid IS NULL OR bsa.brand_id = $5)
  GROUP BY b.name, p.profile_date)
SELECT brand, date_trunc('week', d) wk, AVG(f) f
FROM daily GROUP BY brand, date_trunc('week', d) ORDER BY wk;
```

## Catatan

- Memakai **AVG** follower per minggu agar garis halus; brand dipilih top-4 by puncak follower supaya chart terbaca.
- Mengikuti platform filter (mis. platform=instagram → follower IG saja).
