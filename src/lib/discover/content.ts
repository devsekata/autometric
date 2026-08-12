import pool from '@/lib/db'
import { toIso } from './util'
import type {
  DiscoverContentPayload, DiscoverFilters, DiscoverFormat, DiscoverPost,
} from './types'

/**
 * Query layer for Discovery Content.
 *
 * The grid unions two tables that do not share a schema:
 *   brand posts      l1_silver.unified_post            (rich: format, pillar, er_*, cover_image)
 *   competitor posts l1_silver.unified_competitor_post (lean: post_type + raw counts only)
 *
 * Both are normalised to the same column list inside `base` so the filter, sort
 * and pagination logic is written once. Competitor rows fill the gaps: they have
 * no cover image (the UI falls back to a deterministic gradient), no editorial
 * pillar, and no precomputed engagement rate, so ER is derived from the raw
 * counts instead.
 *
 * Org scoping uses EXISTS rather than a JOIN on brand_social_accounts /
 * brand_competitors. Those are many-to-many link tables — one competitor account
 * can be tracked by several brands in the same org — and a plain JOIN would
 * emit the same post once per link, silently inflating both the grid and the
 * result count.
 */

/**
 * Format normalisation. Brand posts carry a clean editorial `format`
 * (Carousel/Reels/Image/Video); competitor posts only have the platform's raw
 * `post_type` (CAROUSEL_ALBUM, REELS, VIDEO, IMAGE, or NULL for Facebook).
 * `format` wins when present, then post_type, else 'Post'.
 */
export const FORMAT_EXPR = (fmt: string | null, postType: string) => `
  CASE
    WHEN lower(coalesce(${fmt ?? "''"}, '')) IN ('reel', 'reels')                    THEN 'Reel'
    WHEN lower(coalesce(${fmt ?? "''"}, '')) IN ('carousel', 'carousel_album')        THEN 'Carousel'
    WHEN lower(coalesce(${fmt ?? "''"}, '')) IN ('image', 'photo')                    THEN 'Image'
    WHEN lower(coalesce(${fmt ?? "''"}, '')) IN ('video', 'videos')                   THEN 'Video'
    WHEN lower(coalesce(${postType}, ''))    IN ('reel', 'reels', 'clips')            THEN 'Reel'
    WHEN lower(coalesce(${postType}, ''))    IN ('carousel_album', 'album', 'sidecar', 'carousel') THEN 'Carousel'
    WHEN lower(coalesce(${postType}, ''))    IN ('image', 'photo', 'feed')            THEN 'Image'
    WHEN lower(coalesce(${postType}, ''))    IN ('video', 'videos')                   THEN 'Video'
    ELSE 'Post'
  END`

// Whitelisted — `sort` reaches SQL as an ORDER BY fragment and must never be
// interpolated from raw user input.
const SORT_SQL: Record<DiscoverFilters['sort'], string> = {
  new:   'post_date DESC NULLS LAST, views DESC',
  old:   'post_date ASC NULLS LAST, views DESC',
  views: 'views DESC, post_date DESC',
  likes: 'likes DESC, post_date DESC',
  er:    'er_pct DESC, post_date DESC',
}

/**
 * The unioned, org-scoped post set. Kept as a CTE so filters apply uniformly to
 * both sources and the count query can reuse the exact same shape.
 */
export const BASE_CTE = `
  WITH base AS (
    SELECT
      'brand'::text                         AS source,
      p.id                                  AS row_id,
      p.platform,
      p.post_date::timestamptz              AS post_date,
      GREATEST(0, (CURRENT_DATE - p.post_date::date))::int AS age_days,
      COALESCE(p.caption, p.title, '')      AS caption,
      NULLIF(p.cover_image, '')             AS cover_image,
      ${FORMAT_EXPR('p.format', 'p.post_type')} AS format,
      NULLIF(p.content_pillar, '')          AS pillar,
      sa.username                           AS author,
      sa.avatar_url                         AS author_avatar,
      COALESCE(p.views, 0)::bigint          AS views,
      COALESCE(p.likes, 0)::bigint          AS likes,
      COALESCE(p.comments, 0)::bigint       AS comments,
      COALESCE(p.shares, 0)::bigint         AS shares,
      -- er_* columns are ratios (0.024 = 2.4%); the UI wants percent.
      (COALESCE(p.er_reach, p.er_views, p.er_followers, 0) * 100)::float AS er_pct,
      (COALESCE(p.is_boosted, false) OR COALESCE(p.is_campaign, false))  AS sponsored,
      COALESCE(array_to_string(p.hashtag_list, ' '), '') AS hashtags
    FROM l1_silver.unified_post p
    JOIN public.social_accounts sa ON sa.id = p.brand_id
    WHERE EXISTS (
      SELECT 1
        FROM public.brand_social_accounts bsa
        JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
       WHERE bsa.social_account_id = p.brand_id
         AND b.organization_id = $1
         AND ($2::uuid IS NULL OR bsa.brand_id = $2)
    )

    UNION ALL

    SELECT
      'competitor'::text,
      cp.id,
      cp.platform,
      cp.post_date,
      GREATEST(0, (CURRENT_DATE - cp.post_date::date))::int,
      COALESCE(cp.caption, ''),
      NULL,
      ${FORMAT_EXPR(null, 'cp.post_type')},
      NULL,
      sa.username,
      sa.avatar_url,
      COALESCE(cp.view_count, 0)::bigint,
      COALESCE(cp.like_count, 0)::bigint,
      COALESCE(cp.comment_count, 0)::bigint,
      COALESCE(cp.share_count, 0)::bigint,
      -- No stored ER for competitors: derive interactions / views.
      CASE WHEN COALESCE(cp.view_count, 0) > 0
           THEN ((COALESCE(cp.like_count,0) + COALESCE(cp.comment_count,0) + COALESCE(cp.share_count,0))::numeric
                 / cp.view_count * 100)::float
           ELSE 0 END,
      false,
      ''
    FROM l1_silver.unified_competitor_post cp
    JOIN public.social_accounts sa ON sa.id = cp.social_account_id
    WHERE EXISTS (
      SELECT 1
        FROM public.brand_competitors bc
        JOIN public.brands b ON b.id = bc.brand_id AND b.deleted_at IS NULL
       WHERE bc.social_account_id = cp.social_account_id
         AND b.organization_id = $1
         AND ($2::uuid IS NULL OR bc.brand_id = $2)
    )
  )`

// $3..$13 — shared by the page query and its matching count query.
const FILTER_SQL = `
  WHERE ($3::text  IS NULL OR b.caption ILIKE '%' || $3 || '%'
                            OR b.author  ILIKE '%' || $3 || '%'
                            OR b.hashtags ILIKE '%' || $3 || '%')
    AND ($4::text  IS NULL OR b.format   = $4)
    AND ($5::text  IS NULL OR b.platform = $5)
    AND ($6::text  IS NULL OR b.pillar   = $6)
    AND ($7::text  IS NULL OR (CASE WHEN b.sponsored THEN 'sponsored' ELSE 'organic' END) = $7)
    AND ($8::text  IS NULL OR b.source   = $8)
    AND b.er_pct >= $9
    AND b.likes  >= $10
    AND b.views  >= $11
    AND ($12::int IS NULL OR b.age_days <= $12)
    -- Saved-only. Written as EXISTS rather than a predicate on the LEFT JOIN so
    -- the identical clause works in the count query, which has no join.
    AND ($13::boolean IS NOT TRUE OR EXISTS (
          SELECT 1 FROM public.discover_inspirations ins
           WHERE ins.organization_id = $1
             AND ins.source = b.source AND ins.post_row_id = b.row_id))`

/** Empty string / 'all' / 'All' all mean "no filter"; normalise to SQL NULL. */
const orNull = (v: string | null | undefined) =>
  !v || v === 'all' || v === 'All' ? null : v

interface Row {
  source: 'brand' | 'competitor'
  row_id: string
  platform: string
  // timestamptz arrives as a Date from node-pg; normalised in toPost.
  post_date: Date | string | null
  age_days: number
  caption: string
  cover_image: string | null
  format: string
  pillar: string | null
  author: string | null
  author_avatar: string | null
  views: string
  likes: string
  comments: string
  shares: string
  er_pct: number
  sponsored: boolean
  saved: boolean
}

export async function listDiscoverContent(
  orgId: string,
  filters: DiscoverFilters,
  brandId: string | null = null,
): Promise<DiscoverContentPayload> {
  const page = Math.max(1, filters.page)
  const pageSize = Math.min(96, Math.max(1, filters.pageSize))
  const offset = (page - 1) * pageSize

  const params = [
    orgId,                                   // $1
    brandId,                                 // $2
    filters.q.trim() || null,                // $3
    orNull(filters.format),                  // $4
    orNull(filters.platform),                // $5
    orNull(filters.pillar),                  // $6
    orNull(filters.type),                    // $7
    orNull(filters.source),                  // $8
    filters.erMin,                           // $9
    filters.likesMin,                        // $10
    filters.viewsMin,                        // $11
    filters.days === 'all' ? null : filters.days, // $12
    filters.savedOnly === true,              // $13
  ]

  const [pageRes, countRes, metaRes] = await Promise.all([
    pool.query<Row>(
      `${BASE_CTE}
       SELECT b.*, (i.id IS NOT NULL) AS saved
         FROM base b
         LEFT JOIN public.discover_inspirations i
           ON i.organization_id = $1 AND i.source = b.source AND i.post_row_id = b.row_id
       ${FILTER_SQL}
        ORDER BY ${SORT_SQL[filters.sort] ?? SORT_SQL.views}
        LIMIT $14 OFFSET $15`,
      [...params, pageSize, offset],
    ),
    pool.query<{ n: string }>(
      `${BASE_CTE} SELECT COUNT(*)::text n FROM base b ${FILTER_SQL}`,
      params,
    ),
    // Unfiltered context: the total corpus size and the pillar list the filter
    // panel offers. Both ignore $3..$12 by design.
    pool.query<{ grand_total: string; pillars: string[]; saved_count: string }>(
      `${BASE_CTE}
       SELECT (SELECT COUNT(*)::text FROM base)                                   AS grand_total,
              (SELECT COALESCE(array_agg(DISTINCT pillar ORDER BY pillar), '{}')
                 FROM base WHERE pillar IS NOT NULL)                              AS pillars,
              (SELECT COUNT(*)::text FROM public.discover_inspirations
                WHERE organization_id = $1)                                       AS saved_count`,
      [orgId, brandId],
    ),
  ])

  const meta = metaRes.rows[0]
  return {
    posts: pageRes.rows.map(toPost),
    total: Number(countRes.rows[0]?.n ?? 0),
    grandTotal: Number(meta?.grand_total ?? 0),
    pillars: meta?.pillars ?? [],
    savedCount: Number(meta?.saved_count ?? 0),
    page,
    pageSize,
  }
}

function toPost(r: Row): DiscoverPost {
  return {
    key: `${r.source}:${r.row_id}`,
    source: r.source,
    rowId: Number(r.row_id),
    platform: (r.platform ?? 'instagram') as DiscoverPost['platform'],
    postDate: toIso(r.post_date) ?? '',
    ageDays: r.age_days ?? 0,
    caption: r.caption ?? '',
    coverImage: r.cover_image,
    format: (r.format ?? 'Post') as DiscoverFormat,
    pillar: r.pillar,
    author: r.author ?? '—',
    authorAvatar: r.author_avatar,
    views: Number(r.views ?? 0),
    likes: Number(r.likes ?? 0),
    comments: Number(r.comments ?? 0),
    shares: Number(r.shares ?? 0),
    erPct: Number(r.er_pct ?? 0),
    sponsored: !!r.sponsored,
    saved: !!r.saved,
  }
}
