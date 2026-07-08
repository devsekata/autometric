import pool from '@/lib/db'
import type { OverviewKpi, DashPlatform, TopPostRow } from '@/components/dashboard/data'

/**
 * Gold/silver data access for the Content Overview dashboard, scoped to one org.
 *
 * Grain note (same as overview.ts): in l2_gold, `brand_id` = public.brands.id
 * (umbrella brand) so org scoping joins brands directly. In l1_silver,
 * `brand_id` = social_accounts.id, so scoping hops through brand_social_accounts
 * -> brands. Post-level detail (format, per-post metrics, completion_rate, watch
 * time, ER) comes from l2_gold.post_metric (brand_id = per-account, same join as
 * silver). EXCEPTION: FB link clicks have no gold column, so that single KPI still
 * reads l1_silver.unified_post.link_click.
 */

export type PlatformParam = 'all' | DashPlatform

export interface NamedBar { label: string; value: number; color: string }

export interface ContentOverviewPayload {
  kpis: OverviewKpi[]
  postTypePerf: NamedBar[]        // Instagram avg reach by format
  postTypeInsight: string
  contentVolume: { label: string; value: number }[]
  contentVolumeInsight: string
  topPosts: TopPostRow[]
  completionDist: { label: string; value: number }[]   // TikTok completion-rate buckets (% of videos)
  completionInsight: string
  reelWatch: { label: string; value: number }[]         // IG reels avg completion % by duration
  reelWatchInsight: string
  empty: boolean
}

const PALETTE = ['#3d7e96', '#e0a458', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8']

// IG format -> card label for Post Type Performance.
const IG_FORMAT_LABEL: Record<string, string> = {
  reels: 'Reels', carousel: 'Carousel', feed: 'Image', story: 'Story',
}
// per-platform media format -> Top Posts "Format" column label.
const POST_FORMAT_LABEL: Record<string, string> = {
  reels: 'Reel', video: 'Video', carousel: 'Carousel',
  feed: 'Image', photo: 'Image', image: 'Image', link: 'Link', story: 'Story',
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
const ptsStr = (cur: number, prev: number) => ({
  delta: `${cur - prev >= 0 ? '+' : ''}${(cur - prev).toFixed(1)}pts`, good: cur - prev >= 0,
})

// platform filter fragment uses $2; gold queries share param order [orgId, platform, start, end, brandId]
const PLAT = `($2 = 'all' OR {col}.platform = $2)`
// parse a "79%" text completion_rate into a 0..100 numeric
const CR_NUM = `NULLIF(regexp_replace({col}.completion_rate, '[^0-9.]', '', 'g'), '')::numeric`

interface Window { start: string; end: string }

// ── anchor + windows (anchored on gold, like overview) ────────────────────────
async function resolveWindows(orgId: string, platform: PlatformParam, days: number, brandId: string | null) {
  const { rows } = await pool.query<{ d: string | null }>(
    `SELECT to_char(max(bmd.metric_date), 'YYYY-MM-DD') d
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id
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
  return { anchor, cur, prev }
}

// ── KPI totals (gold = posts + IG saves) ──────────────────────────────────────
interface GoldKpiTotals { posts: number; igSaves: number; igErden: number }

async function goldKpiTotals(orgId: string, platform: PlatformParam, w: Window, brandId: string | null): Promise<GoldKpiTotals> {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(bmd.post_count),0)::float                                          posts,
        COALESCE(SUM(bmd.saves_sum)          FILTER (WHERE bmd.platform='instagram'),0)::float igsaves,
        COALESCE(SUM(bmd.er_denominator_sum) FILTER (WHERE bmd.platform='instagram'),0)::float igerden
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return { posts: rows[0].posts, igSaves: rows[0].igsaves, igErden: rows[0].igerden }
}

// per-day gold sparks: posts + IG saves rate
async function goldKpiDaily(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ posts: number; igsaves: number; igerden: number }>(
    `SELECT
        COALESCE(SUM(bmd.post_count),0)::float                                          posts,
        COALESCE(SUM(bmd.saves_sum)          FILTER (WHERE bmd.platform='instagram'),0)::float igsaves,
        COALESCE(SUM(bmd.er_denominator_sum) FILTER (WHERE bmd.platform='instagram'),0)::float igerden
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY bmd.metric_date ORDER BY bmd.metric_date`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return {
    posts: rows.map(r => Math.round(r.posts)),
    savesRate: rows.map(r => +pct(r.igsaves, r.igerden).toFixed(2)),
  }
}

// ── KPI: TK completion (gold post_metric) + FB link clicks (silver unified_post —
//    no gold column for link clicks, so that one metric reads silver by necessity) ──
async function silverKpiTotals(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const [c, l] = await Promise.all([
    pool.query<{ tkcompl: number | null }>(
      `SELECT AVG(${CR_NUM.replace('{col}', 'p')}) FILTER (WHERE p.platform='tiktok')::float tkcompl
         FROM l2_gold.post_metric p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id
        WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'p')})
          AND p.post_date::date BETWEEN $3 AND $4
          AND ($5::uuid IS NULL OR bsa.brand_id = $5)`,
      [orgId, platform, w.start, w.end, brandId],
    ),
    pool.query<{ fbclicks: number }>(
      `SELECT COALESCE(SUM(p.link_click) FILTER (WHERE p.platform='facebook'),0)::float fbclicks
         FROM l1_silver.unified_post p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id
        WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'p')})
          AND p.post_date::date BETWEEN $3 AND $4
          AND ($5::uuid IS NULL OR bsa.brand_id = $5)`,
      [orgId, platform, w.start, w.end, brandId],
    ),
  ])
  return { tkCompl: c.rows[0]?.tkcompl ?? 0, fbClicks: l.rows[0]?.fbclicks ?? 0 }
}

async function silverKpiDaily(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const [c, l] = await Promise.all([
    pool.query<{ tkcompl: number | null }>(
      `SELECT AVG(${CR_NUM.replace('{col}', 'p')}) FILTER (WHERE p.platform='tiktok')::float tkcompl
         FROM l2_gold.post_metric p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id
        WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'p')})
          AND p.post_date::date BETWEEN $3 AND $4
          AND ($5::uuid IS NULL OR bsa.brand_id = $5)
        GROUP BY p.post_date::date ORDER BY p.post_date::date`,
      [orgId, platform, w.start, w.end, brandId],
    ),
    pool.query<{ fbclicks: number }>(
      `SELECT COALESCE(SUM(p.link_click) FILTER (WHERE p.platform='facebook'),0)::float fbclicks
         FROM l1_silver.unified_post p
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id
        WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'p')})
          AND p.post_date::date BETWEEN $3 AND $4
          AND ($5::uuid IS NULL OR bsa.brand_id = $5)
        GROUP BY p.post_date::date ORDER BY p.post_date::date`,
      [orgId, platform, w.start, w.end, brandId],
    ),
  ])
  return {
    completion: c.rows.map(r => +(r.tkcompl ?? 0).toFixed(1)),
    clicks: l.rows.map(r => Math.round(r.fbclicks)),
  }
}

function buildKpis(
  curG: GoldKpiTotals, prevG: GoldKpiTotals,
  curS: { tkCompl: number; fbClicks: number }, prevS: { tkCompl: number; fbClicks: number },
  sg: Awaited<ReturnType<typeof goldKpiDaily>>, ss: Awaited<ReturnType<typeof silverKpiDaily>>,
): OverviewKpi[] {
  const savesCur = pct(curG.igSaves, curG.igErden), savesPrev = pct(prevG.igSaves, prevG.igErden)
  return [
    { key: 'posts', label: 'Total Posts (Period)', icon: 'grid_view', value: fmtNum(curG.posts), ...deltaStr(curG.posts, prevG.posts), spark: sg.posts.length ? sg.posts : [0] },
    { key: 'saves', label: 'Avg. Saves Rate (IG)', icon: 'bookmark', value: `${savesCur.toFixed(2)}%`, ...ptsStr(savesCur, savesPrev), spark: sg.savesRate.length ? sg.savesRate : [0] },
    { key: 'compl', label: 'Avg. Completion Rate (TK)', icon: 'smart_display', value: `${Math.round(curS.tkCompl)}%`, ...ptsStr(curS.tkCompl, prevS.tkCompl), spark: ss.completion.length ? ss.completion : [0] },
    { key: 'clicks', label: 'Link Clicks (FB)', icon: 'ads_click', value: fmtNum(curS.fbClicks), ...deltaStr(curS.fbClicks, prevS.fbClicks), spark: ss.clicks.length ? ss.clicks : [0] },
  ]
}

// ── Post Type Performance — IG avg reach by format (silver) ───────────────────
async function postTypePerf(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ format: string; reach: number }>(
    `SELECT p.format, AVG(p.reach)::float reach
       FROM l2_gold.post_metric p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND p.platform = 'instagram'
        AND p.post_date::date BETWEEN $2 AND $3
        AND p.format IS NOT NULL
        AND ($4::uuid IS NULL OR bsa.brand_id = $4)
      GROUP BY p.format
      ORDER BY reach DESC`,
    [orgId, w.start, w.end, brandId],
  )
  const bars: NamedBar[] = rows.map((r, i) => ({
    label: IG_FORMAT_LABEL[r.format] ?? r.format, value: Math.round(r.reach), color: PALETTE[i % PALETTE.length],
  }))
  // finding: top format vs the next one
  const [top, second] = bars
  const insight = top
    ? second && second.value > 0
      ? `${top.label} rata-rata mencatat reach ${(top.value / second.value).toFixed(1)}× lebih tinggi dari ${second.label} — format dengan distribusi terkuat di Instagram.`
      : `${top.label} adalah format dengan rata-rata reach tertinggi di Instagram.`
    : 'Belum ada data format Instagram pada periode ini.'
  return { postTypePerf: bars, postTypeInsight: insight }
}

// ── Content Volume by Week (gold post_count, bucketed weekly) ──────────────────
async function contentVolume(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ wk: string; posts: number }>(
    `SELECT to_char(date_trunc('week', bmd.metric_date), 'YYYY-MM-DD') wk,
            SUM(bmd.post_count)::int posts
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY date_trunc('week', bmd.metric_date)
      ORDER BY date_trunc('week', bmd.metric_date)`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const volume = rows.map((r, i) => ({ label: `W${i + 1}`, value: r.posts }))
  // finding: biggest week-over-week drop
  let worst = { i: -1, drop: 0 }
  for (let i = 1; i < volume.length; i++) {
    const prev = volume[i - 1].value
    if (prev > 0) {
      const drop = (prev - volume[i].value) / prev
      if (drop > worst.drop) worst = { i, drop }
    }
  }
  const insight = worst.i >= 0 && worst.drop >= 0.15
    ? `${volume[worst.i].label} mengalami penurunan volume posting ${Math.round(worst.drop * 100)}% dibanding minggu sebelumnya — audiens menghukum inkonsistensi, jaga ritme posting.`
    : volume.length
      ? 'Volume posting relatif konsisten antar minggu pada periode ini.'
      : 'Belum ada data volume posting pada periode ini.'
  return { contentVolume: volume, contentVolumeInsight: insight }
}

// ── Top Posts table (silver, ranked by engagement_rate) ───────────────────────
async function topPosts(orgId: string, platform: PlatformParam, w: Window, brandId: string | null): Promise<TopPostRow[]> {
  const { rows } = await pool.query<{
    platform: DashPlatform; caption: string | null; format: string | null; post_type: string | null
    reach: number; views: number; likes: number; comments: number; shares: number; er: number | null; boosted: boolean
  }>(
    `SELECT p.platform, p.caption, p.format, p.post_type,
            COALESCE(p.reach,0)::int reach, COALESCE(p.views,0)::int views,
            COALESCE(p.likes,0)::int likes, COALESCE(p.comments,0)::int comments,
            COALESCE(p.shares,0)::int shares,
            ((CASE WHEN p.platform = 'tiktok' THEN p.er_views ELSE p.er_reach END) * 100)::float er,
            COALESCE(p.is_boosted,false) boosted
       FROM l2_gold.post_metric p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'p')})
        AND p.post_date::date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bsa.brand_id = $5)
      ORDER BY (CASE WHEN p.platform = 'tiktok' THEN p.er_views ELSE p.er_reach END) DESC NULLS LAST
      LIMIT 10`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return rows.map((r, i) => {
    const fmtKey = (r.format ?? r.post_type ?? '').toLowerCase()
    return {
      rank: i + 1,
      platform: r.platform,
      caption: (r.caption || '(tanpa caption)').replace(/\s+/g, ' ').trim(),
      format: POST_FORMAT_LABEL[fmtKey] ?? (r.format ?? r.post_type ?? '—'),
      reach: r.reach, views: r.views, likes: r.likes, comments: r.comments,
      shares: r.shares,
      er: +(r.er ?? 0).toFixed(1),
      tag: r.boosted ? 'Boosted' : 'Organic',
    }
  })
}

// ── TikTok completion-rate distribution (silver) ──────────────────────────────
async function completionDist(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ b1: number; b2: number; b3: number; b4: number; total: number }>(
    `WITH cr AS (
        SELECT ${CR_NUM.replace('{col}', 'p')} v
          FROM l2_gold.post_metric p
          JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
          JOIN public.brands b ON b.id = bsa.brand_id
         WHERE b.organization_id = $1 AND p.platform = 'tiktok'
           AND p.post_date::date BETWEEN $2 AND $3
           AND p.completion_rate IS NOT NULL
           AND ($4::uuid IS NULL OR bsa.brand_id = $4)
     )
     SELECT
        COUNT(*) FILTER (WHERE v <  25)               ::int b1,
        COUNT(*) FILTER (WHERE v >= 25 AND v < 50)    ::int b2,
        COUNT(*) FILTER (WHERE v >= 50 AND v < 75)    ::int b3,
        COUNT(*) FILTER (WHERE v >= 75)               ::int b4,
        COUNT(*)                                      ::int total
       FROM cr WHERE v IS NOT NULL`,
    [orgId, w.start, w.end, brandId],
  )
  const r = rows[0] ?? { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 }
  const t = r.total || 1
  const dist = [
    { label: '0–25%', value: Math.round(pct(r.b1, t)) },
    { label: '25–50%', value: Math.round(pct(r.b2, t)) },
    { label: '50–75%', value: Math.round(pct(r.b3, t)) },
    { label: '75–100%', value: Math.round(pct(r.b4, t)) },
  ]
  const pastHalf = Math.round(pct(r.b3 + r.b4, t))
  const insight = r.total
    ? `${pastHalf}% video ditonton melewati titik tengah${pastHalf >= 50 ? ' — di atas benchmark retensi 50%.' : ', masih di bawah benchmark retensi 50%.'}`
    : 'Belum ada data completion rate TikTok pada periode ini.'
  return { completionDist: dist, completionInsight: insight }
}

// ── Reel watch time by duration (silver, IG) ──────────────────────────────────
const DUR_BUCKETS = ['0–15s', '15–30s', '30–45s', '45–60s', '60s+']
async function reelWatch(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ bucket: string; comp: number }>(
    `SELECT
        CASE
          WHEN p.duration_s < 15 THEN '0–15s'
          WHEN p.duration_s < 30 THEN '15–30s'
          WHEN p.duration_s < 45 THEN '30–45s'
          WHEN p.duration_s < 60 THEN '45–60s'
          ELSE '60s+'
        END bucket,
        AVG(LEAST(100, p.avg_watch_time / p.duration_s * 100))::float comp
       FROM l2_gold.post_metric p
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND p.platform = 'instagram'
        AND p.post_date::date BETWEEN $2 AND $3
        AND p.duration_s > 0 AND p.avg_watch_time > 0
        AND ($4::uuid IS NULL OR bsa.brand_id = $4)
      GROUP BY 1`,
    [orgId, w.start, w.end, brandId],
  )
  const map = new Map(rows.map(r => [r.bucket, Math.round(r.comp)]))
  const reel = DUR_BUCKETS.map(b => ({ label: b, value: map.get(b) ?? 0 }))
  const present = reel.filter(r => r.value > 0)
  const best = present.slice().sort((a, b) => b.value - a.value)[0]
  const worst = present.slice().sort((a, b) => a.value - b.value)[0]
  const insight = best
    ? `Reel ${best.label} menahan rata-rata completion ${best.value}%${worst && worst !== best ? `, sementara ${worst.label} turun ke ${worst.value}%` : ''} — durasi pendek mempertahankan penonton lebih baik.`
    : 'Belum ada data watch time reel pada periode ini.'
  return { reelWatch: reel, reelWatchInsight: insight }
}

// ── orchestrator ──────────────────────────────────────────────────────────────
export async function getContentOverviewData(
  orgId: string, platform: PlatformParam, days: number, brandId: string | null = null,
): Promise<ContentOverviewPayload> {
  const win = await resolveWindows(orgId, platform, days, brandId)
  if (!win) {
    return {
      kpis: [], postTypePerf: [], postTypeInsight: '', contentVolume: [], contentVolumeInsight: '',
      topPosts: [], completionDist: [], completionInsight: '', reelWatch: [], reelWatchInsight: '', empty: true,
    }
  }
  const [curG, prevG, curS, prevS, sg, ss, ptp, vol, top, compl, reel] = await Promise.all([
    goldKpiTotals(orgId, platform, win.cur, brandId),
    goldKpiTotals(orgId, platform, win.prev, brandId),
    silverKpiTotals(orgId, platform, win.cur, brandId),
    silverKpiTotals(orgId, platform, win.prev, brandId),
    goldKpiDaily(orgId, platform, win.cur, brandId),
    silverKpiDaily(orgId, platform, win.cur, brandId),
    postTypePerf(orgId, win.cur, brandId),
    contentVolume(orgId, platform, win.cur, brandId),
    topPosts(orgId, platform, win.cur, brandId),
    completionDist(orgId, win.cur, brandId),
    reelWatch(orgId, win.cur, brandId),
  ])

  return {
    kpis: buildKpis(curG, prevG, curS, prevS, sg, ss),
    ...ptp,
    ...vol,
    topPosts: top,
    ...compl,
    ...reel,
    empty: false,
  }
}
