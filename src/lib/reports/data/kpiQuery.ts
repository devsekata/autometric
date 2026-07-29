// Real KPI scorecard values for the report, scoped to one org + brand + month
// (current month vs the previous month, per platform). Sibling of metricsQuery /
// chartQuery. Sources per the KPI defs in kpiMetrics.ts:
//   - most metrics        → l2_gold.brand_metric_daily (SUM over the month; ER =
//     SUM(engagement)/SUM(er_denominator); followers = last follower_count_eod)
//   - Story Views/Reach   → l2_gold.story_metric_daily
//   - Website Clicks /
//     Total Interactions  → l1_silver.unified_profile (daily, summed)
//   - Avg. Watch Time     → l1_silver.unified_post (avg per post, ms→s normalized)
import pool from '@/lib/db'
import type { DashPlatform } from '@/components/dashboard/data'
import type { ReportKpiMetrics, KpiPair } from './kpiMetrics'

const PLATFORMS: DashPlatform[] = ['instagram', 'facebook', 'tiktok']
const pad = (n: number) => String(n).padStart(2, '0')
const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`
const monthEndExcl = (y: number, m: number) => (m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`)
const prevMonth = (y: number, m: number) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 })

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any> & { platform: string; metric_date: string }
const num = (v: any): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

export async function getReportKpiMetrics(
  orgId: string, brandId: string, year: number, month: number,
): Promise<ReportKpiMetrics> {
  const pv = prevMonth(year, month)
  const rangeStart = monthStart(pv.y, pv.m)     // previous month start
  const rangeEnd = monthEndExcl(year, month)    // current month end (exclusive)
  const curStart = monthStart(year, month)      // boundary: >= curStart ⇒ current

  const [gold, story, prof, post] = await Promise.all([
    pool.query<Row>(
      `SELECT bmd.platform, to_char(bmd.metric_date, 'YYYY-MM-DD') metric_date,
              bmd.reach_sum::float, bmd.impressions_sum::float, bmd.engagement_sum::float,
              bmd.likes_sum::float, bmd.comments_sum::float, bmd.saves_sum::float,
              bmd.shares_sum::float, bmd.reposts_sum::float, bmd.views_sum::float,
              bmd.profile_visit_sum::float, bmd.new_followers_sum::float, bmd.net_growth_sum::float,
              bmd.er_denominator_sum::float, bmd.follower_count_eod::float
         FROM l2_gold.brand_metric_daily bmd
         JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND bmd.brand_id = $2
          AND bmd.metric_date >= $3 AND bmd.metric_date < $4
          AND bmd.platform IN ('instagram','facebook','tiktok')`,
      [orgId, brandId, rangeStart, rangeEnd],
    ),
    pool.query<Row>(
      `SELECT sm.platform, to_char(sm.metric_date, 'YYYY-MM-DD') metric_date,
              sm.views_sum::float, sm.reach_sum::float
         FROM l2_gold.story_metric_daily sm
         JOIN public.brands b ON b.id = sm.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND sm.brand_id = $2
          AND sm.metric_date >= $3 AND sm.metric_date < $4
          AND sm.platform IN ('instagram','facebook','tiktok')`,
      [orgId, brandId, rangeStart, rangeEnd],
    ),
    pool.query<Row>(
      `SELECT up.platform, to_char(up.profile_date, 'YYYY-MM-DD') metric_date,
              up.link_clicks::float, up.total_interactions::float
         FROM l1_silver.unified_profile up
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = up.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND bsa.brand_id = $2
          AND up.profile_date >= $3 AND up.profile_date < $4
          AND up.platform IN ('instagram','facebook','tiktok')`,
      [orgId, brandId, rangeStart, rangeEnd],
    ),
    pool.query<Row>(
      `SELECT p.platform, to_char(p.post_date, 'YYYY-MM-DD') metric_date,
              p.avg_watch_time::float, p.duration_s::float
         FROM l1_silver.unified_post p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND bsa.brand_id = $2
          AND p.post_date >= $3 AND p.post_date < $4
          AND p.platform IN ('instagram','facebook','tiktok')`,
      [orgId, brandId, rangeStart, rangeEnd],
    ),
  ])

  // SUM over rows for a field; null when there are no source rows for the window.
  const sumField = (rows: Row[], f: string): number | null =>
    rows.length ? rows.reduce((a, r) => a + (num(r[f]) ?? 0), 0) : null
  const lastEod = (rows: Row[]): number | null => {
    let best: number | null = null, bd = ''
    for (const r of rows) { if (r.follower_count_eod != null && r.metric_date > bd) { bd = r.metric_date; best = Number(r.follower_count_eod) } }
    return best
  }
  const erRatio = (rows: Row[]): number | null => {
    if (!rows.length) return null
    const eng = rows.reduce((a, r) => a + (num(r.engagement_sum) ?? 0), 0)
    const den = rows.reduce((a, r) => a + (num(r.er_denominator_sum) ?? 0), 0)
    return den > 0 ? (eng / den) * 100 : null
  }
  // avg_watch_time is stored inconsistently (s for some brands, ms for others) —
  // normalize to seconds per post via the clip length, then average.
  const avgWatch = (rows: Row[]): number | null => {
    let s = 0, c = 0
    for (const r of rows) {
      const awt = num(r.avg_watch_time), dur = num(r.duration_s)
      if (awt != null && awt > 0 && dur != null && dur > 0) { s += awt > dur * 2 ? awt / 1000 : awt; c++ }
    }
    return c ? s / c : null
  }

  const out: ReportKpiMetrics = {}
  for (const p of PLATFORMS) {
    const split = (rows: Row[]) => {
      const all = rows.filter(r => r.platform === p)
      return { cur: all.filter(r => r.metric_date >= curStart), prev: all.filter(r => r.metric_date < curStart) }
    }
    const g = split(gold.rows), st = split(story.rows), pf = split(prof.rows), po = split(post.rows)
    const pair = (curr: number | null, prev: number | null): KpiPair => ({ curr, prev })
    const gp = (f: string) => pair(sumField(g.cur, f), sumField(g.prev, f))

    out[p] = {
      reach: gp('reach_sum'),
      impressions: gp('impressions_sum'),
      followers: pair(lastEod(g.cur), lastEod(g.prev)),
      growth: gp('net_growth_sum'),
      engagement: gp('engagement_sum'),
      er: pair(erRatio(g.cur), erRatio(g.prev)),
      likes: gp('likes_sum'),
      comments: gp('comments_sum'),
      saves: gp('saves_sum'),
      shares: gp('shares_sum'),
      reposts: gp('reposts_sum'),
      views: gp('views_sum'),
      visits: gp('profile_visit_sum'),
      new_followers: gp('new_followers_sum'),
      story_views: pair(sumField(st.cur, 'views_sum'), sumField(st.prev, 'views_sum')),
      story_reach: pair(sumField(st.cur, 'reach_sum'), sumField(st.prev, 'reach_sum')),
      clicks: pair(sumField(pf.cur, 'link_clicks'), sumField(pf.prev, 'link_clicks')),
      total_interactions: pair(sumField(pf.cur, 'total_interactions'), sumField(pf.prev, 'total_interactions')),
      watch_time: pair(avgWatch(po.cur), avgWatch(po.prev)),
    }
  }
  return out
}
