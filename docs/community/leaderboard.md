# Community › Section: Top Commenters — Leaderboard

Tabel kontributor dari **`l2_gold.community_contributors`**. Kode: `src/lib/dashboard/community.ts` → `leaderboard()`.

## Tabel sumber per kolom

| Kolom UI | Kolom DB | Catatan |
|---|---|---|
| **Rank** | — | re-rank `index+1` setelah agregasi lintas brand |
| **Username** | `normalized_username` | prefix `@` |
| **Platform** | `platform` | badge `PLATFORM_META[platform].short` |
| **Comments** | `comments_count` | |
| **Likes Received** | `likes_received` | |
| **Avg Replies** | `replies_sum`, `comments_count` | `replies_sum / comments_count` (1 desimal) |
| **Tier** | `tier` | `active→Active`, `casual→Casual`, `super_fan→Super Fan` |

> Kolom "Avg Replies" memetakan ke field `daily` pada `ContributorRow` (di-reuse), tapi diisi **rata-rata reply per komentar**, bukan per hari.

## Pemilihan window

`window_days` dipilih sesuai period (7/30/90; Custom→30). `ORDER BY composite_score DESC, comments_count DESC LIMIT 12`.

## Contoh SQL

```sql
SELECT cc.normalized_username, cc.platform, cc.comments_count, cc.likes_received,
       cc.replies_sum, cc.composite_score, cc.tier
FROM l2_gold.community_contributors cc
JOIN public.brands b ON b.id = cc.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR cc.platform = $2)
  AND cc.window_days = $3
  AND ($4::uuid IS NULL OR cc.brand_id = $4)
ORDER BY cc.composite_score DESC, cc.comments_count DESC
LIMIT 12;
```

## Catatan

- Tabel gold yang sama dipakai section "Top Community Contributors" di tab Audience — beda kolom yang ditampilkan (lihat [Audience › community-contributors](../audience/community-contributors.md)).
- Di seed `composite_score` rata 50 & tier `active/casual` → urutan flat (mencerminkan data).
