# Community Dashboard — Dokumentasi Sumber Data

Memetakan tiap angka di dashboard **Community** ke sumbernya. Seluruh section dari **gold**.

## Alur data

```
Browser  src/components/dashboard/CommunityDashboard.tsx
   │  GET /api/organizations/[id]/dashboard/community?platform=&period=&brand=
   ▼
API      src/app/api/organizations/[id]/dashboard/community/route.ts
   │  auth + requireOrgMemberById  →  getCommunityData(orgId, platform, days, brandId)
   ▼
Lib      src/lib/dashboard/community.ts
   ▼
DB       l2_gold.comment_activity_daily   (KPI + comment volume)
         l2_gold.comment_activity_hourly  (comments by hour)
         l2_gold.community_contributors    (leaderboard)
```

> Semua tabel gold (`brand_id` = public.brands.id, scope via `brands`).

## Scoping & filter

| Filter | Aturan |
|---|---|
| **Organisasi** | `brand_id = public.brands.id` → `brands.organization_id`. |
| **Brand** | `c.brand_id = brandId` / `cc.brand_id = brandId`. Kosong = semua brand org. |
| **Platform** | `All` = tanpa filter; selain itu `WHERE platform = <pilihan>`. KPI bersifat per-platform via `FILTER`. |
| **Period** | `7 / 30 / 90 hari` (`Custom` → 30). Leaderboard memilih baris `window_days` sesuai period. |
| **Window** | Anchor = `MAX(metric_date)` di `comment_activity_daily`. Current/Previous untuk delta. |

## Section

| Section | Sumber | Detail |
|---|---|---|
| **Performance** (KPI cards) | `comment_activity_daily` | [performance.md](./performance.md) |
| **Comment Volume by Platform** | `comment_activity_daily` | [comment-volume.md](./comment-volume.md) |
| **Comment Activity by Hour** | `comment_activity_hourly` | [comment-by-hour.md](./comment-by-hour.md) |
| **Community Leaderboard** | `community_contributors` | [leaderboard.md](./leaderboard.md) |
