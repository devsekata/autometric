import pool from '@/lib/db'
import type { PlatformParam } from './overview'

/**
 * Earliest/latest gold metric dates available for an org, optionally scoped to a
 * brand and/or platform. Used to bound the dashboard's custom date picker so the
 * user can only pick ranges that actually have data. Anchored on
 * brand_metric_daily — the primary daily-metrics table shared across most tabs.
 */
export async function getDataDateRange(
  orgId: string,
  platform: PlatformParam,
  brandId: string | null,
): Promise<{ min: string | null; max: string | null }> {
  const { rows } = await pool.query<{ min: string | null; max: string | null }>(
    `SELECT to_char(min(bmd.metric_date), 'YYYY-MM-DD') AS min,
            to_char(max(bmd.metric_date), 'YYYY-MM-DD') AS max
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1
        AND ($2 = 'all' OR bmd.platform = $2)
        AND ($3::uuid IS NULL OR bmd.brand_id = $3)`,
    [orgId, platform, brandId],
  )
  return { min: rows[0]?.min ?? null, max: rows[0]?.max ?? null }
}
