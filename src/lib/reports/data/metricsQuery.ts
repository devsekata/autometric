// Real metric values for the report's Content Level & Channel Level tables,
// scoped to one org + brand + month. Follows the ROBZ LAUNCH metrics mapping:
//  - Content-level = per-post metrics aggregated over the month (SUM), plus
//    ER metrics as the AVG of per-post ER (Excel: "SUM OF ER / TOTAL POST").
//  - Channel-level = profile aggregates (followers/growth/profile views/reach)
//    from l2_gold.brand_metric_daily, plus "Avg. X" = SUM(metric)/TOTAL POST.
//
// Each value is returned for the current month and the previous month so the
// table can render Previous / Current / Gap%. Missing or unsourced metrics
// (e.g. Reels Skip Rate, New Follows, TikTok completion in this seed) come back
// as null and render as "—". Column source resolution is per-platform (e.g. FB
// likes = reactions; TikTok "Impressions" reads the populated `views` column).
//
// See docs/reports/table-metrics.md for the full metric→column map + gaps.
import pool from '@/lib/db'
import type { DashPlatform } from '@/components/dashboard/data'
import {
  TABLE_TYPES, MetricPair, SectionMetrics, ReportTableMetrics, SentimentTable, TableChannel,
  CompetitorEntity, CompetitorSection, CustomMetricColumn,
} from './tableTypes'
import { getOrgCustomMetrics } from './customMetricsStore'
import { evaluateExpression, type CustomMetricDef } from './customMetrics'

const PLATFORMS: DashPlatform[] = ['instagram', 'facebook', 'tiktok']

const pad = (n: number) => String(n).padStart(2, '0')
const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`
const monthEndExcl = (y: number, m: number) => (m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`)
const prevMonth = (y: number, m: number) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 })

interface PostRow {
  platform: string; post_date: string; post_type: string | null
  likes: number | null; reactions: number | null; comments: number | null; shares: number | null
  saves: number | null; repost_count: number | null; engagement: number | null; engagement_public: number | null
  reach: number | null; views: number | null; impressions: number | null; follows: number | null
  followers_on_post_day: number | null
  avg_watch_time: number | null; duration_s: number | null; completion_rate: string | null
  er_reach: number | null; er_views: number | null; er_impressions: number | null; er_followers: number | null
}

interface GoldRow {
  platform: string; metric_date: string
  net_growth_sum: number | null; new_followers_sum: number | null; lost_followers_sum: number | null
  profile_visit_sum: number | null; profile_reach_sum: number | null; follower_count_eod: number | null
  video_views_sum: number | null; post_count: number | null
}
interface SentPostRow { platform: string; sentiment: string | null; posts: number | null }
// One competitor of the brand + its current-month gold aggregate (null when the
// competitor has no gold rows in the period → the row renders "—").
interface CompRow {
  sid: string; username: string; platform: string
  first_foll: number | null; last_foll: number | null
  post_count: number | null; engagement: number | null
}

// ── per-window aggregates ────────────────────────────────────────────────────
interface PostAgg {
  cnt: number
  likes: number | null; reactions: number | null; comments: number | null; shares: number | null
  saves: number | null; repost: number | null; eng: number | null; engPub: number | null
  reach: number | null; views: number | null; impr: number | null; follows: number | null
  viewsVideoInline: number | null   // FB "Video Views" = views of post_type='video_inline' only
  avgWatch: number | null; avgCompletion: number | null
  erReach: number | null; erViews: number | null; erImpr: number | null; erFollowers: number | null
}

const parsePct = (s: string | null): number | null => {
  if (s == null) return null
  const m = String(s).replace(/[^0-9.]/g, '')
  return m === '' ? null : Number(m)
}
// Silver stores er_* as a fraction (engagement/denominator, e.g. 0.088). The
// report shows ER as a percent, so scale ×100 (null-safe). completion_rate is
// already 0..100 (parsed from "75%") and is NOT scaled.
const toPct = (v: number | null): number | null => (v == null ? null : v * 100)

// SUM of non-null values, but null when nothing is positive (all-zero = "no data").
function sumOrNull(rows: PostRow[], f: keyof PostRow): number | null {
  let s = 0, hasPos = false
  for (const r of rows) { const v = r[f] as number | null; if (v != null) { s += Number(v); if (Number(v) > 0) hasPos = true } }
  return hasPos ? s : null
}
// AVG over rows where the field is non-null (used for ER — includes legit small values).
function avgNonNull(rows: PostRow[], f: keyof PostRow): number | null {
  let s = 0, c = 0
  for (const r of rows) { const v = r[f] as number | null; if (v != null) { s += Number(v); c++ } }
  return c ? s / c : null
}
function avgCompletion(rows: PostRow[]): number | null {
  let s = 0, c = 0
  for (const r of rows) { const v = parsePct(r.completion_rate); if (v != null) { s += v; c++ } }
  return c ? s / c : null
}
// avg_watch_time is stored inconsistently across brands (seconds for some, ms for
// others). Normalize to SECONDS per post using the clip length: a value far above
// the duration can only be milliseconds. Averaged over video posts (dur & wt > 0).
function avgWatchSeconds(rows: PostRow[]): number | null {
  let s = 0, c = 0
  for (const r of rows) {
    const awt = r.avg_watch_time, dur = r.duration_s
    if (awt != null && Number(awt) > 0 && dur != null && Number(dur) > 0) {
      s += Number(awt) > Number(dur) * 2 ? Number(awt) / 1000 : Number(awt)
      c++
    }
  }
  return c ? s / c : null
}

// Sum `views` over rows of a given post_type only (null when none positive).
function sumViewsOfType(rows: PostRow[], type: string): number | null {
  let s = 0, hasPos = false
  for (const r of rows) {
    if (r.post_type === type && r.views != null) { s += Number(r.views); if (Number(r.views) > 0) hasPos = true }
  }
  return hasPos ? s : null
}

function aggPosts(rows: PostRow[]): PostAgg {
  return {
    cnt: rows.length,
    likes: sumOrNull(rows, 'likes'), reactions: sumOrNull(rows, 'reactions'),
    comments: sumOrNull(rows, 'comments'), shares: sumOrNull(rows, 'shares'),
    saves: sumOrNull(rows, 'saves'), repost: sumOrNull(rows, 'repost_count'),
    eng: sumOrNull(rows, 'engagement'), engPub: sumOrNull(rows, 'engagement_public'),
    reach: sumOrNull(rows, 'reach'), views: sumOrNull(rows, 'views'), impr: sumOrNull(rows, 'impressions'),
    follows: sumOrNull(rows, 'follows'),
    viewsVideoInline: sumViewsOfType(rows, 'video_inline'),
    avgWatch: avgWatchSeconds(rows), avgCompletion: avgCompletion(rows),
    erReach: toPct(avgNonNull(rows, 'er_reach')), erViews: toPct(avgNonNull(rows, 'er_views')),
    erImpr: toPct(avgNonNull(rows, 'er_impressions')), erFollowers: toPct(avgNonNull(rows, 'er_followers')),
  }
}

// Cross-channel ("all") post aggregate: same as aggPosts, but "likes" uses each
// row's primary metric (Facebook = reactions, else = likes) so the total is a true
// likes+reactions figure. All other sums/averages combine across every channel.
function aggPostsAll(rows: PostRow[]): PostAgg {
  const base = aggPosts(rows)
  let eff = 0, hasPos = false
  for (const r of rows) {
    const v = r.platform === 'facebook' ? r.reactions : r.likes
    if (v != null) { eff += Number(v); if (Number(v) > 0) hasPos = true }
  }
  return { ...base, likes: hasPos ? eff : null }
}

interface GoldAgg {
  followers: number | null; netGrowth: number | null; newFollows: number | null; unfollows: number | null
  profileViews: number | null; profileReach: number | null; videoViews: number | null
}
function goldSumPos(rows: GoldRow[], f: keyof GoldRow): number | null {
  let s = 0, hasPos = false
  for (const r of rows) { const v = r[f] as number | null; if (v != null) { s += Number(v); if (Number(v) > 0) hasPos = true } }
  return hasPos ? s : null
}
function goldSumSigned(rows: GoldRow[], f: keyof GoldRow): number | null {
  let s = 0, has = false
  for (const r of rows) { const v = r[f] as number | null; if (v != null) { s += Number(v); has = true } }
  return has ? s : null
}
function lastEod(rows: GoldRow[]): number | null {
  let best: number | null = null, bd = ''
  for (const r of rows) { if (r.follower_count_eod != null && r.metric_date > bd) { bd = r.metric_date; best = Number(r.follower_count_eod) } }
  return best
}
function firstEod(rows: GoldRow[]): number | null {
  let best: number | null = null, bd = ''
  for (const r of rows) {
    if (r.follower_count_eod != null && (bd === '' || r.metric_date < bd)) { bd = r.metric_date; best = Number(r.follower_count_eod) }
  }
  return best
}
function aggGold(rows: GoldRow[]): GoldAgg {
  return {
    followers: lastEod(rows),
    netGrowth: goldSumSigned(rows, 'net_growth_sum'),
    newFollows: goldSumPos(rows, 'new_followers_sum'),
    unfollows: goldSumPos(rows, 'lost_followers_sum'),
    profileViews: goldSumPos(rows, 'profile_visit_sum'),
    profileReach: goldSumPos(rows, 'profile_reach_sum'),
    videoViews: goldSumPos(rows, 'video_views_sum'),
  }
}

// ── per-column value resolvers (per-platform column source mapping) ───────────
function contentValue(ch: TableChannel, id: string, a: PostAgg): number | null {
  switch (id) {
    case 'likes': return ch === 'facebook' ? a.reactions : a.likes
    case 'comments': return a.comments
    case 'shares': return a.shares
    case 'saved': return a.saves
    case 'reposts': return a.repost
    case 'eng_owned': return a.eng
    case 'eng_public': return a.engPub
    case 'er_reach': return a.erReach
    case 'er_views': return a.erViews
    case 'er_impressions': return a.erImpr
    case 'er_followers': return a.erFollowers
    case 'reach': return a.reach
    case 'views': return a.views
    case 'impressions': return ch === 'tiktok' ? a.views : a.impr // TikTok data lives in `views`
    case 'video_views': return a.viewsVideoInline   // FB Video Views = post_type='video_inline' views (unified_post.views)
    case 'reels_skip_rate': return null  // not ingested (Meta Graph API)
    case 'video_watch_time': return a.avgWatch // avg per-post watch time in ms (shown ms→s); IG only, FB/TT empty→—
    case 'post_view_time': return null   // ambiguous / no source
    case 'post_completion': return a.avgCompletion
    case 'new_follow_content': return a.follows
    default: return null
  }
}
function channelValue(ch: TableChannel, id: string, a: PostAgg, g: GoldAgg): number | null {
  const perPost = (sum: number | null) => (a.cnt > 0 && sum != null ? sum / a.cnt : null)
  switch (id) {
    case 'total_followers': return g.followers
    case 'followers_net_growth': return g.netGrowth
    case 'new_follows': return g.newFollows
    case 'unfollows': return g.unfollows
    case 'profile_views': return g.profileViews
    case 'profile_reach': return g.profileReach
    case 'avg_er_reach': return a.erReach
    case 'avg_er_views': return a.erViews
    case 'avg_er_impressions': return a.erImpr
    case 'avg_er_followers': return a.erFollowers
    case 'total_posts': return a.cnt > 0 ? a.cnt : null
    case 'avg_likes': return perPost(ch === 'facebook' ? a.reactions : a.likes)
    case 'avg_comments': return perPost(a.comments)
    case 'avg_shares': return perPost(a.shares)
    case 'avg_saved': return perPost(a.saves)
    case 'avg_reposts': return perPost(a.repost)
    case 'avg_eng_owned': return perPost(a.eng)
    case 'avg_eng_public': return perPost(a.engPub)
    case 'avg_reach': return perPost(a.reach)
    case 'avg_views': return perPost(a.views)
    case 'avg_impressions': return perPost(ch === 'tiktok' ? a.views : a.impr)
    case 'avg_video_views': return g.videoViews != null && a.cnt > 0 ? g.videoViews / a.cnt : null
    default: return null
  }
}

// Resolve a custom-metric registry field id → its aggregated period scalar, reusing the
// same per-channel column sources as contentValue/channelValue (FB likes = reactions,
// TikTok impressions live in `views`, etc.). Field ids mirror METRIC_FIELDS in customMetrics.
function fieldValue(ch: TableChannel, fieldId: string, a: PostAgg, g: GoldAgg): number | null {
  switch (fieldId) {
    case 'likes': return ch === 'facebook' ? a.reactions : a.likes
    case 'comments': return a.comments
    case 'shares': return a.shares
    case 'saves': return a.saves
    case 'engagement': return a.eng
    case 'reach': return a.reach
    case 'views': return a.views
    case 'impressions': return ch === 'tiktok' ? a.views : a.impr
    case 'er_reach': return a.erReach
    case 'er_followers': return a.erFollowers
    case 'watch_time': return a.avgWatch
    case 'followers': return g.followers
    case 'net_growth': return g.netGrowth
    case 'new_follows': return g.newFollows
    case 'profile_views': return g.profileViews
    case 'profile_reach': return g.profileReach
    case 'video_views': return g.videoViews
    case 'total_posts': return a.cnt > 0 ? a.cnt : null
    default: return null
  }
}

// Evaluate every org custom metric for a channel (current + previous window) and write the
// resulting pairs into BOTH the content and channel sections (same value — the expression
// runs over the same period aggregates), keyed by the metric's id.
function injectCustomMetrics(
  defs: CustomMetricDef[], ch: TableChannel,
  content: SectionMetrics, channel: SectionMetrics,
  cur: PostAgg, prev: PostAgg, curG: GoldAgg, prevG: GoldAgg,
): void {
  for (const cm of defs) {
    const curr = evaluateExpression(cm.terms, cm.multiply100, fid => fieldValue(ch, fid, cur, curG))
    const prevV = evaluateExpression(cm.terms, cm.multiply100, fid => fieldValue(ch, fid, prev, prevG))
    const pair: MetricPair = { prev: prevV, curr }
    content[cm.id] = pair
    channel[cm.id] = pair
  }
}

// ── "All channels" section builders (Content/Channel Performance spec) ────────
// The all-channel tables present each "SUM & AVERAGE" metric as a SUM column plus
// an Avg. column: content averages are per POST, channel (profile) averages per
// DAY. ER carries a POOLED SUM column (Σengagement ÷ Σdenominator) and a MEAN Avg.
// column (avg of per-post ER). Column ids mirror the *.allColumns definitions.

// Combined awareness per post: Facebook = impressions, Instagram/TikTok = views.
function awarenessValue(r: PostRow): number | null {
  const v = r.platform === 'facebook' ? r.impressions : r.views
  return v == null ? null : Number(v)
}
function sumAwareness(rows: PostRow[]): number | null {
  let s = 0, hasPos = false
  for (const r of rows) { const v = awarenessValue(r); if (v != null) { s += v; if (v > 0) hasPos = true } }
  return hasPos ? s : null
}
// "all" likes = reactions on Facebook, else likes (matches aggPostsAll's effective likes).
function sumLikesAll(rows: PostRow[]): number | null {
  let s = 0, hasPos = false
  for (const r of rows) {
    const v = r.platform === 'facebook' ? r.reactions : r.likes
    if (v != null) { s += Number(v); if (Number(v) > 0) hasPos = true }
  }
  return hasPos ? s : null
}
// Pooled ER (%) = Σengagement ÷ Σdenominator over posts with a positive denominator.
function pooledER(rows: PostRow[], denom: keyof PostRow): number | null {
  let e = 0, d = 0, has = false
  for (const r of rows) {
    const dv = r[denom] as number | null, ev = r.engagement
    if (dv != null && Number(dv) > 0 && ev != null) { e += Number(ev); d += Number(dv); has = true }
  }
  return has && d > 0 ? (e / d) * 100 : null
}
const perPostAvg = (sum: number | null, cnt: number): number | null => (cnt > 0 && sum != null ? sum / cnt : null)

// One window's Content Performance values, keyed by content_level.allColumns ids.
function allContentValues(rows: PostRow[]): Record<string, number | null> {
  const cnt = rows.length
  const reach = sumOrNull(rows, 'reach')
  const iv = sumAwareness(rows)
  const likes = sumLikesAll(rows)
  const comments = sumOrNull(rows, 'comments')
  const shares = sumOrNull(rows, 'shares')
  const saved = sumOrNull(rows, 'saves')
  const reposts = sumOrNull(rows, 'repost_count')
  const eng = sumOrNull(rows, 'engagement')
  return {
    new_follow_content: sumOrNull(rows, 'follows'),
    reach, avg_reach: perPostAvg(reach, cnt),
    impressions_views: iv, avg_impressions_views: perPostAvg(iv, cnt),
    likes, avg_likes: perPostAvg(likes, cnt),
    comments, avg_comments: perPostAvg(comments, cnt),
    shares, avg_shares: perPostAvg(shares, cnt),
    saved, avg_saved: perPostAvg(saved, cnt),
    reposts, avg_reposts: perPostAvg(reposts, cnt),
    eng_owned: eng, avg_eng_owned: perPostAvg(eng, cnt),
    er_reach_pooled: pooledER(rows, 'reach'), er_reach: toPct(avgNonNull(rows, 'er_reach')),
    er_views_pooled: pooledER(rows, 'views'), er_views: toPct(avgNonNull(rows, 'er_views')),
    er_followers_pooled: pooledER(rows, 'followers_on_post_day'), er_followers: toPct(avgNonNull(rows, 'er_followers')),
  }
}

// One window's Channel Performance values, keyed by channel_level.allColumns ids.
// Averages are per day (distinct gold metric_date count in the window). "Profile
// Views" has no distinct gold source, so it (and its average) is null → "—".
function allChannelValues(g: GoldAgg, cnt: number, days: number): Record<string, number | null> {
  const perDay = (sum: number | null): number | null => (days > 0 && sum != null ? sum / days : null)
  return {
    total_followers: g.followers,
    followers_net_growth: g.netGrowth, avg_followers_net_growth: perDay(g.netGrowth),
    new_follows: g.newFollows, avg_new_follows: perDay(g.newFollows),
    unfollows: g.unfollows, avg_unfollows: perDay(g.unfollows),
    profile_reach: g.profileReach, avg_profile_reach: perDay(g.profileReach),
    profile_views: null, avg_profile_views: null,
    profile_visit: g.profileViews, avg_profile_visit: perDay(g.profileViews), // g.profileViews = profile_visit_sum
    total_posts: cnt > 0 ? cnt : null,
  }
}

// Pair two windows (previous vs current) into a SectionMetrics keyed by column id.
function pairSection(cur: Record<string, number | null>, prev: Record<string, number | null>): SectionMetrics {
  const out: SectionMetrics = {}
  for (const id of Object.keys(cur)) out[id] = { prev: prev[id] ?? null, curr: cur[id] ?? null }
  return out
}

function buildSection(
  section: 'content_level' | 'channel_level', ch: TableChannel,
  cur: PostAgg, prev: PostAgg, curG: GoldAgg, prevG: GoldAgg,
): SectionMetrics {
  const out: SectionMetrics = {}
  for (const col of TABLE_TYPES[section].columns) {
    const pair: MetricPair = section === 'content_level'
      ? { prev: contentValue(ch, col.id, prev), curr: contentValue(ch, col.id, cur) }
      : { prev: channelValue(ch, col.id, prev, prevG), curr: channelValue(ch, col.id, cur, curG) }
    out[col.id] = pair
  }
  return out
}

// Brand row of the Brand-vs-Competitor table (current month, one platform).
// Growth = last − first end-of-day followers in the month (symmetric with the
// competitor rows). Reach columns are real for the brand (unlike competitors).
function brandCompetitorValues(pRows: PostRow[], gRows: GoldRow[]): Record<string, number | null> {
  const first = firstEod(gRows), last = lastEod(gRows)
  const growth = first != null && last != null ? last - first : null
  const eng = sumOrNull(pRows, 'engagement')
  const cnt = pRows.length
  return {
    followers_growth:     growth,
    followers_growth_pct: growth != null && first ? (growth / first) * 100 : null,
    post_count:           cnt > 0 ? cnt : null,
    engagement:           eng,
    // ER by followers = avg engagement PER POST ÷ followers (comparable to the
    // brand's channel-level ER), not total monthly engagement ÷ followers.
    er_followers:         eng != null && cnt > 0 && last ? (eng / cnt / last) * 100 : null,
    post_reach:           sumOrNull(pRows, 'reach'),
    profile_reach:        goldSumPos(gRows, 'profile_reach_sum'),
  }
}

// One competitor row (current-month gold aggregate). Public scraping has no reach,
// so post_reach / profile_reach are always null → "—".
function competitorRowValues(r: CompRow): Record<string, number | null> {
  const first = r.first_foll != null ? Number(r.first_foll) : null
  const last  = r.last_foll  != null ? Number(r.last_foll)  : null
  const growth = first != null && last != null ? last - first : null
  const eng = r.engagement != null ? Number(r.engagement) : null
  const cnt = r.post_count != null ? Number(r.post_count) : null
  return {
    followers_growth:     growth,
    followers_growth_pct: growth != null && first ? (growth / first) * 100 : null,
    post_count:           cnt,
    engagement:           eng,
    // ER by followers = avg engagement PER POST ÷ followers (see brand row).
    er_followers:         eng != null && cnt && last ? (eng / cnt / last) * 100 : null,
    post_reach:           null,
    profile_reach:        null,
  }
}

/**
 * Compute Content Level + Channel Level metric values for a brand's month
 * (current) vs the month before (previous), for Instagram / Facebook / TikTok.
 */
export async function getReportTableMetrics(
  orgId: string, brandId: string, year: number, month: number,
): Promise<ReportTableMetrics> {
  const pv = prevMonth(year, month)
  const rangeStart = monthStart(pv.y, pv.m)      // previous month start
  const rangeEnd = monthEndExcl(year, month)     // current month end (exclusive)
  const curStart = monthStart(year, month)       // boundary: >= curStart = current

  const posts = await pool.query<PostRow>(
    `SELECT p.platform, to_char(p.post_date, 'YYYY-MM-DD') post_date, p.post_type,
            p.likes, p.reactions, p.comments, p.shares, p.saves, p.repost_count,
            p.engagement, p.engagement_public, p.reach, p.views, p.impressions, p.follows,
            p.followers_on_post_day,
            p.avg_watch_time, p.duration_s, p.completion_rate,
            p.er_reach, p.er_views, p.er_impressions, p.er_followers
       FROM l1_silver.unified_post p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND bsa.brand_id = $2
        AND p.post_date >= $3 AND p.post_date < $4
        AND p.platform IN ('instagram','facebook','tiktok')`,
    [orgId, brandId, rangeStart, rangeEnd],
  )

  const gold = await pool.query<GoldRow>(
    `SELECT bmd.platform, to_char(bmd.metric_date, 'YYYY-MM-DD') metric_date,
            bmd.net_growth_sum, bmd.new_followers_sum, bmd.lost_followers_sum,
            bmd.profile_visit_sum, bmd.profile_reach_sum, bmd.follower_count_eod,
            bmd.video_views_sum, bmd.post_count
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id
      WHERE b.organization_id = $1 AND bmd.brand_id = $2
        AND bmd.metric_date >= $3 AND bmd.metric_date < $4
        AND bmd.platform IN ('instagram','facebook','tiktok')`,
    [orgId, brandId, rangeStart, rangeEnd],
  )

  // Sentiments table (per channel): posts per dominant sentiment for the REPORT
  // month. Undated sentiment posts are included (gold leaves post_date NULL for
  // some posts — see chartQuery.ts), matching the word cloud's scoping rule.
  const sent = await pool.query<SentPostRow>(
    `SELECT csp.platform, csp.dominant_sentiment sentiment, count(*)::int posts
       FROM l2_gold.comment_sentiment_post csp
       JOIN public.brands b ON b.id = csp.brand_id
      WHERE b.organization_id = $1 AND csp.brand_id = $2
        AND (csp.post_date IS NULL OR (csp.post_date >= $3 AND csp.post_date < $4))
        AND csp.dominant_sentiment IS NOT NULL
        AND csp.platform IN ('instagram','facebook','tiktok')
      GROUP BY csp.platform, csp.dominant_sentiment`,
    [orgId, brandId, curStart, rangeEnd],
  )

  // Brand-vs-Competitor: every competitor of this brand per platform, LEFT JOINed
  // to its current-month gold aggregate (competitors without data still list, with
  // null values → "—"). Ordered by end-of-month followers so the picker/rows read
  // biggest-first. Source is 100% l2_gold (never l0_raw).
  const compRows = await pool.query<CompRow>(
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
    [brandId, curStart, rangeEnd],
  )

  // Org custom metrics (free expressions over l1/l2 fields) — evaluated per channel below.
  const customDefs = await getOrgCustomMetrics(orgId)

  const content: ReportTableMetrics['content'] = {}
  const channel: ReportTableMetrics['channel'] = {}

  // Per-channel followers summed for the "all" total (each channel's own EOD count).
  let allCurFoll = 0, allPrevFoll = 0, hasCurFoll = false, hasPrevFoll = false

  for (const ch of PLATFORMS) {
    const pRows = posts.rows.filter(r => r.platform === ch)
    const gRows = gold.rows.filter(r => r.platform === ch)
    const curPosts = aggPosts(pRows.filter(r => r.post_date >= curStart))
    const prevPosts = aggPosts(pRows.filter(r => r.post_date < curStart))
    const curGold = aggGold(gRows.filter(r => r.metric_date >= curStart))
    const prevGold = aggGold(gRows.filter(r => r.metric_date < curStart))
    if (curGold.followers != null) { allCurFoll += curGold.followers; hasCurFoll = true }
    if (prevGold.followers != null) { allPrevFoll += prevGold.followers; hasPrevFoll = true }
    content[ch] = buildSection('content_level', ch, curPosts, prevPosts, curGold, prevGold)
    channel[ch] = buildSection('channel_level', ch, curPosts, prevPosts, curGold, prevGold)
    injectCustomMetrics(customDefs, ch, content[ch]!, channel[ch]!, curPosts, prevPosts, curGold, prevGold)
  }

  // "All channels" aggregate — the Content/Channel Performance layout: counts summed
  // across every channel's posts, per-post & per-day averages, pooled + mean ER, and
  // total followers = sum of each channel's end-of-period count. Keyed by *.allColumns
  // ids (see tableTypes) so the all-channel tables read real values.
  const allCurPostRows = posts.rows.filter(r => r.post_date >= curStart)
  const allPrevPostRows = posts.rows.filter(r => r.post_date < curStart)
  const allCurGoldRows = gold.rows.filter(r => r.metric_date >= curStart)
  const allPrevGoldRows = gold.rows.filter(r => r.metric_date < curStart)
  const allCurPosts = aggPostsAll(allCurPostRows)    // retained for custom-metric evaluation
  const allPrevPosts = aggPostsAll(allPrevPostRows)
  const allCurGold = aggGold(allCurGoldRows)
  const allPrevGold = aggGold(allPrevGoldRows)
  allCurGold.followers = hasCurFoll ? allCurFoll : null
  allPrevGold.followers = hasPrevFoll ? allPrevFoll : null
  const dayCount = (rows: GoldRow[]) => new Set(rows.map(r => r.metric_date)).size
  content['all'] = pairSection(allContentValues(allCurPostRows), allContentValues(allPrevPostRows))
  channel['all'] = pairSection(
    allChannelValues(allCurGold, allCurPosts.cnt, dayCount(allCurGoldRows)),
    allChannelValues(allPrevGold, allPrevPosts.cnt, dayCount(allPrevGoldRows)),
  )
  injectCustomMetrics(customDefs, 'all', content['all']!, channel['all']!, allCurPosts, allPrevPosts, allCurGold, allPrevGold)

  const sentiment: Partial<Record<DashPlatform, SentimentTable>> = {}
  for (const ch of PLATFORMS) {
    const counts = { positive: 0, neutral: 0, negative: 0 }
    for (const r of sent.rows) {
      if (r.platform === ch && (r.sentiment === 'positive' || r.sentiment === 'neutral' || r.sentiment === 'negative')) {
        counts[r.sentiment] = Number(r.posts) || 0
      }
    }
    const total = counts.positive + counts.neutral + counts.negative
    if (total === 0) continue
    const pct = (n: number) => (n / total) * 100
    sentiment[ch] = {
      positive: { number_of_posts: counts.positive, percentage: pct(counts.positive) },
      neutral:  { number_of_posts: counts.neutral,  percentage: pct(counts.neutral) },
      negative: { number_of_posts: counts.negative, percentage: pct(counts.negative) },
    }
  }

  // Brand-vs-Competitor sections (per platform). A platform appears only when the
  // brand actually has competitors on it. Brand row is always computed (current month).
  const brandNameRes = await pool.query<{ name: string }>('SELECT name FROM public.brands WHERE id = $1', [brandId])
  const brandName = brandNameRes.rows[0]?.name ?? 'Brand'
  const competitors: Partial<Record<DashPlatform, CompetitorSection>> = {}
  for (const ch of PLATFORMS) {
    const rowsForCh = compRows.rows.filter(r => r.platform === ch)
    if (rowsForCh.length === 0) continue
    const pRowsCur = posts.rows.filter(r => r.platform === ch && r.post_date >= curStart)
    const gRowsCur = gold.rows.filter(r => r.platform === ch && r.metric_date >= curStart)
    const brand: CompetitorEntity = { id: 'brand', label: brandName, values: brandCompetitorValues(pRowsCur, gRowsCur) }
    const comps: CompetitorEntity[] = rowsForCh.map(r => ({
      id: r.sid, label: '@' + r.username, values: competitorRowValues(r),
    }))
    competitors[ch] = { brand, competitors: comps }
  }

  // Column defs for the selected-column picker + table headers (id/label/format).
  const customMetrics: CustomMetricColumn[] = customDefs.map(d => ({ id: d.id, label: d.name, format: d.format }))

  return { content, channel, sentiment, competitors, customMetrics }
}
