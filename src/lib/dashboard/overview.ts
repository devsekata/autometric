import pool from '@/lib/db'
import { windowsFromRange, type CustomRange } from './range'
import type {
  OverviewKpi, TrendSeries, TrendMetric, DashPlatform, BrandMatrixRow, ContentAttribute,
} from '@/components/dashboard/data'

/**
 * Gold-layer data access for the Overview dashboard, scoped to one organization.
 *
 * Grain note: in l2_gold, `brand_id` = public.brands.id (umbrella brand), so org
 * scoping joins brands directly. In l1_silver, `brand_id` = social_accounts.id, so
 * scoping there hops through brand_social_accounts -> brands. Followers use
 * brand_metric_daily.follower_count_eod; the posting heatmap uses
 * posting_time_heatmap (all-time, per-account) — both gold.
 */

export type PlatformParam = 'all' | DashPlatform

export interface OverviewPayload {
  kpis: OverviewKpi[]
  engagementOverTime: Record<TrendMetric, TrendSeries[]>
  trendLabels: string[]
  platformReachShare: { platform: DashPlatform; value: number }[]
  brandMatrix: BrandMatrixRow[]
  contentAttributes: ContentAttribute[]
  contentAttrFinding: string
  postingHeatmap: number[][]
  postingWindowInsight: string
  empty: boolean
}

const PALETTE = ['#285D6E', '#e0a458', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8']
const ATTR_COLORS = ['#5fa783', '#e0a458', '#d97a7a', '#8b7fc7', '#285D6E', '#5b94b8', '#c79235', '#9ca3af']

const TAG_LABEL: Record<string, string> = {
  organic: 'Organic', boosted: 'Boosted Posts', collab: 'Collabs', campaign: 'Campaign',
  aon: 'AON Posts', activity: 'Activity', event: 'Event', repost: 'Repost',
}

// ── formatters ──────────────────────────────────────────────────────────────
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
  const sign = d >= 0 ? '+' : ''
  return { delta: `${sign}${d.toFixed(d >= 10 || d <= -10 ? 0 : 1)}%`, good: d >= 0 }
}

// platform filter fragment uses $2; queries share param order [orgId, platform, start, end]
const PLAT = `($2 = 'all' OR {col}.platform = $2)`

interface Window { start: string; end: string }

// ── anchor + windows ──────────────────────────────────────────────────────────
async function resolveWindows(orgId: string, platform: PlatformParam, days: number, brandId: string | null, custom: CustomRange | null = null) {
  if (custom) return windowsFromRange(custom)
  const { rows } = await pool.query<{ d: string | null }>(
    `SELECT to_char(max(bmd.metric_date), 'YYYY-MM-DD') d
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND ($3::uuid IS NULL OR bmd.brand_id = $3)`,
    [orgId, platform, brandId],
  )
  const anchor = rows[0]?.d
  if (!anchor) return null
  const a = new Date(anchor + 'T00:00:00Z')
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minus = (base: Date, n: number) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return d }
  const cur: Window = { start: iso(minus(a, days - 1)), end: anchor }
  const prev: Window = { start: iso(minus(a, days * 2 - 1)), end: iso(minus(a, days)) }
  const mid = iso(minus(a, Math.floor(days / 2)))
  return { anchor, cur, prev, mid }
}

// ── KPIs ────────────────────────────────────────────────────────────────────
interface Totals { reach: number; eng: number; erden: number; tkviews: number; net: number }

async function totals(orgId: string, platform: PlatformParam, w: Window, brandId: string | null): Promise<Totals> {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(bmd.reach_sum),0)::float        reach,
        COALESCE(SUM(bmd.engagement_sum),0)::float   eng,
        COALESCE(SUM(bmd.er_denominator_sum),0)::float erden,
        COALESCE(SUM(bmd.video_views_sum) FILTER (WHERE bmd.platform='tiktok'),0)::float tkviews,
        COALESCE(SUM(bmd.net_growth_sum),0)::float   net
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return rows[0]
}

async function dailySparks(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ reach: number; eng: number; erden: number; tkviews: number; net: number }>(
    `SELECT
        COALESCE(SUM(bmd.reach_sum),0)::float reach,
        COALESCE(SUM(bmd.engagement_sum),0)::float eng,
        COALESCE(SUM(bmd.er_denominator_sum),0)::float erden,
        COALESCE(SUM(bmd.video_views_sum) FILTER (WHERE bmd.platform='tiktok'),0)::float tkviews,
        COALESCE(SUM(bmd.net_growth_sum),0)::float net
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY bmd.metric_date ORDER BY bmd.metric_date`,
    [orgId, platform, w.start, w.end, brandId],
  )
  let cum = 0
  return {
    reach: rows.map(r => Math.round(r.reach)),
    eng: rows.map(r => Math.round(r.eng)),
    er: rows.map(r => +pct(r.eng, r.erden).toFixed(2)),
    tkviews: rows.map(r => Math.round(r.tkviews)),
    netCum: rows.map(r => (cum += r.net, Math.round(cum))),
  }
}

function buildKpis(cur: Totals, prev: Totals, s: Awaited<ReturnType<typeof dailySparks>>): OverviewKpi[] {
  const erCur = pct(cur.eng, cur.erden), erPrev = pct(prev.eng, prev.erden)
  const erDelta = erCur - erPrev
  return [
    { key: 'reach', label: 'Total Reach', icon: 'ads_click', value: fmtNum(cur.reach), ...deltaStr(cur.reach, prev.reach), spark: s.reach.length ? s.reach : [0] },
    { key: 'eng', label: 'Total Engagement', icon: 'favorite', value: fmtNum(cur.eng), ...deltaStr(cur.eng, prev.eng), spark: s.eng.length ? s.eng : [0] },
    { key: 'er', label: 'Blended Eng. Rate', icon: 'bolt', value: `${erCur.toFixed(2)}%`, delta: `${erDelta >= 0 ? '+' : ''}${erDelta.toFixed(2)}pts`, good: erDelta >= 0, spark: s.er.length ? s.er : [0] },
    { key: 'views', label: 'TK Video Views', icon: 'smart_display', value: fmtNum(cur.tkviews), ...deltaStr(cur.tkviews, prev.tkviews), spark: s.tkviews.length ? s.tkviews : [0] },
    { key: 'growth', label: 'Net Follower Growth', icon: 'group_add', value: `${cur.net >= 0 ? '+' : ''}${fmtNum(cur.net)}`, ...deltaStr(cur.net, prev.net), spark: s.netCum.length ? s.netCum : [0] },
  ]
}

// ── engagement over time (daily, over the selected period) ────────────────────
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const fmtDateLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MONTH_ABBR[+m - 1]}` }

// all calendar dates (YYYY-MM-DD) from start..end inclusive
function dateRange(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (d <= last) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

async function engagementOverTime(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows: metricRows } = await pool.query<{ brand: string; d: string; eng: number; reach: number }>(
    `SELECT b.name brand, to_char(bmd.metric_date, 'YYYY-MM-DD') d,
            SUM(bmd.engagement_sum)::float eng, SUM(bmd.reach_sum)::float reach
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY b.name, bmd.metric_date
      ORDER BY d`,
    [orgId, platform, w.start, w.end, brandId],
  )

  // followers per brand per day: unified_profile is 1 row/account/day, so SUM is the daily total
  const { rows: folRows } = await pool.query<{ brand: string; d: string; f: number }>(
    `SELECT b.name brand, to_char(bmd.metric_date, 'YYYY-MM-DD') d, SUM(bmd.follower_count_eod)::float f
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY b.name, bmd.metric_date
      ORDER BY d`,
    [orgId, platform, w.start, w.end, brandId],
  )

  const dates = dateRange(w.start, w.end)
  const idx = new Map(dates.map((d, i) => [d, i]))

  // rank brands by total engagement, keep top 4 for a readable chart
  const engByBrand = new Map<string, number>()
  for (const r of metricRows) engByBrand.set(r.brand, (engByBrand.get(r.brand) ?? 0) + r.eng)
  const brands = [...engByBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0])

  const series = (field: 'eng' | 'reach' | 'fol'): TrendSeries[] =>
    brands.map((brand, i) => {
      const data = new Array(dates.length).fill(0)
      const src = field === 'fol' ? folRows : metricRows
      for (const r of src as { brand: string; d: string; eng?: number; reach?: number; f?: number }[]) {
        if (r.brand !== brand) continue
        const at = idx.get(r.d); if (at === undefined) continue
        data[at] = Math.round(field === 'fol' ? (r.f ?? 0) : field === 'eng' ? (r.eng ?? 0) : (r.reach ?? 0))
      }
      return { name: brand, color: PALETTE[i % PALETTE.length], data }
    })

  // one tick per date; thin visible labels to ~10 so the axis stays readable
  const step = Math.max(1, Math.ceil(dates.length / 10))
  const labels = dates.map((iso, i) => (i % step === 0 || i === dates.length - 1 ? fmtDateLabel(iso) : ''))

  return {
    engagementOverTime: { Engagement: series('eng'), Reach: series('reach'), Followers: series('fol') } as Record<TrendMetric, TrendSeries[]>,
    trendLabels: labels.length ? labels : [''],
  }
}

// ── platform reach share ──────────────────────────────────────────────────────
async function platformReachShare(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ platform: DashPlatform; reach: number }>(
    `SELECT bmd.platform, SUM(bmd.reach_sum)::float reach
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY bmd.platform`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const total = rows.reduce((s, r) => s + r.reach, 0)
  return rows
    .filter(r => r.reach > 0)
    .map(r => ({ platform: r.platform, value: Math.round(pct(r.reach, total)) }))
    .sort((a, b) => b.value - a.value)
}

// ── brand performance matrix ──────────────────────────────────────────────────
async function brandMatrix(orgId: string, platform: PlatformParam, cur: Window, mid: string, brandId: string | null): Promise<BrandMatrixRow[]> {
  const { rows } = await pool.query<{
    brand: string; platform: DashPlatform; reach: number; eng: number; posts: number; erden: number; eng1: number; eng2: number
  }>(
    `SELECT b.name brand, bmd.platform,
            SUM(bmd.reach_sum)::float reach, SUM(bmd.engagement_sum)::float eng,
            SUM(bmd.post_count)::int posts, SUM(bmd.er_denominator_sum)::float erden,
            COALESCE(SUM(bmd.engagement_sum) FILTER (WHERE bmd.metric_date <= $5),0)::float eng1,
            COALESCE(SUM(bmd.engagement_sum) FILTER (WHERE bmd.metric_date >  $5),0)::float eng2
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($6::uuid IS NULL OR bmd.brand_id = $6)
      GROUP BY b.name, bmd.platform`,
    [orgId, platform, cur.start, cur.end, mid, brandId],
  )

  const { rows: fol } = await pool.query<{ brand: string; platform: DashPlatform; f: number }>(
    `WITH last_acct AS (
        SELECT DISTINCT ON (bmd.account_id, bmd.platform) bmd.brand_id, bmd.platform, bmd.follower_count_eod
          FROM l2_gold.brand_metric_daily bmd
          JOIN public.brands b ON b.id = bmd.brand_id AND b.deleted_at IS NULL
         WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
           AND ($3::uuid IS NULL OR bmd.brand_id = $3)
         ORDER BY bmd.account_id, bmd.platform, bmd.metric_date DESC
     )
     SELECT b.name brand, la.platform, SUM(la.follower_count_eod)::float f
       FROM last_acct la JOIN public.brands b ON b.id = la.brand_id AND b.deleted_at IS NULL
      GROUP BY b.name, la.platform`,
    [orgId, platform, brandId],
  )
  const folMap = new Map(fol.map(r => [`${r.brand}|${r.platform}`, r.f]))

  // min-max ranges for scoring
  const ers = rows.map(r => pct(r.eng, r.erden))
  const reaches = rows.map(r => r.reach)
  const posts = rows.map(r => r.posts)
  const norm = (v: number, arr: number[]) => {
    const lo = Math.min(...arr), hi = Math.max(...arr)
    return hi > lo ? (v - lo) / (hi - lo) : 0.5
  }

  return rows
    .map(r => {
      const er = pct(r.eng, r.erden)
      const ratio = r.eng1 > 0 ? r.eng2 / r.eng1 : (r.eng2 > 0 ? 2 : 1)
      const trend: BrandMatrixRow['trend'] = ratio > 1.05 ? 'up' : ratio < 0.95 ? 'down' : 'flat'
      const score = Math.max(1, Math.min(100, Math.round(
        (norm(er, ers) * 0.5 + norm(r.reach, reaches) * 0.3 + norm(r.posts, posts) * 0.2) * 100,
      )))
      return {
        brand: r.brand, platform: r.platform,
        followers: Math.round(folMap.get(`${r.brand}|${r.platform}`) ?? 0),
        reach: Math.round(r.reach), engagement: Math.round(r.eng),
        er: +er.toFixed(1), posts: r.posts, trend, score,
      }
    })
    .sort((a, b) => b.score - a.score)
}

// ── content attribute breakdown ────────────────────────────────────────────────
async function contentAttributes(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ tag: string; cnt: number; eng: number; erden: number }>(
    `SELECT cad.content_tag tag, SUM(cad.post_count)::int cnt,
            SUM(cad.engagement_sum)::float eng, SUM(cad.er_denominator_sum)::float erden
       FROM l2_gold.content_attribute_daily cad
       JOIN public.brands b ON b.id = cad.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'cad')})
        AND cad.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR cad.brand_id = $5)
      GROUP BY cad.content_tag ORDER BY cnt DESC`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const totalEng = rows.reduce((s, r) => s + r.eng, 0)
  const totalDen = rows.reduce((s, r) => s + r.erden, 0)
  const overall = pct(totalEng, totalDen)

  const attrs: ContentAttribute[] = rows.map((r, i) => ({
    label: TAG_LABEL[r.tag] ?? r.tag, count: r.cnt, er: +pct(r.eng, r.erden).toFixed(1),
    color: ATTR_COLORS[i % ATTR_COLORS.length],
  }))

  // finding: best-performing tag vs overall (ignore the catch-all "organic")
  const ranked = attrs.filter(a => a.label !== 'Organic' && a.count > 0).sort((a, b) => b.er - a.er)
  const top = ranked[0]
  const finding = top
    ? `${top.label} mencatat ER tertinggi (${top.er}%), ${overall > 0 ? `${(top.er / overall).toFixed(1)}× di atas rata-rata blended (${overall.toFixed(1)}%)` : 'jauh di atas rata-rata'} — kanal dengan leverage terbesar saat ini.`
    : 'Belum cukup data atribut konten pada periode ini.'
  return { contentAttributes: attrs, contentAttrFinding: finding }
}

// ── best posting times heatmap (gold posting_time_heatmap — all-time by design) ──
const SLOT_OF = (h: number) => (h <= 9 ? 0 : h <= 12 ? 1 : h <= 15 ? 2 : h <= 18 ? 3 : h <= 20 ? 4 : 5)

async function postingHeatmap(orgId: string, platform: PlatformParam, brandId: string | null) {
  // posting_time_heatmap is a TRUNCATE+INSERT all-time aggregate (no metric_date),
  // so it is NOT period-scoped — best posting windows are a stable pattern. brand_id
  // is per-account; weekday is 0=Sun..6=Sat (WIB).
  const { rows } = await pool.query<{ weekday: number; hr: number; eng: number; cnt: number }>(
    `SELECT pth.weekday, pth.hour hr,
            SUM(pth.engagement_sum)::float eng, SUM(pth.post_count)::int cnt
       FROM l2_gold.posting_time_heatmap pth
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = pth.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id AND b.deleted_at IS NULL
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'pth')})
        AND ($3::uuid IS NULL OR bsa.brand_id = $3)
      GROUP BY pth.weekday, pth.hour`,
    [orgId, platform, brandId],
  )
  // accumulate engagement sum + post count per (day, slot), then take the AVERAGE
  // engagement per post — reflects effectiveness, not just posting frequency.
  const sum = Array.from({ length: 7 }, () => new Array(6).fill(0))
  const cnt = Array.from({ length: 7 }, () => new Array(6).fill(0))
  for (const r of rows) {
    if (r.weekday < 0 || r.weekday > 6) continue
    const day = (r.weekday + 6) % 7   // gold 0=Sun..6=Sat → grid 0=Mon..6=Sun
    const slot = SLOT_OF(r.hr)
    sum[day][slot] += r.eng
    cnt[day][slot] += r.cnt
  }
  const grid = sum.map((row, d) => row.map((v, s) => (cnt[d][s] > 0 ? v / cnt[d][s] : 0)))
  const max = Math.max(1, ...grid.flat())
  const norm = grid.map(row => row.map(v => +(v / max).toFixed(3)))

  // top window insight from the hottest cell
  const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
  const SLOTS = ['08:00', '12:00', '15:00', '18:00', '20:00', '22:00']
  let best = { v: 0, d: 0, s: 0 }
  norm.forEach((row, d) => row.forEach((v, s) => { if (v > best.v) best = { v, d, s } }))
  const insight = best.v > 0
    ? `Rata-rata engagement per post tertinggi di ${DAYS[best.d]} sekitar ${SLOTS[best.s]} WIB. Jadwalkan konten utama di window ini.`
    : 'Belum ada cukup data posting untuk menentukan jam terbaik.'
  return { postingHeatmap: norm, postingWindowInsight: insight }
}

// ── orchestrator ──────────────────────────────────────────────────────────────
export async function getOverviewData(
  orgId: string, platform: PlatformParam, days: number, brandId: string | null = null,
  custom: CustomRange | null = null,
): Promise<OverviewPayload> {
  const win = await resolveWindows(orgId, platform, days, brandId, custom)
  if (!win) {
    return {
      kpis: [], trendLabels: [''], platformReachShare: [], brandMatrix: [],
      contentAttributes: [], contentAttrFinding: '', postingHeatmap: [], postingWindowInsight: '',
      engagementOverTime: { Engagement: [], Reach: [], Followers: [] }, empty: true,
    }
  }
  const [curT, prevT, sparks, eot, share, matrix, attrs, heat] = await Promise.all([
    totals(orgId, platform, win.cur, brandId),
    totals(orgId, platform, win.prev, brandId),
    dailySparks(orgId, platform, win.cur, brandId),
    engagementOverTime(orgId, platform, win.cur, brandId),
    platformReachShare(orgId, platform, win.cur, brandId),
    brandMatrix(orgId, platform, win.cur, win.mid, brandId),
    contentAttributes(orgId, platform, win.cur, brandId),
    postingHeatmap(orgId, platform, brandId),
  ])

  return {
    kpis: buildKpis(curT, prevT, sparks),
    ...eot,
    platformReachShare: share,
    brandMatrix: matrix,
    ...attrs,
    ...heat,
    empty: false,
  }
}
