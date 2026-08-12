import pool from '@/lib/db'
import { FORMAT_EXPR } from './content'
import { toIso } from './util'
import type { DirectoryAccount, DiscoverPlatform } from './types'
import type { NamedCount } from './summary'

/**
 * Per-account detail for the KOL Intelligence workspace.
 *
 * The source platform's creator detail page was driven by a hardcoded KOL
 * record carrying commercial fields (emv, cpe, rate, agency, match %,
 * authenticity, collab status). autometric stores none of those, so every
 * section here is rebuilt from the account's actual post history.
 *
 * `relation` is a required argument rather than something the query infers,
 * because the same social account can legitimately exist on both sides — it can
 * be an org's own account AND appear in another brand's competitor list, and
 * some accounts in this dataset have rows in both post tables. Passing it
 * explicitly keeps "which numbers am I looking at" unambiguous.
 */

export type AccountRelation = 'owned' | 'competitor'

export interface AccountPost {
  key: string
  caption: string
  platform: string
  format: string
  postDate: string | null
  views: number
  likes: number
  comments: number
  erPct: number
  sponsored: boolean
  pillar: string | null
}

export interface AccountDetailPayload {
  account: DirectoryAccount
  kpis: {
    posts: number; views: number; likes: number; comments: number; shares: number
    erPct: number; viewsPerPost: number; firstPostAt: string | null; lastPostAt: string | null
  }
  timeline: { month: string; posts: number; views: number }[]
  byFormat: NamedCount[]
  byPillar: NamedCount[]
  byPlatform: NamedCount[]
  engagementMix: { label: string; value: number }[]
  campaignSplit: NamedCount[]
  topPosts: AccountPost[]
  recentCampaignPosts: AccountPost[]
  /** Latest 10 posts — the unit of analysis for the Content Analytics tab. */
  latestPosts: AccountPost[]
  /** Posting-time heatmap source: post counts by weekday and hour bucket. */
  postingTimes: { day: number; bucket: number; posts: number; avgEr: number }[]
}

/**
 * Post set for one account, normalised to the same column list both post tables
 * are mapped onto elsewhere in Discover. The `$3 = '...'` guards mean only the
 * branch matching `relation` contributes rows.
 */
const ACCOUNT_CTE = `
  WITH base AS (
    SELECT
      'brand'::text                     AS source,
      p.id                              AS row_id,
      p.platform,
      p.post_date::timestamptz          AS post_date,
      COALESCE(p.caption, p.title, '')  AS caption,
      ${FORMAT_EXPR('p.format', 'p.post_type')} AS format,
      NULLIF(p.content_pillar, '')      AS pillar,
      COALESCE(p.views, 0)::bigint      AS views,
      COALESCE(p.likes, 0)::bigint      AS likes,
      COALESCE(p.comments, 0)::bigint   AS comments,
      COALESCE(p.shares, 0)::bigint     AS shares,
      (COALESCE(p.er_reach, p.er_views, p.er_followers, 0) * 100)::float AS er_pct,
      (COALESCE(p.is_boosted, false) OR COALESCE(p.is_campaign, false))  AS sponsored
    FROM l1_silver.unified_post p
    WHERE $3 = 'owned'
      AND p.brand_id = $2
      AND EXISTS (
        SELECT 1 FROM public.brand_social_accounts bsa
          JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
         WHERE bsa.social_account_id = p.brand_id AND b.organization_id = $1
      )

    UNION ALL

    SELECT
      'competitor'::text, cp.id, cp.platform, cp.post_date,
      COALESCE(cp.caption, ''),
      ${FORMAT_EXPR(null, 'cp.post_type')},
      NULL,
      COALESCE(cp.view_count, 0)::bigint,
      COALESCE(cp.like_count, 0)::bigint,
      COALESCE(cp.comment_count, 0)::bigint,
      COALESCE(cp.share_count, 0)::bigint,
      CASE WHEN COALESCE(cp.view_count, 0) > 0
           THEN ((COALESCE(cp.like_count,0) + COALESCE(cp.comment_count,0) + COALESCE(cp.share_count,0))::numeric
                 / cp.view_count * 100)::float
           ELSE 0 END,
      false
    FROM l1_silver.unified_competitor_post cp
    WHERE $3 = 'competitor'
      AND cp.social_account_id = $2
      AND EXISTS (
        SELECT 1 FROM public.brand_competitors bc
          JOIN public.brands b ON b.id = bc.brand_id AND b.deleted_at IS NULL
         WHERE bc.social_account_id = cp.social_account_id AND b.organization_id = $1
      )
  )`

const AGG = `
  COUNT(*)::int                      AS posts,
  COALESCE(SUM(views), 0)::bigint    AS views,
  COALESCE(SUM(likes), 0)::bigint    AS likes,
  COALESCE(SUM(comments), 0)::bigint AS comments,
  COALESCE(AVG(er_pct), 0)::float    AS er_pct`

interface AggRow {
  label: string | null; posts: number; views: string
  likes: string; comments: string; er_pct: number
}

const toNamed = (rows: AggRow[]): NamedCount[] => rows.map(r => ({
  label: r.label ?? '—',
  posts: Number(r.posts ?? 0),
  views: Number(r.views ?? 0),
  likes: Number(r.likes ?? 0),
  comments: Number(r.comments ?? 0),
  erPct: Number(r.er_pct ?? 0),
}))

interface PostRow {
  source: string; row_id: string; caption: string; platform: string; format: string
  post_date: Date | string | null; views: string; likes: string; comments: string
  er_pct: number; sponsored: boolean; pillar: string | null
}

const toPost = (r: PostRow): AccountPost => ({
  key: `${r.source}:${r.row_id}`,
  caption: r.caption ?? '',
  platform: r.platform,
  format: r.format,
  postDate: toIso(r.post_date),
  views: Number(r.views ?? 0),
  likes: Number(r.likes ?? 0),
  comments: Number(r.comments ?? 0),
  erPct: Number(r.er_pct ?? 0),
  sponsored: !!r.sponsored,
  pillar: r.pillar,
})

/** Returns null when the account is not visible to this org under that relation. */
export async function getAccountDetail(
  orgId: string,
  accountId: string,
  relation: AccountRelation,
): Promise<AccountDetailPayload | null> {
  const p = [orgId, accountId, relation]

  const profileRes = await pool.query<{
    id: string; username: string; avatar_url: string | null; profile_url: string | null
    platform: string; brand_id: string | null; brand_name: string | null
  }>(
    `SELECT DISTINCT ON (sa.id)
            sa.id, sa.username, sa.avatar_url, sa.profile_url,
            pl.key AS platform, b.id AS brand_id, b.name AS brand_name
       FROM public.social_accounts sa
       JOIN public.platforms pl ON pl.id = sa.platform_id
       JOIN public.brands b ON b.deleted_at IS NULL AND b.organization_id = $1
      WHERE sa.id = $2
        AND (
          ($3 = 'owned' AND EXISTS (
             SELECT 1 FROM public.brand_social_accounts bsa
              WHERE bsa.social_account_id = sa.id AND bsa.brand_id = b.id))
          OR
          ($3 = 'competitor' AND EXISTS (
             SELECT 1 FROM public.brand_competitors bc
              WHERE bc.social_account_id = sa.id AND bc.brand_id = b.id))
        )
      ORDER BY sa.id, b.name
      LIMIT 1`,
    p,
  )
  const profile = profileRes.rows[0]
  if (!profile) return null

  const [kpi, timeline, format, pillar, platform, campaign, top, campPosts, latest, times] = await Promise.all([
    pool.query<{
      posts: number; views: string; likes: string; comments: string; shares: string
      er_pct: number; first_at: Date | null; last_at: Date | null
    }>(
      `${ACCOUNT_CTE}
       SELECT COUNT(*)::int AS posts,
              COALESCE(SUM(views),0)::bigint    AS views,
              COALESCE(SUM(likes),0)::bigint    AS likes,
              COALESCE(SUM(comments),0)::bigint AS comments,
              COALESCE(SUM(shares),0)::bigint   AS shares,
              COALESCE(AVG(er_pct),0)::float    AS er_pct,
              MIN(post_date) AS first_at, MAX(post_date) AS last_at
         FROM base`, p),

    pool.query<{ month: string; posts: number; views: string }>(
      `${ACCOUNT_CTE}
       SELECT to_char(date_trunc('month', post_date), 'YYYY-MM') AS month,
              COUNT(*)::int AS posts, COALESCE(SUM(views),0)::bigint AS views
         FROM base WHERE post_date IS NOT NULL GROUP BY 1 ORDER BY 1`, p),

    pool.query<AggRow>(
      `${ACCOUNT_CTE} SELECT format AS label, ${AGG} FROM base GROUP BY format ORDER BY posts DESC`, p),

    pool.query<AggRow>(
      `${ACCOUNT_CTE} SELECT pillar AS label, ${AGG} FROM base
        WHERE pillar IS NOT NULL GROUP BY pillar ORDER BY views DESC`, p),

    pool.query<AggRow>(
      `${ACCOUNT_CTE} SELECT platform AS label, ${AGG} FROM base GROUP BY platform ORDER BY views DESC`, p),

    pool.query<AggRow>(
      `${ACCOUNT_CTE}
       SELECT CASE WHEN sponsored THEN 'Campaign / Boosted' ELSE 'Organic' END AS label, ${AGG}
         FROM base GROUP BY 1 ORDER BY posts DESC`, p),

    pool.query<PostRow>(
      `${ACCOUNT_CTE}
       SELECT source, row_id, caption, platform, format, post_date, views, likes, comments, er_pct, sponsored, pillar
         FROM base ORDER BY views DESC LIMIT 8`, p),

    pool.query<PostRow>(
      `${ACCOUNT_CTE}
       SELECT source, row_id, caption, platform, format, post_date, views, likes, comments, er_pct, sponsored, pillar
         FROM base WHERE sponsored ORDER BY post_date DESC NULLS LAST LIMIT 10`, p),

    pool.query<PostRow>(
      `${ACCOUNT_CTE}
       SELECT source, row_id, caption, platform, format, post_date, views, likes, comments, er_pct, sponsored, pillar
         FROM base ORDER BY post_date DESC NULLS LAST LIMIT 10`, p),

    // Weekday x 4-hour bucket, so "when does this account post and does it work".
    pool.query<{ day: number; bucket: number; posts: number; avg_er: number }>(
      `${ACCOUNT_CTE}
       SELECT EXTRACT(DOW FROM post_date)::int AS day,
              (EXTRACT(HOUR FROM post_date)::int / 4) AS bucket,
              COUNT(*)::int AS posts,
              COALESCE(AVG(er_pct), 0)::float AS avg_er
         FROM base WHERE post_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2`, p),
  ])

  const k = kpi.rows[0]
  const posts = Number(k?.posts ?? 0)
  const views = Number(k?.views ?? 0)
  const likes = Number(k?.likes ?? 0)
  const comments = Number(k?.comments ?? 0)
  const shares = Number(k?.shares ?? 0)

  const account: DirectoryAccount = {
    id: profile.id,
    username: profile.username ?? '—',
    avatarUrl: profile.avatar_url,
    profileUrl: profile.profile_url,
    platform: (profile.platform ?? 'instagram') as DiscoverPlatform,
    relation,
    brandId: profile.brand_id,
    brandName: profile.brand_name,
    postCount: posts,
    totalViews: views,
    totalLikes: likes,
    totalComments: comments,
    avgErPct: Number(k?.er_pct ?? 0),
    lastPostAt: toIso(k?.last_at ?? null),
  }

  return {
    account,
    kpis: {
      posts, views, likes, comments, shares,
      erPct: Number(k?.er_pct ?? 0),
      viewsPerPost: posts ? Math.round(views / posts) : 0,
      firstPostAt: toIso(k?.first_at ?? null),
      lastPostAt: toIso(k?.last_at ?? null),
    },
    timeline: timeline.rows.map(r => ({
      month: r.month, posts: Number(r.posts ?? 0), views: Number(r.views ?? 0),
    })),
    byFormat: toNamed(format.rows),
    byPillar: toNamed(pillar.rows),
    byPlatform: toNamed(platform.rows),
    engagementMix: [
      { label: 'Likes', value: likes },
      { label: 'Comments', value: comments },
      { label: 'Shares', value: shares },
    ],
    campaignSplit: toNamed(campaign.rows),
    topPosts: top.rows.map(toPost),
    recentCampaignPosts: campPosts.rows.map(toPost),
    latestPosts: latest.rows.map(toPost),
    postingTimes: times.rows.map(r => ({
      day: Number(r.day ?? 0), bucket: Number(r.bucket ?? 0),
      posts: Number(r.posts ?? 0), avgEr: Number(r.avg_er ?? 0),
    })),
  }
}
