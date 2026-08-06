import pool from '@/lib/db'
import { windowsFromRange, type CustomRange } from './range'
import type { OverviewKpi, TrendSeries } from '@/components/dashboard/data'

/**
 * Gold-layer data access for the Stories dashboard, scoped to one organization.
 * All sections come from l2_gold.story_metric_daily (+ story_type_daily), which
 * roll up l1_silver.unified_story. `brand_id` = public.brands.id (umbrella brand).
 * In the current seed only Instagram has story data.
 */

export type PlatformParam = 'all' | 'instagram' | 'facebook' | 'tiktok'

export interface StoryFunnelStep { label: string; value: number; color: string }
export interface StoryTypeRow { type: string; reach: number; replies: number }

export interface StoriesPayload {
  kpis: OverviewKpi[]
  funnel: StoryFunnelStep[]
  funnelInsight: string
  typePerf: StoryTypeRow[]
  typeInsight: string
  overTime: TrendSeries[]
  overTimeLabels: string[]
  empty: boolean
}

// funnel colors mirror the original design
const FUNNEL_COLORS: Record<string, string> = {
  Views: '#6c4cd6', 'Taps Back': '#285D6E', 'Taps Fwd': '#3d7eea',
  Exits: '#d6556f', Replies: '#d23f6f', 'Swipe-Up': '#5fa783',
}
const TYPE_LABEL: Record<string, string> = { IMAGE: 'Static Image', VIDEO: 'Video' }
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function fmtNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0)
function deltaStr(cur: number, prev: number): { delta: string; good: boolean } {
  if (prev <= 0) return { delta: cur > 0 ? 'new' : '0%', good: cur >= 0 }
  const d = ((cur - prev) / prev) * 100
  return { delta: `${d >= 0 ? '+' : ''}${d.toFixed(d >= 10 || d <= -10 ? 0 : 1)}%`, good: d >= 0 }
}
// rate delta in points; `lowerIsGood` flips the colour (e.g. exit rate)
function ptsStr(cur: number, prev: number, lowerIsGood = false) {
  const d = cur - prev
  return { delta: `${d >= 0 ? '+' : ''}${d.toFixed(1)}pts`, good: lowerIsGood ? d <= 0 : d >= 0, dir: (d >= 0 ? 'up' : 'down') as 'up' | 'down' }
}

const PLAT = `($2 = 'all' OR {col}.platform = $2)`

interface Window { start: string; end: string }

async function resolveWindows(orgId: string, platform: PlatformParam, days: number, brandId: string | null, custom: CustomRange | null = null) {
  if (custom) return windowsFromRange(custom)
  const { rows } = await pool.query<{ d: string | null }>(
    `SELECT to_char(max(s.metric_date), 'YYYY-MM-DD') d
       FROM l2_gold.story_metric_daily s
       JOIN public.brands b ON b.id = s.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 's')})
        AND ($3::uuid IS NULL OR s.brand_id = $3)`,
    [orgId, platform, brandId],
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

interface Totals { stories: number; reach: number; views: number; exits: number; swipe: number }

async function totals(orgId: string, platform: PlatformParam, w: Window, brandId: string | null): Promise<Totals> {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(s.story_count),0)::float   stories,
        COALESCE(SUM(s.reach_sum),0)::float     reach,
        COALESCE(SUM(s.views_sum),0)::float     views,
        COALESCE(SUM(s.exits_sum),0)::float     exits,
        COALESCE(SUM(s.swipe_up_sum),0)::float  swipe
       FROM l2_gold.story_metric_daily s
       JOIN public.brands b ON b.id = s.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 's')})
        AND s.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR s.brand_id = $5)`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return rows[0]
}

async function dailySparks(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ stories: number; reach: number; views: number; exits: number; swipe: number }>(
    `SELECT
        COALESCE(SUM(s.story_count),0)::float   stories,
        COALESCE(SUM(s.reach_sum),0)::float     reach,
        COALESCE(SUM(s.views_sum),0)::float     views,
        COALESCE(SUM(s.exits_sum),0)::float     exits,
        COALESCE(SUM(s.swipe_up_sum),0)::float  swipe
       FROM l2_gold.story_metric_daily s
       JOIN public.brands b ON b.id = s.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 's')})
        AND s.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR s.brand_id = $5)
      GROUP BY s.metric_date ORDER BY s.metric_date`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return {
    stories: rows.map(r => Math.round(r.stories)),
    avgReach: rows.map(r => Math.round(r.stories > 0 ? r.reach / r.stories : 0)),
    swipeRate: rows.map(r => +pct(r.swipe, r.reach).toFixed(2)),
    exitRate: rows.map(r => +pct(r.exits, r.views).toFixed(2)),
  }
}

function buildKpis(cur: Totals, prev: Totals, s: Awaited<ReturnType<typeof dailySparks>>): OverviewKpi[] {
  const avgReachCur = cur.stories > 0 ? cur.reach / cur.stories : 0
  const avgReachPrev = prev.stories > 0 ? prev.reach / prev.stories : 0
  const swipeCur = pct(cur.swipe, cur.reach), swipePrev = pct(prev.swipe, prev.reach)
  const exitCur = pct(cur.exits, cur.views), exitPrev = pct(prev.exits, prev.views)
  return [
    { key: 's-pub', label: 'Stories Published', icon: 'amp_stories', value: fmtNum(cur.stories), ...deltaStr(cur.stories, prev.stories), spark: s.stories.length ? s.stories : [0] },
    { key: 's-reach', label: 'Avg. Story Reach', icon: 'ads_click', value: fmtNum(avgReachCur), ...deltaStr(avgReachCur, avgReachPrev), spark: s.avgReach.length ? s.avgReach : [0] },
    { key: 's-swipe', label: 'Swipe-Up Rate', icon: 'swipe_up', value: `${swipeCur.toFixed(1)}%`, ...ptsStr(swipeCur, swipePrev), spark: s.swipeRate.length ? s.swipeRate : [0] },
    { key: 's-exit', label: 'Exit Rate (avg)', icon: 'logout', value: `${Math.round(exitCur)}%`, ...ptsStr(exitCur, exitPrev, true), spark: s.exitRate.length ? s.exitRate : [0] },
  ]
}

async function funnel(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const t = await totals(orgId, platform, w, brandId)
  const { rows } = await pool.query<{ taps_back: number; taps_fwd: number; replies: number }>(
    `SELECT COALESCE(SUM(s.taps_back_sum),0)::float taps_back,
            COALESCE(SUM(s.taps_fwd_sum),0)::float  taps_fwd,
            COALESCE(SUM(s.replies_sum),0)::float   replies
       FROM l2_gold.story_metric_daily s
       JOIN public.brands b ON b.id = s.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 's')})
        AND s.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR s.brand_id = $5)`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const r = rows[0]
  const steps: StoryFunnelStep[] = [
    { label: 'Views', value: Math.round(t.views), color: FUNNEL_COLORS.Views },
    { label: 'Taps Back', value: Math.round(r.taps_back), color: FUNNEL_COLORS['Taps Back'] },
    { label: 'Taps Fwd', value: Math.round(r.taps_fwd), color: FUNNEL_COLORS['Taps Fwd'] },
    { label: 'Exits', value: Math.round(t.exits), color: FUNNEL_COLORS.Exits },
    { label: 'Replies', value: Math.round(r.replies), color: FUNNEL_COLORS.Replies },
    { label: 'Swipe-Up', value: Math.round(t.swipe), color: FUNNEL_COLORS['Swipe-Up'] },
  ]
  const fwdRate = pct(r.taps_fwd, t.views)
  const insight = t.views > 0
    ? `${Math.round(fwdRate)}% tap-forward${fwdRate >= 40 ? ' — story banyak dilewati; perkuat hook di frame pertama atau pendekkan sekuens.' : ' — retensi sekuens sehat.'}`
    : 'Belum ada data story pada periode ini.'
  return { funnel: steps, funnelInsight: insight }
}

async function typePerf(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ story_type: string; reach: number; replies: number; cnt: number }>(
    `SELECT s.story_type,
            COALESCE(SUM(s.reach_sum),0)::float   reach,
            COALESCE(SUM(s.replies_sum),0)::float replies,
            COALESCE(SUM(s.story_count),0)::float cnt
       FROM l2_gold.story_type_daily s
       JOIN public.brands b ON b.id = s.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 's')})
        AND s.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR s.brand_id = $5)
      GROUP BY s.story_type
      ORDER BY reach DESC`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const types: StoryTypeRow[] = rows.map(r => ({
    type: TYPE_LABEL[r.story_type] ?? r.story_type,
    reach: Math.round(r.cnt > 0 ? r.reach / r.cnt : 0),
    replies: Math.round(r.cnt > 0 ? r.replies / r.cnt : 0),
  }))
  // finding: type with the highest replies-per-reach (interaction efficiency)
  const ranked = rows
    .map(r => ({ label: TYPE_LABEL[r.story_type] ?? r.story_type, rate: pct(r.replies, r.reach) }))
    .sort((a, b) => b.rate - a.rate)
  const insight = ranked[0]
    ? `${ranked[0].label} menghasilkan rasio reply-per-reach tertinggi — format story dengan interaksi paling kuat.`
    : 'Belum ada data tipe story pada periode ini.'
  return { typePerf: types, typeInsight: insight }
}

const fmtDateLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MONTH_ABBR[+m - 1]}` }

async function overTime(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ wk: string; views: number; exits: number; swipe: number }>(
    `SELECT to_char(date_trunc('week', s.metric_date), 'YYYY-MM-DD') wk,
            COALESCE(SUM(s.views_sum),0)::float    views,
            COALESCE(SUM(s.exits_sum),0)::float    exits,
            COALESCE(SUM(s.swipe_up_sum),0)::float swipe
       FROM l2_gold.story_metric_daily s
       JOIN public.brands b ON b.id = s.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 's')})
        AND s.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR s.brand_id = $5)
      GROUP BY date_trunc('week', s.metric_date)
      ORDER BY date_trunc('week', s.metric_date)`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const labels = rows.map(r => fmtDateLabel(r.wk))
  const series: TrendSeries[] = [
    { name: 'Views', color: '#d23f6f', data: rows.map(r => Math.round(r.views)) },
    { name: 'Exits', color: '#e0a458', data: rows.map(r => Math.round(r.exits)) },
    { name: 'Swipe-Ups', color: '#5fa783', data: rows.map(r => Math.round(r.swipe)) },
  ]
  return { overTime: series, overTimeLabels: labels.length ? labels : [''] }
}

export async function getStoriesData(
  orgId: string, platform: PlatformParam, days: number, brandId: string | null = null,
  custom: CustomRange | null = null,
): Promise<StoriesPayload> {
  const win = await resolveWindows(orgId, platform, days, brandId, custom)
  if (!win) {
    return {
      kpis: [], funnel: [], funnelInsight: '', typePerf: [], typeInsight: '',
      overTime: [], overTimeLabels: [''], empty: true,
    }
  }
  const [curT, prevT, sparks, fun, types, ot] = await Promise.all([
    totals(orgId, platform, win.cur, brandId),
    totals(orgId, platform, win.prev, brandId),
    dailySparks(orgId, platform, win.cur, brandId),
    funnel(orgId, platform, win.cur, brandId),
    typePerf(orgId, platform, win.cur, brandId),
    overTime(orgId, platform, win.cur, brandId),
  ])
  return {
    kpis: buildKpis(curT, prevT, sparks),
    ...fun,
    ...types,
    ...ot,
    empty: false,
  }
}
