# TikTok Deep Dashboard — Dokumentasi Sumber Data

Memetakan tiap angka di dashboard **TikTok Deep** ke sumbernya. Tab ini **inheren TikTok** — platform toggle diabaikan; semua query di-scope ke TikTok.

## Alur data

```
Browser  src/components/dashboard/TikTokDeepDashboard.tsx
   │  GET /api/organizations/[id]/dashboard/tiktok?platform=&period=&brand=
   ▼
API      src/app/api/organizations/[id]/dashboard/tiktok/route.ts
   │  auth + requireOrgMemberById  →  getTiktokData(orgId, _platform, days, brandId)
   ▼
Lib      src/lib/dashboard/tiktok.ts
   ▼
DB       l2_gold.tiktok_churn_daily  (KPI followers/views + churn)
         l1_silver.unified_post      (completion, duration, watch time, pillar — platform='tiktok')
```

## Sumber per section

| Section | Sumber | Grain |
|---|---|---|
| KPI: views/new/lost/net | `l2_gold.tiktok_churn_daily` | gold (`brand_id`=brands.id) |
| KPI: Avg Completion | `l1_silver.unified_post` | silver (scope via `brand_social_accounts`) |
| Follower Churn (weekly) | `l2_gold.tiktok_churn_daily` | gold |
| Duration vs Completion | `l1_silver.unified_post` | silver |
| Avg Watch Time by Pillar | `l1_silver.unified_post` | silver |

## Scoping & filter

| Filter | Aturan |
|---|---|
| **Organisasi** | gold: `brand_id`=brands.id → `brands.organization_id`. silver: `brand_id`=social_accounts.id → `brand_social_accounts → brands`. |
| **Brand** | gold `t.brand_id = brandId`; silver `bsa.brand_id = brandId`. |
| **Platform** | **Diabaikan** — selalu TikTok (churn table & `unified_post` difilter `platform='tiktok'`). |
| **Period** | `7 / 30 / 90 hari` (`Custom` → 30). |
| **Window** | Anchor = `MAX(metric_date)` di `tiktok_churn_daily`. Current/Previous untuk delta. |

## Section

| Section | Detail |
|---|---|
| **Performance** (KPI cards) | [performance.md](./performance.md) |
| **Follower Churn Analysis** | [follower-churn.md](./follower-churn.md) |
| **Duration vs. Completion Rate** | [duration-completion.md](./duration-completion.md) |
| **Avg Watch Time by Content Pillar** | [watch-by-pillar.md](./watch-by-pillar.md) |
