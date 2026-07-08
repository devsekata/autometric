# Content Overview Dashboard — Dokumentasi Sumber Data

Dokumentasi ini memetakan setiap angka di dashboard **Content Overview** ke sumbernya: **tabel + kolom + rumus**. Polanya identik dengan [Overview](../overview/README.md) — beda di tabel sumber per section.

## Alur data

```
Browser  src/components/dashboard/ContentDashboard.tsx
   │  GET /api/organizations/[id]/dashboard/content?platform=&period=&brand=
   ▼
API      src/app/api/organizations/[id]/dashboard/content/route.ts
   │  auth + requireOrgMemberById  →  getContentOverviewData(orgId, platform, days, brandId)
   ▼
Lib      src/lib/dashboard/content.ts        (SQL ke gold + silver)
   ▼
DB       l2_gold.brand_metric_daily  (posts, saves, volume)
         l1_silver.unified_post      (completion, link clicks, top posts, format, watch time)
```

## Gold vs Silver — kenapa dua-duanya?

Content Overview butuh **detail per-post** (format, completion rate, watch time, link clicks per platform) yang **tidak ada di gold** (gold cuma roll-up harian per brand×platform). Jadi:

| Butuh roll-up harian | Sumber |
|---|---|
| Total Posts, Saves (IG), Content Volume by Week | **`l2_gold.brand_metric_daily`** |
| Completion Rate (TK), Link Clicks (FB), Top Posts, Post-Type, Reel Watch Time | **`l1_silver.unified_post`** (per-post) |

## Scoping & filter (berlaku untuk semua section)

| Filter | Aturan |
|---|---|
| **Organisasi** | Gold: `brand_id = public.brands.id` → join `brands.organization_id`. Silver: `brand_id = social_accounts.id` → join `brand_social_accounts → brands`. |
| **Brand** | Mengikuti brand di switcher (`brand=<brandId>`). Gold: `bmd.brand_id = brandId`. Silver: `bsa.brand_id = brandId`. Kosong = portfolio (semua brand org). |
| **Platform** | `All` = tanpa filter; selain itu `WHERE platform = <pilihan>`. **Catatan:** 3 kartu yang secara desain spesifik-platform (Post Type = IG, Completion = TK, Reel Watch = IG) selalu query platformnya sendiri, mengabaikan toggle (sama seperti kartu "TK Video Views" di Overview). |
| **Period** | `7 / 30 / 90 hari` (`Custom` → 30). |
| **Window tanggal** | Anchor = `MAX(metric_date)` di gold untuk org/brand. **Current** = `[anchor−(days−1), anchor]`; **Previous** = `[anchor−(2·days−1), anchor−days]` (untuk delta). Query silver memfilter `post_date::date` pada window yang sama. |

## Section

| Section | Status | Sumber | Detail |
|---|---|---|---|
| **Performance** (KPI cards) | ✅ terdokumentasi | gold + silver | [performance.md](./performance.md) |
| **Post Type Performance** | ✅ terdokumentasi | silver | [post-type-performance.md](./post-type-performance.md) |
| **Content Volume by Week** | ✅ terdokumentasi | gold | [content-volume.md](./content-volume.md) |
| **Top Posts — Performance Table** | ✅ terdokumentasi | silver | [top-posts.md](./top-posts.md) |
| **TikTok Completion Rate Distribution** | ✅ terdokumentasi | silver | [completion-rate.md](./completion-rate.md) |
| **Reel Watch Time by Duration** | ✅ terdokumentasi | silver | [reel-watch-time.md](./reel-watch-time.md) |

## Catatan grain `l1_silver.unified_post`

- Satu baris = satu post. `brand_id` = `social_accounts.id` (per-akun), jadi scope brand lewat `brand_social_accounts`.
- Kolom kunci yang dipakai: `platform, post_date, format, post_type, reach, views, likes, comments, shares, saves, engagement_rate, link_click, avg_watch_time, duration_s, completion_rate (text), is_boosted`.
- `completion_rate` disimpan sebagai **teks** (mis. `'79%'`) → diparse ke numeric `0..100` dengan `regexp_replace`.
- `engagement_rate` sudah dalam **persen** (numeric) — dipakai apa adanya sebagai kolom ER di Top Posts.
