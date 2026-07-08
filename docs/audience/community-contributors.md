# Audience › Section: Top Community Contributors

Tabel kontributor komunitas dari **`l2_gold.community_contributors`**. Kode: `src/lib/dashboard/audience.ts` → `contributors()`.

## Tabel sumber per kolom

| Kolom UI | Kolom DB | Catatan |
|---|---|---|
| **#** (rank) | — | re-rank `index+1` setelah agregasi lintas brand |
| **User** | `normalized_username` | diberi prefix `@`; inisial diturunkan dari nama |
| **(logo)** | `platform` | logo dari `PLATFORM_META` |
| **Comments** | `comments_count` | |
| **Likes** | `likes_received` | |
| **Daily** | `comments_count`, `window_days` | `comments_count / window_days` (1 desimal) |
| **Relevance** | `avg_relevance` | `%`; `NULL → 0` (di seed masih NULL) |
| **Score** | `composite_score` | dibulatkan |
| **Tier** | `tier` | `active→Active`, `casual→Casual`, `super_fan→Super Fan` |

## Pemilihan window

`window_days` dipilih sesuai period: 7/30/90 (Custom→30). Baris di-`ORDER BY composite_score DESC, comments_count DESC LIMIT 12`.

## Filter klien

Dua `Select` (Platform, Tier) memfilter array `contributors` di komponen `AudienceDashboard.tsx`, tanpa request ulang.

## Contoh SQL

```sql
SELECT cc.normalized_username, cc.platform, cc.comments_count, cc.likes_received,
       cc.avg_relevance, cc.composite_score, cc.tier
FROM l2_gold.community_contributors cc
JOIN public.brands b ON b.id = cc.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR cc.platform = $2)
  AND cc.window_days = $3
  AND ($4::uuid IS NULL OR cc.brand_id = $4)
ORDER BY cc.composite_score DESC, cc.comments_count DESC
LIMIT 12;
```

## Catatan

- `community_contributors` adalah tabel **gold** → `brand_id = brands.id` (scope via `brands`, bukan `brand_social_accounts`).
- Di seed `avg_relevance` NULL & `composite_score` rata 50, tier hanya `active/casual` → tampil flat (mencerminkan data, bukan bug).
