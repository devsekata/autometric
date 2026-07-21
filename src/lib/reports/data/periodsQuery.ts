// Which (year, month) periods actually have report data for a brand — used by the
// report setup to disable empty periods and default to the latest one with data.
// A period counts as "has data" when it has posts (l1_silver.unified_post) OR daily
// profile aggregates (l2_gold.brand_metric_daily), matching the report's sources.
import pool from '@/lib/db'

export interface AvailablePeriod { year: number; month: number }

export async function getReportAvailablePeriods(orgId: string, brandId: string): Promise<AvailablePeriod[]> {
  const { rows } = await pool.query<{ y: number; m: number }>(
    `SELECT DISTINCT y, m FROM (
        SELECT EXTRACT(YEAR FROM p.post_date)::int y, EXTRACT(MONTH FROM p.post_date)::int m
          FROM l1_silver.unified_post p
          JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
          JOIN public.brands b ON b.id = bsa.brand_id
         WHERE b.organization_id = $1 AND bsa.brand_id = $2
           AND p.platform IN ('instagram','facebook','tiktok')
        UNION
        SELECT EXTRACT(YEAR FROM bmd.metric_date)::int y, EXTRACT(MONTH FROM bmd.metric_date)::int m
          FROM l2_gold.brand_metric_daily bmd
          JOIN public.brands b ON b.id = bmd.brand_id
         WHERE b.organization_id = $1 AND bmd.brand_id = $2
           AND bmd.platform IN ('instagram','facebook','tiktok')
     ) t
     ORDER BY y DESC, m DESC`,
    [orgId, brandId],
  )
  return rows.map(r => ({ year: r.y, month: r.m }))
}
