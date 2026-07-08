# Content Overview › Section: Post Type Performance

Bar horizontal **rata-rata reach per format Instagram** + satu "Key Finding". Window current. Spesifik **Instagram** (mengabaikan platform toggle).

Kode: `src/lib/dashboard/content.ts` → `postTypePerf()`.

## Tabel sumber per elemen

| Elemen UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Daftar format** | `l1_silver.unified_post` | `format` | `GROUP BY format`, urut `avg reach` desc |
| **Nilai bar** | `l1_silver.unified_post` | `reach` | `AVG(reach)` per format |
| **Key Finding** | — (turunan) | — | format teratas vs format kedua (rasio reach) |

## Mapping `format` → label (Instagram)

| `format` (DB) | Label UI |
|---|---|
| `reels` | Reels |
| `carousel` | Carousel |
| `feed` | Image |
| `story` | Story |

> Hanya `platform = 'instagram'`. Format IG di silver: `reels / feed / carousel / story`.

## Key Finding (teks otomatis)

- Ambil format dengan **rata-rata reach tertinggi** (`top`) dan format kedua (`second`).
- Teks: *"`<top>` rata-rata mencatat reach `n`× lebih tinggi dari `<second>` — format dengan distribusi terkuat di Instagram."*
- Bila tak ada data: *"Belum ada data format Instagram pada periode ini."*

## Contoh SQL

```sql
SELECT p.format, AVG(p.reach) AS reach
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND p.platform = 'instagram'
  AND p.post_date::date BETWEEN $2 AND $3
  AND p.format IS NOT NULL
  AND ($4::uuid IS NULL OR bsa.brand_id = $4)   -- silver: scope brand via bsa
GROUP BY p.format
ORDER BY reach DESC;
```

## Catatan

- Memakai **rata-rata** (bukan total) reach supaya format yang jarang diposting tidak otomatis kalah dari yang sering — bar mencerminkan **efektivitas** format, bukan volume.
- Warna bar memakai palet `PALETTE` urut sesuai ranking reach.
- Section ini selalu Instagram (subtitle UI: "Instagram · avg reach by format"); platform toggle tidak mengubahnya, tapi filter **brand** & **period** tetap berlaku.
