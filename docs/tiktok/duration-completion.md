# TikTok Deep › Section: Duration vs. Completion Rate

Scatter plot per video: X = durasi, Y = completion rate. Window current. Kode: `src/lib/dashboard/tiktok.ts` → `durationCompletion()`.

## Tabel sumber

`l1_silver.unified_post` (platform='tiktok'), satu titik per video.

| Sumbu | Kolom | Catatan |
|---|---|---|
| **X (Video Duration)** | `duration_s` | detik |
| **Y (Completion Rate)** | `completion_rate` (text) | diparse → numeric, di-`min(100, …)` |

`xMax`/`xTicks` dihitung di komponen dari data (`ceilTo(max, 10)`); `yMax=100`, `yTicks=[20,40,60,80,100]`.

## Contoh SQL

```sql
SELECT p.duration_s x,
       NULLIF(regexp_replace(p.completion_rate,'[^0-9.]','','g'),'')::numeric y
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1 AND p.platform = 'tiktok'
  AND p.post_date::date BETWEEN $2 AND $3
  AND p.duration_s > 0 AND p.completion_rate IS NOT NULL
  AND ($4::uuid IS NULL OR bsa.brand_id = $4)
ORDER BY p.duration_s;
```

## Catatan

- Filter `duration_s > 0` menyaring konten non-video (photo/slide TikTok punya durasi 0/null).
- Y di-cap 100% (replay bisa membuat skor mentah > 100).
