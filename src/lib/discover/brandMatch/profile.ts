import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { CANONICAL_CATEGORIES, INTEREST_KEYS } from './model'
import { cleanWhatMatters, type WhatMattersKey } from '@/lib/discover/whatMatters/brandMatch'

/**
 * The Brand Profile: read, validated, written, and turned into the shape the
 * Brand Match Engine scores against.
 *
 * ── Both halves of the comparison are on the KOL server ────────────────────
 * It lives in `public.brand_profile` on the KOL pool (`@/lib/kolDb`), beside
 * the creator half it is compared against — see `migrations/kol/001` for why it
 * is not a column on `public.brand`, and why it is not named
 * `discover_brand_profiles`.
 *
 * It used to live on the warehouse (`@/lib/db`, `tsdb`), which made an
 * otherwise KOL-only feature unable to produce a score without a second
 * database. `@/lib/db` must not come back into this file: the pool, not the
 * table name, is what decides which server a query reaches, and the warehouse
 * still carries the abandoned `discover_brand_profiles` with zero rows in it.
 *
 * The warehouse table is deliberately left in place rather than dropped;
 * whoever owns that database decides its fate.
 *
 * ── Ported from `origin/engkol_v2`, with three deliberate differences ───────
 *   1. Tenant. `organizationId` is whatever `requireOrgMemberById` authorised,
 *      which on this branch is `public.agencies.id` on the KOL server — not an
 *      organization on the warehouse. Nothing in this file looks a tenant up.
 *   2. `brand_id` is never written. v2 created a `public.brand` row the first
 *      time a profile named a brand (`resolveBrandLink`) and linked it; that is
 *      removed. No official process creates `public.brand` yet (0 rows), and
 *      `migrations/kol/001` itself calls this column an opaque label that the
 *      scoring path does not read. It stays NULL on create and untouched on
 *      update; a request that tries to set it is rejected.
 *   3. The Brand Match adapters (`toScoringBrand`, `toEligibility`) are not
 *      ported: the Brand Match engine is not on this branch, and bringing its
 *      `./score` types along for an unused adapter would be dead weight.
 */

/* ── the profile ──────────────────────────────────────────────────────────── */

export interface BrandProfile {
  organizationId: string
  brandId: string | null

  /* Brand Identity. Brand Values is deliberately absent — see the migration. */
  brandName: string | null
  brandDescription: string | null
  /** One of `CANONICAL_CATEGORIES`, or null while the profile is incomplete. */
  brandCategory: string | null
  brandPersonality: string[]

  /* Engine inputs */
  brandKeywords: string[]
  brandHashtags: string[]
  captionTerms: string[]
  genderMajority: GenderMajority
  /**
   * TODO(BLOCKED — decision needed): the stored format. The audience data keys
   * countries by ISO-2 (`ID`), Brand Fit reads ISO-2, but v2's Brand Match
   * compares against the literal 'Indonesia'. One value cannot satisfy both, so
   * this stays free text, as in v2, until the engines agree.
   */
  targetCountry: string | null
  /** A city name as `l2_gold.audience_geo_daily.geo_key` spells it, e.g. 'Jakarta'. */
  targetCity: string | null
  audienceInterests: string[]

  /* Brand Fit inputs — added by `migrations/kol/002_brand-fit-inputs.sql`.
   *
   * Stored here and NOT in a second table, because this is already the brand
   * side of the same server. Brand Match ignores all four: `toScoringBrand()`
   * does not read them and no Match Score component changes because they exist.
   * `feature.brand_fit_analysis` is the only thing downstream of them. */
  brandTone: string[]
  targetAgeMin: number | null
  targetAgeMax: number | null
  /** Metric -> target value. Brand Fit decides which keys it recognises. */
  performanceTargets: Record<string, number>

  /* Ideal Creator Profile — eligibility, not score */
  preferredCategories: string[]
  preferredPlatforms: string[]
  preferredTiers: string[]
  contentStyles: string[]

  /* What Matters — the criteria Brand Match averages (migrations/kol/007) */
  whatMatters: WhatMattersKey[]
  minFollowers: number | null
  minErPct: number | null
  requireCategory: boolean
  verifiedOnly: boolean

  updatedAt: string | null
}

export const GENDER_MAJORITIES = ['Any', 'Female', 'Male', 'Balanced'] as const
export type GenderMajority = (typeof GENDER_MAJORITIES)[number]

/**
 * A profile with nothing filled in.
 *
 * Returned instead of null when an organization has never saved one, so the
 * form has something to render and the caller does not branch. It is NOT
 * scoreable — `isScoreable` is what decides that, and a blank profile fails it,
 * because a match score computed against no stated preference is not a match.
 */
export function emptyProfile(organizationId: string): BrandProfile {
  return {
    organizationId,
    brandId: null,
    brandName: null,
    brandDescription: null,
    brandCategory: null,
    brandPersonality: [],
    brandKeywords: [],
    brandHashtags: [],
    captionTerms: [],
    genderMajority: 'Any',
    targetCountry: null,
    targetCity: null,
    audienceInterests: [],
    brandTone: [],
    targetAgeMin: null,
    targetAgeMax: null,
    performanceTargets: {},
    preferredCategories: [],
    preferredPlatforms: [],
    preferredTiers: [],
    contentStyles: [],
    whatMatters: [],
    minFollowers: null,
    minErPct: null,
    requireCategory: false,
    verifiedOnly: false,
    updatedAt: null,
  }
}

/**
 * Whether this profile can produce a match score.
 *
 * The brand category is the one required field, and it is required because it
 * is the only input that reaches the whole roster: Category Match is scored for
 * every creator (a creator with no category scores the neutral 50 rather than
 * N/A), while keywords, hashtags, interests and geography are all N/A for the
 * large majority. A profile with a description and no category would produce a
 * score in which almost every component renormalised away — a number with
 * nothing behind it.
 */
export function isScoreable(p: BrandProfile): boolean {
  return !!p.brandCategory && (CANONICAL_CATEGORIES as readonly string[]).includes(p.brandCategory)
}

/* ── read ─────────────────────────────────────────────────────────────────── */

interface Row {
  organization_id: string
  brand_id: string | null
  brand_name: string | null
  brand_description: string | null
  brand_category: string | null
  brand_personality: string[]
  brand_keywords: string[]
  brand_hashtags: string[]
  caption_terms: string[]
  gender_majority: string
  target_country: string | null
  target_city: string | null
  audience_interests: string[]
  brand_tone: string[] | null
  target_age_min: number | null
  target_age_max: number | null
  performance_targets: Record<string, unknown> | null
  preferred_categories: string[]
  preferred_platforms: string[]
  preferred_tiers: string[]
  content_styles: string[]
  what_matters: string[] | null
  min_followers: string | null
  min_er_pct: string | null
  require_category: boolean
  verified_only: boolean
  updated_at: Date | null
}

const COLUMNS = `
  organization_id, brand_id, brand_name, brand_description, brand_category,
  brand_personality, brand_keywords, brand_hashtags, caption_terms,
  gender_majority, target_country, target_city, audience_interests,
  brand_tone, target_age_min, target_age_max, performance_targets,
  preferred_categories, preferred_platforms, preferred_tiers, content_styles,
  what_matters, min_followers, min_er_pct, require_category, verified_only, updated_at`

function fromRow(r: Row): BrandProfile {
  return {
    organizationId: r.organization_id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    brandDescription: r.brand_description,
    brandCategory: r.brand_category,
    brandPersonality: r.brand_personality ?? [],
    brandKeywords: r.brand_keywords ?? [],
    brandHashtags: r.brand_hashtags ?? [],
    captionTerms: r.caption_terms ?? [],
    genderMajority: (GENDER_MAJORITIES as readonly string[]).includes(r.gender_majority)
      ? r.gender_majority as GenderMajority : 'Any',
    targetCountry: r.target_country,
    targetCity: r.target_city,
    audienceInterests: r.audience_interests ?? [],
    brandTone: r.brand_tone ?? [],
    targetAgeMin: r.target_age_min === null ? null : Number(r.target_age_min),
    targetAgeMax: r.target_age_max === null ? null : Number(r.target_age_max),
    performanceTargets: cleanTargets(r.performance_targets),
    preferredCategories: r.preferred_categories ?? [],
    preferredPlatforms: r.preferred_platforms ?? [],
    preferredTiers: r.preferred_tiers ?? [],
    contentStyles: r.content_styles ?? [],
    whatMatters: cleanWhatMatters(r.what_matters ?? []),
    // NUMERIC and BIGINT arrive as strings from `pg`. Null stays null: "no
    // bound" and "a bound of zero" are different instructions.
    minFollowers: r.min_followers === null ? null : Number(r.min_followers),
    minErPct: r.min_er_pct === null ? null : Number(r.min_er_pct),
    requireCategory: r.require_category,
    verifiedOnly: r.verified_only,
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  }
}

export async function getBrandProfile(organizationId: string): Promise<BrandProfile> {
  const { rows } = await kolDb().query<Row>(
    `SELECT ${COLUMNS} FROM public.brand_profile WHERE organization_id = $1`,
    [organizationId])
  return rows[0] ? fromRow(rows[0]) : emptyProfile(organizationId)
}

/* ── write ────────────────────────────────────────────────────────────────── */

/** Everything a client may set. Absent keys keep their stored value. */
export type BrandProfileInput = Partial<Omit<BrandProfile, 'organizationId' | 'updatedAt' | 'brandId'>>

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t : null
}

/**
 * Cleans a free-text list: trims, drops blanks, de-duplicates case-insensitively
 * while keeping the first spelling, and caps the length.
 *
 * The cap is not arbitrary. Keyword and hashtag lists are scored by `overlap()`
 * as "share of the brand's slots that were found", so every term a brand adds
 * that its creators never say lowers every creator's Keyword Match equally. A
 * hundred-term list does not express more, it just drives the component toward
 * zero for everyone.
 */
const LIST_CAP = 25
function cleanList(v: unknown, cap = LIST_CAP): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of v) {
    const s = str(item)
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= cap) break
  }
  return out
}

/** Keeps only members of a closed vocabulary. Anything else is dropped. */
function cleanEnum(v: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(v)) return []
  const set = new Set(allowed)
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && set.has(x)))]
}

/** A non-negative bound, or null. `0` survives; it is a real lower bound. */
function bound(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Keeps only positive, finite numeric targets.
 *
 * Which METRIC NAMES count is Brand Fit's decision, not this file's —
 * `brandFit/records.ts` filters to the five it recognises when it reads. This
 * only guarantees the column holds numbers, so an unrecognised key is stored
 * and ignored rather than rejected here and duplicated as a second vocabulary.
 */
function cleanTargets(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) out[key.trim()] = n
  }
  return out
}

/** An age bound, or null. Rejects nonsense rather than storing it. */
function age(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 120) {
    throw new BrandProfileError('target age must be a number between 0 and 120')
  }
  return Math.round(n)
}

export class BrandProfileError extends Error {}

/**
 * `brand_id` is not settable here — see the header. Rejected rather than
 * silently dropped, so a caller that believes it is linking a brand finds out
 * immediately instead of reading back a profile that quietly is not linked.
 */
const NOT_SETTABLE = ['brandId'] as const

/**
 * Saves the profile and returns what was stored.
 *
 * Upsert on `organization_id`, which is the table's unique key — so saving
 * twice edits one row rather than growing a history nobody reads. The returned
 * value is read back out of the row rather than echoed from the input, so the
 * caller sees exactly what the next request will see. That is what makes §9's
 * "available to the KOL Directory immediately, without a restart" true rather
 * than hoped for: there is no cache between this write and the next read.
 */
export async function saveBrandProfile(
  organizationId: string,
  input: BrandProfileInput,
  updatedBy: string | null,
): Promise<BrandProfile> {
  for (const key of NOT_SETTABLE) {
    if (key in input) {
      throw new BrandProfileError(
        `${key} cannot be set through the Brand Profile; it is not linked to a brand here.`)
    }
  }

  const current = await getBrandProfile(organizationId)
  const has = <K extends keyof BrandProfileInput>(k: K) => k in input

  const category = has('brandCategory') ? str(input.brandCategory) : current.brandCategory
  if (category && !(CANONICAL_CATEGORIES as readonly string[]).includes(category)) {
    throw new BrandProfileError(
      `brandCategory must be one of the canonical categories: ${CANONICAL_CATEGORIES.join(', ')}`)
  }

  const gender = has('genderMajority') ? String(input.genderMajority) : current.genderMajority
  if (!(GENDER_MAJORITIES as readonly string[]).includes(gender)) {
    throw new BrandProfileError(
      `genderMajority must be one of: ${GENDER_MAJORITIES.join(', ')}`)
  }

  const name = has('brandName') ? str(input.brandName) : current.brandName

  const ageMin = has('targetAgeMin') ? age(input.targetAgeMin) : current.targetAgeMin
  const ageMax = has('targetAgeMax') ? age(input.targetAgeMax) : current.targetAgeMax
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    throw new BrandProfileError('targetAgeMin cannot be greater than targetAgeMax')
  }

  const next = {
    brandName: name,
    brandDescription: has('brandDescription') ? str(input.brandDescription) : current.brandDescription,
    brandCategory: category,
    brandPersonality: has('brandPersonality') ? cleanList(input.brandPersonality) : current.brandPersonality,
    brandKeywords: has('brandKeywords') ? cleanList(input.brandKeywords) : current.brandKeywords,
    brandHashtags: has('brandHashtags')
      // Stored without the leading '#': the creator-side haystack is built as
      // `#tag` tokens and `overlap()` is containment, so a stored '#running'
      // and a stored 'running' would both hit — but only one of them matches
      // what the UI shows back. Normalising on write keeps the two equal.
      ? cleanList(input.brandHashtags).map(h => h.replace(/^#+/, '')).filter(Boolean)
      : current.brandHashtags,
    captionTerms: has('captionTerms') ? cleanList(input.captionTerms) : current.captionTerms,
    genderMajority: gender,
    targetCountry: has('targetCountry') ? str(input.targetCountry) : current.targetCountry,
    targetCity: has('targetCity') ? str(input.targetCity) : current.targetCity,
    audienceInterests: has('audienceInterests')
      ? cleanEnum(input.audienceInterests, INTEREST_KEYS) : current.audienceInterests,
    brandTone: has('brandTone') ? cleanList(input.brandTone) : current.brandTone,
    targetAgeMin: ageMin,
    targetAgeMax: ageMax,
    performanceTargets: has('performanceTargets')
      ? cleanTargets(input.performanceTargets) : current.performanceTargets,
    preferredCategories: has('preferredCategories')
      ? cleanEnum(input.preferredCategories, CANONICAL_CATEGORIES) : current.preferredCategories,
    preferredPlatforms: has('preferredPlatforms')
      ? cleanList(input.preferredPlatforms, 8).map(p => p.toLowerCase()) : current.preferredPlatforms,
    preferredTiers: has('preferredTiers') ? cleanList(input.preferredTiers, 8) : current.preferredTiers,
    contentStyles: has('contentStyles') ? cleanList(input.contentStyles, 12) : current.contentStyles,
    // Closed vocabulary of six; anything else (brand_safety included) is dropped,
    // the same way audienceInterests treats an unknown key.
    whatMatters: has('whatMatters') ? cleanWhatMatters(input.whatMatters) : current.whatMatters,
    minFollowers: has('minFollowers') ? bound(input.minFollowers) : current.minFollowers,
    minErPct: has('minErPct') ? bound(input.minErPct) : current.minErPct,
    requireCategory: has('requireCategory') ? !!input.requireCategory : current.requireCategory,
    verifiedOnly: has('verifiedOnly') ? !!input.verifiedOnly : current.verifiedOnly,
  }

  // `kolDbWrite()`, not `kolDb()`: this is the one place Brand Match writes to
  // the KOL server, and the function name is how a reader grepping for writes
  // finds it. Same server and same credentials — the split is about intent.
  const { rows } = await kolDbWrite().query<Row>(`
    INSERT INTO public.brand_profile (
      organization_id, brand_name, brand_description, brand_category,
      brand_personality, brand_keywords, brand_hashtags, caption_terms,
      gender_majority, target_country, target_city, audience_interests,
      brand_tone, target_age_min, target_age_max, performance_targets,
      preferred_categories, preferred_platforms, preferred_tiers, content_styles,
      what_matters, min_followers, min_er_pct, require_category, verified_only, updated_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,NOW())
    ON CONFLICT (organization_id) DO UPDATE SET
      -- brand_id is deliberately absent: NULL on create, unchanged on update.
      brand_name = EXCLUDED.brand_name,
      brand_description = EXCLUDED.brand_description,
      brand_category = EXCLUDED.brand_category,
      brand_personality = EXCLUDED.brand_personality,
      brand_keywords = EXCLUDED.brand_keywords,
      brand_hashtags = EXCLUDED.brand_hashtags,
      caption_terms = EXCLUDED.caption_terms,
      gender_majority = EXCLUDED.gender_majority,
      target_country = EXCLUDED.target_country,
      target_city = EXCLUDED.target_city,
      audience_interests = EXCLUDED.audience_interests,
      brand_tone = EXCLUDED.brand_tone,
      target_age_min = EXCLUDED.target_age_min,
      target_age_max = EXCLUDED.target_age_max,
      performance_targets = EXCLUDED.performance_targets,
      preferred_categories = EXCLUDED.preferred_categories,
      preferred_platforms = EXCLUDED.preferred_platforms,
      preferred_tiers = EXCLUDED.preferred_tiers,
      content_styles = EXCLUDED.content_styles,
      what_matters = EXCLUDED.what_matters,
      min_followers = EXCLUDED.min_followers,
      min_er_pct = EXCLUDED.min_er_pct,
      require_category = EXCLUDED.require_category,
      verified_only = EXCLUDED.verified_only,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING ${COLUMNS}`,
  [
    organizationId, next.brandName, next.brandDescription, next.brandCategory,
    next.brandPersonality, next.brandKeywords, next.brandHashtags, next.captionTerms,
    next.genderMajority, next.targetCountry, next.targetCity, next.audienceInterests,
    next.brandTone, next.targetAgeMin, next.targetAgeMax,
    JSON.stringify(next.performanceTargets),
    next.preferredCategories, next.preferredPlatforms, next.preferredTiers, next.contentStyles,
    next.whatMatters,
    next.minFollowers, next.minErPct, next.requireCategory, next.verifiedOnly, updatedBy,
  ])

  return fromRow(rows[0])
}
