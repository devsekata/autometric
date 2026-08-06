import pool from '@/lib/db'
import type { DashBrand, DashPlatform } from '@/components/dashboard/data'

/**
 * Real brand list for the dashboard brand switcher, scoped to one org.
 * Aggregates each brand's connected social accounts:
 *   - platforms  : distinct platform keys (instagram/facebook/tiktok)
 *   - followers  : sum of the latest follower_count_eod across the brand's accounts
 *                  (l2_gold.brand_metric_daily, brand_id = public.brands.id — per docs §5)
 *   - handle     : a representative username (prefers Instagram)
 */

const COLORS = ['#327488', '#285D6E', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8', '#c79235', '#6f4e37']
const DASH_PLATFORMS: DashPlatform[] = ['instagram', 'facebook', 'tiktok']

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const ini = parts.slice(0, 2).map(w => w[0]).join('')
  return (ini || name.slice(0, 2)).toUpperCase()
}

export async function getDashboardBrands(orgId: string): Promise<DashBrand[]> {
  const { rows } = await pool.query<{
    id: string; name: string; platforms: string[] | null; followers: string; handle: string | null; profile_url: string | null
  }>(
    `WITH accts AS (
        SELECT bsa.brand_id, p.key AS platform, sa.username
          FROM public.brand_social_accounts bsa
          JOIN public.social_accounts sa ON sa.id = bsa.social_account_id
          JOIN public.platforms p ON p.id = bsa.platform_id
         WHERE p.key IN ('instagram','facebook','tiktok')
     ),
     brand_fol AS (
        SELECT brand_id, SUM(follower_count_eod)::bigint AS followers
          FROM (
            SELECT DISTINCT ON (bmd.brand_id, bmd.account_id, bmd.platform)
                   bmd.brand_id, bmd.follower_count_eod
              FROM l2_gold.brand_metric_daily bmd
             ORDER BY bmd.brand_id, bmd.account_id, bmd.platform, bmd.metric_date DESC
          ) x GROUP BY brand_id
     )
     SELECT b.id, b.name, b.profile_url,
            array_agg(DISTINCT af.platform ORDER BY af.platform) FILTER (WHERE af.platform IS NOT NULL) AS platforms,
            COALESCE(bf.followers, 0)::bigint AS followers,
            (array_agg(af.username ORDER BY CASE af.platform
                WHEN 'instagram' THEN 0 WHEN 'tiktok' THEN 1 ELSE 2 END)
              FILTER (WHERE af.username IS NOT NULL))[1] AS handle
       FROM public.brands b
       LEFT JOIN accts af ON af.brand_id = b.id
       LEFT JOIN brand_fol bf ON bf.brand_id = b.id
      WHERE b.organization_id = $1 AND b.deleted_at IS NULL
      GROUP BY b.id, b.name, bf.followers
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
    logo: r.profile_url,
  }))
}
