# TikTok Deep › Section: Avg Watch Time by Content Pillar

Bar horizontal rata-rata watch time (detik) per `content_pillar` + insight. Window current. Kode: `src/lib/dashboard/tiktok.ts` → `watchByPillar()`.

## Tabel sumber

`l1_silver.unified_post` (platform='tiktok'), `GROUP BY content_pillar`.

| Elemen | Kolom | Rumus |
|---|---|---|
| **Pillar** | `content_pillar` | `GROUP BY content_pillar` |
| **Bar (detik)** | `avg_watch_time` | `AVG(avg_watch_time)` per pillar |

Pillar di seed: Community, Engagement, Awareness, Behind The Scenes, Promo, Education. Warna dari `PALETTE` urut nilai desc.

## Insight (teks otomatis)

- Bandingkan pillar tertinggi vs terendah → *"Pillar `<top>` menahan rata-rata watch time `x`s vs `y`s untuk `<bottom>` — narasi mengalahkan hard-sell."*

## Contoh SQL

```sql
SELECT p.content_pillar pillar, AVG(p.avg_watch_time) awt
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1 AND p.platform = 'tiktok'
  AND p.post_date::date BETWEEN $2 AND $3
  AND p.content_pillar IS NOT NULL AND p.avg_watch_time IS NOT NULL
  AND ($4::uuid IS NULL OR bsa.brand_id = $4)
GROUP BY p.content_pillar ORDER BY awt DESC;
```

## Catatan

- `avg_watch_time` dalam detik (numeric). `content_pillar` berasal dari `l0_extra.tiktok_post_extra_attribute` yang diturunkan ke silver.
