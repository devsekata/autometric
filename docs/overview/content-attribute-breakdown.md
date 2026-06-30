# Overview › Section: Content Attribute Breakdown

Kartu-kartu ER per **content tag** + satu "Key Finding". Window current.

Kode: `src/lib/dashboard/overview.ts` → `contentAttributes()`.

## Tabel sumber per elemen

| Elemen UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Daftar tag** | `l2_gold.content_attribute_daily` | `content_tag` | `GROUP BY content_tag`, urut `count` desc |
| **Count** (angka besar) | `l2_gold.content_attribute_daily` | `post_count` | `SUM(post_count)` per tag |
| **ER** (per tag) | `l2_gold.content_attribute_daily` | `engagement_sum`, `er_denominator_sum` | `SUM(engagement_sum) / SUM(er_denominator_sum) × 100` |
| **Overall ER** (pembanding) | `l2_gold.content_attribute_daily` | `engagement_sum`, `er_denominator_sum` | `SUM(semua engagement) / SUM(semua erden) × 100` |
| **Key Finding** | — (turunan) | — | tag ER tertinggi (selain `organic`) vs Overall ER |

## Mapping `content_tag` → label

| `content_tag` (DB) | Label UI |
|---|---|
| `organic` | Organic |
| `boosted` | Boosted Posts |
| `collab` | Collabs |
| `campaign` | Campaign |
| `aon` | AON Posts |
| `activity` | Activity |
| `event` | Event |
| `repost` | Repost |

## Key Finding (teks otomatis)

- Ambil tag dengan **ER tertinggi** (abaikan `organic`, harus `count > 0`).
- Bandingkan ke Overall ER → teks: *"`<Label>` mencatat ER tertinggi (`x%`), `n`× di atas rata-rata blended (`y%`) …"*.
- Bila tak ada data: *"Belum cukup data atribut konten pada periode ini."*

## Contoh SQL

```sql
SELECT cad.content_tag AS tag,
       SUM(cad.post_count)         AS cnt,
       SUM(cad.engagement_sum)     AS eng,
       SUM(cad.er_denominator_sum) AS erden
FROM l2_gold.content_attribute_daily cad
JOIN public.brands b ON b.id = cad.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR cad.platform = $2)
  AND cad.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR cad.brand_id = $5)
GROUP BY cad.content_tag
ORDER BY cnt DESC;
```

## Catatan

- `content_tag` berasal dari atribut konten di `l0_extra.*_post_extra_attribute` (mis. `is_boosted`, `is_collab`) yang diturunkan pipeline ke `content_attribute_daily`.
- Warna kartu memakai palet `ATTR_COLORS` (urut sesuai ranking count).
