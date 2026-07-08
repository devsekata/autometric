# Report Tables — Metric → Database Mapping

How the report builder's **Content Level Metric** and **Channel Level Metric**
tables pull real data, following the ROBZ LAUNCH metrics mapping
(`docs/metrik/[8ricks x SEKATA] Metrics Mapping (5).xlsx`).

- **Source code:** `src/lib/reports/data/metricsQuery.ts` (`getReportTableMetrics`)
- **API:** `GET /api/organizations/[id]/reports/table-metrics?brand=&year=&month=`
- **Rows:** `Previous Month` / `Current Month` / `Gap (%)`. Current = the report's
  selected month; Previous = the month before. Gap = `(curr − prev) / prev × 100`.
- **Scope:** one org + one brand. Content/`Avg.` metrics come from
  `l1_silver.unified_post`; channel profile metrics from
  `l2_gold.brand_metric_daily`.
- **Missing / ambiguous values render as `—`** in the UI and PPTX export. A metric
  is treated as "no data" when all source rows for the window are null/zero.

## Aggregation rules (from the Excel)

- **Count metrics** (Likes, Comments, Shares, Saved, Reposts, Reach, Views,
  Impressions, Engagement Owned/Public, New Follow from Content): **SUM** over all
  posts in the month.
- **ER metrics** (ER Reach/Views/Impressions/Followers): **average of per-post ER**
  (Excel: *"SUM OF ER / TOTAL POST"*) — read from the precomputed `er_*` columns.
  Silver stores `er_*` as a **fraction** (engagement/denominator, e.g. `0.088`), so
  `metricsQuery` scales it **×100** for the percent display (→ `8.8%`).
  `completion_rate` is already `0..100` and is **not** scaled.
- **Channel `Avg. X`** metrics: `SUM(metric) / TOTAL POSTS` (Excel:
  *"SUM OF METRICS PERFORMANCE / TOTAL POST"*).
- **Channel profile** metrics (followers, growth, profile views/reach): from gold
  daily sums; `Total Followers` = last `follower_count_eod` in the window.

## Content Level — column → source (per channel)

| Column | Instagram | TikTok | Facebook |
|---|---|---|---|
| Likes | `likes` | `likes` | `reactions` |
| Comments | `comments` | `comments` | `comments` |
| Shares | `shares` | `shares` | `shares` |
| Saved | `saves` | `saves` | — (not in doc) |
| Reposts | `repost_count` | — | — |
| Engagement Owned | `engagement` | `engagement` | `engagement` |
| Engagement Public | `engagement_public` | `engagement_public` | `engagement_public` |
| ER Reach | `er_reach` (avg) | `er_reach` (avg) | `er_reach` (avg) |
| ER Views | `er_views` (avg) | `er_views` (avg) | — |
| ER Impressions | — | — | `er_impressions` (avg) |
| ER Followers | `er_followers` (avg) | `er_followers` (avg) | `er_followers` (avg) |
| Reach | `reach` | `reach` | `reach` |
| Views | `views` | — | — |
| Impressions | — | `views` ⚠️ | `impressions` |
| Video Views | — | — | **—** (no per-post source) |
| Reels Skip Rate | **—** | — | — |
| Video Avg. Watch Time | `avg_watch_time` (normalized→s) | **—** (empty in silver) | **—** (empty in silver) |
| Post Avg. View Time | — | **—** | — |
| Post Completion Rate | — | `completion_rate` | — |
| New Follow from Content | `follows` | `follows` | — |

## Channel Level — column → source (per channel)

| Column | Source | Notes |
|---|---|---|
| Total Followers | `brand_metric_daily.follower_count_eod` | last day in window |
| Followers Net Growth | `net_growth_sum` (SUM) | |
| New Follows | `new_followers_sum` (SUM) | **— when unpopulated** |
| Unfollows | `lost_followers_sum` (SUM) | **— when unpopulated** |
| Profile Views | `profile_visit_sum` (SUM) | IG/TT often `—` in current data |
| Profile Reach | `profile_reach_sum` (SUM) | TT often `—` in current data |
| Avg. ER Reach/Views/Impr/Followers | `er_*` from silver (avg) | per-platform (views vs impressions) |
| Total Posts | `COUNT(posts)` | |
| Avg. Likes/Comments/Shares/Saved/Reposts | `SUM/COUNT` from silver | FB likes = `reactions` |
| Avg. Engagement Owned/Public | `SUM/COUNT` from silver | |
| Avg. Reach/Views/Impressions | `SUM/COUNT` from silver | TikTok `Avg. Impressions` reads `views` |
| Avg. Video Views | `video_views_sum / COUNT` | Facebook only |

## Known gaps (render `—`, pending pipeline)

> Full breakdown of every still-empty column + how to fill each:
> **`docs/reports/empty-metrics.md`**.

| Metric | Reason |
|---|---|
| **Reels Skip Rate** | Column exists (`unified_post.reels_skip_rate`) but is never populated — no source field in `l0_harmonization.instagram_post`. Needs Meta Graph API ingestion. |
| **Video Avg. Watch Time** (Facebook / TikTok) | `avg_watch_time` is empty in silver for FB/TT (TikTok source exists in `l0_extra.tiktok_post_extra_attribute.avg_watch_time` but isn't loaded to silver yet). **Instagram is wired.** Note: `avg_watch_time` is stored **inconsistently across brands** — seconds for some (e.g. 22.5 on a 50s reel), milliseconds for others (e.g. 8116 on a 61s reel). `metricsQuery.avgWatchSeconds` normalizes each post to seconds using the clip length (`avg_watch_time > duration_s × 2` ⇒ treated as ms, ÷1000). |
| **Post Avg. View Time** (TikTok) | No unambiguous source column. |
| **Video Views** (FB content-level) | No per-post column in silver (`video_views_sum` only exists at the gold/channel level → feeds `Avg. Video Views`). |
| **New Follows / Unfollows** | `new_followers_sum` / `lost_followers_sum` are 0/unpopulated in gold (only `net_growth_sum` is captured). |
| **Post Completion Rate** (TikTok) | `completion_rate` empty in current seed → `—` (mapping is ready once populated). |
| **Impressions (TikTok)** ⚠️ | The `impressions` column is empty for TikTok; the populated `views` column is used instead. |

## TikTok "Impressions" note

The ROBZ LAUNCH doc names TikTok's "impressions/views of posts" metric
**Impressions**, but TikTok data lands in the `views` column (its `impressions`
column is empty). So the TikTok `Impressions` / `Avg. Impressions` columns read
from `views`.
