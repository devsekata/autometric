# Audience › Section: Comment Relevance Analysis

Kartu tier (High/Mid/Low) + distribusi + contoh komentar per tier. **Sumber di luar medallion.** Kode: `src/lib/dashboard/audience.ts` → `commentRelevance()`.

## Tabel sumber

| Elemen | Tabel | Kolom |
|---|---|---|
| **Skor relevansi** | `feature.comment_relevance_scores` | `relevance_score`, `comment_id`, `platform`, `brand_id` |
| **Teks komentar (samples)** | `l1_silver.unified_comment` | `comment_text` (join `comment_id` + `platform`) |

> ⚠️ Di seed saat ini `feature.comment_relevance_scores` **kosong (0 baris)** → section menampilkan empty state ("feature.comment_relevance_scores masih kosong"). Begitu pipeline mengisinya, section terisi otomatis tanpa perubahan kode.

## Normalisasi skor & bucket

Skor dinormalisasi ke 0–100 agar tahan apakah disimpan 0–1 atau 0–100:
`s = CASE WHEN relevance_score <= 1 THEN relevance_score*100 ELSE relevance_score END`

| Tier | Range (`s`) | Warna |
|---|---|---|
| High Relevance | `> 75` | `#5fa783` |
| Mid Relevance | `40 – 75` | `#e0a458` |
| Low Relevance | `< 40` | `#d97a7a` |

- **count** = jumlah komentar di tier; **pct** = `count / total × 100`.
- **samples** = hingga 3 komentar teratas per tier (skor tertinggi).

## Contoh SQL

```sql
SELECT (CASE WHEN f.relevance_score <= 1 THEN f.relevance_score*100 ELSE f.relevance_score END) s,
       c.comment_text txt
FROM feature.comment_relevance_scores f
JOIN l1_silver.unified_comment c ON c.comment_id = f.comment_id AND c.platform = f.platform
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = c.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR c.platform = $2)
  AND f.relevance_score IS NOT NULL
  AND ($3::uuid IS NULL OR bsa.brand_id = $3);
```

## Catatan

- Bucket + sampling dilakukan di aplikasi dari baris hasil (skor + teks), bukan di SQL.
- Query dibungkus `try/catch` di lib — jika tabel/izin `feature.*` tak tersedia, section jatuh ke empty state, bukan error.
