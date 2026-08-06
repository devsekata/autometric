import pool from '@/lib/db'

/**
 * Content Pillars dashboard data access, per docs §5 Content Pillars:
 *  - Define Pillars (CRUD) : l2_gold.dim_content_pillar (read-write; brand_id = umbrella)
 *  - Comparison Output      : l2_gold.pillar_performance_daily (ER + posts per pillar)
 * Pillars are per-brand. Add = insert/reactivate; delete = soft (is_active=false) so a
 * pipeline re-seed (ON CONFLICT DO NOTHING) doesn't resurrect it.
 */

export interface PillarRow { id: string; name: string; color: string; hashtags: string[] }
export interface PillarComparison { name: string; color: string; er: number; posts: number }
export interface PillarsPayload { pillars: PillarRow[]; comparison: PillarComparison[] }

const DEFAULT_COLORS = ['#6c4cd6', '#d23f6f', '#3d7eea', '#5fa783', '#e0a458', '#8b5cf6', '#285D6E', '#d97a7a']
const colorFor = (name: string, given: string | null): string =>
  given || DEFAULT_COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % DEFAULT_COLORS.length]

/** True when the brand belongs to the org (guards every write). */
async function brandInOrg(orgId: string, brandId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM public.brands WHERE id = $1 AND organization_id = $2', [brandId, orgId])
  return rows.length > 0
}

export async function getPillarsData(orgId: string, brandId: string | null): Promise<PillarsPayload> {
  const [dim, perf] = await Promise.all([
    pool.query<{ id: string; content_pillar: string; color: string | null; hashtags: string[] }>(
      `SELECT d.id::text id, d.content_pillar, d.color, d.hashtags
         FROM l2_gold.dim_content_pillar d
         JOIN public.brands b ON b.id = d.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND d.is_active
          AND ($2::uuid IS NULL OR d.brand_id = $2)
        ORDER BY d.display_order NULLS LAST, d.content_pillar`,
      [orgId, brandId],
    ),
    pool.query<{ content_pillar: string; posts: number; eng: number; den: number }>(
      `SELECT pp.content_pillar,
              SUM(pp.post_count)::int posts,
              SUM(pp.engagement_sum)::float eng,
              SUM(pp.er_denominator_sum)::float den
         FROM l2_gold.pillar_performance_daily pp
         JOIN public.brands b ON b.id = pp.brand_id AND b.deleted_at IS NULL
        WHERE b.organization_id = $1 AND pp.content_pillar IS NOT NULL
          AND ($2::uuid IS NULL OR pp.brand_id = $2)
        GROUP BY pp.content_pillar`,
      [orgId, brandId],
    ),
  ])

  const pillars: PillarRow[] = dim.rows.map(r => ({
    id: r.id, name: r.content_pillar, color: colorFor(r.content_pillar, r.color), hashtags: r.hashtags ?? [],
  }))

  const perfByName = new Map(perf.rows.map(r => [r.content_pillar, r]))
  const comparison: PillarComparison[] = pillars.map(p => {
    const m = perfByName.get(p.name)
    const er = m && m.den > 0 ? (m.eng / m.den) * 100 : 0
    return { name: p.name, color: p.color, er: +er.toFixed(1), posts: m?.posts ?? 0 }
  }).sort((a, b) => b.er - a.er)

  return { pillars, comparison }
}

/** Add a pillar (or reactivate/update an existing one for the brand). */
export async function upsertPillar(orgId: string, brandId: string, name: string, color: string, hashtags: string[]): Promise<boolean> {
  if (!(await brandInOrg(orgId, brandId))) return false
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM l2_gold.dim_content_pillar WHERE brand_id = $1 AND content_pillar = $2',
    [brandId, name],
  )
  if (existing.rows.length) {
    await pool.query(
      `UPDATE l2_gold.dim_content_pillar SET color = $3, hashtags = $4::text[], is_active = true, updated_at = now()
        WHERE brand_id = $1 AND content_pillar = $2`,
      [brandId, name, color, hashtags],
    )
  } else {
    await pool.query(
      `INSERT INTO l2_gold.dim_content_pillar (brand_id, content_pillar, color, hashtags, is_active)
       VALUES ($1, $2, $3, $4::text[], true)`,
      [brandId, name, color, hashtags],
    )
  }
  return true
}

/** Soft-delete a pillar (is_active=false), scoped to the org's brand. */
export async function deletePillar(orgId: string, brandId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE l2_gold.dim_content_pillar d SET is_active = false, updated_at = now()
       FROM public.brands b
      WHERE d.id = $1::bigint AND d.brand_id = b.id AND b.id = $2::uuid AND b.organization_id = $3
        AND b.deleted_at IS NULL`,
    [id, brandId, orgId],
  )
  return (rowCount ?? 0) > 0
}
