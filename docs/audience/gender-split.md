# Audience › Section: Gender Split by Platform

Stacked bar Female vs Male per platform. **Snapshot terbaru**. Kode: `src/lib/dashboard/audience.ts` → `genderSplit()`.

## Tabel sumber

`l1_silver.unified_audience` dengan `audience_type = 'gender'`, pada `audience_date = MAX(audience_date)`.

| Elemen | Kolom | Rumus |
|---|---|---|
| **Female %** | `gender_female`, `gender_male` | `SUM(female) / (SUM(female)+SUM(male)) × 100` |
| **Male %** | — | `100 − Female%` |

`GROUP BY platform`; baris dengan `female+male = 0` dibuang.

## Contoh SQL

```sql
SELECT u.platform,
       SUM(u.gender_female) f,
       SUM(u.gender_male)   m
FROM l1_silver.unified_audience u
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = u.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR u.platform = $2)
  AND u.audience_type = 'gender'
  AND u.audience_date = (SELECT max(audience_date) FROM l1_silver.unified_audience /* scoped */ )
  AND ($3::uuid IS NULL OR bsa.brand_id = $3)
GROUP BY u.platform;
```

## Catatan

- `gender_unknown` **diabaikan** dalam pembagian (UI hanya menampilkan Female vs Male yang berjumlah 100%).
- Di seed hanya Instagram punya data gender → hanya satu baris yang tampil; bila tak ada data, kartu menampilkan "Tidak ada data gender."
