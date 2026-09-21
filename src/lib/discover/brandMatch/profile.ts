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

  /*
   * Exactly the fields of the Brand Profile form (the product prototype), plus
   * `organizationId`, `brandId` and `updatedAt`. Nine legacy fields with no
   * form input and no reader — keywords, hashtags, caption terms, tone,
   * performance targets, the follower/ER minimums and the two eligibility
   * toggles — were dropped by `migrations/kol/009`.
   */

  /* Company Profile + Brand Identity */
  brandName: string | null
  brandDescription: string | null
  /** Company website, free text; optional. Stored only (migrations/kol/008). */
  companyWebsite: string | null
  /** One of `CANONICAL_CATEGORIES`, or null while the profile is incomplete. */
  brandCategory: string | null
  brandPersonality: string[]
  /**
   * Brand Values (migrations/kol/008). Stored and shown only: no Brand Match,
   * What Matters or Brand Fit code reads it.
   */
  brandValues: string[]

  /* Target Audience */
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

  /** Age Range — added by `migrations/kol/002_brand-fit-inputs.sql`. */
  targetAgeMin: number | null
  targetAgeMax: number | null

  /* Ideal Creator Profile */
  preferredCategories: string[]
  preferredPlatforms: string[]
  preferredTiers: string[]
  contentStyles: string[]

  /* What Matters — the criteria Brand Match averages (migrations/kol/007) */
  whatMatters: WhatMattersKey[]

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
    companyWebsite: null,
    brandCategory: null,
    brandPersonality: [],
    brandValues: [],
    genderMajority: 'Any',
    targetCountry: null,
    targetCity: null,
    audienceInterests: [],
    targetAgeMin: null,
    targetAgeMax: null,
    preferredCategories: [],
    preferredPlatforms: [],
    preferredTiers: [],
    contentStyles: [],
    whatMatters: [],
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
  company_website: string | null
  brand_category: string | null
  brand_personality: string[]
  brand_values: string[] | null
  gender_majority: string
  target_country: string | null
  target_city: string | null
  audience_interests: string[]
  target_age_min: number | null
  target_age_max: number | null
  preferred_categories: string[]
  preferred_platforms: string[]
  preferred_tiers: string[]
  content_styles: string[]
  what_matters: string[] | null
  updated_at: Date | null
}

const COLUMNS = `
  organization_id, brand_id, brand_name, brand_description, brand_category,
  brand_personality, gender_majority, target_country, target_city, audience_interests,
  target_age_min, target_age_max,
  preferred_categories, preferred_platforms, preferred_tiers, content_styles,
  what_matters, updated_at, company_website, brand_values`

function fromRow(r: Row): BrandProfile {
  return {
    organizationId: r.organization_id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    brandDescription: r.brand_description,
    companyWebsite: r.company_website,
    brandCategory: r.brand_category,
    brandPersonality: r.brand_personality ?? [],
    brandValues: r.brand_values ?? [],
    genderMajority: (GENDER_MAJORITIES as readonly string[]).includes(r.gender_majority)
      ? r.gender_majority as GenderMajority : 'Any',
    targetCountry: r.target_country,
    targetCity: r.target_city,
    audienceInterests: r.audience_interests ?? [],
    targetAgeMin: r.target_age_min === null ? null : Number(r.target_age_min),
    targetAgeMax: r.target_age_max === null ? null : Number(r.target_age_max),
    preferredCategories: r.preferred_categories ?? [],
    preferredPlatforms: r.preferred_platforms ?? [],
    preferredTiers: r.preferred_tiers ?? [],
    contentStyles: r.content_styles ?? [],
    whatMatters: cleanWhatMatters(r.what_matters ?? []),
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
 */
const LIST_CAP = 25

/** A website is a short string; anything longer is a paste error, not a URL. */
const WEBSITE_MAX = 2048
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

  const website = has('companyWebsite') ? str(input.companyWebsite) : current.companyWebsite
  if (website !== null && website.length > WEBSITE_MAX) {
    throw new BrandProfileError(`companyWebsite must be at most ${WEBSITE_MAX} characters`)
  }

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
    companyWebsite: website,
    // Prototype vocabulary plus custom values, cleaned like the other free lists.
    brandValues: has('brandValues') ? cleanList(input.brandValues) : current.brandValues,
    genderMajority: gender,
    targetCountry: has('targetCountry') ? str(input.targetCountry) : current.targetCountry,
    targetCity: has('targetCity') ? str(input.targetCity) : current.targetCity,
    audienceInterests: has('audienceInterests')
      ? cleanEnum(input.audienceInterests, INTEREST_KEYS) : current.audienceInterests,
    targetAgeMin: ageMin,
    targetAgeMax: ageMax,
    preferredCategories: has('preferredCategories')
      ? cleanEnum(input.preferredCategories, CANONICAL_CATEGORIES) : current.preferredCategories,
    preferredPlatforms: has('preferredPlatforms')
      ? cleanList(input.preferredPlatforms, 8).map(p => p.toLowerCase()) : current.preferredPlatforms,
    preferredTiers: has('preferredTiers') ? cleanList(input.preferredTiers, 8) : current.preferredTiers,
    contentStyles: has('contentStyles') ? cleanList(input.contentStyles, 12) : current.contentStyles,
    // Closed vocabulary of six; anything else (brand_safety included) is dropped,
    // the same way audienceInterests treats an unknown key.
    whatMatters: has('whatMatters') ? cleanWhatMatters(input.whatMatters) : current.whatMatters,
  }

  // `kolDbWrite()`, not `kolDb()`: this is the one place Brand Match writes to
  // the KOL server, and the function name is how a reader grepping for writes
  // finds it. Same server and same credentials — the split is about intent.
  const { rows } = await kolDbWrite().query<Row>(`
    INSERT INTO public.brand_profile (
      organization_id, brand_name, brand_description, brand_category,
      brand_personality, gender_majority, target_country, target_city, audience_interests,
      target_age_min, target_age_max,
      preferred_categories, preferred_platforms, preferred_tiers, content_styles,
      what_matters, updated_by, company_website, brand_values, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
    ON CONFLICT (organization_id) DO UPDATE SET
      -- brand_id is deliberately absent: NULL on create, unchanged on update.
      brand_name = EXCLUDED.brand_name,
      brand_description = EXCLUDED.brand_description,
      brand_category = EXCLUDED.brand_category,
      brand_personality = EXCLUDED.brand_personality,
      gender_majority = EXCLUDED.gender_majority,
      target_country = EXCLUDED.target_country,
      target_city = EXCLUDED.target_city,
      audience_interests = EXCLUDED.audience_interests,
      target_age_min = EXCLUDED.target_age_min,
      target_age_max = EXCLUDED.target_age_max,
      preferred_categories = EXCLUDED.preferred_categories,
      preferred_platforms = EXCLUDED.preferred_platforms,
      preferred_tiers = EXCLUDED.preferred_tiers,
      content_styles = EXCLUDED.content_styles,
      what_matters = EXCLUDED.what_matters,
      updated_by = EXCLUDED.updated_by,
      company_website = EXCLUDED.company_website,
      brand_values = EXCLUDED.brand_values,
      updated_at = NOW()
    RETURNING ${COLUMNS}`,
  [
    organizationId, next.brandName, next.brandDescription, next.brandCategory,
    next.brandPersonality, next.genderMajority, next.targetCountry, next.targetCity,
    next.audienceInterests, next.targetAgeMin, next.targetAgeMax,
    next.preferredCategories, next.preferredPlatforms, next.preferredTiers, next.contentStyles,
    next.whatMatters, updatedBy, next.companyWebsite, next.brandValues,
  ])

  return fromRow(rows[0])
}
