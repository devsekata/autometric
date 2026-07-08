# Audience › Section: Performance (KPI Cards)

4 kartu KPI dari **`l1_silver.unified_profile`**, window current. Kode: `src/lib/dashboard/audience.ts` → `profileDaily()`, `buildKpis()`.

## Tabel sumber per metric

| KPI | Kolom | Rumus nilai |
|---|---|---|
| **Total Tracked Followers** | `follower_count` | `SUM(follower_count)` pada **hari terakhir** window |
| **IG Profile Reach** | `profile_reach` (FILTER instagram) | `SUM(profile_reach)` window |
| **TK Profile Views** | `profile_visit` (FILTER tiktok) | `SUM(profile_visit)` window |
| **FB Profile Visits** | `profile_visit` (FILTER facebook) | `SUM(profile_visit)` window |

> `unified_profile` = 1 baris per akun per hari, jadi `SUM(...)` per `profile_date` = total harian.

## Delta & spark

- **Total Tracked Followers:** delta = pertumbuhan dalam window (nilai hari terakhir vs hari pertama). Spark = total follower harian.
- **3 metric lainnya:** delta `%` vs window previous. Spark = nilai harian metric tsb.
- Metric platform-spesifik pakai `FILTER (WHERE platform=…)`; saat platform toggle dipilih satu platform, kartu platform-lain ikut nol (konsisten dengan kartu "TK Video Views" di Overview).

## Contoh SQL

```sql
SELECT p.profile_date,
       SUM(p.follower_count)                                         AS foll,
       SUM(p.profile_reach) FILTER (WHERE p.platform='instagram')    AS ig_reach,
       SUM(p.profile_visit) FILTER (WHERE p.platform='tiktok')        AS tk_visit,
       SUM(p.profile_visit) FILTER (WHERE p.platform='facebook')      AS fb_visit
FROM l1_silver.unified_profile p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR p.platform = $2)
  AND p.profile_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR bsa.brand_id = $5)
GROUP BY p.profile_date ORDER BY p.profile_date;
```

## Catatan

- KPI di-relabel ke metric yang benar-benar ada di `unified_profile` (mis. "IG Profile Reach" memakai `profile_reach`, bukan "accounts engaged" yang tak punya kolom).
- `link_clicks` (IG/FB) juga tersedia di `unified_profile` bila perlu KPI tambahan ke depan.
