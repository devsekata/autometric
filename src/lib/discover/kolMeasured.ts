import kolDb from '@/lib/kolDb'
import { toIso } from './util'

/**
 * What the warehouse has actually measured about a roster creator.
 *
 * This module exists to shrink `@/lib/discover/kolSample`'s territory rather
 * than to replace it. The commercial KOL database was described there as holding
 * identity only, and for most of the roster that is still true — but not for all
 * of it. Two of its tables carry real figures:
 *
 *   * `l1_silver.unified_post` — 221 posts across 23 creators, with likes,
 *     comments, views, caption, permalink, cover image and media type.
 *   * `l1_silver.unified_rate_card` — 9,210 priced deliverables covering 7,230
 *     of the 7,718 roster creators, in IDR.
 *
 * Both are reached from `public.kol_directory` through `public.kol_social_account`,
 * which maps a roster row to the social accounts it owns. A creator can hold more
 * than one (Instagram and TikTok), and posts hang off the account rather than the
 * creator, so the join fans in rather than out.
 *
 * Everything the workspace shows beyond this is still sampled: audience
 * demographics, campaign history, brand fit and the AI summary all live in
 * tables that exist but hold zero rows (`feature.*_audience_analysis`,
 * `feature.*_brand_fit_analysis`, `public.campaigns`, `public.campaign_kols`).
 *
 * Nulls here are deliberate and are never coalesced to zero. `reach`, `shares`
 * and `saved` come back empty for every post harvested so far, and a zero would
 * read as "measured, and it was nothing" instead of "never measured" — the same
 * distinction `erPct` already makes on the roster row itself.
 */

export interface KolMeasuredPost {
  id: string
  /** ISO timestamp of the post, or null when the harvest carried none. */
  date: string | null
  /** Raw warehouse value (`clips`, `feed`, `CAROUSEL`, …), kept for grouping. */
  mediaType: string | null
  /** `mediaType` rendered for a human; see `POST_FORMAT_LABEL`. */
  format: string
  caption: string | null
  permalink: string | null
  coverImage: string | null
  likes: number | null
  comments: number | null
  views: number | null
  /** Tags the post actually carries; 78 of the 221 harvested posts have some. */
  hashtags: string[]
  /** The platform's own paid-partnership flag, not an inference from the caption. */
  sponsored: boolean
}

/** One priced deliverable from the KOL platform's own rate card. */
export interface KolMeasuredRate {
  postType: string
  /** Human label for `postType`, the same mapping the formats use. */
  label: string
  fee: number
  currency: string
}

export interface KolMeasured {
  /** How many posts back these figures — the workspace prints it as the basis. */
  postCount: number
  totals: {
    likes: number | null
    comments: number | null
    views: number | null
    shares: number | null
    reach: number | null
    saved: number | null
  }
  averages: {
    likes: number | null
    comments: number | null
    views: number | null
  }
  /** Share of posts per format, largest first. Empty when nothing is harvested. */
  formats: { label: string; pct: number; n: number }[]
  /** Newest first, capped at twelve — enough to fill the Content grid. */
  recent: KolMeasuredPost[]
  /**
   * Most-used tags across every harvested post, not just the twelve shown. This
   * is the source platform's "Top hashtags & keywords" panel, which it filled
   * with a hardcoded list; here it is counted.
   */
  hashtags: { tag: string; n: number }[]
  /** How many harvested posts the platform marks as paid partnerships. */
  sponsoredCount: number
  /** The creator's real prices, cheapest quote per deliverable. */
  rates: KolMeasuredRate[]
  firstPostAt: string | null
  lastPostAt: string | null
}

/**
 * The warehouse's `media_type` vocabulary is the union of what Instagram and
 * TikTok each report, so one idea arrives under several spellings — `clips` and
 * `VIDEO` are both short-form video. Mapping happens here, once, rather than in
 * every component that prints one.
 */
const POST_FORMAT_LABEL: Record<string, string> = {
  clips: 'Reels',
  reel: 'Reels',
  feed: 'Feed',
  feed_photo: 'Foto',
  feed_video: 'Feed Video',
  carousel_container: 'Carousel',
  carousel: 'Carousel',
  video: 'Video',
  image: 'Foto',
  story: 'Story',
}

export function postFormatLabel(mediaType: string | null): string {
  if (!mediaType) return 'Lainnya'
  return POST_FORMAT_LABEL[mediaType] ?? POST_FORMAT_LABEL[mediaType.toLowerCase()] ?? mediaType
}

/** `bigint` and `numeric` both arrive as strings from node-pg; null stays null. */
const num = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v)

/**
 * Returns null when the warehouse has neither posts nor prices for this creator,
 * which is the signal for the workspace to sample the whole page exactly as it
 * did before this module existed.
 */
export async function getKolMeasured(kolId: string): Promise<KolMeasured | null> {
  const db = kolDb()

  const [agg, recent, rates, tags, sponsored] = await Promise.all([
    db.query<{
      media_type: string | null; n: number
      likes: string | null; comments: string | null; views: string | null
      shares: string | null; reach: string | null; saved: string | null
      first_at: Date | string | null; last_at: Date | string | null
    }>(
      `SELECT p.media_type,
              COUNT(*)::int   AS n,
              SUM(p.likes)    AS likes,
              SUM(p.comments) AS comments,
              SUM(p.views)    AS views,
              SUM(p.shares)   AS shares,
              SUM(p.reach)    AS reach,
              SUM(p.saved)    AS saved,
              MIN(COALESCE(p.posted_at, p.date::timestamptz)) AS first_at,
              MAX(COALESCE(p.posted_at, p.date::timestamptz)) AS last_at
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
        GROUP BY p.media_type`,
      [kolId],
    ),

    db.query<{
      id: string; at: Date | string | null; media_type: string | null
      caption: string | null; title: string | null
      permalink: string | null; cover_image: string | null
      likes: string | null; comments: string | null; views: string | null
      hashtags: string[] | null; is_sponsored: boolean | null
    }>(
      `SELECT p.id,
              COALESCE(p.posted_at, p.date::timestamptz) AS at,
              p.media_type, p.caption, p.title, p.permalink, p.cover_image,
              p.likes, p.comments, p.views, p.hashtags, p.is_sponsored
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
        ORDER BY COALESCE(p.posted_at, p.date::timestamptz) DESC NULLS LAST
        LIMIT 12`,
      [kolId],
    ),

    // The roster carries a row per harvest, so a deliverable can be quoted more
    // than once. The cheapest quote wins rather than an arbitrary one: a price
    // shown to a buyer should be one the creator has actually agreed to.
    db.query<{ post_type: string | null; fee: string | null; currency: string | null }>(
      `SELECT DISTINCT ON (rc.post_type)
              rc.post_type, rc.fee, rc.currency
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_rate_card rc ON rc.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1 AND rc.fee IS NOT NULL AND rc.post_type IS NOT NULL
        ORDER BY rc.post_type, rc.fee ASC`,
      [kolId],
    ),

    db.query<{ tag: string; n: number }>(
      `SELECT tag, COUNT(*)::int AS n
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
        CROSS JOIN LATERAL unnest(COALESCE(p.hashtags, ARRAY[]::text[])) AS tag
        WHERE ksa.kol_id = $1
        GROUP BY tag
        ORDER BY n DESC, tag
        LIMIT 12`,
      [kolId],
    ),

    db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1 AND p.is_sponsored`,
      [kolId],
    ),
  ])

  if (!agg.rows.length && !rates.rows.length) return null

  const postCount = agg.rows.reduce((a, r) => a + r.n, 0)

  /** Sums one column across the per-format groups, staying null if every group is. */
  const total = (k: 'likes' | 'comments' | 'views' | 'shares' | 'reach' | 'saved') => {
    const vals = agg.rows.map(r => num(r[k])).filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const avg = (v: number | null) =>
    v === null || postCount === 0 ? null : Math.round(v / postCount)

  const stamps = agg.rows
    .flatMap(r => [r.first_at, r.last_at])
    .map(toIso)
    .filter((v): v is string => v !== null)
    .sort()

  const likes = total('likes')
  const comments = total('comments')
  const views = total('views')

  return {
    postCount,
    totals: {
      likes,
      comments,
      views,
      shares: total('shares'),
      reach: total('reach'),
      saved: total('saved'),
    },
    averages: { likes: avg(likes), comments: avg(comments), views: avg(views) },
    formats: [...agg.rows]
      .sort((a, b) => b.n - a.n)
      .map(r => ({
        label: postFormatLabel(r.media_type),
        n: r.n,
        pct: postCount ? Math.round((r.n / postCount) * 100) : 0,
      })),
    recent: recent.rows.map(r => ({
      id: r.id,
      date: toIso(r.at),
      mediaType: r.media_type,
      format: postFormatLabel(r.media_type),
      // TikTok fills `title` where Instagram fills `caption`; either one is the
      // text the card shows, and an empty string is not a caption.
      caption: (r.caption || r.title) ?? null,
      permalink: r.permalink,
      coverImage: r.cover_image,
      likes: num(r.likes),
      comments: num(r.comments),
      views: num(r.views),
      hashtags: r.hashtags ?? [],
      sponsored: r.is_sponsored === true,
    })),
    hashtags: tags.rows.map(r => ({ tag: r.tag, n: r.n })),
    sponsoredCount: sponsored.rows[0]?.n ?? 0,
    rates: rates.rows.map(r => ({
      postType: r.post_type as string,
      label: postFormatLabel(r.post_type),
      fee: Number(r.fee),
      currency: r.currency ?? 'IDR',
    })),
    firstPostAt: stamps[0] ?? null,
    lastPostAt: stamps[stamps.length - 1] ?? null,
  }
}
