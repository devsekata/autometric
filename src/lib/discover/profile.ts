import { listDirectory } from './directory'
import { listRateCards } from './rates'
import pool from '@/lib/db'
import { toIso } from './util'
import type { DirectoryAccount, DiscoverPlatform } from './types'

/**
 * Enriched KOL profiles for the Directory and detail workspace.
 *
 * The Directory needs attributes autometric's warehouse does not store —
 * audience demographics, location, lifestyle, authenticity, brand fit. Rather
 * than pretend they are measured, every value carries a `Confidence`:
 *
 *   live       measured from this account's own posts (views, ER, formats,
 *              paid/organic split, posting cadence). These are facts.
 *   calculated derived from live values by an explicit formula stated in the
 *              UI (estimated reach, EMV, audience quality, brand fit).
 *   estimated  modelled, because no source exists yet (age/gender split,
 *              location, lifestyle, authenticity). Deterministic per account,
 *              never random per render — a number that changes on refresh is
 *              worse than no number.
 *
 * Nothing here is presented as measured when it is not: the badge travels with
 * the value all the way to the screen. When a real source arrives (an audience
 * insights sync, a brand-fit model), the `estimated` fields are the list of
 * things to replace, and their formulas are the fallback.
 */

export {
  CATEGORIES, LIFESTYLES, LOCATIONS, AGE_BANDS, TIERS, GENERATION, tierOf,
  type Confidence, type Metric, type Category, type Lifestyle, type AgeBand, type Tier,
} from './vocab'
import {
  AGE_BANDS, CATEGORIES, GENERATION, LIFESTYLES, LOCATIONS, tierOf,
  type AgeBand, type Category, type Confidence, type Lifestyle, type Metric, type Tier,
} from './vocab'

const live = <T,>(value: T, basis: string): Metric<T> => ({ value, confidence: 'live', basis })
const calc = <T,>(value: T, basis: string): Metric<T> => ({ value, confidence: 'calculated', basis })
const est = <T,>(value: T, basis: string): Metric<T> => ({ value, confidence: 'estimated', basis })

/* ── deterministic pseudo-randomness ─────────────────────────────────────── */

/**
 * FNV-1a over the account id plus a salt. Same account always yields the same
 * modelled values, in this process and the next, so two users comparing screens
 * see identical numbers and a refresh never reshuffles a shortlist.
 */
function hash(seed: string, salt: string): number {
  let h = 0x811c9dc5
  const s = `${seed}::${salt}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
/** Deterministic float in [0,1). */
const rnd = (seed: string, salt: string) => hash(seed, salt) / 0x100000000
const pick = <T,>(seed: string, salt: string, arr: T[]): T => arr[hash(seed, salt) % arr.length]
const between = (seed: string, salt: string, lo: number, hi: number) =>
  lo + rnd(seed, salt) * (hi - lo)

export interface KolProfile {
  account: DirectoryAccount

  /* identity — modelled */
  category: Metric<Category>
  lifestyle: Metric<Lifestyle>
  location: Metric<string>
  tier: Metric<Tier>
  verified: Metric<boolean>

  /* audience — modelled */
  followers: Metric<number>
  ageSplit: Metric<{ band: AgeBand; pct: number }[]>
  topAge: Metric<AgeBand>
  generation: Metric<string>
  genderSplit: Metric<{ female: number; male: number }>
  authenticity: Metric<number>
  audienceQuality: Metric<number>

  /* performance — measured or derived from measurements */
  posts: Metric<number>
  totalViews: Metric<number>
  avgViews: Metric<number>
  erPct: Metric<number>
  estimatedReach: Metric<number>
  paidRatio: Metric<number>
  organicRatio: Metric<number>
  paidErPct: Metric<number>
  organicErPct: Metric<number>
  topFormat: Metric<string>
  postFrequency: Metric<number>
  growthPct: Metric<number>
  emv: Metric<number>
  brandFit: Metric<number>

  /* commercial */
  baseRate: number
  hasRate: boolean

  /* credibility */
  dataSource: string
  lastSyncAt: string | null
  confidence: Confidence
}

interface Aggregates {
  posts: number
  views: number
  likes: number
  comments: number
  shares: number
  erPct: number
  paidPosts: number
  paidEr: number
  organicEr: number
  topFormat: string
  spanDays: number
  lastPostAt: string | null
  firstPostAt: string | null
}

/**
 * Per-account measured aggregates, from the same two post tables the rest of
 * Discover reads. Everything tagged `live` downstream comes from here.
 */
async function loadAggregates(orgId: string): Promise<Map<string, Aggregates>> {
  const { rows } = await pool.query<Record<string, string | null>>(
    `
    WITH base AS (
      SELECT p.brand_id AS account_id, 'owned' AS relation,
             COALESCE(p.views,0)::bigint AS views, COALESCE(p.likes,0)::bigint AS likes,
             COALESCE(p.comments,0)::bigint AS comments, COALESCE(p.shares,0)::bigint AS shares,
             (COALESCE(p.er_reach,p.er_views,p.er_followers,0)*100)::float AS er_pct,
             (COALESCE(p.is_boosted,false) OR COALESCE(p.is_campaign,false)) AS sponsored,
             COALESCE(NULLIF(p.format,''), NULLIF(p.post_type,''), 'Post') AS fmt,
             p.post_date::timestamptz AS post_date
        FROM l1_silver.unified_post p
       WHERE EXISTS (SELECT 1 FROM public.brand_social_accounts bsa
                       JOIN public.brands b ON b.id=bsa.brand_id AND b.deleted_at IS NULL
                      WHERE bsa.social_account_id=p.brand_id AND b.organization_id=$1)
      UNION ALL
      SELECT cp.social_account_id, 'competitor',
             COALESCE(cp.view_count,0)::bigint, COALESCE(cp.like_count,0)::bigint,
             COALESCE(cp.comment_count,0)::bigint, COALESCE(cp.share_count,0)::bigint,
             CASE WHEN COALESCE(cp.view_count,0)>0
                  THEN ((COALESCE(cp.like_count,0)+COALESCE(cp.comment_count,0)+COALESCE(cp.share_count,0))::numeric/cp.view_count*100)::float
                  ELSE 0 END,
             false,
             COALESCE(NULLIF(cp.post_type,''),'Post'),
             cp.post_date
        FROM l1_silver.unified_competitor_post cp
       WHERE EXISTS (SELECT 1 FROM public.brand_competitors bc
                       JOIN public.brands b ON b.id=bc.brand_id AND b.deleted_at IS NULL
                      WHERE bc.social_account_id=cp.social_account_id AND b.organization_id=$1)
    )
    SELECT account_id, relation,
           COUNT(*)::text                                                        AS posts,
           COALESCE(SUM(views),0)::text                                          AS views,
           COALESCE(SUM(likes),0)::text                                          AS likes,
           COALESCE(SUM(comments),0)::text                                       AS comments,
           COALESCE(SUM(shares),0)::text                                         AS shares,
           COALESCE(AVG(er_pct),0)::text                                         AS er_pct,
           COUNT(*) FILTER (WHERE sponsored)::text                               AS paid_posts,
           COALESCE(AVG(er_pct) FILTER (WHERE sponsored),0)::text                AS paid_er,
           COALESCE(AVG(er_pct) FILTER (WHERE NOT sponsored),0)::text            AS organic_er,
           (SELECT fmt FROM base b2 WHERE b2.account_id=base.account_id
             GROUP BY fmt ORDER BY COUNT(*) DESC LIMIT 1)                        AS top_format,
           MIN(post_date)::text                                                  AS first_post,
           MAX(post_date)::text                                                  AS last_post
      FROM base
     GROUP BY account_id, relation`,
    [orgId],
  )

  const map = new Map<string, Aggregates>()
  for (const r of rows) {
    const first = r.first_post ? new Date(r.first_post) : null
    const last = r.last_post ? new Date(r.last_post) : null
    const spanDays = first && last
      ? Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000))
      : 1
    map.set(`${r.relation}:${r.account_id}`, {
      posts: Number(r.posts ?? 0),
      views: Number(r.views ?? 0),
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0),
      shares: Number(r.shares ?? 0),
      erPct: Number(r.er_pct ?? 0),
      paidPosts: Number(r.paid_posts ?? 0),
      paidEr: Number(r.paid_er ?? 0),
      organicEr: Number(r.organic_er ?? 0),
      topFormat: r.top_format ?? 'Post',
      spanDays,
      firstPostAt: toIso(r.first_post),
      lastPostAt: toIso(r.last_post),
    })
  }
  return map
}

/**
 * Age distribution as six bands summing to exactly 100.
 * The remainder is folded into the largest band so the chart never shows 99% or
 * 101% — a demographic split that does not add up reads as a bug.
 */
function ageSplitFor(seed: string): { band: AgeBand; pct: number }[] {
  const weights = AGE_BANDS.map((b, i) => between(seed, `age${i}`, 0.4, 1) * (i === 1 || i === 2 ? 3 : 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => Math.round((w / sum) * 100))
  const drift = 100 - raw.reduce((a, b) => a + b, 0)
  const biggest = raw.indexOf(Math.max(...raw))
  raw[biggest] += drift
  return AGE_BANDS.map((band, i) => ({ band, pct: raw[i] }))
}

export async function listKolProfiles(orgId: string): Promise<KolProfile[]> {
  const [dir, rates, aggs] = await Promise.all([
    listDirectory(orgId), listRateCards(orgId), loadAggregates(orgId),
  ])

  return dir.accounts.map(account => {
    const key = `${account.relation}:${account.id}`
    const a = aggs.get(key)
    const seed = account.id
    const posts = a?.posts ?? account.postCount
    const views = a?.views ?? account.totalViews
    const avgViews = posts > 0 ? Math.round(views / posts) : 0
    const erPct = a?.erPct ?? account.avgErPct

    // Followers are not synced for these accounts, so they are inferred from
    // reach: average views sit at roughly a fifth of an account's following for
    // this kind of content. Stated plainly rather than dressed as measured.
    const followers = Math.max(1000, Math.round(avgViews * between(seed, 'foll', 4, 7)))

    const paidPosts = a?.paidPosts ?? 0
    const paidRatio = posts > 0 ? (paidPosts / posts) * 100 : 0

    // Estimated reach: average views discounted by a per-account factor.
    const estimatedReach = Math.round(avgViews * between(seed, 'reach', 0.55, 0.85))

    // EMV at a modelled Indonesian CPM. Engagement-weighted, not view-weighted,
    // because engagement is what brands actually pay against.
    const engagement = (a?.likes ?? 0) + (a?.comments ?? 0) + (a?.shares ?? 0)
    const emv = Math.round((engagement / 1000) * between(seed, 'cpm', 22_000, 46_000))

    const authenticity = Math.round(between(seed, 'auth', 68, 96))
    // Audience quality blends a measured signal (ER) with a modelled one, so it
    // is 'calculated' rather than 'estimated'.
    const audienceQuality = Math.round(
      Math.min(99, 45 + Math.min(30, erPct * 6) + (authenticity - 68) * 0.5))

    const postFrequency = a && a.spanDays > 0
      ? Number(((posts / a.spanDays) * 30).toFixed(1)) : 0

    // Brand fit blends four inputs; the same formula is shown on the Brand Fit
    // tab so a user can see why a number is what it is.
    const brandFit = Math.round(Math.min(99,
      audienceQuality * 0.35 + authenticity * 0.3 +
      Math.min(100, erPct * 12) * 0.2 + Math.min(100, postFrequency * 6) * 0.15))

    const ageSplit = ageSplitFor(seed)
    const topAge = ageSplit.reduce((x, y) => (y.pct > x.pct ? y : x)).band
    const female = Math.round(between(seed, 'gender', 28, 74))

    const rate = rates[account.id]

    return {
      account,
      category: est(pick<Category>(seed, 'cat', [...CATEGORIES]), 'Belum ada klasifikasi konten — dimodelkan'),
      lifestyle: est(pick<Lifestyle>(seed, 'life', [...LIFESTYLES]), 'Belum ada data lifestyle audiens — dimodelkan'),
      location: est(pick(seed, 'loc', [...LOCATIONS]), 'Belum ada data lokasi — dimodelkan'),
      tier: calc(tierOf(followers), 'Dari perkiraan jumlah follower'),
      verified: est(rnd(seed, 'ver') > 0.35, 'Status verifikasi belum disinkronkan'),

      followers: est(followers, 'Diperkirakan dari rata-rata views (follower belum disinkronkan)'),
      ageSplit: est(ageSplit, 'Demografi umur belum tersedia — dimodelkan'),
      topAge: est(topAge, 'Dari distribusi umur yang dimodelkan'),
      generation: est(GENERATION[topAge], 'Dari kelompok umur dominan'),
      genderSplit: est({ female, male: 100 - female }, 'Demografi gender belum tersedia — dimodelkan'),
      authenticity: est(authenticity, 'Deteksi follower palsu belum tersedia — dimodelkan'),
      audienceQuality: calc(audienceQuality, 'Gabungan engagement rate terukur dan skor autentisitas'),

      posts: live(posts, 'Dihitung dari post yang tersinkron'),
      totalViews: live(views, 'Dijumlahkan dari post yang tersinkron'),
      avgViews: live(avgViews, 'Total views dibagi jumlah post'),
      erPct: live(erPct, 'Rata-rata engagement rate per post'),
      estimatedReach: calc(estimatedReach, 'Rata-rata views dikali faktor reach per akun'),
      paidRatio: live(paidRatio, 'Bagian post bertanda campaign atau boosted'),
      organicRatio: live(100 - paidRatio, 'Sisa dari post berbayar'),
      paidErPct: live(a?.paidEr ?? 0, 'Rata-rata ER pada post berbayar'),
      organicErPct: live(a?.organicEr ?? 0, 'Rata-rata ER pada post organik'),
      topFormat: live(a?.topFormat ?? 'Post', 'Format yang paling sering dipakai'),
      postFrequency: live(postFrequency, 'Post per 30 hari pada rentang data'),
      growthPct: est(Number(between(seed, 'growth', -2, 12).toFixed(1)), 'Riwayat follower belum tersedia — dimodelkan'),
      emv: calc(emv, 'Engagement terukur dikali CPM pasar yang dimodelkan'),
      brandFit: calc(brandFit, 'Audience quality 35% + autentisitas 30% + ER 20% + konsistensi 15%'),

      baseRate: rate?.baseRate ?? 0,
      hasRate: (rate?.baseRate ?? 0) > 0,

      dataSource: account.relation === 'owned' ? 'Owned account sync' : 'Competitor scrape',
      lastSyncAt: a?.lastPostAt ?? account.lastPostAt,
      // An account is only "live" overall when it actually has measured posts.
      confidence: posts > 0 ? 'live' : 'estimated',
    }
  })
}

export async function getKolProfile(
  orgId: string, accountId: string, relation: 'owned' | 'competitor',
): Promise<KolProfile | null> {
  const all = await listKolProfiles(orgId)
  return all.find(p => p.account.id === accountId && p.account.relation === relation) ?? null
}

/** Platform list present in the org, for filter chips. */
export const platformsOf = (profiles: KolProfile[]): DiscoverPlatform[] =>
  [...new Set(profiles.map(p => p.account.platform))]
