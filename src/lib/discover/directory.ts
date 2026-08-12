import pool from '@/lib/db'
import { toIso } from './util'
import type { DirectoryAccount, DirectoryPayload, DiscoverPlatform } from './types'

/**
 * Query layer for the Discover Directory (the port of KOL Intelligence).
 *
 * autometric has no influencer/KOL table, so the entities a user browses here
 * are the social accounts the org already tracks: its own brand accounts
 * (`relation: 'owned'`) and every competitor account linked to one of its
 * brands (`relation: 'competitor'`). Metrics are aggregated from the same two
 * post tables Discovery Content reads, so the two pages always agree.
 *
 * Competitors are aggregated per account, not per link: `brand_competitors` is
 * many-to-many, so the post rollup is computed in its own subquery and joined
 * on, rather than grouped across a join that would multiply rows per brand.
 */
export async function listDirectory(
  orgId: string,
  brandId: string | null = null,
): Promise<DirectoryPayload> {
  const { rows } = await pool.query<{
    id: string; username: string; avatar_url: string | null; profile_url: string | null
    platform: string; relation: 'owned' | 'competitor'
    brand_id: string | null; brand_name: string | null
    post_count: string; total_views: string; total_likes: string
    // node-pg hydrates timestamptz into a Date, not a string — normalised below.
    total_comments: string; avg_er: number | null; last_post_at: Date | string | null
  }>(
    `
    WITH owned AS (
      SELECT DISTINCT ON (sa.id)
             sa.id, sa.username, sa.avatar_url, sa.profile_url,
             pl.key AS platform, 'owned'::text AS relation,
             b.id AS brand_id, b.name AS brand_name
        FROM public.brand_social_accounts bsa
        JOIN public.brands b          ON b.id  = bsa.brand_id AND b.deleted_at IS NULL
        JOIN public.social_accounts sa ON sa.id = bsa.social_account_id
        JOIN public.platforms pl       ON pl.id = sa.platform_id
       WHERE b.organization_id = $1
         AND ($2::uuid IS NULL OR bsa.brand_id = $2)
       ORDER BY sa.id, b.name
    ),
    comp AS (
      SELECT DISTINCT ON (sa.id)
             sa.id, sa.username, sa.avatar_url, sa.profile_url,
             pl.key AS platform, 'competitor'::text AS relation,
             b.id AS brand_id, b.name AS brand_name
        FROM public.brand_competitors bc
        JOIN public.brands b          ON b.id  = bc.brand_id AND b.deleted_at IS NULL
        JOIN public.social_accounts sa ON sa.id = bc.social_account_id
        JOIN public.platforms pl       ON pl.id = sa.platform_id
       WHERE b.organization_id = $1
         AND ($2::uuid IS NULL OR bc.brand_id = $2)
       ORDER BY sa.id, b.name
    ),
    accounts AS (SELECT * FROM owned UNION ALL SELECT * FROM comp),
    -- Rollups are per social account, computed before the join so a competitor
    -- tracked by two brands is still counted once.
    -- Tagged with a relation column because some accounts appear in BOTH
    -- post tables (a competitor account that also has rows in unified_post).
    -- Joining on account_id alone matched two stat rows per account and
    -- duplicated it in the grid; the pair (account_id, relation) is the real key.
    own_stats AS (
      SELECT p.brand_id AS account_id, 'owned'::text AS relation,
             COUNT(*)::bigint                                    AS post_count,
             COALESCE(SUM(p.views), 0)::bigint                   AS total_views,
             COALESCE(SUM(p.likes), 0)::bigint                   AS total_likes,
             COALESCE(SUM(p.comments), 0)::bigint                AS total_comments,
             (AVG(COALESCE(p.er_reach, p.er_views, p.er_followers, 0)) * 100)::float AS avg_er,
             MAX(p.post_date)::timestamptz                       AS last_post_at
        FROM l1_silver.unified_post p
       GROUP BY p.brand_id
    ),
    comp_stats AS (
      SELECT cp.social_account_id AS account_id, 'competitor'::text AS relation,
             COUNT(*)::bigint                        AS post_count,
             COALESCE(SUM(cp.view_count), 0)::bigint AS total_views,
             COALESCE(SUM(cp.like_count), 0)::bigint AS total_likes,
             COALESCE(SUM(cp.comment_count), 0)::bigint AS total_comments,
             (AVG(CASE WHEN COALESCE(cp.view_count,0) > 0
                       THEN (COALESCE(cp.like_count,0) + COALESCE(cp.comment_count,0) + COALESCE(cp.share_count,0))::numeric / cp.view_count
                       ELSE 0 END) * 100)::float      AS avg_er,
             MAX(cp.post_date)                        AS last_post_at
        FROM l1_silver.unified_competitor_post cp
       GROUP BY cp.social_account_id
    ),
    stats AS (SELECT * FROM own_stats UNION ALL SELECT * FROM comp_stats)
    SELECT a.id, a.username, a.avatar_url, a.profile_url, a.platform, a.relation,
           a.brand_id, a.brand_name,
           COALESCE(s.post_count, 0)::text     AS post_count,
           COALESCE(s.total_views, 0)::text    AS total_views,
           COALESCE(s.total_likes, 0)::text    AS total_likes,
           COALESCE(s.total_comments, 0)::text AS total_comments,
           COALESCE(s.avg_er, 0)               AS avg_er,
           s.last_post_at
      FROM accounts a
      LEFT JOIN stats s ON s.account_id = a.id AND s.relation = a.relation
     ORDER BY a.relation, COALESCE(s.total_views, 0) DESC, a.username`,
    [orgId, brandId],
  )

  const accounts: DirectoryAccount[] = rows.map(r => ({
    id: r.id,
    username: r.username ?? '—',
    avatarUrl: r.avatar_url,
    profileUrl: r.profile_url,
    platform: (r.platform ?? 'instagram') as DiscoverPlatform,
    relation: r.relation,
    brandId: r.brand_id,
    brandName: r.brand_name,
    postCount: Number(r.post_count),
    totalViews: Number(r.total_views),
    totalLikes: Number(r.total_likes),
    totalComments: Number(r.total_comments),
    avgErPct: Number(r.avg_er ?? 0),
    lastPostAt: toIso(r.last_post_at),
  }))

  return {
    accounts,
    platforms: [...new Set(accounts.map(a => a.platform))],
  }
}
