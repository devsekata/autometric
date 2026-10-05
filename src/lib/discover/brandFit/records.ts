/**
 * Brand Fit — reading the two sides out of the KOL database.
 *
 * Every query in this file goes through `kolDb()`. Brand Fit never touches
 * `@/lib/db`: the warehouse carries schemas with the same names — `feature`,
 * `l1_silver`, `l2_gold` all exist on both servers — so a query sent to the
 * wrong pool comes back with different numbers and no error at all. One pool,
 * named once, is the only defence against that.
 *
 * Nothing here scores anything. It shapes rows into the inputs `./engine.ts`
 * expects and stops.
 *
 * ── Platform comes from the roster, never from a table name ────────────────
 * `agency_kol_accounts.platform_id` is the creator's platform, and it is
 * carried through untouched. The audience tables are joined on
 * `social_account_id`, which belongs to exactly one platform already — so the
 * right row is selected by the key, not by guessing from `ig_` or `tt_` in a
 * relation's name.
 */
import kolDb from '@/lib/kolDb'
import type { BrandFitBrand, BrandFitCreator } from './engine'
import type { PoolClient } from 'pg'
import { type CreatorAudience, type GenderTarget } from './rules'

const GENDERS: readonly string[] = ['Any', 'Female', 'Male', 'Balanced']

/**
 * Anything that can run a query — the pool by default, or a caller's client.
 *
 * Passing a client lets a test open a transaction, insert a brand, read it back
 * through THESE functions rather than a copy of their SQL, and roll the whole
 * thing back. Without it a test would either need real production rows or a
 * second copy of the queries, and a second copy is how queries drift.
 */
export type Queryable = Pick<PoolClient, 'query'>

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : []

/**
 * Drops the `unknown` bucket and rescales what is left to sum to 100.
 *
 * The audience tables report shares of the followers they analysed, and a large
 * `unknown` slice is missing data rather than a group of people who failed to
 * match. Left in, it would push every share toward zero and make a creator with
 * poor coverage look like a poor fit. Rescaling over the KNOWN population asks
 * the right question: of the followers we could actually resolve, how many are
 * what the brand asked for.
 */
function knownShares(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => key.toLowerCase() !== 'unknown')
    .map(([key, value]) => [key, num(value)] as const)
    .filter((e): e is readonly [string, number] => e[1] !== null && e[1] > 0)
  const total = entries.reduce((a, [, v]) => a + v, 0)
  if (total <= 0) return null
  return Object.fromEntries(entries.map(([k, v]) => [k, (v / total) * 100]))
}

/**
 * `feature.{ig,tt}_audience_analysis.top_interest` as `{ interest: count }`.
 *
 * The column is a jsonb ARRAY of `{"interest": <key>, "count": <n>}` — the
 * scrapper's audience writer builds it that way, and every live row has that
 * shape — so handing it to `knownShares` directly returned null for every
 * creator and the Interest dimension fell back to a present/absent check on
 * `interest_top`. This folds the array into the object `knownShares` expects
 * (counts for a repeated key are summed); an object is passed through unchanged.
 * Anything else is unreadable and stays null — never a guessed share.
 */
export function interestShares(raw: unknown): Record<string, number> | null {
  if (!Array.isArray(raw)) return knownShares(raw)
  const counts: Record<string, number> = {}
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const key = String((item as { interest?: unknown }).interest ?? '').trim().toLowerCase()
    const count = num((item as { count?: unknown }).count)
    if (!key || count === null) continue
    counts[key] = (counts[key] ?? 0) + count
  }
  return knownShares(counts)
}

/* ── brand side ───────────────────────────────────────────────────────────── */

/**
 * Whether `public.brand` row `brandId` belongs to the agency. Brand Fit reads
 * and writes per brand, so every request-supplied brand id is checked against
 * the caller's agency before anything is loaded (a brand with no agency_id
 * belongs to no one and is refused too).
 */
export async function brandBelongsToAgency(
  brandId: string, agencyId: string, db: Queryable = kolDb(),
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM public.brand WHERE id = $1 AND agency_id = $2 LIMIT 1`,
    [brandId, agencyId],
  )
  return rows.length > 0
}

interface BrandRow {
  brand_id: string
  brand_name: string | null
  brand_category: string | null
  gender_majority: string | null
  target_age_min: number | null
  target_age_max: number | null
  target_country: string | null
  target_city: string | null
  audience_interests: string[] | null
}

/**
 * The brand half of one Brand Fit row.
 *
 * `public.brand` is the identity — it is what `brand_id` points at and it is the
 * reason the grain is what it is. The matching configuration lives beside it in
 * `public.brand_profile`, joined on `brand_profile.brand_id`, because
 * `public.brand` carries only category, keywords and hashtags and is read for
 * identity by six other modules (see `migrations/kol/002_brand-fit-inputs.sql`).
 *
 * A brand with no profile row still returns — with no category and no
 * targets, which the engine reports as NOT MEASURED. That is the truthful answer
 * for a brand nobody has configured, and it is not an error.
 *
 * `brand_profile` is unique per organisation, not per brand, so two workspaces
 * could in principle point at the same `brand_id`. The most recently updated
 * profile wins, deterministically, with `id` breaking an exact tie.
 */
export async function loadBrand(
  brandId: string, db: Queryable = kolDb(),
): Promise<BrandFitBrand | null> {
  const { rows } = await db.query<BrandRow>(`
    SELECT b.id                       AS brand_id,
           COALESCE(p.brand_name, b.name) AS brand_name,
           p.brand_category,
           p.gender_majority,
           p.target_age_min,
           p.target_age_max,
           p.target_country,
           p.target_city,
           p.audience_interests
      FROM public.brand b
      LEFT JOIN LATERAL (
        SELECT * FROM public.brand_profile bp
         WHERE bp.brand_id = b.id
         ORDER BY bp.updated_at DESC, bp.id
         LIMIT 1
      ) p ON TRUE
     WHERE b.id = $1`, [brandId])

  const r = rows[0]
  if (!r) return null

  const gender = GENDERS.includes(String(r.gender_majority))
    ? (r.gender_majority as GenderTarget)
    : 'Any'

  return {
    brandId: r.brand_id,
    brandName: r.brand_name,
    category: r.brand_category,
    audience: {
      gender,
      ageMin: num(r.target_age_min),
      ageMax: num(r.target_age_max),
      country: r.target_country,
      city: r.target_city,
      interests: list(r.audience_interests),
    },
    // `performance_targets` was dropped by migrations/kol/009 and has no
    // replacement column, so there are no targets: Past Performance reports
    // NOT MEASURED rather than scoring against invented numbers.
    performanceTargets: {},
  }
}

/* ── creator side ─────────────────────────────────────────────────────────── */

interface CreatorRow {
  agency_kol_account_id: string
  platform_id: string | null
  username: string | null
  categories: string[] | null
  engagement_rate: string | number | null
  median_views: string | number | null
  followers_growth: string | number | null
  post_frequency_reliability: string | number | null
  performance_stability: string | number | null
  has_audience: boolean
  female_pct: string | number | null
  male_pct: string | number | null
  gender_known_pct: string | number | null
  age_coverage_pct: string | number | null
  age_buckets: unknown
  geo_country: unknown
  geo_city: unknown
  interests: unknown
  interest_top: string | null
}

/**
 * One SQL statement per call, whatever the number of creators: the roster is
 * 7,431 rows and a per-creator round trip would be the whole cost of the
 * feature.
 *
 * Passing no ids loads the entire active roster, which is what a
 * "score this brand against everyone" run needs.
 */
export async function loadCreators(
  agencyKolAccountIds?: string[], db: Queryable = kolDb(), agencyId: string | null = null,
): Promise<BrandFitCreator[]> {
  const filtered = agencyKolAccountIds?.length ? agencyKolAccountIds : null

  const { rows } = await db.query<CreatorRow>(`
    WITH account AS (
      SELECT aka.id   AS agency_kol_account_id,
             aka.platform_id,
             kd.id    AS kol_directory_id,
             kd.username,
             kd.engagement_rate,
             kd.category_ids
        FROM public.agency_kol_accounts aka
        JOIN public.kol_directory kd ON kd.id = aka.kol_account_id
       WHERE ($1::uuid[] IS NULL OR aka.id = ANY($1::uuid[]))
         -- Tenant: only the calling agency's own active links. Ids from a
         -- request body are narrowed by this, never trusted on their own.
         AND ($2::uuid IS NULL OR (aka.agency_id = $2 AND aka.is_active IS TRUE))
    ),
    -- One social account per creator, chosen deterministically so repeated runs
    -- read the same audience row rather than whichever the planner returns first.
    social AS (
      SELECT DISTINCT ON (ksa.kol_id) ksa.kol_id, ksa.social_account_id
        FROM public.kol_social_account ksa
       WHERE ksa.kol_id IN (SELECT kol_directory_id FROM account)
       ORDER BY ksa.kol_id, ksa.social_account_id
    ),
    -- Joined on social_account_id, which already belongs to exactly one
    -- platform. The platform is never inferred from the relation's name.
    audience AS (
      SELECT social_account_id, female_pct, male_pct, gender_known_pct,
             age_gender_breakdown, geo_distribution, top_interest, interest_top,
             interest_source
        FROM feature.ig_audience_analysis
      UNION ALL
      SELECT social_account_id, female_pct, male_pct, gender_known_pct,
             age_gender_breakdown, geo_distribution, top_interest, interest_top,
             interest_source
        FROM feature.tt_audience_analysis
    )
    SELECT a.agency_kol_account_id,
           a.platform_id,
           a.username,
           (SELECT array_agg(DISTINCT kc.taxonomy_key)
              FROM public.kol_categories kc
             WHERE kc.id = ANY(a.category_ids) AND kc.taxonomy_key IS NOT NULL) AS categories,
           a.engagement_rate,
           pc.median_views,
           pc.followers_growth,
           pc.post_frequency_reliability,
           pc.performance_stability,
           (au.social_account_id IS NOT NULL) AS has_audience,
           au.female_pct, au.male_pct, au.gender_known_pct,
           (au.age_gender_breakdown->>'coverage_pct')::numeric AS age_coverage_pct,
           au.age_gender_breakdown->'age' AS age_buckets,
           au.geo_distribution->'country' AS geo_country,
           au.geo_distribution->'city'    AS geo_city,
           CASE WHEN au.interest_source = 'audience' THEN au.top_interest END AS interests,
           CASE WHEN au.interest_source = 'audience' THEN au.interest_top END AS interest_top
      FROM account a
      LEFT JOIN social s  ON s.kol_id = a.kol_directory_id
      LEFT JOIN audience au ON au.social_account_id = s.social_account_id
      LEFT JOIN l2_gold.kol_profile_card pc ON pc.social_account_id = s.social_account_id
     ORDER BY a.agency_kol_account_id`,
    [filtered, agencyId])

  return rows.map(toCreator)
}

function toCreator(r: CreatorRow): BrandFitCreator {
  return {
    agencyKolAccountId: r.agency_kol_account_id,
    platformId: r.platform_id,
    username: r.username,
    categories: (r.categories ?? []).filter(Boolean),
    audience: r.has_audience ? toAudience(r) : null,
    performance: {
      engagement_rate: num(r.engagement_rate),
      median_views: num(r.median_views),
      followers_growth: num(r.followers_growth),
      post_frequency_reliability: num(r.post_frequency_reliability),
      performance_stability: num(r.performance_stability),
    },
  }
}

function toAudience(r: CreatorRow): CreatorAudience {
  return {
    femalePct: num(r.female_pct),
    malePct: num(r.male_pct),
    genderKnownPct: num(r.gender_known_pct),
    ageBuckets: knownShares(r.age_buckets),
    ageCoveragePct: num(r.age_coverage_pct),
    countries: knownShares(r.geo_country),
    cities: knownShares(r.geo_city),
    interests: interestShares(r.interests),
    interestTop: r.interest_top,
  }
}
