# Report Tables — Empty Metrics (still "—")

Which **Content Level** / **Channel Level** metric columns still render `—` even
after a brand is fully seeded and the medallion pipeline has run, and *why*.

Verified 2026-07-03 against brand **Fibo Demo** (org `gg`), June 2026, after
running all `sp_sync_*` / `sp_build_*` procedures. Everything **not** listed here
fills with real data. See also `docs/reports/table-metrics.md` (full mapping).

> A metric renders `—` when its value is `null` — either because the resolver in
> `src/lib/reports/data/metricsQuery.ts` returns `null` on purpose (no usable
> column), or because the underlying data is empty for that channel.

## Summary

| Table | Column | Channel(s) | Root cause |
|---|---|---|---|
| Content | Reels Skip Rate | Instagram | No source anywhere (L0 → silver) |
| Content | Video Avg. Watch Time | Facebook | No FB watch-time field in L0/silver |
| Content | Video Views | Facebook | No per-post column in silver |
| Content | Post Avg. View Time | TikTok | No unambiguous source column |
| Channel | New Follows | Instagram, Facebook | L0 only has net growth (no new/lost split) |
| Channel | Unfollows | Instagram, Facebook | L0 only has net growth (no new/lost split) |

TikTok's New Follows / Unfollows **do** fill (TikTok profile carries
`new_followers` / `lost_followers`); Instagram & Facebook do not.

## By root cause

### 1. No source data anywhere (needs new ingestion)

- **Reels Skip Rate** (IG) — `l1_silver.unified_post.reels_skip_rate` exists but
  is never populated; there is no skip field in `l0_harmonization.instagram_post`
  or the raw snapshots. The resolver returns `null` (`case 'reels_skip_rate'`).
  **To fill:** ingest the skip metric from the Meta Graph API into L0, map it
  through `sp_sync_unified_post`, then read the column in `contentValue`.

- **Video Avg. Watch Time** (FB) — Facebook has no average-watch-time field in
  L0 (`facebook_post` carries no watch time), so `unified_post.avg_watch_time`
  is empty for FB → `—`. Instagram (`reel_avg_watch_time`) and TikTok
  (`l0_extra.tiktok_post_extra_attribute.avg_watch_time`) do populate it.
  **To fill:** add a FB watch-time field to the FB post ingestion.

### 2. No per-post column in silver (only aggregate / ambiguous)

- **Video Views** (FB content-level) — silver has no per-post `video_views`
  column (only gold `brand_metric_daily.video_views_sum` at the channel level,
  which does feed the *Channel* table's **Avg. Video Views**). The content-level
  resolver returns `null` (`case 'video_views'`).
  **To fill:** add a per-post `video_views` column to `unified_post` + map it.

- **Post Avg. View Time** (TT content-level) — no unambiguous silver column
  (`avg_watch_time` already backs *Video Avg. Watch Time*; `video_view_total_time`
  is a total, not an average). The resolver returns `null` (`case 'post_view_time'`).
  **To fill:** decide the definition + source column, then read it in `contentValue`.

### 3. Missing breakdown in L0 (only a net figure exists)

- **New Follows** and **Unfollows** (IG + FB channel-level) — L0 only carries a
  net growth number (`instagram_profile.followers_growth`,
  `facebook_profile.follows_increase`); there is no separate new-vs-lost split.
  So gold `new_followers_sum` / `lost_followers_sum` stay `0` → `—`. Only
  **TikTok** has the split (`tiktok_profile.new_followers` / `lost_followers`),
  which flows to gold and fills.
  **What still fills:** **Followers Net Growth** (from the net figure) is shown.
  **To fill new/lost:** ingest per-day new/lost follower counts for IG & FB.

## Note

These are data-pipeline gaps, not report bugs. The report intentionally renders
`—` for `null` (per the "yang tidak ada → (-)" rule). Once the upstream columns
are populated and the pipeline is re-run, only the three resolver `case … return
null` lines in `metricsQuery.ts` (Reels Skip Rate, FB Video Views, TT Post Avg.
View Time) would additionally need to be pointed at their new columns.
