// Live post pool for the Visual Analysis slide, scoped to one org + brand + month,
// keyed by channel. Sourced from l1_silver.unified_post (post-level detail — format,
// content_pillar, per-post metrics, cover image). Sibling of kpiQuery / chartQuery.
import pool from '@/lib/db'
import { normFormat, normPillar, type PostCandidate, type ReportPostMetrics } from './posts'

/* eslint-disable @typescript-eslint/no-explicit-any */
const pad = (n: number) => String(n).padStart(2, '0')
const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`
const monthEndExcl = (y: number, m: number) => (m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`)

const num = (v: any) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))

// Broad recent pool so top/low ranking by any metric is meaningful client-side.
const LIMIT = 600

export async function getReportPostMetrics(
  orgId: string, brandId: string, year: number, month: number,
): Promise<ReportPostMetrics> {
  const start = monthStart(year, month)
  const end = monthEndExcl(year, month)

  const { rows } = await pool.query<Record<string, any>>(
    `SELECT p.id, p.platform, p.cover_image, p.format, p.content_pillar,
            COALESCE(p.follows,0)::float      follows,
            COALESCE(p.reach,0)::float        reach,
            COALESCE(p.impressions,0)::float  impressions,
            COALESCE(p.views,0)::float        views,
            COALESCE(p.engagement,0)::float   engagement,
            COALESCE(p.likes,0)::float        likes,
            COALESCE(p.comments,0)::float     comments,
            COALESCE(p.saves,0)::float        saves,
            COALESCE(p.shares,0)::float       shares,
            COALESCE(p.repost_count,0)::float reposts,
            COALESCE(p.er_reach,0)::float     er_reach,
            COALESCE(p.er_views,0)::float     er_views,
            COALESCE(p.er_followers,0)::float er_followers
       FROM l1_silver.unified_post p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND bsa.brand_id = $2
        AND p.post_date >= $3 AND p.post_date < $4
        AND p.platform IN ('instagram','facebook','tiktok')
      ORDER BY p.post_date DESC
      LIMIT ${LIMIT}`,
    [orgId, brandId, start, end],
  )

  const out: ReportPostMetrics = { instagram: [], facebook: [], tiktok: [] }
  for (const r of rows) {
    const f = normFormat(r.format)
    const pil = normPillar(r.content_pillar)
    // Awareness: Facebook reports impressions, Instagram/TikTok report views.
    const impressionsViews = r.platform === 'facebook' ? num(r.impressions) : num(r.views)
    const cand: PostCandidate = {
      id: Number(r.id),
      image: r.cover_image || null,
      formatId: f.id, format: f.label,
      pillarId: pil.id, pillar: pil.label,
      values: {
        new_follow: num(r.follows),
        reach: num(r.reach),
        impressions_views: impressionsViews,
        likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), saves: num(r.saves),
        reposts: num(r.reposts),
        engagement: num(r.engagement),
        // silver stores er_* as a fraction (0.088) → ×100 for percent display.
        er_reach: num(r.er_reach) * 100,
        er_views: num(r.er_views) * 100,
        er_followers: num(r.er_followers) * 100,
      },
    }
    ;(out[r.platform] ??= []).push(cand)
  }
  return out
}
