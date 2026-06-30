import pool from '@/lib/db'
import type { DashBrand, DashPlatform } from '@/components/dashboard/data'

/**
 * Real brand list for the dashboard brand switcher, scoped to one org.
 * Aggregates each brand's connected social accounts:
 *   - platforms  : distinct platform keys (instagram/facebook/tiktok)
 *   - followers  : sum of the latest follower_count across the brand's accounts
 *                  (l1_silver.unified_profile, where brand_id = social_accounts.id)
 *   - handle     : a representative username (prefers Instagram)
 */

const COLORS = ['#1e4f49', '#3d7e96', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8', '#c79235', '#6f4e37']
const DASH_PLATFORMS: DashPlatform[] = ['instagram', 'facebook', 'tiktok']

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const ini = parts.slice(0, 2).map(w => w[0]).join('')
  return (ini || name.slice(0, 2)).toUpperCase()
}

export async function getDashboardBrands(orgId: string): Promise<DashBrand[]> {
  const { rows } = await pool.query<{
    id: string; name: string; platforms: string[] | null; followers: string; handle: string | null
  }>(
    `WITH accts AS (
        SELECT bsa.brand_id, p.key AS platform, sa.id AS account_id, sa.username
          FROM public.brand_social_accounts bsa
          JOIN public.social_accounts sa ON sa.id = bsa.social_account_id
          JOIN public.platforms p ON p.id = bsa.platform_id
         WHERE p.key IN ('instagram','facebook','tiktok')
     ),
     fol AS (
        SELECT DISTINCT ON (up.brand_id) up.brand_id AS account_id, up.follower_count
          FROM l1_silver.unified_profile up
         ORDER BY up.brand_id, up.profile_date DESC
     ),
     acct_fol AS (
        SELECT a.brand_id, a.platform, a.username, COALESCE(f.follower_count, 0) AS followers
          FROM accts a LEFT JOIN fol f ON f.account_id = a.account_id
     )
     SELECT b.id, b.name,
            array_agg(DISTINCT af.platform ORDER BY af.platform) FILTER (WHERE af.platform IS NOT NULL) AS platforms,
            COALESCE(SUM(af.followers), 0)::bigint AS followers,
            (array_agg(af.username ORDER BY CASE af.platform
                WHEN 'instagram' THEN 0 WHEN 'tiktok' THEN 1 ELSE 2 END)
              FILTER (WHERE af.username IS NOT NULL))[1] AS handle
       FROM public.brands b
       LEFT JOIN acct_fol af ON af.brand_id = b.id
      WHERE b.organization_id = $1
      GROUP BY b.id, b.name
      ORDER BY followers DESC, b.name`,
    [orgId],
  )

  return rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    handle: r.handle ? '@' + r.handle.replace(/^@/, '') : '',
    initials: initials(r.name),
    color: COLORS[i % COLORS.length],
    followers: Number(r.followers) || 0,
    platforms: (r.platforms ?? []).filter((p): p is DashPlatform => DASH_PLATFORMS.includes(p as DashPlatform)),
  }))
}
