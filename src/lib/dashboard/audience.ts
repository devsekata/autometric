import pool from '@/lib/db'
import type {
  OverviewKpi, TrendSeries, DashPlatform, ContributorRow, RelevanceTierRow, UgcPost,
} from '@/components/dashboard/data'

/**
 * Data access for the Audience Deep Dive dashboard, scoped to one organization.
 *
 * Gold-first sources (per docs §5 Audience):
 *  - KPIs & Follower Growth : l2_gold.brand_metric_daily (follower_count_eod, profile_*)
 *  - Age / Gender           : l2_gold.audience_demographics_daily (audience_type='follower_demographics')
 *  - Cities                 : l2_gold.audience_geo_daily (geo_level='city')
 *  - Community Contributors : l2_gold.community_contributors
 *  - Comment Relevance      : l2_gold.comment_relevance_distribution (counts) +
 *                             feature.comment_relevance_scores + unified_comment (sample text)
 *  - UGC Tagged Posts       : l2_gold.ugc_tagged_posts
 *
 * Grain: audience_* `brand_id` = social_accounts.id (scope via brand_social_accounts);
 * brand_metric_daily / ugc / relevance_distribution `brand_id` = umbrella (scope via
 * brands). In the current seed only Instagram carries demographic (age/gender/city) data.
 */

export type PlatformParam = 'all' | DashPlatform

export interface AudiencePayload {
  kpis: OverviewKpi[]
  age: { bucket: string; value: number; color: string }[]
  ageInsight: string
  gender: { platform: DashPlatform; female: number; male: number }[]
  relevanceTiers: RelevanceTierRow[]
  relevanceSignal: string
  contributors: ContributorRow[]
  superFanNote: string
  cities: { city: string; value: number }[]
  followerTrend: TrendSeries[]
  followerLabels: string[]
  ugc: UgcPost[]
  ugcInsight: string
  empty: boolean
}

const PALETTE = ['#3d7e96', '#e0a458', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8']
const AGE_LABELS: [string, string][] = [
  ['age_13_17', '13–17'], ['age_18_24', '18–24'], ['age_25_34', '25–34'],
  ['age_35_44', '35–44'], ['age_45_54', '45–54'], ['age_55_64', '55–64'], ['age_65_plus', '65+'],
]
const UGC_FORMAT: Record<string, string> = {
  CAROUSEL_ALBUM: 'Carousel', IMAGE: 'Image', VIDEO: 'Video', REELS: 'Reel',
}
const TIER_LABEL: Record<string, ContributorRow['tier']> = {
  super_fan: 'Super Fan', active: 'Active', casual: 'Casual',
}
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
function initials(name: string): string {
  const parts = name.replace(/[@_.]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase()
}
const fmtDateLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MONTH_ABBR[+m - 1]}` }
const fmtShort = (d: Date) => `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`

const PLAT = `($2 = 'all' OR {col}.platform = $2)`

interface Window { start: string; end: string }

async function resolveWindows(orgId: string, platform: PlatformParam, days: number, brandId: string | null) {
  // anchor on gold metric dates (audience KPIs/trend live in brand_metric_daily)
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

// ── KPIs + follower sparks from unified_profile ───────────────────────────────
interface ProfDay { d: string; foll: number; igReach: number; tkVisit: number; fbVisit: number }

async function profileDaily(orgId: string, platform: PlatformParam, w: Window, brandId: string | null): Promise<ProfDay[]> {
  const { rows } = await pool.query<ProfDay>(
    `SELECT to_char(bmd.metric_date, 'YYYY-MM-DD') d,
            COALESCE(SUM(bmd.follower_count_eod),0)::float                                        foll,
            COALESCE(SUM(bmd.profile_reach_sum) FILTER (WHERE bmd.platform='instagram'),0)::float  "igReach",
            COALESCE(SUM(bmd.profile_visit_sum) FILTER (WHERE bmd.platform='tiktok'),0)::float      "tkVisit",
            COALESCE(SUM(bmd.profile_visit_sum) FILTER (WHERE bmd.platform='facebook'),0)::float    "fbVisit"
       FROM l2_gold.brand_metric_daily bmd
       JOIN public.brands b ON b.id = bmd.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
        AND bmd.metric_date BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR bmd.brand_id = $5)
      GROUP BY bmd.metric_date ORDER BY bmd.metric_date`,
    [orgId, platform, w.start, w.end, brandId],
  )
  return rows
}

function buildKpis(cur: ProfDay[], prev: ProfDay[]): OverviewKpi[] {
  const sum = (rows: ProfDay[], k: keyof ProfDay) => rows.reduce((s, r) => s + (r[k] as number), 0)
  const follCur = cur.length ? cur[cur.length - 1].foll : 0
  const follStart = cur.length ? cur[0].foll : 0
  const igCur = sum(cur, 'igReach'), igPrev = sum(prev, 'igReach')
  const tkCur = sum(cur, 'tkVisit'), tkPrev = sum(prev, 'tkVisit')
  const fbCur = sum(cur, 'fbVisit'), fbPrev = sum(prev, 'fbVisit')
  return [
    { key: 'foll', label: 'Total Tracked Followers', icon: 'group', value: fmtNum(follCur), ...deltaStr(follCur, follStart), spark: cur.length ? cur.map(r => Math.round(r.foll)) : [0] },
    { key: 'igr', label: 'IG Profile Reach', icon: 'ads_click', value: fmtNum(igCur), ...deltaStr(igCur, igPrev), spark: cur.length ? cur.map(r => Math.round(r.igReach)) : [0] },
    { key: 'tkv', label: 'TK Profile Views', icon: 'visibility', value: fmtNum(tkCur), ...deltaStr(tkCur, tkPrev), spark: cur.length ? cur.map(r => Math.round(r.tkVisit)) : [0] },
    { key: 'fbv', label: 'FB Profile Visits', icon: 'person', value: fmtNum(fbCur), ...deltaStr(fbCur, fbPrev), spark: cur.length ? cur.map(r => Math.round(r.fbVisit)) : [0] },
  ]
}

// ── Age distribution (latest snapshot) ────────────────────────────────────────
async function ageDistribution(orgId: string, platform: PlatformParam, brandId: string | null) {
  const sums = AGE_LABELS.map(([col]) => `COALESCE(SUM(u.${col}),0)::float "${col}"`).join(',\n            ')
  const { rows } = await pool.query<Record<string, number>>(
    `SELECT ${sums}
       FROM l2_gold.audience_demographics_daily u
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = u.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'u')})
        AND u.audience_type = 'follower_demographics'
        AND u.audience_date = (
          SELECT max(u2.audience_date) FROM l2_gold.audience_demographics_daily u2
          JOIN public.brand_social_accounts bsa2 ON bsa2.social_account_id = u2.brand_id
          JOIN public.brands b2 ON b2.id = bsa2.brand_id
          WHERE b2.organization_id = $1 AND (${PLAT.replace('{col}', 'u2')}) AND u2.audience_type='follower_demographics'
            AND ($3::uuid IS NULL OR bsa2.brand_id = $3))
        AND ($3::uuid IS NULL OR bsa.brand_id = $3)`,
    [orgId, platform, brandId],
  )
  const r = rows[0] ?? {}
  const total = AGE_LABELS.reduce((s, [col]) => s + (r[col] ?? 0), 0)
  const age = AGE_LABELS.map(([col, label], i) => ({
    bucket: label, value: total > 0 ? Math.round(pct(r[col] ?? 0, total)) : 0, color: PALETTE[i % PALETTE.length],
  }))
  const top = age.slice().sort((a, b) => b.value - a.value)[0]
  const insight = total > 0 && top
    ? `Segmen ${top.bucket} mendominasi audiens (${top.value}%) — sesuaikan tone & format konten untuk kelompok usia ini.`
    : 'Belum ada data demografi usia pada periode ini.'
  return { age, ageInsight: insight }
}

// ── Gender split per platform (latest snapshot) ───────────────────────────────
async function genderSplit(orgId: string, platform: PlatformParam, brandId: string | null) {
  const { rows } = await pool.query<{ platform: DashPlatform; f: number; m: number }>(
    `SELECT u.platform,
            COALESCE(SUM(u.gender_female),0)::float f,
            COALESCE(SUM(u.gender_male),0)::float   m
       FROM l2_gold.audience_demographics_daily u
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = u.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'u')})
        AND u.audience_type = 'follower_demographics'
        AND u.audience_date = (
          SELECT max(u2.audience_date) FROM l2_gold.audience_demographics_daily u2
          JOIN public.brand_social_accounts bsa2 ON bsa2.social_account_id = u2.brand_id
          JOIN public.brands b2 ON b2.id = bsa2.brand_id
          WHERE b2.organization_id = $1 AND (${PLAT.replace('{col}', 'u2')}) AND u2.audience_type='follower_demographics'
            AND ($3::uuid IS NULL OR bsa2.brand_id = $3))
        AND ($3::uuid IS NULL OR bsa.brand_id = $3)
      GROUP BY u.platform`,
    [orgId, platform, brandId],
  )
  return rows
    .filter(r => r.f + r.m > 0)
    .map(r => {
      const female = Math.round(pct(r.f, r.f + r.m))
      return { platform: r.platform, female, male: 100 - female }
    })
}

// ── Top audience cities (latest snapshot, jsonb) ──────────────────────────────
async function topCities(orgId: string, platform: PlatformParam, brandId: string | null) {
  const { rows } = await pool.query<{ city: string; v: number }>(
    `SELECT u.geo_key city, SUM(u.audience_count)::float v
       FROM l2_gold.audience_geo_daily u
       JOIN public.brand_social_accounts bsa ON bsa.social_account_id = u.brand_id
       JOIN public.brands b ON b.id = bsa.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'u')})
        AND u.geo_level = 'city'
        AND u.audience_date = (
          SELECT max(u2.audience_date) FROM l2_gold.audience_geo_daily u2
          JOIN public.brand_social_accounts bsa2 ON bsa2.social_account_id = u2.brand_id
          JOIN public.brands b2 ON b2.id = bsa2.brand_id
          WHERE b2.organization_id = $1 AND (${PLAT.replace('{col}', 'u2')}) AND u2.geo_level='city'
            AND ($3::uuid IS NULL OR bsa2.brand_id = $3))
        AND ($3::uuid IS NULL OR bsa.brand_id = $3)
      GROUP BY u.geo_key ORDER BY v DESC LIMIT 8`,
    [orgId, platform, brandId],
  )
  const total = rows.reduce((s, r) => s + r.v, 0)
  return rows.map(r => ({ city: r.city, value: total > 0 ? Math.round(pct(r.v, total)) : 0 }))
}

// ── Follower growth trend (per brand, weekly) ─────────────────────────────────
async function followerTrend(orgId: string, platform: PlatformParam, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{ brand: string; wk: string; f: number }>(
    `WITH daily AS (
        SELECT b.name brand, bmd.metric_date d, SUM(bmd.follower_count_eod)::float f
          FROM l2_gold.brand_metric_daily bmd
          JOIN public.brands b ON b.id = bmd.brand_id
         WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'bmd')})
           AND bmd.metric_date BETWEEN $3 AND $4
           AND ($5::uuid IS NULL OR bmd.brand_id = $5)
         GROUP BY b.name, bmd.metric_date)
     SELECT brand, to_char(date_trunc('week', d), 'YYYY-MM-DD') wk, AVG(f)::float f
       FROM daily GROUP BY brand, date_trunc('week', d)
      ORDER BY wk`,
    [orgId, platform, w.start, w.end, brandId],
  )
  const weeks = [...new Set(rows.map(r => r.wk))].sort()
  const idx = new Map(weeks.map((wk, i) => [wk, i]))
  const totByBrand = new Map<string, number>()
  for (const r of rows) totByBrand.set(r.brand, Math.max(totByBrand.get(r.brand) ?? 0, r.f))
  const brands = [...totByBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0])
  const series: TrendSeries[] = brands.map((brand, i) => {
    const data = new Array(weeks.length).fill(0)
    for (const r of rows) if (r.brand === brand) data[idx.get(r.wk)!] = Math.round(r.f)
    return { name: brand, color: PALETTE[i % PALETTE.length], data }
  })
  return { followerTrend: series, followerLabels: weeks.length ? weeks.map(fmtDateLabel) : [''] }
}

// ── Comment relevance tiers (gold distribution counts + feature/silver samples) ──
const REL_TIERS = [
  { key: 'high', tier: 'High Relevance', range: '>75', desc: 'Kontekstual, terkait plot/caption, debat karakter', color: '#5fa783', min: 75, max: 101 },
  { key: 'mid', tier: 'Mid Relevance', range: '40–75', desc: 'Reaksi positif umum, pujian singkat', color: '#e0a458', min: 40, max: 75 },
  { key: 'low', tier: 'Low Relevance', range: '<40', desc: 'Spam, emoji saja, off-topic', color: '#d97a7a', min: -1, max: 40 },
]
// normalise score to 0..100 whether the source stores 0..1 or 0..100
const REL_NORM = `(CASE WHEN f.relevance_score <= 1 THEN f.relevance_score * 100 ELSE f.relevance_score END)`

async function commentRelevance(orgId: string, platform: PlatformParam, brandId: string | null) {
  // Distribution counts come from the gold rollup; sample texts per tier are joined
  // on the fly from feature.comment_relevance_scores + unified_comment (per docs §5).
  const [dist, samp] = await Promise.all([
    pool.query<{ tier: string; cnt: number }>(
      `SELECT crd.tier, SUM(crd.comment_count)::int cnt
         FROM l2_gold.comment_relevance_distribution crd
         JOIN public.brands b ON b.id = crd.brand_id
        WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'crd')})
          AND ($3::uuid IS NULL OR crd.brand_id = $3)
        GROUP BY crd.tier`,
      [orgId, platform, brandId],
    ).catch(() => ({ rows: [] as { tier: string; cnt: number }[] })),
    pool.query<{ s: number; txt: string | null }>(
      `SELECT ${REL_NORM} s, c.comment_text txt
         FROM feature.comment_relevance_scores f
         JOIN l1_silver.unified_comment c
           ON c.comment_id = f.comment_id AND c.platform = f.platform
         JOIN public.brand_social_accounts bsa ON bsa.social_account_id = c.brand_id
         JOIN public.brands b ON b.id = bsa.brand_id
        WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'c')})
          AND f.relevance_score IS NOT NULL
          AND ($3::uuid IS NULL OR bsa.brand_id = $3)`,
      [orgId, platform, brandId],
    ).catch(() => ({ rows: [] as { s: number; txt: string | null }[] })),
  ])

  const countByTier = new Map(dist.rows.map(r => [r.tier, r.cnt]))
  const total = [...countByTier.values()].reduce((s, c) => s + c, 0)
  const tiers: RelevanceTierRow[] = REL_TIERS.map(t => {
    const count = countByTier.get(t.key) ?? 0
    const samples = samp.rows
      .filter(r => r.s >= t.min && r.s < t.max)
      .sort((a, b) => b.s - a.s)
      .map(r => (r.txt ?? '').trim()).filter(Boolean).slice(0, 3)
    return {
      tier: t.tier, range: t.range, count,
      pct: total > 0 ? Math.round(pct(count, total)) : 0,
      desc: t.desc, color: t.color, samples,
    }
  })
  const high = tiers[0]
  const signal = total > 0
    ? `${high.pct}% komentar tergolong relevansi tinggi (>75) — sinyal keterlibatan audiens yang dalam. Optimalkan caption dengan pertanyaan terbuka untuk menaikkan porsi ini.`
    : 'Belum ada distribusi relevansi komentar pada periode ini (l2_gold.comment_relevance_distribution masih kosong).'
  return { relevanceTiers: tiers, relevanceSignal: signal }
}

// ── Top community contributors (gold) ─────────────────────────────────────────
async function contributors(orgId: string, platform: PlatformParam, days: number, brandId: string | null): Promise<{ contributors: ContributorRow[]; superFanNote: string }> {
  const windowDays = [7, 30, 90].includes(days) ? days : 30
  const { rows } = await pool.query<{
    uname: string; platform: DashPlatform; comments: number; likes: number
    relevance: number | null; score: number; tier: string
  }>(
    `SELECT cc.normalized_username uname, cc.platform,
            cc.comments_count::int comments, cc.likes_received::int likes,
            cc.avg_relevance::float relevance, cc.composite_score::float score, cc.tier
       FROM l2_gold.community_contributors cc
       JOIN public.brands b ON b.id = cc.brand_id
      WHERE b.organization_id = $1 AND (${PLAT.replace('{col}', 'cc')})
        AND cc.window_days = $3
        AND ($4::uuid IS NULL OR cc.brand_id = $4)
      ORDER BY cc.composite_score DESC, cc.comments_count DESC
      LIMIT 12`,
    [orgId, platform, windowDays, brandId],
  )
  const list: ContributorRow[] = rows.map((r, i) => ({
    rank: i + 1,
    initials: initials(r.uname),
    username: r.uname.startsWith('@') ? r.uname : `@${r.uname}`,
    platform: r.platform,
    comments: r.comments,
    likes: r.likes,
    daily: +(r.comments / windowDays).toFixed(1),
    relevance: Math.round(r.relevance ?? 0),
    score: Math.round(r.score),
    tier: TIER_LABEL[r.tier] ?? 'Casual',
    color: PALETTE[i % PALETTE.length],
  }))
  const sf = list.find(c => c.tier === 'Super Fan') ?? list[0]
  const note = list.length
    ? `${sf.username} memimpin dengan ${sf.comments} komentar (skor ${sf.score}) dalam ${windowDays} hari terakhir — kandidat untuk program fan/ambassador.`
    : 'Belum ada data kontributor komunitas pada periode ini.'
  return { contributors: list, superFanNote: note }
}

// ── UGC tagged posts (L0 harmonization) ───────────────────────────────────────
async function ugcPosts(orgId: string, w: Window, brandId: string | null) {
  const { rows } = await pool.query<{
    username: string; post_type: string | null; caption: string | null
    likes: number; comments: number; post_date: Date
  }>(
    `SELECT tp.username, tp.post_type, tp.caption,
            COALESCE(tp.like_count,0)::int likes, COALESCE(tp.comment_count,0)::int comments,
            tp.post_date
       FROM l2_gold.ugc_tagged_posts tp
       JOIN public.brands b ON b.id = tp.brand_id
      WHERE b.organization_id = $1
        AND tp.post_date::date BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR tp.brand_id = $4)
      ORDER BY COALESCE(tp.total_engagement, tp.like_count + tp.comment_count) DESC
      LIMIT 10`,
    [orgId, w.start, w.end, brandId],
  )
  const ugc: UgcPost[] = rows.map(r => ({
    username: r.username?.startsWith('@') ? r.username : `@${r.username ?? 'unknown'}`,
    format: UGC_FORMAT[r.post_type ?? ''] ?? (r.post_type ?? 'Image'),
    caption: (r.caption ?? '').replace(/\s+/g, ' ').trim() || '(tanpa caption)',
    likes: r.likes, comments: r.comments, total: r.likes + r.comments,
    date: fmtShort(new Date(r.post_date)),
  }))
  const avg = ugc.length ? Math.round(ugc.reduce((s, p) => s + p.total, 0) / ugc.length) : 0
  const insight = ugc.length
    ? `Post tagged dari audiens rata-rata meraih ${fmtNum(avg)} interaksi — repost UGC berperforma tinggi adalah pengganda reach termurah.`
    : 'Belum ada UGC tagged post pada periode ini.'
  return { ugc, ugcInsight: insight }
}

// ── orchestrator ──────────────────────────────────────────────────────────────
export async function getAudienceData(
  orgId: string, platform: PlatformParam, days: number, brandId: string | null = null,
): Promise<AudiencePayload> {
  const win = await resolveWindows(orgId, platform, days, brandId)
  if (!win) {
    return {
      kpis: [], age: [], ageInsight: '', gender: [], relevanceTiers: [], relevanceSignal: '',
      contributors: [], superFanNote: '', cities: [], followerTrend: [], followerLabels: [''],
      ugc: [], ugcInsight: '', empty: true,
    }
  }
  const [curP, prevP, age, gender, cities, trend, rel, contrib, ugc] = await Promise.all([
    profileDaily(orgId, platform, win.cur, brandId),
    profileDaily(orgId, platform, win.prev, brandId),
    ageDistribution(orgId, platform, brandId),
    genderSplit(orgId, platform, brandId),
    topCities(orgId, platform, brandId),
    followerTrend(orgId, platform, win.cur, brandId),
    commentRelevance(orgId, platform, brandId),
    contributors(orgId, platform, days, brandId),
    ugcPosts(orgId, win.cur, brandId),
  ])
  return {
    kpis: buildKpis(curP, prevP),
    ...age,
    gender,
    ...rel,
    ...contrib,
    cities,
    ...trend,
    ...ugc,
    empty: false,
  }
}
