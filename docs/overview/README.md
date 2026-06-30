# Overview Dashboard — Dokumentasi Sumber Data

Dokumentasi ini memetakan setiap angka di dashboard **Overview** ke sumbernya: **tabel + kolom + rumus**.

## Alur data

```
Browser  src/components/dashboard/OverviewDashboard.tsx
   │  GET /api/organizations/[id]/dashboard/overview?platform=&period=&brand=
   ▼
API      src/app/api/organizations/[id]/dashboard/overview/route.ts
   │  auth + requireOrgMemberById  →  getOverviewData(orgId, platform, days, brandId)
   ▼
Lib      src/lib/dashboard/overview.ts        (SQL ke gold + silver)
   ▼
DB       l2_gold.*  (+ l1_silver.* untuk followers & heatmap)
```

## Scoping & filter (berlaku untuk semua section)

| Filter | Aturan |
|---|---|
| **Organisasi** | Gold: `brand_id = public.brands.id` → join `brands.organization_id`. Silver: `brand_id = social_accounts.id` → join `brand_social_accounts → brands`. |
| **Brand** | Mengikuti brand di switcher (`brand=<brandId>`). Gold: `bmd.brand_id = brandId`. Silver: `bsa.brand_id = brandId`. Kosong = portfolio (semua brand org). |
| **Platform** | `All` = tanpa filter; selain itu `WHERE platform = <pilihan>`. |
| **Period** | `7 / 30 / 90 hari` (`Custom` → 30). |
| **Window tanggal** | Anchor = `MAX(metric_date)` untuk org/brand. **Current** = `[anchor−(days−1), anchor]`; **Previous** = `[anchor−(2·days−1), anchor−days]` (untuk delta). |

## Section

| Section | Status | Detail |
|---|---|---|
| **Performance** (KPI cards) | ✅ terdokumentasi | [performance.md](./performance.md) |
| **Engagement Over Time** | ✅ terdokumentasi | [engagement-over-time.md](./engagement-over-time.md) |
| **Platform Share** | ✅ terdokumentasi | [platform-share.md](./platform-share.md) |
| **Brand Performance Matrix** | ✅ terdokumentasi | [brand-performance-matrix.md](./brand-performance-matrix.md) |
| **Content Attribute Breakdown** | ✅ terdokumentasi | [content-attribute-breakdown.md](./content-attribute-breakdown.md) |
| **Best Posting Times** | ✅ terdokumentasi | [best-posting-times.md](./best-posting-times.md) |
