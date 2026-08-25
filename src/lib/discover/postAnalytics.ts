import pool from '@/lib/db'
import { toIso } from './util'

/**
 * One post, analysed — the payload behind Discover's per-post detail.
 *
 * Discover already listed posts and Content Analytics already analysed them, but
 * the two never met: the grid showed three numbers per card and the analysis
 * lived on another page, keyed to an account rather than to a post. This module
 * is the join between them, so a post's own performance can be read where the
 * post is.
 *
 * Everything here is measured. `l1_silver.unified_post` carries the full metric
 * set for a brand post — reach, impressions, saves, follows, profile visits,
 * link clicks, watch time — and `l2_gold.comment_sentiment_post` carries real
 * per-comment sentiment for the 272 posts whose comments have been analysed.
 * Nothing is modelled to fill a gap: a metric the platform does not report comes
 * back null and the UI prints an em dash, because a zero would read as "measured,
 * and it was nothing".
 *
 * Two shapes of post arrive here and they are not equally rich:
 *
 *   * brand posts (`l1_silver.unified_post`) — the org's own accounts, with
 *     everything the platform's insights API returns.
 *   * competitor posts (`l1_silver.unified_competitor_post`) — scraped from the
 *     outside, so likes, comments, shares, views and saves only. No reach, no
 *     impressions, no engagement rate of record.
 *
 * A single number means little on its own, so every metric is returned beside
 * the median of the same account's other posts. "412K views" is a fact; "412K
 * views, median 180K" is a judgement the reader can make themselves.
 *
 * One wrinkle the warehouse forces: a metric the platform does not report is
 * stored as 0, not NULL, so the column is fully populated and completely
 * meaningless for two thirds of the roster. Instagram reports no impressions and
 * no link clicks, Facebook no saves and no watch time, TikTok neither follows nor
 * profile visits — each is a flat zero across every post on that platform. A
 * printed "0 impressions" would be read as a measurement, so `reported()` checks
 * the metric against the account's own maximum: if this account has never once
 * recorded a non-zero value, the figure is not a zero, it is an absence.
 */

export type PostSource = 'brand' | 'competitor'

/** How a metric should be rendered; the number itself stays raw. */
export type MetricKind = 'count' | 'percent' | 'seconds'

export interface PostMetric {
  key: string
  label: string
  /** Null when the platform never reported it for this post — never coalesced to 0. */
  value: number | null
  /** Median across this account's posts. Null when there is nothing to compare against. */
  median: number | null
  kind: MetricKind
  /** Set on the handful of metrics that belong in the card's summary row. */
  headline?: boolean
}

export interface PostSentiment {
  total: number
  positive: number
  neutral: number
  negative: number
  /** 0..1 as stored by the sentiment build. */
  score: number
  dominant: string
}

export interface PostTargetLine {
  label: string
  target: number
  actual: number
  /** Achievement, in percent of target. */
  pct: number
}

export interface PostAchievement {
  orderName: string
  deliverable: string | null
  objective: string | null
  /** The order item's own progress field, e.g. 'published'. */
  status: string | null
  campaignStatus: string | null
  lines: PostTargetLine[]
}

export interface PostAnalytics {
  key: string
  source: PostSource
  platform: string
  postDate: string | null
  title: string | null
  caption: string
  coverImage: string | null
  link: string | null
  format: string
  pillar: string | null
  author: string
  authorAvatar: string | null
  sponsored: boolean
  isCampaign: boolean
  isBoosted: boolean
  hashtags: string[]
  metrics: PostMetric[]
  /** Engagement rate against the account's median, and the verdict that follows. */
  performance: {
    erPct: number | null
    medianErPct: number | null
    /** This post's ER as a multiple of the median. Null when either is missing. */
    ratio: number | null
    verdict: 'outstanding' | 'above' | 'typical' | 'below' | 'unknown'
  }
  /** Real comment sentiment, or null when this post's comments were never analysed. */
  sentiment: PostSentiment | null
  /** Target achievement, or null when the post is not tied to an order item. */
  achievement: PostAchievement | null
  /** How many of the account's posts the medians rest on. */
  benchmarkPosts: number
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** `bigint` and `numeric` arrive as strings from node-pg; null must stay null. */
const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v)

/** Same, but for a value that is meaningless as zero (medians over empty sets). */
const pos = (v: string | number | null | undefined): number | null => {
  const n = num(v)
  return n === null || n <= 0 ? null : n
}

/**
 * A metric's value, or null when the platform never reports it for this account.
 *
 * `accountMax` is the largest value the metric has ever taken across the
 * account's posts. Zero there means the column is structurally empty — Instagram
 * has no impressions, Facebook no saves — and this post's zero carries no
 * information. A genuine zero on a metric the account does report (a post nobody
 * saved) survives, because the account's maximum is above zero.
 */
const reported = (
  v: string | number | null | undefined,
  accountMax: string | number | null | undefined,
): number | null => (num(accountMax) ? num(v) : null)

/**
 * Trailing slashes and query strings make two spellings of the same permalink,
 * and an order item's `published_url` is typed by a human. Compared normalised.
 */
function normaliseUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '')
  }
}

const HASHTAG = /#[\p{L}\p{N}_]+/gu

/** Tags the post's own caption carries, when the warehouse stored no array. */
const hashtagsFromCaption = (caption: string): string[] =>
  [...new Set((caption.match(HASHTAG) ?? []).map(h => h.toLowerCase()))]

function verdictFor(ratio: number | null): PostAnalytics['performance']['verdict'] {
  if (ratio === null) return 'unknown'
  if (ratio >= 2) return 'outstanding'
  if (ratio >= 1.2) return 'above'
  if (ratio >= 0.8) return 'typical'
  return 'below'
}

/* ── brand posts ──────────────────────────────────────────────────────────── */

interface BrandRow {
  id: string
  brand_id: string
  platform: string
  post_id: string | null
  post_date: Date | string | null
  title: string | null
  caption: string | null
  link: string | null
  cover_image: string | null
  post_type: string | null
  format: string | null
  content_pillar: string | null
  duration_s: string | null
  views: string | null
  reach: string | null
  impressions: string | null
  likes: string | null
  comments: string | null
  shares: string | null
  saves: string | null
  engagement: string | null
  total_interactions: string | null
  engagement_rate: string | null
  er_reach: string | null
  er_views: string | null
  er_followers: string | null
  link_click: string | null
  follows: string | null
  profile_visits: string | null
  avg_watch_time: string | null
  followers_on_post_day: string | null
  hashtag_list: string[] | null
  is_campaign: boolean | null
  is_boosted: boolean | null
  is_collab: boolean | null
  username: string | null
  avatar_url: string | null
}

interface BenchRow {
  n: number
  /** Per-metric maxima over the account, used to tell an absence from a zero. */
  max_views: string | null
  max_reach: string | null
  max_impressions: string | null
  max_likes: string | null
  max_comments: string | null
  max_shares: string | null
  max_saves: string | null
  max_engagement: string | null
  max_follows: string | null
  max_profile_visits: string | null
  max_link_click: string | null
  max_watch: string | null
  med_views: string | null
  med_reach: string | null
  med_impressions: string | null
  med_likes: string | null
  med_comments: string | null
  med_shares: string | null
  med_saves: string | null
  med_engagement: string | null
  med_er: string | null
}

const BRAND_SCOPE = `
  EXISTS (
    SELECT 1
      FROM public.brand_social_accounts bsa
      JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
     WHERE bsa.social_account_id = p.brand_id
       AND b.organization_id = $1
  )`

async function brandAnalytics(orgId: string, rowId: number): Promise<PostAnalytics | null> {
  const { rows } = await pool.query<BrandRow>(
    `SELECT p.id::text, p.brand_id, p.platform, p.post_id, p.post_date, p.title, p.caption,
            p.link, p.cover_image, p.post_type, p.format, p.content_pillar, p.duration_s,
            p.views, p.reach, p.impressions, p.likes, p.comments, p.shares, p.saves,
            p.engagement, p.total_interactions, p.engagement_rate,
            p.er_reach, p.er_views, p.er_followers,
            p.link_click, p.follows, p.profile_visits, p.avg_watch_time,
            p.followers_on_post_day, p.hashtag_list,
            p.is_campaign, p.is_boosted, p.is_collab,
            sa.username, sa.avatar_url
       FROM l1_silver.unified_post p
       JOIN public.social_accounts sa ON sa.id = p.brand_id
      WHERE p.id = $2 AND ${BRAND_SCOPE}
      LIMIT 1`,
    [orgId, rowId],
  )
  const p = rows[0]
  if (!p) return null

  // Medians over the same account, which is the only fair comparison: a reel on
  // a 2M-follower account and one on a 20K account share no scale.
  const [benchRes, sentRes, achieveRes] = await Promise.all([
    pool.query<BenchRow>(
      `SELECT COUNT(*)::int AS n,
              MAX(views) AS max_views, MAX(reach) AS max_reach,
              MAX(impressions) AS max_impressions, MAX(likes) AS max_likes,
              MAX(comments) AS max_comments, MAX(shares) AS max_shares,
              MAX(saves) AS max_saves,
              MAX(COALESCE(engagement, total_interactions)) AS max_engagement,
              MAX(follows) AS max_follows, MAX(profile_visits) AS max_profile_visits,
              MAX(link_click) AS max_link_click, MAX(avg_watch_time) AS max_watch,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY views)        AS med_views,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY reach)        AS med_reach,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY impressions)  AS med_impressions,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY likes)        AS med_likes,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY comments)     AS med_comments,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY shares)       AS med_shares,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY saves)        AS med_saves,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY COALESCE(engagement, total_interactions))      AS med_engagement,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY COALESCE(er_reach, er_views, er_followers) * 100) AS med_er
         FROM l1_silver.unified_post
        WHERE brand_id = $1`,
      [p.brand_id],
    ),
    pool.query<{
      total_comments: string; positive_count: string; neutral_count: string
      negative_count: string; avg_sentiment_score: string | null; dominant_sentiment: string | null
    }>(
      `SELECT total_comments, positive_count, neutral_count, negative_count,
              avg_sentiment_score, dominant_sentiment
         FROM l2_gold.comment_sentiment_post
        WHERE platform = $1 AND post_id = $2 AND brand_id = $3
        LIMIT 1`,
      [p.platform, p.post_id, p.brand_id],
    ),
    findAchievement(orgId, p.link),
  ])

  const bench = benchRes.rows[0]
  const erPct = num(p.er_reach) !== null || num(p.er_views) !== null || num(p.er_followers) !== null
    ? (num(p.er_reach) ?? num(p.er_views) ?? num(p.er_followers)!) * 100
    : num(p.engagement_rate)
  const medianEr = pos(bench?.med_er)
  const ratio = erPct !== null && medianEr !== null && medianEr > 0 ? erPct / medianEr : null

  const engagement = num(p.engagement) ?? num(p.total_interactions)
  const s = sentRes.rows[0]

  const metrics: PostMetric[] = [
    { key: 'views', label: 'Views', value: reported(p.views, bench?.max_views), median: pos(bench?.med_views), kind: 'count', headline: true },
    { key: 'likes', label: 'Likes', value: reported(p.likes, bench?.max_likes), median: pos(bench?.med_likes), kind: 'count', headline: true },
    { key: 'comments', label: 'Comments', value: reported(p.comments, bench?.max_comments), median: pos(bench?.med_comments), kind: 'count', headline: true },
    { key: 'er', label: 'Engagement rate', value: erPct, median: medianEr, kind: 'percent', headline: true },
    { key: 'reach', label: 'Reach', value: reported(p.reach, bench?.max_reach), median: pos(bench?.med_reach), kind: 'count' },
    { key: 'impressions', label: 'Impressions', value: reported(p.impressions, bench?.max_impressions), median: pos(bench?.med_impressions), kind: 'count' },
    { key: 'shares', label: 'Shares', value: reported(p.shares, bench?.max_shares), median: pos(bench?.med_shares), kind: 'count' },
    { key: 'saves', label: 'Saves', value: reported(p.saves, bench?.max_saves), median: pos(bench?.med_saves), kind: 'count' },
    { key: 'engagement', label: 'Total interaksi', value: reported(engagement, bench?.max_engagement), median: pos(bench?.med_engagement), kind: 'count' },
    { key: 'follows', label: 'Follows dari post', value: reported(p.follows, bench?.max_follows), median: null, kind: 'count' },
    { key: 'profileVisits', label: 'Kunjungan profil', value: reported(p.profile_visits, bench?.max_profile_visits), median: null, kind: 'count' },
    { key: 'linkClick', label: 'Klik tautan', value: reported(p.link_click, bench?.max_link_click), median: null, kind: 'count' },
    { key: 'watchTime', label: 'Rata-rata ditonton', value: reported(p.avg_watch_time, bench?.max_watch), median: null, kind: 'seconds' },
    { key: 'followersOnDay', label: 'Followers saat posting', value: pos(p.followers_on_post_day), median: null, kind: 'count' },
  ]

  const caption = p.caption ?? ''
  return {
    key: `brand:${p.id}`,
    source: 'brand',
    platform: p.platform,
    postDate: toIso(p.post_date),
    title: p.title,
    caption,
    coverImage: p.cover_image || null,
    link: p.link,
    format: p.format || p.post_type || 'Post',
    pillar: p.content_pillar || null,
    author: p.username ?? '—',
    authorAvatar: p.avatar_url,
    sponsored: p.is_boosted === true || p.is_campaign === true,
    isCampaign: p.is_campaign === true,
    isBoosted: p.is_boosted === true,
    hashtags: p.hashtag_list?.length
      ? p.hashtag_list.map(h => (h.startsWith('#') ? h : `#${h}`).toLowerCase())
      : hashtagsFromCaption(caption),
    metrics,
    performance: { erPct, medianErPct: medianEr, ratio, verdict: verdictFor(ratio) },
    sentiment: s
      ? {
          total: Number(s.total_comments),
          positive: Number(s.positive_count),
          neutral: Number(s.neutral_count),
          negative: Number(s.negative_count),
          score: Number(s.avg_sentiment_score ?? 0),
          dominant: s.dominant_sentiment ?? 'neutral',
        }
      : null,
    achievement: achieveRes,
    benchmarkPosts: bench?.n ?? 0,
  }
}

/* ── competitor posts ─────────────────────────────────────────────────────── */

async function competitorAnalytics(orgId: string, rowId: number): Promise<PostAnalytics | null> {
  const { rows } = await pool.query<{
    id: string; social_account_id: string; platform: string; post_date: Date | string | null
    caption: string | null; post_type: string | null
    like_count: number | null; comment_count: number | null; share_count: number | null
    view_count: number | null; save_count: number | null
    username: string | null; avatar_url: string | null
  }>(
    `SELECT cp.id::text, cp.social_account_id, cp.platform, cp.post_date, cp.caption, cp.post_type,
            cp.like_count, cp.comment_count, cp.share_count, cp.view_count, cp.save_count,
            sa.username, sa.avatar_url
       FROM l1_silver.unified_competitor_post cp
       JOIN public.social_accounts sa ON sa.id = cp.social_account_id
      WHERE cp.id = $2
        AND EXISTS (
          SELECT 1
            FROM public.brand_competitors bc
            JOIN public.brands b ON b.id = bc.brand_id AND b.deleted_at IS NULL
           WHERE bc.social_account_id = cp.social_account_id
             AND b.organization_id = $1
        )
      LIMIT 1`,
    [orgId, rowId],
  )
  const c = rows[0]
  if (!c) return null

  const { rows: benchRows } = await pool.query<{
    n: number; med_views: string | null; med_likes: string | null
    med_comments: string | null; med_shares: string | null; med_saves: string | null
    med_er: string | null
    max_views: string | null; max_likes: string | null; max_comments: string | null
    max_shares: string | null; max_saves: string | null
  }>(
    `SELECT COUNT(*)::int AS n,
            MAX(view_count) AS max_views, MAX(like_count) AS max_likes,
            MAX(comment_count) AS max_comments, MAX(share_count) AS max_shares,
            MAX(save_count) AS max_saves,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY view_count)    AS med_views,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY like_count)    AS med_likes,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY comment_count) AS med_comments,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY share_count)   AS med_shares,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY save_count)    AS med_saves,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY CASE WHEN COALESCE(view_count, 0) > 0
                            THEN (COALESCE(like_count,0) + COALESCE(comment_count,0)
                                  + COALESCE(share_count,0))::numeric / view_count * 100
                       END)                                            AS med_er
       FROM l1_silver.unified_competitor_post
      WHERE social_account_id = $1`,
    [c.social_account_id],
  )
  const bench = benchRows[0]

  const views = num(c.view_count)
  const interactions = (c.like_count ?? 0) + (c.comment_count ?? 0) + (c.share_count ?? 0)
  // Derived, because a scraped post carries no engagement rate of record — the
  // same derivation the Discover grid already prints for competitor rows.
  const erPct = views && views > 0 ? (interactions / views) * 100 : null
  const medianEr = pos(bench?.med_er)
  const ratio = erPct !== null && medianEr !== null && medianEr > 0 ? erPct / medianEr : null

  const caption = c.caption ?? ''
  return {
    key: `competitor:${c.id}`,
    source: 'competitor',
    platform: c.platform,
    postDate: toIso(c.post_date),
    title: null,
    caption,
    coverImage: null,
    link: null,
    format: c.post_type || 'Post',
    pillar: null,
    author: c.username ?? '—',
    authorAvatar: c.avatar_url,
    sponsored: false,
    isCampaign: false,
    isBoosted: false,
    hashtags: hashtagsFromCaption(caption),
    metrics: [
      { key: 'views', label: 'Views', value: reported(views, bench?.max_views), median: pos(bench?.med_views), kind: 'count', headline: true },
      { key: 'likes', label: 'Likes', value: reported(c.like_count, bench?.max_likes), median: pos(bench?.med_likes), kind: 'count', headline: true },
      { key: 'comments', label: 'Comments', value: reported(c.comment_count, bench?.max_comments), median: pos(bench?.med_comments), kind: 'count', headline: true },
      { key: 'er', label: 'Engagement rate', value: erPct, median: medianEr, kind: 'percent', headline: true },
      { key: 'shares', label: 'Shares', value: reported(c.share_count, bench?.max_shares), median: pos(bench?.med_shares), kind: 'count' },
      { key: 'saves', label: 'Saves', value: reported(c.save_count, bench?.max_saves), median: pos(bench?.med_saves), kind: 'count' },
      { key: 'engagement', label: 'Total interaksi', value: interactions, median: null, kind: 'count' },
    ],
    performance: { erPct, medianErPct: medianEr, ratio, verdict: verdictFor(ratio) },
    // Competitor posts are scraped from outside: no comment corpus, and they can
    // never be a deliverable of this org's campaign.
    sentiment: null,
    achievement: null,
    benchmarkPosts: bench?.n ?? 0,
  }
}

/* ── campaign achievement ─────────────────────────────────────────────────── */

/**
 * The order item this post fulfils, if any, and how it did against its target.
 *
 * The link is `discover_order_items.published_url`: when a booked deliverable is
 * published, the URL of the post that fulfilled it is recorded there, and that
 * is the only honest way to tie a post to a target. `is_campaign` on the post
 * says a post belonged to *a* campaign; it does not say which, and it carries no
 * number to be measured against.
 *
 * Both order tables are empty today, so this returns null for every post in the
 * warehouse. It is written against the real columns rather than stubbed, so the
 * achievement panel starts working the moment the first order is published — no
 * second pass over this file.
 */
async function findAchievement(orgId: string, link: string | null): Promise<PostAchievement | null> {
  const key = normaliseUrl(link)
  if (!key) return null

  const { rows } = await pool.query<{
    order_name: string | null; objective: string | null; campaign_status: string | null
    goal_reach: string | null; goal_engagement: string | null
    deliverable_label: string | null; target_objective: string | null
    target_reach: string | null; target_engagement: string | null
    progress_status: string | null; published_url: string | null
  }>(
    `SELECT o.name AS order_name, o.objective, o.campaign_status,
            o.goal_reach, o.goal_engagement,
            i.deliverable_label, i.target_objective, i.target_reach, i.target_engagement,
            i.progress_status, i.published_url
       FROM public.discover_order_items i
       JOIN public.discover_orders o ON o.id = i.order_id
      WHERE o.organization_id = $1 AND i.published_url IS NOT NULL
      ORDER BY i.published_at DESC NULLS LAST`,
    [orgId],
  )

  const hit = rows.find(r => normaliseUrl(r.published_url) === key)
  if (!hit) return null

  return {
    orderName: hit.order_name ?? 'Campaign',
    deliverable: hit.deliverable_label,
    objective: hit.target_objective ?? hit.objective,
    status: hit.progress_status,
    campaignStatus: hit.campaign_status,
    // Filled by the caller, which is the only place that holds the actuals.
    lines: [
      ...(num(hit.target_reach) ? [{ label: 'Reach', target: num(hit.target_reach)!, actual: 0, pct: 0 }] : []),
      ...(num(hit.target_engagement) ? [{ label: 'Engagement', target: num(hit.target_engagement)!, actual: 0, pct: 0 }] : []),
      ...(num(hit.goal_reach) && !num(hit.target_reach)
        ? [{ label: 'Reach (goal order)', target: num(hit.goal_reach)!, actual: 0, pct: 0 }] : []),
      ...(num(hit.goal_engagement) && !num(hit.target_engagement)
        ? [{ label: 'Engagement (goal order)', target: num(hit.goal_engagement)!, actual: 0, pct: 0 }] : []),
    ],
  }
}

/** Fills each target line's `actual` from the post's own measured metrics. */
function scoreAchievement(a: PostAchievement | null, metrics: PostMetric[]): PostAchievement | null {
  if (!a || a.lines.length === 0) return a
  const at = (k: string) => metrics.find(m => m.key === k)?.value ?? null

  const lines = a.lines.map(line => {
    const actual = line.label.startsWith('Reach')
      ? (at('reach') ?? at('impressions') ?? at('views') ?? 0)
      : (at('engagement') ?? 0)
    return { ...line, actual, pct: line.target > 0 ? (actual / line.target) * 100 : 0 }
  })
  return { ...a, lines }
}

/* ── entry point ──────────────────────────────────────────────────────────── */

/**
 * Full analytics for one post the org is allowed to see.
 *
 * Returns null when the row does not exist or belongs to another org — the
 * caller answers 404 either way, so a probe cannot tell the two apart.
 */
export async function getPostAnalytics(
  orgId: string, source: PostSource, rowId: number,
): Promise<PostAnalytics | null> {
  if (!Number.isInteger(rowId) || rowId <= 0) return null

  const data = source === 'brand'
    ? await brandAnalytics(orgId, rowId)
    : await competitorAnalytics(orgId, rowId)
  if (!data) return null

  return { ...data, achievement: scoreAchievement(data.achievement, data.metrics) }
}
