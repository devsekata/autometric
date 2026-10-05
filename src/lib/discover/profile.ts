import { listDirectory } from './directory'
import { listRateCards } from './rates'
import { accountFactsFor, femaleShare, NO_FACTS, type Breakdown } from './accountFacts'
import pool from '@/lib/db'
import { toIso } from './util'
import type { DirectoryAccount, DiscoverPlatform } from './types'

/**
 * Enriched KOL profiles for the Directory and detail workspace.
 *
 * Every value carries a `Confidence` that travels with it to the screen:
 *
 *   live       measured from this account's own posts or profile snapshots
 *              (followers, views, ER, formats, paid/organic split, cadence,
 *              audience demographics). These are facts.
 *   calculated derived from live values by an explicit formula stated in the UI.
 *   estimated  modelled, because no source exists. Deterministic per account,
 *              never random per render.
 *
 * ── What changed, and why ──────────────────────────────────────────────────
 * The `estimated` badge was doing too much work. A reader comparing two accounts
 * reads the numbers, not the badges, and several of these were not derived from
 * anything — they were a hash of the account id mapped onto a plausible range.
 *
 * **Followers and tier are now real.** `followers` was `avgViews × between(4,7)`
 * and `tier` was derived from that invention, so the Tier badge on every Tracked
 * Account was a guess about a guess. Both now come from
 * `l0_raw.{ig,tt,fb}_profile_snapshots` via `@/lib/discover/accountFacts` —
 * measured for 41 of 54 accounts, and `null` for the rest.
 *
 * **Age, gender and location are now real where they exist.** The platform
 * insights API answers only for accounts you hold a token for, so these are
 * populated for owned accounts and structurally absent for competitors. Null
 * where unmeasured; the UI prints an unavailable state rather than a band.
 *
 * **`growthPct` is gone.** It was `between(seed,-2,12)` and had no consumer.
 *
 * **`authenticity`, `audienceQuality`, `brandFit`, `ageSplit` and `genderSplit`
 * are gone entirely** — they had no real source and, since Phase 2A, no
 * consumer either. See the note in the type body.
 *
 * **`category`, `lifestyle` and `emv` are gone or null** — same reason. EMV in
 * particular was a real engagement count times a CPM drawn from a hash.
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

  /*
   * identity
   *
   * `category` and `lifestyle` used to live here. Both were `pick(seed, ...)`
   * over a fixed list - a 7-way and a 6-way coin flip per account - and neither
   * has a real source. The nearest candidate for category,
   * `l1_silver.unified_post.content_pillar`, is free text (it holds values like
   * 'tesyun') filled for 3 of 42 accounts, which is not a taxonomy. Lifestyle
   * is an audience psychographic the warehouse has no reading of at all.
   */
  /**
   * The audience's largest city, from the platform's own insights. Null when
   * this account has no demographics reading — which is every competitor, by
   * construction, and any owned account below the platform's reporting
   * threshold. Was `pick(seed, 'loc', LOCATIONS)`.
   */
  location: Metric<string | null>
  /** Derived from the REAL follower count. Null when followers are unmeasured. */
  tier: Metric<Tier | null>
  /** TikTok publishes this; the other platforms do not. Null means unknown. */
  verified: Metric<boolean | null>

  /* audience */
  /** Real, from the newest profile snapshot. Null when never synced. */
  followers: Metric<number | null>
  /**
   * The real audience age distribution, largest band first. Empty array when
   * unmeasured — the UI checks `.length`, and an empty chart is drawn as an
   * unavailable state rather than as six zero-height bars.
   */
  ageBands: Metric<Breakdown>
  topAge: Metric<string | null>
  /** Real gender split. Empty when unmeasured. */
  genderBands: Metric<Breakdown>
  /** Female share 0–100, or null when unmeasured. Never defaulted to 50. */
  femalePct: Metric<number | null>

  /*
   * `authenticity`, `audienceQuality`, `brandFit`, `ageSplit` and `genderSplit`
   * were quarantined here through Phases 1 and 2A: removed from every screen,
   * but kept alive because `predictSuccess()` and `optimiseSelection()` still
   * read them.
   *
   * Phase 2A replaced the last of those reads. A search across `src/` found
   * zero consumers of any of the five, so they are deleted rather than left as
   * dead generated code - which is the state in which a future change quietly
   * starts using one again.
   *
   * The OLD model that did use them is still reproducible: the before/after
   * harness in `scripts/verify-optimizer-regression.ts` restates each formula
   * locally, the same way it already restates the old reach formula. The
   * reconstruction lives with the comparison, not in the production type.
   */

  /* performance — measured or derived from measurements */
  posts: Metric<number>
  totalViews: Metric<number>
  avgViews: Metric<number>
  erPct: Metric<number>
  /**
   * Audience reached per post. **Nullable, and three different things.**
   *
   * Read `confidence` before using it, and never present it as measured reach
   * without checking:
   *
   *   `live`       the platform's own per-post `reach`, averaged over the posts
   *                that carry one. A real measurement. 19 of 42 accounts.
   *   `calculated` derived from measured VIEWS because no reach was reported.
   *                Views are a real measurement but a different one - a view is
   *                not a person, and on video the two diverge badly. 20 of 42.
   *   `null`       neither exists. 3 of 42, plus every account with no posts.
   *
   * It was `avgViews x between(seed, 'reach', 0.55, 0.85)` - a measured number
   * multiplied by a hash of the account id. That is why the ladder is explicit
   * now: the difference between "we measured reach", "we measured something
   * adjacent" and "we know nothing" was previously invisible.
   */
  estimatedReach: Metric<number | null>
  paidRatio: Metric<number>
  organicRatio: Metric<number>
  paidErPct: Metric<number>
  organicErPct: Metric<number>
  /** How many of this account's posts are tagged as campaign deliverables. */
  campaignPosts: Metric<number>
  /** Average ER across those posts. Null when the account has run none. */
  campaignErPct: Metric<number | null>
  /**
   * Campaign ER divided by the account's own non-campaign ER — how much better
   * (or worse) this profile does when it is running a brief.
   *
   * Ranking profiles by raw campaign ER would just rank accounts, the same trap
   * the post-level sort avoids: 4% is strong for one handle and weak for
   * another. The lift asks the only question a brief cares about — does paying
   * this account to post actually move its numbers — and it is null when the
   * account has no campaign posts, or nothing to compare them against.
   */
  campaignLift: Metric<number | null>
  topFormat: Metric<string>
  postFrequency: Metric<number>
  /**
   * Earned Media Value. **Always null.**
   *
   * It was `(likes + comments + shares) / 1000 x between(seed, 'cpm', 22000, 46000)`
   * - a real engagement count multiplied by a CPM drawn from a hash of the
   * account id. The engagement half was measured; the price half was invented,
   * and EMV is a money figure, so the invented half is the whole point of it.
   *
   * Nothing in autometric holds a real CPM or rate benchmark: searched across
   * `lib/dashboard`, `lib/reports` and `lib/metrics`, the only other EMV in the
   * codebase is `discover_orders.est_emv`, which is this same generated value
   * frozen at checkout. So there is no approved calculation to reuse, and a new
   * formula invented here to keep the tiles populated would be the same failure
   * with a fresh comment on top.
   *
   * Kept as a null-valued field rather than deleted so the shape of a profile
   * is stable for callers, and so the day a rate-card benchmark exists there is
   * an obvious place to put it. Every surface renders it as unavailable.
   */
  emv: Metric<number | null>

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
  campaignPosts: number
  /** Null, not zero: an account with no campaign posts has no campaign rate. */
  campaignEr: number | null
  nonCampaignEr: number | null
  /**
   * Mean of the platform-reported `reach` over the posts that carry one.
   *
   * Null when this account has no post with a positive reach - which is 23 of
   * the 42 accounts that have posts, and every competitor, because reach is an
   * insights metric and insights need an access token.
   */
  avgReach: number | null
  /** Mean of `views` over the posts that carry one. Null when none do. */
  avgViewsPos: number | null
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
             COALESCE(p.reach,0)::bigint AS reach,
             (COALESCE(p.is_boosted,false) OR COALESCE(p.is_campaign,false)) AS sponsored,
             COALESCE(p.is_campaign,false) AS is_campaign,
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
             -- A scraped competitor post has no reach column and never will:
             -- reach is an insights metric, and insights need a token.
             0::bigint,
             false,
             -- A scraped competitor post carries no campaign tag and never can.
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
           -- Real per-post reach, from the platform's own insights.
           -- FILTERed on > 0 rather than COALESCEd: reach is non-null on every
           -- row but zero on the 1.316 of 1.842 the platform never reported,
           -- and averaging those zeros in would halve a real figure.
           (AVG(reach)  FILTER (WHERE reach  > 0))::text                          AS avg_reach,
           (AVG(views)  FILTER (WHERE views  > 0))::text                          AS avg_views_pos,
           COALESCE(SUM(likes),0)::text                                          AS likes,
           COALESCE(SUM(comments),0)::text                                       AS comments,
           COALESCE(SUM(shares),0)::text                                         AS shares,
           COALESCE(AVG(er_pct),0)::text                                         AS er_pct,
           COUNT(*) FILTER (WHERE sponsored)::text                               AS paid_posts,
           COALESCE(AVG(er_pct) FILTER (WHERE sponsored),0)::text                AS paid_er,
           COALESCE(AVG(er_pct) FILTER (WHERE NOT sponsored),0)::text            AS organic_er,
           COUNT(*) FILTER (WHERE is_campaign)::text                             AS campaign_posts,
           -- Not COALESCEd: null here means "ran no campaign", which the lift
           -- has to be able to tell apart from "ran one and it scored zero".
           -- A rate of zero means never measured, so both averages skip those
           -- rows and the two halves stay like for like.
           (AVG(er_pct) FILTER (WHERE is_campaign AND er_pct > 0))::text          AS campaign_er,
           (AVG(er_pct) FILTER (WHERE NOT is_campaign AND er_pct > 0))::text      AS non_campaign_er,
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
      campaignPosts: Number(r.campaign_posts ?? 0),
      avgReach: r.avg_reach === null || r.avg_reach === undefined ? null : Number(r.avg_reach),
      avgViewsPos: r.avg_views_pos === null || r.avg_views_pos === undefined
        ? null : Number(r.avg_views_pos),
      campaignEr: r.campaign_er === null || r.campaign_er === undefined ? null : Number(r.campaign_er),
      nonCampaignEr: r.non_campaign_er === null || r.non_campaign_er === undefined
        ? null : Number(r.non_campaign_er),
      topFormat: r.top_format ?? 'Post',
      spanDays,
      firstPostAt: toIso(r.first_post),
      lastPostAt: toIso(r.last_post),
    })
  }
  return map
}

export async function listKolProfiles(orgId: string): Promise<KolProfile[]> {
  const [dir, rates, aggs] = await Promise.all([
    listDirectory(orgId), listRateCards(orgId), loadAggregates(orgId),
  ])

  // Real follower counts and audience demographics for every account on the
  // list, in one query. Fetched after `listDirectory` because it is the thing
  // that decides which accounts this caller may see.
  const facts = await accountFactsFor(dir.accounts.map(a => a.id))

  return dir.accounts.map(account => {
    const key = `${account.relation}:${account.id}`
    const a = aggs.get(key)
    const seed = account.id
    const posts = a?.posts ?? account.postCount
    const views = a?.views ?? account.totalViews
    const avgViews = posts > 0 ? Math.round(views / posts) : 0
    const erPct = a?.erPct ?? account.avgErPct

    /*
     * Followers, measured.
     *
     * This used to be `avgViews × between(seed, 'foll', 4, 7)` — a follower
     * count inferred from view counts by a ratio nobody measured, for accounts
     * whose real follower count was sitting unread in `l0_raw`. `tier` was then
     * derived from it, so the Tier badge was a guess about a guess.
     *
     * Null when this account has never been snapshotted. Not 0, and not a floor
     * of 1.000 as the old code used: a floor turns "unknown" into "small".
     */
    const f = facts.get(account.id) ?? NO_FACTS
    const followers = f.followers

    const paidPosts = a?.paidPosts ?? 0
    const paidRatio = posts > 0 ? (paidPosts / posts) * 100 : 0

    // Null unless both halves exist: an account with no campaign posts, or one
    // whose every non-campaign post went unmeasured, has nothing to divide.
    const campaignLift = a?.campaignEr != null && a?.nonCampaignEr != null && a.nonCampaignEr > 0
      ? a.campaignEr / a.nonCampaignEr
      : null

    /*
     * Reach per post, down the honest ladder. See the field's note.
     *
     * No branch here invents anything: tier 1 is the platform's reach column,
     * tier 2 is the platform's views column stated as what it is, and tier 3 is
     * null rather than a number.
     */
    const measuredReach = a?.avgReach ?? null
    const measuredViews = a?.avgViewsPos ?? null
    const estimatedReach = measuredReach !== null ? Math.round(measuredReach)
      : measuredViews !== null ? Math.round(measuredViews)
        : null



    const postFrequency = a && a.spanDays > 0
      ? Number(((posts / a.spanDays) * 30).toFixed(1)) : 0


    /*
     * Audience demographics, measured.
     *
     * Empty arrays and nulls where the platform has not reported a breakdown —
     * which is every competitor account by construction, because the insights
     * API only answers for an account you hold a token for. The UI draws an
     * unavailable state off `.length`, never a chart of zeroes.
     */
    const topAge = f.age[0]?.label ?? null
    const female = femaleShare(f.gender)
    const topCity = f.city[0]?.label ?? null

    const rate = rates[account.id]

    return {
      account,
      location: topCity === null
        ? est(null, 'Demografi lokasi audiens belum dilaporkan platform untuk akun ini')
        : live(topCity, 'Kota audiens terbesar dari platform insights'),
      tier: followers === null
        ? est(null, 'Jumlah follower belum tersinkron, jadi tier belum bisa ditentukan')
        : calc(tierOf(followers), 'Dari jumlah follower asli pada snapshot terakhir'),
      verified: f.verified === null
        ? est(null, 'Platform ini tidak mempublikasikan status verifikasi')
        : live(f.verified, 'Status verifikasi dari profile snapshot'),

      followers: followers === null
        ? est(null, 'Akun ini belum pernah tersinkron, jadi jumlah follower belum terukur')
        : live(followers, 'Jumlah follower dari profile snapshot terakhir'),
      ageBands: f.age.length
        ? live(f.age, 'Demografi umur audiens dari platform insights')
        : est([], 'Demografi umur belum dilaporkan platform untuk akun ini'),
      topAge: topAge === null
        ? est(null, 'Demografi umur belum dilaporkan platform untuk akun ini')
        : live(topAge, 'Kelompok umur audiens terbesar'),
      genderBands: f.gender.length
        ? live(f.gender, 'Demografi gender audiens dari platform insights')
        : est([], 'Demografi gender belum dilaporkan platform untuk akun ini'),
      femalePct: female === null
        ? est(null, 'Demografi gender belum dilaporkan platform untuk akun ini')
        : live(female, 'Bagian audiens perempuan dari platform insights'),


      posts: live(posts, 'Dihitung dari post yang tersinkron'),
      totalViews: live(views, 'Dijumlahkan dari post yang tersinkron'),
      avgViews: live(avgViews, 'Total views dibagi jumlah post'),
      erPct: live(erPct, 'Rata-rata engagement rate per post'),
      estimatedReach: measuredReach !== null
        ? live(Math.round(measuredReach), 'Rata-rata reach per post dari platform insights')
        : measuredViews !== null
          ? calc(Math.round(measuredViews),
            'PERKIRAAN dari rata-rata views terukur — platform tidak melaporkan reach untuk akun ini. Views bukan reach: satu orang bisa menonton berkali-kali.')
          : est(null, 'Platform belum melaporkan reach maupun views untuk akun ini'),
      paidRatio: live(paidRatio, 'Bagian post bertanda campaign atau boosted'),
      organicRatio: live(100 - paidRatio, 'Sisa dari post berbayar'),
      paidErPct: live(a?.paidEr ?? 0, 'Rata-rata ER pada post berbayar'),
      organicErPct: live(a?.organicEr ?? 0, 'Rata-rata ER pada post organik'),
      campaignPosts: live(a?.campaignPosts ?? 0, 'Jumlah post bertanda campaign'),
      campaignErPct: live(a?.campaignEr ?? null, 'Rata-rata ER pada post campaign'),
      campaignLift: calc(
        campaignLift,
        campaignLift === null
          ? 'Belum ada post campaign yang terukur untuk dibandingkan'
          : 'ER post campaign dibagi ER post non-campaign akun ini sendiri',
      ),
      topFormat: live(a?.topFormat ?? 'Post', 'Format yang paling sering dipakai'),
      postFrequency: live(postFrequency, 'Post per 30 hari pada rentang data'),
      emv: est(null, 'Belum ada benchmark CPM/rate yang terukur, jadi EMV belum bisa dihitung'),

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
