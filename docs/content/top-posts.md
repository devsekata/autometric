# Content Overview › Section: Top Posts — Performance Table

Tabel **10 post teratas** diurut Engagement Rate, semua platform digabung. Window current. Mengikuti platform toggle + ada filter format di sisi klien.

Kode: `src/lib/dashboard/content.ts` → `topPosts()`.

## Tabel sumber per kolom

| Kolom UI | Tabel | Kolom DB | Catatan |
|---|---|---|---|
| **#** (rank) | — (turunan) | — | urutan hasil (1..10) |
| **(logo)** | `l1_silver.unified_post` | `platform` | logo dari `PLATFORM_META` |
| **Post** (caption) | `l1_silver.unified_post` | `caption` (fallback `title`) | spasi dinormalisasi; truncate di UI |
| **Format** | `l1_silver.unified_post` | `format` (fallback `post_type`) | dipetakan ke label (lihat bawah) |
| **Reach** | `l1_silver.unified_post` | `reach` | `COALESCE(reach,0)` |
| **Views** | `l1_silver.unified_post` | `views` | `COALESCE(views,0)` |
| **Likes** | `l1_silver.unified_post` | `likes` | `COALESCE(likes,0)` |
| **Comments** | `l1_silver.unified_post` | `comments` | `COALESCE(comments,0)` |
| **Shares** | `l1_silver.unified_post` | `shares` | `COALESCE(shares,0)` |
| **ER** | `l1_silver.unified_post` | `engagement_rate` | sudah persen, dibulatkan 1 desimal |
| **Tag** | `l1_silver.unified_post` | `is_boosted` | `true → Boosted`, else `Organic` |

## Mapping format → label

| `format` / `post_type` (DB) | Label UI |
|---|---|
| `reels` | Reel |
| `video` | Video |
| `carousel` | Carousel |
| `feed` / `photo` / `image` | Image |
| `link` | Link |
| `story` | Story |

## Ranking & filter

- **Ranking:** `ORDER BY engagement_rate DESC NULLS LAST LIMIT 10`.
- **Filter format (klien):** tombol `All Formats / Reel / Video / Carousel / Image` memfilter array `topPosts` di komponen (`ContentDashboard.tsx`), tanpa request ulang.

## Contoh SQL

```sql
SELECT p.platform, p.caption, p.title, p.format, p.post_type,
       COALESCE(p.reach,0)    AS reach,
       COALESCE(p.views,0)    AS views,
       COALESCE(p.likes,0)    AS likes,
       COALESCE(p.comments,0) AS comments,
       COALESCE(p.shares,0)   AS shares,
       p.engagement_rate      AS er,
       COALESCE(p.is_boosted,false) AS boosted
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR p.platform = $2)
  AND p.post_date::date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR bsa.brand_id = $5)
ORDER BY p.engagement_rate DESC NULLS LAST
LIMIT 10;
```

## Catatan

- `engagement_rate` dipakai apa adanya dari silver (sudah memperhitungkan `engagement_rate_base`: `reach` untuk IG/FB, `views` untuk TK). Nilai ekstrem (mis. > 100%) mencerminkan data sumber bila `engagement > base` — bukan transformasi di app.
- Beberapa baris seed punya `format` & `post_type` tidak selaras (mis. `format='reels'` tapi `post_type='CAROUSEL_ALBUM'`); label memprioritaskan `format`, fallback ke `post_type`.
