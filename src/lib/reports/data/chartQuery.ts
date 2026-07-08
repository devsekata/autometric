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
} from './chartTypes'

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
}
interface PostRow {
  platform: string; post_date: string
  likes: number | null; reactions: number | null; comments: number | null; shares: number | null; eng: number | null
  reach: number | null; er_sum: number | null; er_cnt: number | null; posts: number | null
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
type GoldVals = { foll: number | null; pv: number | null; pr: number | null; ng: number | null }
type PostVals = {
  likes: number | null; reactions: number | null; comments: number | null; shares: number | null; eng: number | null
  reach: number | null; er_sum: number | null; er_cnt: number | null; posts: number | null
}

const num = (v: number | null | undefined): number | undefined =>
  v == null || !Number.isFinite(Number(v)) ? undefined : Number(v)

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

  const [gold, posts, pillars, sentiment, words] = await Promise.all([
    pool.query<GoldRow>(
      `SELECT bmd.platform, to_char(bmd.metric_date, 'YYYY-MM-DD') metric_date,
              bmd.follower_count_eod::float foll, bmd.profile_visit_sum::float pv,
              bmd.profile_reach_sum::float pr, bmd.net_growth_sum::float ng
         FROM l2_gold.brand_metric_daily bmd
         JOIN public.brands b ON b.id = bmd.brand_id
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
              SUM(p.er_reach)::float er_sum, count(p.er_reach)::int er_cnt, count(*)::int posts
         FROM l1_silver.unified_post p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id
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
         JOIN public.brands b ON b.id = pp.brand_id
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
         JOIN public.brands b ON b.id = csd.brand_id
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
         JOIN public.brands b ON b.id = csp.brand_id
        WHERE b.organization_id = $1 AND csp.brand_id = $2
          AND (csp.post_date IS NULL OR (csp.post_date >= $3 AND csp.post_date < $4))
          AND csp.platform IN ('instagram','facebook','tiktok')
        GROUP BY csp.platform, pw.word, csp.dominant_sentiment`,
      [orgId, brandId, monthStart(year, month), windowEnd],
    ),
  ])

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
    if (Object.keys(metrics).length) channels[p] = metrics

    const barCats = buildBars(monthDates, monthGroups, monthLabels, goldMap, postMap, pillarMap)
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
  }
}
