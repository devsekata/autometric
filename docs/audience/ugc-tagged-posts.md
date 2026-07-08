# Audience › Section: User-Generated Content — Tagged Posts

Tabel post tagging dari audiens. **Sumber L0.** Window current. Kode: `src/lib/dashboard/audience.ts` → `ugcPosts()`.

## Tabel sumber

`l0_harmonization.instagram_tagged_post` (`brand_id` = social_accounts.id → scope via `brand_social_accounts`).

| Kolom UI | Kolom DB | Catatan |
|---|---|---|
| **User** | `username` | prefix `@` |
| **Format** | `post_type` | `CAROUSEL_ALBUM→Carousel`, `VIDEO→Video`, `IMAGE→Image`, `REELS→Reel` |
| **Caption** | `caption` | spasi dinormalisasi |
| **Likes** | `like_count` | |
| **Comments** | `comment_count` | |
| **Total** | — | `like_count + comment_count` |
| **Date** | `post_date` | format `D Mon` |

Urut `ORDER BY (like_count + comment_count) DESC LIMIT 10`, difilter `post_date::date` pada window.

## Insight (teks otomatis)

- Rata-rata total interaksi UGC → *"Post tagged dari audiens rata-rata meraih `n` interaksi — repost UGC berperforma tinggi adalah pengganda reach termurah."*
- Tanpa data → *"Belum ada UGC tagged post pada periode ini."*

## Contoh SQL

```sql
SELECT tp.username, tp.post_type, tp.caption,
       COALESCE(tp.like_count,0) likes, COALESCE(tp.comment_count,0) comments, tp.post_date
FROM l0_harmonization.instagram_tagged_post tp
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = tp.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND tp.post_date::date BETWEEN $2 AND $3
  AND ($4::uuid IS NULL OR bsa.brand_id = $4)
ORDER BY (COALESCE(tp.like_count,0) + COALESCE(tp.comment_count,0)) DESC
LIMIT 10;
```

## Catatan

- UGC inheren **Instagram** (tabel `instagram_tagged_post`) → tidak mengikuti platform toggle, tapi filter **brand** & **period** tetap berlaku.
- Ini satu-satunya section Audience yang menarik dari **L0 mentah** (belum ada padanan silver/gold).
