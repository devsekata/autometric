# Content Overview › Section: TikTok Completion Rate Distribution

Bar vertikal **distribusi completion rate video TikTok** (% video per bucket) + insight "Strong Retention". Window current. Spesifik **TikTok**.

Kode: `src/lib/dashboard/content.ts` → `completionDist()`.

## Tabel sumber per elemen

| Elemen UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Bucket** | `l1_silver.unified_post` | `completion_rate` (text) | parse → numeric, dipetakan ke 4 bucket |
| **Nilai bar** | `l1_silver.unified_post` | `completion_rate` | `% video dalam bucket = count(bucket) / count(total) × 100` |
| **Strong Retention** | — (turunan) | — | % video melewati titik tengah (`≥ 50%`) |

### Pemetaan completion rate → bucket

| `completion_rate` (numeric) | Bucket |
|---|---|
| `< 25` | `0–25%` |
| `25 – < 50` | `25–50%` |
| `50 – < 75` | `50–75%` |
| `≥ 75` | `75–100%` |

> `completion_rate` disimpan **teks** (mis. `'79%'`). Diparse: `NULLIF(regexp_replace(completion_rate, '[^0-9.]', '', 'g'), '')::numeric`.

## Strong Retention (teks otomatis)

- `pastHalf = (bucket 50–75 + bucket 75–100) / total × 100`.
- Teks: *"`pastHalf`% video ditonton melewati titik tengah — di atas benchmark retensi 50%."* (atau "masih di bawah benchmark…" bila `< 50%`).
- Bila tak ada data → *"Belum ada data completion rate TikTok pada periode ini."*

## Contoh SQL

```sql
WITH cr AS (
  SELECT NULLIF(regexp_replace(p.completion_rate, '[^0-9.]', '', 'g'), '')::numeric AS v
  FROM l1_silver.unified_post p
  JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
  JOIN public.brands b ON b.id = bsa.brand_id
  WHERE b.organization_id = $1
    AND p.platform = 'tiktok'
    AND p.post_date::date BETWEEN $2 AND $3
    AND p.completion_rate IS NOT NULL
    AND ($4::uuid IS NULL OR bsa.brand_id = $4)
)
SELECT COUNT(*) FILTER (WHERE v <  25)            AS b1,
       COUNT(*) FILTER (WHERE v >= 25 AND v < 50) AS b2,
       COUNT(*) FILTER (WHERE v >= 50 AND v < 75) AS b3,
       COUNT(*) FILTER (WHERE v >= 75)            AS b4,
       COUNT(*)                                   AS total
FROM cr WHERE v IS NOT NULL;
```

## Catatan

- Spesifik `platform = 'tiktok'` (subtitle UI: "completion_rate · % of videos per bucket"); platform toggle tidak mengubahnya, filter **brand** & **period** tetap berlaku.
- `completion_rate` hanya terisi untuk TikTok (berasal dari `l0_extra.tiktok_post_extra_attribute`); IG/FB tidak punya kolom ini.
