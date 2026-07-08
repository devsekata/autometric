# Audience › Section: Audience Age Distribution

Bar horizontal share per bucket usia + insight. **Snapshot terbaru** (bukan window). Kode: `src/lib/dashboard/audience.ts` → `ageDistribution()`.

## Tabel sumber

`l1_silver.unified_audience` dengan `audience_type = 'age'`, pada `audience_date = MAX(audience_date)` untuk scope tsb.

| Bucket UI | Kolom | Nilai |
|---|---|---|
| 13–17 | `age_13_17` | `SUM` |
| 18–24 | `age_18_24` | `SUM` |
| 25–34 | `age_25_34` | `SUM` |
| 35–44 | `age_35_44` | `SUM` |
| 45–54 | `age_45_54` | `SUM` |
| 55–64 | `age_55_64` | `SUM` |
| 65+ | `age_65_plus` | `SUM` |

Nilai bar = **% share** = `SUM(bucket) / SUM(semua bucket) × 100`.

## Insight (teks otomatis)

- Ambil bucket dengan share tertinggi → *"Segmen `<bucket>` mendominasi audiens (`x%`) — sesuaikan tone & format konten untuk kelompok usia ini."*
- Tanpa data → *"Belum ada data demografi usia pada periode ini."*

## Contoh SQL

```sql
SELECT SUM(u.age_13_17) a1, SUM(u.age_18_24) a2, SUM(u.age_25_34) a3,
       SUM(u.age_35_44) a4, SUM(u.age_45_54) a5, SUM(u.age_55_64) a6, SUM(u.age_65_plus) a7
FROM l1_silver.unified_audience u
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = u.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR u.platform = $2)
  AND u.audience_type = 'age'
  AND u.audience_date = (SELECT max(audience_date) FROM l1_silver.unified_audience
                         /* di-scope ke org/brand/platform yang sama */ )
  AND ($3::uuid IS NULL OR bsa.brand_id = $3);
```

## Catatan

- Demografi bersifat **snapshot** (di seed hanya 1 tanggal & **Instagram-only**) — filter period tidak mengubahnya; bila platform dipilih non-IG → kosong.
- Per baris, satu `audience_type` (age/gender/city/country) terisi di kolom yang relevan; baris `age` hanya mengisi kolom `age_*`.
