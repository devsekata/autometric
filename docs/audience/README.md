# Audience Deep Dive Dashboard — Dokumentasi Sumber Data

Memetakan tiap angka di dashboard **Audience Deep Dive** ke sumbernya. Tab ini **multi-sumber** — selain silver/gold, ada section yang menarik dari schema `feature.*` dan `l0_harmonization.*`.

## Alur data

```
Browser  src/components/dashboard/AudienceDashboard.tsx
   │  GET /api/organizations/[id]/dashboard/audience?platform=&period=&brand=
   ▼
API      src/app/api/organizations/[id]/dashboard/audience/route.ts
   │  auth + requireOrgMemberById  →  getAudienceData(orgId, platform, days, brandId)
   ▼
Lib      src/lib/dashboard/audience.ts
   ▼
DB       l1_silver.unified_profile          (KPI, follower growth)
         l1_silver.unified_audience         (age, gender, cities — snapshot)
         l2_gold.community_contributors      (top contributors)
         feature.comment_relevance_scores    (comment relevance)  + l1_silver.unified_comment (teks)
         l0_harmonization.instagram_tagged_post (UGC)
```

## Sumber per section (penting)

| Section | Sumber | Catatan grain |
|---|---|---|
| KPI cards | `l1_silver.unified_profile` | silver: scope via `brand_social_accounts` |
| Age / Gender / Cities | `l1_silver.unified_audience` | **snapshot** (1 tanggal), IG-only di seed |
| Community Contributors | `l2_gold.community_contributors` | gold: scope via `brands` |
| Comment Relevance | `feature.comment_relevance_scores` (+ `unified_comment`) | di luar medallion; **tabel kosong di seed → empty state** |
| UGC Tagged Posts | `l0_harmonization.instagram_tagged_post` | L0: scope via `brand_social_accounts`, IG-only |

## Scoping & filter

| Filter | Aturan |
|---|---|
| **Organisasi** | silver/L0 (`brand_id`=social_accounts.id) → `brand_social_accounts → brands.organization_id`. gold (`brand_id`=brands.id) → `brands` langsung. |
| **Brand** | silver/L0: `bsa.brand_id = brandId`; gold: `cc.brand_id = brandId`. Kosong = semua brand org. |
| **Platform** | `All` = tanpa filter; selain itu `WHERE platform = <pilihan>`. |
| **Period** | `7 / 30 / 90 hari` (`Custom` → 30). KPI/follower/UGC mengikuti window; **demografi (age/gender/city) = snapshot terbaru, tidak terpengaruh period.** Community Contributors memilih baris `window_days` sesuai period. |
| **Window** | Anchor = `MAX(profile_date)` di `unified_profile`. Current/Previous seperti tab lain. |

## Section

| Section | Detail |
|---|---|
| **Performance** (KPI cards) | [performance.md](./performance.md) |
| **Audience Age Distribution** | [age-distribution.md](./age-distribution.md) |
| **Gender Split by Platform** | [gender-split.md](./gender-split.md) |
| **Comment Relevance Analysis** | [comment-relevance.md](./comment-relevance.md) |
| **Top Community Contributors** | [community-contributors.md](./community-contributors.md) |
| **Top Audience Cities** | [audience-cities.md](./audience-cities.md) |
| **Follower Growth Trend** | [follower-growth.md](./follower-growth.md) |
| **UGC — Tagged Posts** | [ugc-tagged-posts.md](./ugc-tagged-posts.md) |
