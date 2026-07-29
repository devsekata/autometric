// Real time-series values for the report's line chart, scoped to one org + brand
// + period. Sibling of metricsQuery.ts (which backs the tables). For each channel
// and each wired metric we precompute all three line dimensions so the chart can
// switch dimension client-side without refetching:
//   - Day Month      : one point per day of the report month
//   - Last 3 Months  : the report month + the two before it
//   - Daily          : average per weekday (Sun…Sat) within the report month
//
// Sources (per the ROBZ LAUNCH mapping, same joins as metricsQuery):
//   - Channel/profile metrics (followers, profile views/reach, net growth) come
//     from l2_gold.brand_metric_daily (daily aggregates).
//   - Post metrics (engagements, likes, comments, shares) are summed per day from
//     l1_silver.unified_post (Facebook "likes" = reactions).
//   - `sentiments` (3 lines: pos/neu/neg comment counts) come from
//     l2_gold.comment_sentiment_daily; the word cloud comes from l2_gold.post_wordcloud
//     joined to l2_gold.comment_sentiment_post (per-post dominant_sentiment → per-word
//     color). Both fall back to an empty state when the brand+period has no data.
import pool from '@/lib/db'
import type { DashPlatform } from '@/components/dashboard/data'
import {
  CHART_METRIC_IDS, ChartMetricId, ChartDimSeries, ChannelChartMetrics, ChannelBarMetrics, ReportChartMetrics,
  ChannelSentiment, ChannelWords, CloudWordData, SentimentKey,
  CompetitorChartSection, CompetitorChartEntity,
} from './chartTypes'
import { getOrgCustomMetrics } from './customMetricsStore'
import { evaluateExpression, type CustomMetricDef } from './customMetrics'

const PLATFORMS: DashPlatform[] = ['instagram', 'facebook', 'tiktok']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WORDCLOUD_MAX = 60  // top-N words per channel (source has hundreds of tokens)

const pad = (n: number) => String(n).padStart(2, '0')
const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`
const monthEndExcl = (y: number, m: number) => (m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`)
const addMonths = (y: number, m: number, d: number) => {
  const t = (y * 12 + (m - 1)) + d
  return { y: Math.floor(t / 12), m: (t % 12) + 1 }
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const weekday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()

function eachDate(startISO: string, endExclISO: string): string[] {
  const out: string[] = []
  const d = new Date(startISO + 'T00:00:00Z')
  const end = new Date(endExclISO + 'T00:00:00Z')
  while (d < end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

interface GoldRow {
  platform: string; metric_date: string
  foll: number | null; pv: number | null; pr: number | null; ng: number | null
  nf: number | null; vv: number | null
}
interface PostRow {
  platform: string; post_date: string
  likes: number | null; reactions: number | null; comments: number | null; shares: number | null; eng: number | null
  reach: number | null; er_sum: number | null; er_cnt: number | null; posts: number | null
  saves: number | null; views: number | null; impressions: number | null
}
interface PillarRow {
  platform: string; content_pillar: string
  posts: number | null; eng: number | null; er_den: number | null; reach: number | null
}
interface SentimentRow {
  platform: string; d: string
  pos: number | null; neu: number | null; neg: number | null
}
interface WordRow {
  platform: string; word: string; sentiment: string | null; freq: number | null
}
// A competitor + its current-month gold aggregate (null → no data for that metric).
interface CompChartRow {
  sid: string; username: string; platform: string
  first_foll: number | null; last_foll: number | null
  post_count: number | null; engagement: number | null
}
type GoldVals = { foll: number | null; pv: number | null; pr: number | null; ng: number | null; nf: number | null; vv: number | null }
type PostVals = {
  likes: number | null; reactions: number | null; comments: number | null; shares: number | null; eng: number | null
  reach: number | null; er_sum: number | null; er_cnt: number | null; posts: number | null
  saves: number | null; views: number | null; impressions: number | null
}

const num = (v: number | null | undefined): number | undefined =>
  v == null || !Number.isFinite(Number(v)) ? undefined : Number(v)

// Sum keeping null when there's no datum at all (0 ≠ "no data" here — a real 0 sum
// stays 0, but an empty set → null so the bar is omitted).
const sumFloatNull = (vals: (number | null | undefined)[]): number | null => {
  let s = 0, has = false
  for (const v of vals) if (v != null) { s += Number(v); has = true }
  return has ? s : null
}
// The four comparable competitor bar metrics from a monthly aggregate (reach-based
// metrics are excluded — public competitor scraping has none).
function competitorMetrics(first: number | null, last: number | null, postCount: number | null, eng: number | null): Partial<Record<string, number>> {
  const m: Partial<Record<string, number>> = {}
  const growth = first != null && last != null ? last - first : null
  if (eng != null) m.engagements = eng
  if (eng != null && postCount) m.avg_engagements = eng / postCount
  if (growth != null) m.followers_growth = growth
  if (growth != null && first) m.followers_growth_pct = (growth / first) * 100
  return m
}

// Per-metric daily value for a platform on a date, or undefined when there's no
// usable datum (drives both the series and the "present" check).
function dailyValue(
  metric: ChartMetricId, p: DashPlatform, date: string,
  gold: Map<string, GoldVals>, post: Map<string, PostVals>,
): number | undefined {
  const g = gold.get(date)
  const s = post.get(date)
  switch (metric) {
    case 'followers': return num(g?.foll)
    case 'profile_views': return num(g?.pv)
    case 'profile_reach': return num(g?.pr)
    case 'net_followers_growth': return num(g?.ng)
    case 'engagements': return num(s?.eng)
    case 'likes': return num(p === 'facebook' ? s?.reactions : s?.likes)
    case 'comments': return num(s?.comments)
    case 'shares': return num(s?.shares)
    default: return undefined
  }
}

const LEVEL: ChartMetricId[] = ['followers'] // stock (carry-forward) vs flow (sum)

function buildDimSeries(
  metric: ChartMetricId, p: DashPlatform,
  windowDates: string[], monthDates: string[], monthGroups: string[][],
  gold: Map<string, GoldVals>, post: Map<string, PostVals>,
): ChartDimSeries | null {
  const isLevel = LEVEL.includes(metric)
  const raw = new Map<string, number>()
  for (const d of windowDates) { const v = dailyValue(metric, p, d, gold, post); if (v !== undefined) raw.set(d, v) }
  if (raw.size === 0) return null // no data anywhere in the window → omit (empty state)

  // level metrics carry forward across gaps (a follower count persists day to day)
  const first = [...raw.values()][0]
  const filled = new Map<string, number>()
  if (isLevel) { let last = first; for (const d of windowDates) { if (raw.has(d)) last = raw.get(d)!; filled.set(d, last) } }
  const valAt = (d: string) => (isLevel ? filled.get(d) ?? first : raw.get(d) ?? 0)

  const daymonth = monthDates.map(valAt)
  const last3months = monthGroups.map(dates =>
    isLevel ? valAt(dates[dates.length - 1]) : dates.reduce((sum, d) => sum + (raw.get(d) ?? 0), 0))
  const byWeekday: number[][] = Array.from({ length: 7 }, () => [])
  for (const d of monthDates) byWeekday[weekday(d)].push(valAt(d))
  const days = byWeekday.map(arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0))

  return { daymonth, last3months, days }
}

// A "flow" dim series from a plain date→count map (no carry-forward): daily value,
// summed per month, averaged per weekday. Used for sentiment comment counts.
function flowDimSeries(
  valByDate: Map<string, number>, monthDates: string[], monthGroups: string[][],
): ChartDimSeries {
  const daymonth = monthDates.map(d => valByDate.get(d) ?? 0)
  const last3months = monthGroups.map(dates => dates.reduce((s, d) => s + (valByDate.get(d) ?? 0), 0))
  const byWeekday: number[][] = Array.from({ length: 7 }, () => [])
  for (const d of monthDates) byWeekday[weekday(d)].push(valByDate.get(d) ?? 0)
  const days = byWeekday.map(arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0))
  return { daymonth, last3months, days }
}

/* ── custom metrics (free expressions over l1/l2 fields, evaluated per time bucket) ── */

// Aggregate a registry field over a set of dates (a time bucket), matching the table's
// per-period semantics: counts SUM, followers = last EOD, ER = ΣerSum/ΣerCnt ×100.
// Returns null when the field has no datum in the bucket, or isn't chart-sourced
// (er_followers / watch_time have no per-day source here → the metric is omitted).
function bucketFieldResolver(
  dates: string[], p: DashPlatform, gold: Map<string, GoldVals>, post: Map<string, PostVals>,
): (fieldId: string) => number | null {
  const sumF = (pick: (d: string) => number | null | undefined): number | null => {
    let s = 0, has = false
    for (const d of dates) { const v = pick(d); if (v != null && Number.isFinite(Number(v))) { s += Number(v); has = true } }
    return has ? s : null
  }
  const lastEod = (): number | null => {
    let best: number | null = null, bd = ''
    for (const d of dates) { const g = gold.get(d); if (g?.foll != null && d > bd) { bd = d; best = Number(g.foll) } }
    return best
  }
  return (fieldId: string): number | null => {
    switch (fieldId) {
      case 'likes': return sumF(d => { const s = post.get(d); return s ? (p === 'facebook' ? s.reactions : s.likes) : null })
      case 'comments': return sumF(d => post.get(d)?.comments)
      case 'shares': return sumF(d => post.get(d)?.shares)
      case 'saves': return sumF(d => post.get(d)?.saves)
      case 'engagement': return sumF(d => post.get(d)?.eng)
      case 'reach': return sumF(d => post.get(d)?.reach)
      case 'views': return sumF(d => post.get(d)?.views)
      case 'impressions': return sumF(d => post.get(d)?.impressions)
      case 'total_posts': return sumF(d => post.get(d)?.posts)
      case 'followers': return lastEod()
      case 'net_growth': return sumF(d => gold.get(d)?.ng)
      case 'new_follows': return sumF(d => gold.get(d)?.nf)
      case 'profile_views': return sumF(d => gold.get(d)?.pv)
      case 'profile_reach': return sumF(d => gold.get(d)?.pr)
      case 'video_views': return sumF(d => gold.get(d)?.vv)
      case 'er_reach': { const es = sumF(d => post.get(d)?.er_sum); const ec = sumF(d => post.get(d)?.er_cnt); return es != null && ec ? (es / ec) * 100 : null }
      default: return null // er_followers, watch_time — not chart-sourced yet
    }
  }
}

// A custom metric's 3-dimension line series: per-day (daymonth), per-month (last3months —
// aggregate-then-combine, matching the table), and weekday-average of the per-day values
// (days). null when the expression yields nothing all month → omit (empty state).
function buildCustomDimSeries(
  def: CustomMetricDef, p: DashPlatform,
  monthDates: string[], monthGroups: string[][],
  gold: Map<string, GoldVals>, post: Map<string, PostVals>,
): ChartDimSeries | null {
  const perDay = monthDates.map(d => evaluateExpression(def.terms, def.multiply100, bucketFieldResolver([d], p, gold, post)))
  if (!perDay.some(v => v != null && Number.isFinite(v))) return null
  const daymonth = perDay.map(v => (v != null && Number.isFinite(v) ? v : 0))
  const last3months = monthGroups.map(dates => {
    const v = evaluateExpression(def.terms, def.multiply100, bucketFieldResolver(dates, p, gold, post))
    return v != null && Number.isFinite(v) ? v : 0
  })
  const byWeekday: number[][] = Array.from({ length: 7 }, () => [])
  monthDates.forEach((d, i) => byWeekday[weekday(d)].push(daymonth[i]))
  const days = byWeekday.map(arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0))
  return { daymonth, last3months, days }
}

/* ── bar categories ──────────────────────────────────────────────────────────── */

const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]                              // Mon…Sun
const WD_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type PillarAgg = { posts: number; eng: number; erDen: number; reach: number }
const nonEmpty = (a: number[]) => a.some(v => Number.isFinite(v) && v !== 0)
// attach a metric only when it carries real (non-zero) data → else the chart shows an empty state for that series
const put = (into: Record<string, number[]>, id: string, arr: number[]) => { if (nonEmpty(arr)) into[id] = arr }

function buildBars(
  monthDates: string[], monthGroups: string[][], monthLabels: string[],
  gold: Map<string, GoldVals>, post: Map<string, PostVals>, pillars: Map<string, PillarAgg>,
  p: DashPlatform, customDefs: CustomMetricDef[],
): ChannelBarMetrics {
  const out: ChannelBarMetrics = {}
  const sumPost = (dates: string[], pick: (v: PostVals) => number | null | undefined) =>
    dates.reduce((s, d) => { const pv = post.get(d); const v = pv ? num(pick(pv)) : undefined; return s + (v ?? 0) }, 0)

  // daily_performance — average per weekday (Mon…Sun) over the report month
  {
    const byWd = (pick: (d: string) => number | undefined) => WD_ORDER.map(wd => {
      let s = 0, c = 0
      for (const d of monthDates) if (weekday(d) === wd) { const v = pick(d); if (v !== undefined) { s += v; c++ } }
      return c ? s / c : 0
    })
    const m: Record<string, number[]> = {}
    put(m, 'profile_views', byWd(d => num(gold.get(d)?.pv)))
    put(m, 'engagement', byWd(d => num(post.get(d)?.eng)))
    put(m, 'followers', byWd(d => num(gold.get(d)?.foll)))
    put(m, 'net_followers_growth', byWd(d => num(gold.get(d)?.ng)))
    // custom metrics — weekday average of per-day custom values (matches the line 'days' dim)
    for (const def of customDefs) {
      const perDay = monthDates.map(d => evaluateExpression(def.terms, def.multiply100, bucketFieldResolver([d], p, gold, post)))
      put(m, def.id, WD_ORDER.map(wd => {
        let s = 0, c = 0
        monthDates.forEach((d, i) => { if (weekday(d) === wd) { const v = perDay[i]; if (v != null && Number.isFinite(v)) { s += v; c++ } } })
        return c ? s / c : 0
      }))
    }
    if (Object.keys(m).length) out.daily_performance = { labels: WD_LABELS, metrics: m }
  }

  // last3months_performance — one value per month (report month + 2 prior)
  {
    const lastFoll = (dates: string[]) => { for (let i = dates.length - 1; i >= 0; i--) { const v = num(gold.get(dates[i])?.foll); if (v !== undefined) return v } return 0 }
    const firstFoll = (dates: string[]) => { for (const d of dates) { const v = num(gold.get(d)?.foll); if (v !== undefined) return v } return 0 }
    const sumNg = (dates: string[]) => dates.reduce((s, d) => { const v = num(gold.get(d)?.ng); return s + (v ?? 0) }, 0)

    const engagements = monthGroups.map(dates => sumPost(dates, v => v.eng))
    const postsCnt = monthGroups.map(dates => sumPost(dates, v => v.posts))
    const m: Record<string, number[]> = {}
    put(m, 'followers', monthGroups.map(lastFoll))
    put(m, 'followers_growth_pct', monthGroups.map(dates => { const f0 = firstFoll(dates); return f0 > 0 ? (sumNg(dates) / f0) * 100 : 0 }))
    put(m, 'er_reach', monthGroups.map(dates => { const es = sumPost(dates, v => v.er_sum); const ec = sumPost(dates, v => v.er_cnt); return ec > 0 ? (es / ec) * 100 : 0 }))
    put(m, 'engagements', engagements)
    put(m, 'avg_engagements', engagements.map((e, i) => (postsCnt[i] > 0 ? e / postsCnt[i] : 0)))
    put(m, 'total_reach', monthGroups.map(dates => sumPost(dates, v => v.reach)))
    // custom metrics — per-month value (aggregate-then-combine, matches table + line last3months)
    for (const def of customDefs) {
      put(m, def.id, monthGroups.map(dates => {
        const v = evaluateExpression(def.terms, def.multiply100, bucketFieldResolver(dates, p, gold, post))
        return v != null && Number.isFinite(v) ? v : 0
      }))
    }
    if (Object.keys(m).length) out.last3months_performance = { labels: monthLabels, metrics: m }
  }

  // content_pillars — aggregate the gold pillar rollup over the report month (top 6 by posts)
  {
    const names = [...pillars.entries()].sort((a, b) => b[1].posts - a[1].posts).slice(0, 6).map(e => e[0])
    if (names.length) {
      const agg = names.map(n => pillars.get(n)!)
      const m: Record<string, number[]> = {}
      put(m, 'number_of_posts', agg.map(a => a.posts))
      put(m, 'engagement', agg.map(a => a.eng))
      put(m, 'avg_engagements', agg.map(a => (a.posts > 0 ? a.eng / a.posts : 0)))
      put(m, 'avg_reach', agg.map(a => (a.posts > 0 ? a.reach / a.posts : 0)))
      put(m, 'avg_er_pct', agg.map(a => (a.erDen > 0 ? (a.eng / a.erDen) * 100 : 0)))
      if (Object.keys(m).length) out.content_pillars = { labels: names, metrics: m }
    }
  }

  return out
}

/**
 * Compute the report line chart's real series for Instagram / Facebook / TikTok
 * over the selected month plus the two preceding months.
 */
export async function getReportChartMetrics(
  orgId: string, brandId: string, year: number, month: number,
): Promise<ReportChartMetrics> {
  const w0 = addMonths(year, month, -2)
  const windowStart = monthStart(w0.y, w0.m)
  const windowEnd = monthEndExcl(year, month) // exclusive
  const windowDates = eachDate(windowStart, windowEnd)
  const monthDates = eachDate(monthStart(year, month), windowEnd)
  const monthGroups = [addMonths(year, month, -2), addMonths(year, month, -1), { y: year, m: month }]
    .map(({ y, m }) => eachDate(monthStart(y, m), monthEndExcl(y, m)))
  const monthLabels = [addMonths(year, month, -2), addMonths(year, month, -1), { y: year, m: month }]
    .map(({ m }) => MONTH_ABBR[m - 1])

  const [gold, posts, pillars, sentiment, words, compProfile] = await Promise.all([
    pool.query<GoldRow>(
      `SELECT bmd.platform, to_char(bmd.metric_date, 'YYYY-MM-DD') metric_date,
              bmd.follower_count_eod::float foll, bmd.profile_visit_sum::float pv,
              bmd.profile_reach_sum::float pr, bmd.net_growth_sum::float ng,
              bmd.new_followers_sum::float nf, bmd.video_views_sum::float vv
         FROM l2_gold.brand_metric_daily bmd
         JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND bmd.brand_id = $2
          AND bmd.metric_date >= $3 AND bmd.metric_date < $4
          AND bmd.platform IN ('instagram','facebook','tiktok')`,
      [orgId, brandId, windowStart, windowEnd],
    ),
    pool.query<PostRow>(
      `SELECT p.platform, to_char(p.post_date, 'YYYY-MM-DD') post_date,
              SUM(p.likes)::float likes, SUM(p.reactions)::float reactions,
              SUM(p.comments)::float comments, SUM(p.shares)::float shares,
              SUM(p.engagement)::float eng, SUM(p.reach)::float reach,
              SUM(p.saves)::float saves, SUM(p.views)::float views, SUM(p.impressions)::float impressions,
              SUM(p.er_reach)::float er_sum, count(p.er_reach)::int er_cnt, count(*)::int posts
         FROM l1_silver.unified_post p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND bsa.brand_id = $2
          AND p.post_date >= $3 AND p.post_date < $4
          AND p.platform IN ('instagram','facebook','tiktok')
        GROUP BY p.platform, p.post_date`,
      [orgId, brandId, windowStart, windowEnd],
    ),
    // Content-pillar rollup (gold) — report month only; NULL pillars excluded upstream.
    pool.query<PillarRow>(
      `SELECT pp.platform, pp.content_pillar,
              SUM(pp.post_count)::float posts, SUM(pp.engagement_sum)::float eng,
              SUM(pp.er_denominator_sum)::float er_den, SUM(pp.reach_sum)::float reach
         FROM l2_gold.pillar_performance_daily pp
         JOIN public.brands b ON b.id = pp.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND pp.brand_id = $2
          AND pp.metric_date >= $3 AND pp.metric_date < $4
          AND pp.content_pillar IS NOT NULL
          AND pp.platform IN ('instagram','facebook','tiktok')
        GROUP BY pp.platform, pp.content_pillar`,
      [orgId, brandId, monthStart(year, month), windowEnd],
    ),
    // Daily comment sentiment (3 lines: pos/neu/neg counts) over the 3-month window.
    pool.query<SentimentRow>(
      `SELECT csd.platform, to_char(csd.metric_date, 'YYYY-MM-DD') d,
              csd.positive_count::float pos, csd.neutral_count::float neu, csd.negative_count::float neg
         FROM l2_gold.comment_sentiment_daily csd
         JOIN public.brands b ON b.id = csd.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND csd.brand_id = $2
          AND csd.metric_date >= $3 AND csd.metric_date < $4
          AND csd.platform IN ('instagram','facebook','tiktok')`,
      [orgId, brandId, windowStart, windowEnd],
    ),
    // Word cloud: words + frequency joined to each post's dominant_sentiment so
    // words inherit their source post's sentiment color. Scoped to the brand +
    // report month; posts whose sentiment row has no post_date are still included
    // (the gold builder leaves post_date NULL for some posts — dropping them would
    // hide real words), so undated words show regardless of the selected month.
    pool.query<WordRow>(
      `SELECT csp.platform, pw.word, csp.dominant_sentiment sentiment, SUM(pw.frequency)::float freq
         FROM l2_gold.post_wordcloud pw
         JOIN l2_gold.comment_sentiment_post csp ON csp.post_id = pw.post_id AND csp.platform = pw.platform
         JOIN public.brands b ON b.id = csp.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND csp.brand_id = $2
          AND (csp.post_date IS NULL OR (csp.post_date >= $3 AND csp.post_date < $4))
          AND csp.platform IN ('instagram','facebook','tiktok')
        GROUP BY csp.platform, pw.word, csp.dominant_sentiment`,
      [orgId, brandId, monthStart(year, month), windowEnd],
    ),
    // Competitors of this brand + current-month gold aggregate (l2_gold only).
    // LEFT JOIN so competitors without data still list (null → no bar).
    pool.query<CompChartRow>(
      `WITH comp AS (
         SELECT csa.id AS sid, csa.username, cp.key AS platform
           FROM public.brand_competitors bc
           JOIN public.social_accounts csa ON csa.id = bc.social_account_id
           JOIN public.platforms cp        ON cp.id  = csa.platform_id
          WHERE bc.brand_id = $1 AND cp.key IN ('instagram','facebook','tiktok')
       ),
       agg AS (
         SELECT competitor_social_account_id AS sid, platform,
                (array_agg(follower_count ORDER BY metric_date)
                   FILTER (WHERE follower_count IS NOT NULL))[1]      AS first_foll,
                (array_agg(follower_count ORDER BY metric_date DESC)
                   FILTER (WHERE follower_count IS NOT NULL))[1]      AS last_foll,
                SUM(post_count)::int                                   AS post_count,
                SUM(like_count + comment_count + share_count)::bigint AS engagement
           FROM l2_gold.competitor_profile_metric_daily
          WHERE brand_id = $1 AND metric_date >= $2 AND metric_date < $3
          GROUP BY competitor_social_account_id, platform
       )
       SELECT comp.sid, comp.username, comp.platform,
              agg.first_foll, agg.last_foll, agg.post_count, agg.engagement
         FROM comp
         LEFT JOIN agg ON agg.sid = comp.sid AND agg.platform = comp.platform
        ORDER BY comp.platform, agg.last_foll DESC NULLS LAST, comp.username`,
      [brandId, monthStart(year, month), windowEnd],
    ),
  ])

  // Org custom metrics (free expressions) — evaluated per channel as extra line series.
  const customDefs = await getOrgCustomMetrics(orgId)

  const channels: Partial<Record<DashPlatform, ChannelChartMetrics>> = {}
  const bars: Partial<Record<DashPlatform, ChannelBarMetrics>> = {}
  const sentimentByChannel: Partial<Record<DashPlatform, ChannelSentiment>> = {}
  const wordsByChannel: Partial<Record<DashPlatform, ChannelWords>> = {}
  for (const p of PLATFORMS) {
    const goldMap = new Map<string, GoldVals>()
    for (const r of gold.rows) if (r.platform === p) goldMap.set(r.metric_date, r)
    const postMap = new Map<string, PostVals>()
    for (const r of posts.rows) if (r.platform === p) postMap.set(r.post_date, r)
    const pillarMap = new Map<string, PillarAgg>()
    for (const r of pillars.rows) if (r.platform === p) {
      pillarMap.set(r.content_pillar, { posts: Number(r.posts) || 0, eng: Number(r.eng) || 0, erDen: Number(r.er_den) || 0, reach: Number(r.reach) || 0 })
    }

    const metrics: ChannelChartMetrics = {}
    for (const metric of CHART_METRIC_IDS) {
      const series = buildDimSeries(metric, p, windowDates, monthDates, monthGroups, goldMap, postMap)
      if (series) metrics[metric] = series
    }
    for (const def of customDefs) {
      const cs = buildCustomDimSeries(def, p, monthDates, monthGroups, goldMap, postMap)
      if (cs) metrics[def.id] = cs
    }
    if (Object.keys(metrics).length) channels[p] = metrics

    const barCats = buildBars(monthDates, monthGroups, monthLabels, goldMap, postMap, pillarMap, p, customDefs)
    if (Object.keys(barCats).length) bars[p] = barCats

    // Sentiment — 3 daily-count series (present if the platform has any comments in the window).
    const sentRows = sentiment.rows.filter(r => r.platform === p)
    if (sentRows.length) {
      const posMap = new Map<string, number>()
      const neuMap = new Map<string, number>()
      const negMap = new Map<string, number>()
      for (const r of sentRows) {
        posMap.set(r.d, Number(r.pos) || 0)
        neuMap.set(r.d, Number(r.neu) || 0)
        negMap.set(r.d, Number(r.neg) || 0)
      }
      sentimentByChannel[p] = {
        positive: flowDimSeries(posMap, monthDates, monthGroups),
        neutral: flowDimSeries(neuMap, monthDates, monthGroups),
        negative: flowDimSeries(negMap, monthDates, monthGroups),
      }
    }

    // Word cloud — collapse each word to its dominant sentiment + total frequency.
    const wordRows = words.rows.filter(r => r.platform === p)
    if (wordRows.length) {
      const agg = new Map<string, { total: number; bySent: Record<SentimentKey, number> }>()
      for (const r of wordRows) {
        const sent: SentimentKey =
          r.sentiment === 'positive' || r.sentiment === 'negative' ? r.sentiment : 'neutral'
        const f = Number(r.freq) || 0
        let e = agg.get(r.word)
        if (!e) { e = { total: 0, bySent: { positive: 0, neutral: 0, negative: 0 } }; agg.set(r.word, e) }
        e.total += f
        e.bySent[sent] += f
      }
      const list: CloudWordData[] = [...agg.entries()].map(([word, e]) => {
        const dominant = (['positive', 'neutral', 'negative'] as SentimentKey[])
          .reduce((best, k) => (e.bySent[k] > e.bySent[best] ? k : best), 'neutral' as SentimentKey)
        return { word, sentiment: dominant, frequency: e.total }
      }).sort((a, b) => b.frequency - a.frequency)
      // Cap to the most frequent words so the cloud stays readable (source has
      // hundreds of tokens); the client still filters this set by sentiment.
      if (list.length) wordsByChannel[p] = list.slice(0, WORDCLOUD_MAX)
    }
  }

  // Brand-vs-Competitor bar entities (per platform, current month only). Brand
  // aggregate reuses the already-fetched gold/posts; competitors come from the gold
  // competitor rollup. A platform appears only when the brand has competitors on it.
  const curMonthStart = monthStart(year, month)
  const brandNameRes = await pool.query<{ name: string }>('SELECT name FROM public.brands WHERE id = $1', [brandId])
  const brandName = brandNameRes.rows[0]?.name ?? 'Brand'
  const competitorsOut: Partial<Record<DashPlatform, CompetitorChartSection>> = {}
  for (const p of PLATFORMS) {
    const compRowsP = compProfile.rows.filter(r => r.platform === p)
    if (compRowsP.length === 0) continue
    const goldCur = gold.rows
      .filter(r => r.platform === p && r.metric_date >= curMonthStart && r.foll != null)
      .sort((a, b) => (a.metric_date < b.metric_date ? -1 : 1))
    const postsCur = posts.rows.filter(r => r.platform === p && r.post_date >= curMonthStart)
    const bFirst = goldCur.length ? Number(goldCur[0].foll) : null
    const bLast = goldCur.length ? Number(goldCur[goldCur.length - 1].foll) : null
    const brand: CompetitorChartEntity = {
      id: 'brand', label: brandName,
      metrics: competitorMetrics(bFirst, bLast, sumFloatNull(postsCur.map(r => r.posts)), sumFloatNull(postsCur.map(r => r.eng))),
    }
    const competitors: CompetitorChartEntity[] = compRowsP.map(r => ({
      id: r.sid, label: '@' + r.username,
      metrics: competitorMetrics(
        r.first_foll != null ? Number(r.first_foll) : null,
        r.last_foll != null ? Number(r.last_foll) : null,
        r.post_count != null ? Number(r.post_count) : null,
        r.engagement != null ? Number(r.engagement) : null,
      ),
    }))
    competitorsOut[p] = { brand, competitors }
  }

  return {
    meta: {
      year, month,
      daysInMonth: daysInMonth(year, month),
      dayLabels: monthDates.map(d => String(Number(d.slice(8, 10)))),
      monthLabels,
    },
    channels,
    bars,
    sentiment: sentimentByChannel,
    words: wordsByChannel,
    competitors: competitorsOut,
    customMetrics: customDefs.map(d => ({ id: d.id, label: d.name })),
  }
}
