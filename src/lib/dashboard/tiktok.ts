import pool from '@/lib/db'
import { windowsFromRange, type CustomRange } from './range'
import type { OverviewKpi } from '@/components/dashboard/data'

/**
 * Data access for the TikTok Deep dashboard, scoped to one organization.
 * This tab is inherently TikTok-only, so the platform toggle is ignored — every
 * query is scoped to TikTok.
 *
 *  - KPIs + Follower Churn : l2_gold.tiktok_churn_daily (brand_id = public.brands.id)
 *  - Completion + duration scatter : l2_gold.post_metric (platform='tiktok';
 *    brand_id = social_accounts.id → scope via brand_social_accounts)
 *  - Avg watch time by pillar : l2_gold.pillar_performance_daily (brand_id = umbrella)
 */

export type PlatformParam = 'all' | 'instagram' | 'facebook' | 'tiktok'

export interface TiktokPayload {
  kpis: OverviewKpi[]
  churnWeeks: { label: string; gained: number; lost: number }[]
  churnTotals: { gained: number; lost: number; net: number }
  churnInsight: string
  durationCompletion: { x: number; y: number }[]
  watchByPillar: { label: string; value: number; color: string }[]
  watchInsight: string
  empty: boolean
}

const PALETTE = ['#1B8A80', '#e0a458', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const CR_NUM = `NULLIF(regexp_replace({col}.completion_rate, '[^0-9.]', '', 'g'), '')::numeric`
const fmtDateLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MONTH_ABBR[+m - 1]}` }

function fmtNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0)
function deltaStr(cur: number, prev: number, lowerIsGood = false): { delta: string; good: boolean; dir: 'up' | 'down' } {
  const dir = (cur >= prev ? 'up' : 'down') as 'up' | 'down'
  if (prev <= 0) return { delta: cur > 0 ? 'new' : '0%', good: lowerIsGood ? cur <= 0 : cur >= 0, dir }
  const d = ((cur - prev) / prev) * 100
  const up = d >= 0
  return { delta: `${up ? '+' : ''}${d.toFixed(d >= 10 || d <= -10 ? 0 : 1)}%`, good: lowerIsGood ? !up : up, dir }
}
function ptsStr(cur: number, prev: number): { delta: string; good: boolean; dir: 'up' | 'down' } {
  const d = cur - prev
  return { delta: `${d >= 0 ? '+' : ''}${d.toFixed(1)}pts`, good: d >= 0, dir: (d >= 0 ? 'up' : 'down') }
}

interface Window { start: string; end: string }

async function resolveWindows(orgId: string, days: number, brandId: string | null, custom: CustomRange | null = null) {
  if (custom) return windowsFromRange(custom)
  const { rows } = await pool.query<{ d: string | null }>(
    `SELECT to_char(max(t.metric_date), 'YYYY-MM-DD') d
       FROM l2_gold.tiktok_churn_daily t
       JOIN public.brands b ON b.id = t.brand_id
      WHERE b.organization_id = $1 AND ($2::uuid IS NULL OR t.brand_id = $2)`,
    [orgId, brandId],
  )
  const anchor = rows[0]?.d
  if (!anchor) return null
  const a = new Date(anchor + 'T00:00:00Z')
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minus = (base: Date, n: number) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return d }
  const cur: Window = { start: iso(minus(a, days - 1)), end: anchor }
  const prev: Window = { start: iso(minus(a, days * 2 - 1)), end: iso(minus(a, days)) }
  return { anchor, cur, prev }
}

// ── churn totals (gold) ───────────────────────────────────────────────────────
interface ChurnTotals { views: number; gained: number; lost: number; net: number }

async function churnTotals(orgId: string, w: Window, brandId: string | null): Promise<ChurnTotals> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(t.video_views_sum),0)::float views,
            COALESCE(SUM(t.new_followers),0)::float    gained,
            COALESCE(SUM(t.lost_followers),0)::float   lost,
            COALESCE(SUM(t.net_growth),0)::float       net
       FROM l2_gold.tiktok_churn_daily t
       JOIN public.brands b ON b.id = t.brand_id
      WHERE b.organization_id = $1 AND t.metric_date BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR t.brand_id = $4)`,
    [orgId, w.start, w.end, brandId],
  )
  return rows[0]
}

// avg TikTok completion rate (silver) over a window
async function avgCompletion(orgId: string, w: Window, brandId: string | null): Promise<number> {
  const { rows } = await pool.query<{ c: number | null }>(
    `SELECT AVG(${CR_NUM.replace('{col}', 'p')})::float c
       FROM l2_gold.post_metric p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND p.platform = 'tiktok'
        AND p.post_date::date BETWEEN $2 AND $3 AND p.completion_rate IS NOT NULL
        AND ($4::uuid IS NULL OR bsa.brand_id = $4)`,
    [orgId, w.start, w.end, brandId],
  )
  return rows[0]?.c ?? 0
}

async function dailySparks(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ views: number; gained: number; lost: number; net: number }>(
    `SELECT COALESCE(SUM(t.video_views_sum),0)::float views,
            COALESCE(SUM(t.new_followers),0)::float    gained,
            COALESCE(SUM(t.lost_followers),0)::float   lost,
            COALESCE(SUM(t.net_growth),0)::float       net
       FROM l2_gold.tiktok_churn_daily t
       JOIN public.brands b ON b.id = t.brand_id
      WHERE b.organization_id = $1 AND t.metric_date BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR t.brand_id = $4)
      GROUP BY t.metric_date ORDER BY t.metric_date`,
    [orgId, w.start, w.end, brandId],
  )
  const { rows: comp } = await pool.query<{ c: number | null }>(
    `SELECT AVG(${CR_NUM.replace('{col}', 'p')})::float c
       FROM l2_gold.post_metric p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND p.platform = 'tiktok'
        AND p.post_date::date BETWEEN $2 AND $3 AND p.completion_rate IS NOT NULL
        AND ($4::uuid IS NULL OR bsa.brand_id = $4)
      GROUP BY p.post_date::date ORDER BY p.post_date::date`,
    [orgId, w.start, w.end, brandId],
  )
  let cum = 0
  return {
    views: rows.map(r => Math.round(r.views)),
    gained: rows.map(r => Math.round(r.gained)),
    lost: rows.map(r => Math.round(r.lost)),
    netCum: rows.map(r => (cum += r.net, Math.round(cum))),
    completion: comp.map(r => +(r.c ?? 0).toFixed(1)),
  }
}

function buildKpis(cur: ChurnTotals, prev: ChurnTotals, complCur: number, complPrev: number, s: Awaited<ReturnType<typeof dailySparks>>): OverviewKpi[] {
  return [
    { key: 'tk-views', label: 'Total Video Views', icon: 'play_circle', value: fmtNum(cur.views), ...deltaStr(cur.views, prev.views), spark: s.views.length ? s.views : [0] },
    { key: 'tk-new', label: 'New Followers', icon: 'person_add', value: fmtNum(cur.gained), ...deltaStr(cur.gained, prev.gained), spark: s.gained.length ? s.gained : [0] },
    { key: 'tk-lost', label: 'Lost Followers', icon: 'person_remove', value: fmtNum(cur.lost), ...deltaStr(cur.lost, prev.lost, true), spark: s.lost.length ? s.lost : [0] },
    { key: 'tk-net', label: 'Net Growth', icon: 'trending_up', value: `${cur.net >= 0 ? '+' : ''}${fmtNum(cur.net)}`, ...deltaStr(cur.net, prev.net), spark: s.netCum.length ? s.netCum : [0] },
    { key: 'tk-compl', label: 'Avg. Completion Rate', icon: 'check_circle', value: `${Math.round(complCur)}%`, ...ptsStr(complCur, complPrev), spark: s.completion.length ? s.completion : [0] },
  ]
}

// ── follower churn weekly (gold) ──────────────────────────────────────────────
async function churnWeekly(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ wk: string; gained: number; lost: number }>(
    `SELECT to_char(date_trunc('week', t.metric_date), 'YYYY-MM-DD') wk,
            COALESCE(SUM(t.new_followers),0)::int  gained,
            COALESCE(SUM(t.lost_followers),0)::int lost
       FROM l2_gold.tiktok_churn_daily t
       JOIN public.brands b ON b.id = t.brand_id
      WHERE b.organization_id = $1 AND t.metric_date BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR t.brand_id = $4)
      GROUP BY date_trunc('week', t.metric_date)
      ORDER BY date_trunc('week', t.metric_date)`,
    [orgId, w.start, w.end, brandId],
  )
  const churnWeeks = rows.map(r => ({ label: fmtDateLabel(r.wk), gained: r.gained, lost: r.lost }))
  // insight: week with the biggest lost-follower spike vs the prior week
  let worst = { i: -1, jump: 0 }
  for (let i = 1; i < churnWeeks.length; i++) {
    const prev = churnWeeks[i - 1].lost
    if (prev > 0) {
      const jump = (churnWeeks[i].lost - prev) / prev
      if (jump > worst.jump) worst = { i, jump }
    }
  }
  const insight = worst.i >= 0 && worst.jump >= 0.2
    ? `Volume lost follower melonjak +${Math.round(worst.jump * 100)}% di ${churnWeeks[worst.i].label} — biasanya bertepatan dengan jeda posting; jaga ≥1 post/hari di TikTok.`
    : churnWeeks.length
      ? 'Churn follower relatif stabil antar minggu pada periode ini.'
      : 'Belum ada data churn pada periode ini.'
  return { churnWeeks, churnInsight: insight }
}

// ── duration vs completion scatter (silver) ───────────────────────────────────
async function durationCompletion(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ x: number; y: number }>(
    `SELECT p.duration_s::float x, ${CR_NUM.replace('{col}', 'p')}::float y
       FROM l2_gold.post_metric p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND p.platform = 'tiktok'
        AND p.post_date::date BETWEEN $2 AND $3
        AND p.duration_s > 0 AND p.completion_rate IS NOT NULL
        AND ($4::uuid IS NULL OR bsa.brand_id = $4)
      ORDER BY p.duration_s`,
    [orgId, w.start, w.end, brandId],
  )
  return rows.map(r => ({ x: Math.round(r.x), y: Math.min(100, Math.round(r.y)) }))
}

// ── avg watch time by content pillar (gold pillar_performance_daily) ──────────
async function watchByPillar(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ pillar: string; awt: number }>(
    `SELECT pp.content_pillar pillar,
            (SUM(pp.watch_time_sum) / NULLIF(SUM(pp.post_count),0))::float awt
       FROM l2_gold.pillar_performance_daily pp
       JOIN public.brands b ON b.id = pp.brand_id
      WHERE b.organization_id = $1 AND pp.platform = 'tiktok'
        AND pp.metric_date BETWEEN $2 AND $3
        AND pp.content_pillar IS NOT NULL
        AND ($4::uuid IS NULL OR pp.brand_id = $4)
      GROUP BY pp.content_pillar
      ORDER BY awt DESC NULLS LAST`,
    [orgId, w.start, w.end, brandId],
  )
  const watchByPillar = rows.map((r, i) => ({ label: r.pillar, value: +r.awt.toFixed(1), color: PALETTE[i % PALETTE.length] }))
  const [top, ...rest] = watchByPillar
  const bottom = rest[rest.length - 1]
  const insight = top
    ? bottom
      ? `Pillar ${top.label} menahan rata-rata watch time ${top.value}s vs ${bottom.value}s untuk ${bottom.label} — narasi mengalahkan hard-sell.`
      : `Pillar ${top.label} mencatat rata-rata watch time tertinggi (${top.value}s).`
    : 'Belum ada data watch time per pillar pada periode ini.'
  return { watchByPillar, watchInsight: insight }
}

export async function getTiktokData(
  orgId: string, _platform: PlatformParam, days: number, brandId: string | null = null,
  custom: CustomRange | null = null,
): Promise<TiktokPayload> {
  const win = await resolveWindows(orgId, days, brandId, custom)
  if (!win) {
    return {
      kpis: [], churnWeeks: [], churnTotals: { gained: 0, lost: 0, net: 0 }, churnInsight: '',
      durationCompletion: [], watchByPillar: [], watchInsight: '', empty: true,
    }
  }
  const [curT, prevT, complCur, complPrev, sparks, weekly, scatter, pillar] = await Promise.all([
    churnTotals(orgId, win.cur, brandId),
    churnTotals(orgId, win.prev, brandId),
    avgCompletion(orgId, win.cur, brandId),
    avgCompletion(orgId, win.prev, brandId),
    dailySparks(orgId, win.cur, brandId),
    churnWeekly(orgId, win.cur, brandId),
    durationCompletion(orgId, win.cur, brandId),
    watchByPillar(orgId, win.cur, brandId),
  ])
  return {
    kpis: buildKpis(curT, prevT, complCur, complPrev, sparks),
    ...weekly,
    churnTotals: { gained: Math.round(curT.gained), lost: Math.round(curT.lost), net: Math.round(curT.net) },
    durationCompletion: scatter,
    ...pillar,
    empty: false,
  }
}
