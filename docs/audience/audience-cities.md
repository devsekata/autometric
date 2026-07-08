# Audience › Section: Top Audience Cities

Bar horizontal share follower per kota. **Snapshot terbaru**, dari jsonb. Kode: `src/lib/dashboard/audience.ts` → `topCities()`.

## Tabel sumber

`l1_silver.unified_audience` dengan `audience_type = 'city'`, kolom **`city_breakdown` (jsonb)** `{ "Kota": count }`, pada `audience_date = MAX(audience_date)`.

| Elemen | Sumber | Rumus |
|---|---|---|
| **Kota** | key jsonb (`jsonb_each_text`) | `GROUP BY key` |
| **Nilai** | value jsonb | `SUM(value::numeric)` per kota |
| **Bar (%)** | — | `nilai_kota / total × 100`, top 8 |

## Contoh SQL

```sql
SELECT e.key AS city, SUM(e.value::numeric) AS v
FROM l1_silver.unified_audience u
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = u.brand_id
JOIN public.brands b ON b.id = bsa.brand_id,
     LATERAL jsonb_each_text(u.city_breakdown) e
WHERE b.organization_id = $1 AND ($2 = 'all' OR u.platform = $2)
  AND u.audience_type = 'city' AND u.city_breakdown IS NOT NULL
  AND u.audience_date = (SELECT max(audience_date) FROM l1_silver.unified_audience /* scoped */ )
  AND ($3::uuid IS NULL OR bsa.brand_id = $3)
GROUP BY e.key ORDER BY v DESC LIMIT 8;
```

## Catatan

- `LATERAL jsonb_each_text` membongkar map kota→count menjadi baris agar bisa di-`SUM` lintas brand/akun.
- Ada juga `country_breakdown` (jsonb `{ "ID": count, ... }`) bila ingin section negara ke depan.
- Snapshot & IG-only di seed; period tidak mengubah hasil.
