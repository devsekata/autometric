# Stories Dashboard — Dokumentasi Sumber Data

Memetakan tiap angka di dashboard **Stories** ke sumbernya. Pola identik dengan [Overview](../overview/README.md); seluruh section dari **gold**.

## Alur data

```
Browser  src/components/dashboard/StoriesDashboard.tsx
   │  GET /api/organizations/[id]/dashboard/stories?platform=&period=&brand=
   ▼
API      src/app/api/organizations/[id]/dashboard/stories/route.ts
   │  auth + requireOrgMemberById  →  getStoriesData(orgId, platform, days, brandId)
   ▼
Lib      src/lib/dashboard/stories.ts
   ▼
DB       l2_gold.story_metric_daily  (KPI, funnel, over-time)
         l2_gold.story_type_daily    (story type performance)
```

> Kedua tabel gold me-roll-up `l1_silver.unified_story`. `brand_id` = `public.brands.id` (umbrella brand). Di seed saat ini hanya **Instagram** yang punya data story.

## Scoping & filter (semua section)

| Filter | Aturan |
|---|---|
| **Organisasi** | `brand_id = public.brands.id` → join `brands.organization_id`. |
| **Brand** | `s.brand_id = brandId` (kosong = semua brand org). |
| **Platform** | `All` = tanpa filter; selain itu `WHERE platform = <pilihan>`. |
| **Period** | `7 / 30 / 90 hari` (`Custom` → 30). |
| **Window tanggal** | Anchor = `MAX(metric_date)` di `story_metric_daily`. Current = `[anchor−(days−1), anchor]`; Previous = window sebelumnya (untuk delta KPI). |

## Section

| Section | Sumber | Detail |
|---|---|---|
| **Performance** (KPI cards) | `story_metric_daily` | [performance.md](./performance.md) |
| **Story Retention Funnel** | `story_metric_daily` | [retention-funnel.md](./retention-funnel.md) |
| **Story Type Performance** | `story_type_daily` | [story-type-performance.md](./story-type-performance.md) |
| **Story Performance Over Time** | `story_metric_daily` | [performance-over-time.md](./performance-over-time.md) |
