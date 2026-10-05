import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { CANONICAL_CATEGORIES, INTEREST_KEYS } from './model'
import { cleanWhatMatters, type WhatMattersKey } from '@/lib/discover/whatMatters/brandMatch'
import { selectedAudienceCriteria } from '@/lib/discover/whatMatters/audienceMatch'

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
 * ── One shape, since the engine swap ───────────────────────────────────────
 * There used to be three: `BrandProfile` for the form, `ScoringBrand` for the
 * weighted scorer's eight fields, and `EligibilityRules` for the Ideal Creator
 * Profile as directory filters. Both adapters are gone with the scorer they
 * fed. Brand Match now reads this profile directly — `whatMatters` for the
 * criteria it averages, and the Target Audience fields for the audience
 * criteria (`@/lib/discover/whatMatters/audienceMatch`) — so a second shape in
 * between would only be a place for the two to drift.
 */

/* ── the profile ──────────────────────────────────────────────────────────── */

export interface BrandProfile {
  organizationId: string
  /**
   * `public.agencies.id` on the KOL server — the workspace this profile belongs
   * to, and the `organization_id` the table is UNIQUE on. One agency, one
   * profile. It is the id `requireOrgMemberById` authorised, never one a
   * request body chose.
   */
  brandId: string | null

  /*
   * Exactly the fields of the Brand Profile form, plus `organizationId`,
   * `brandId` and `updatedAt`. Nine legacy fields with no form input and no
   * reader — keywords, hashtags, caption terms, tone, performance targets, the
   * follower/ER minimums and the two eligibility toggles — were dropped by
   * `migrations/kol/009`, together with the weighted scorer that read them.
   */

  /* Company Profile + Brand Identity */
  brandName: string | null
  brandDescription: string | null
  /** Company website, free text; optional. Stored only (migrations/kol/008). */
  companyWebsite: string | null
  /** One of `CANONICAL_CATEGORIES`, or null while the profile is incomplete. */
  brandCategory: string | null
  // Brand personality and Brand values were removed from the profile, and
  // `migrations/kol/011` dropped their columns (`brand_personality`,
  // `brand_values`) from `brand_profile`.

  /* Target Audience — each filled-in field selects one Brand Match criterion.
   * See `@/lib/discover/whatMatters/audienceMatch`: an empty field is not
   * selected and never reaches the denominator. */
  genderMajority: GenderMajority
  /**
   * TODO(BLOCKED — decision needed): the stored format. The audience data keys
   * countries by ISO-2 (`ID`) and Brand Fit reads ISO-2, while the literal
   * 'Indonesia' is what has been stored so far. One value cannot satisfy both,
   * so this stays free text and `audienceCountryScore` canonicalises on read.
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
 * Whether this profile can produce a Match %.
 *
 * It is a question about the SELECTION, not about the brand's identity. Brand
 * Match is the mean of the criteria this profile chose — the What Matters keys
 * (`whatMatters`) and the Target Audience fields that are filled in — so a
 * profile that has chosen none of them has nothing to average, and the engine
 * answers `unavailable: 'no_selection'` rather than a number.
 *
 * This used to require `brandCategory`, because the weighted scorer's Category
 * Match was the one component that reached the whole roster. That scorer is
 * gone, and with it the reason: a brand category now changes no Match %, so
 * gating the score on it would refuse to answer a question it does not affect.
 */
export function isScoreable(p: BrandProfile): boolean {
  return p.whatMatters.length > 0 || selectedAudienceCriteria(p).length > 0
}

/* ── read ─────────────────────────────────────────────────────────────────── */

interface Row {
  organization_id: string
  brand_id: string | null
  brand_name: string | null
  brand_description: string | null
  company_website: string | null
  brand_category: string | null
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
  gender_majority, target_country, target_city, audience_interests,
  target_age_min, target_age_max,
  preferred_categories, preferred_platforms, preferred_tiers, content_styles,
  what_matters, updated_at, company_website`

function fromRow(r: Row): BrandProfile {
  return {
    organizationId: r.organization_id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    brandDescription: r.brand_description,
    companyWebsite: r.company_website,
    brandCategory: r.brand_category,
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
    // Unknown keys — `brand_safety`, a typo — are dropped on READ as well as on
    // write, so a row written before the vocabulary settled cannot select a
    // criterion that no longer exists.
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
export type BrandProfileInput = Partial<Omit<BrandProfile, 'organizationId' | 'updatedAt'>>

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
/** Company Website is stored, never fetched; the cap is only to bound the row. */
const WEBSITE_MAX = 500
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
 * Resolves the `public.brand` row this profile points at, creating one the
 * first time a workspace names its brand.
 *
 * This is the join that makes Brand Fit reachable. Its grain is
 * `(agency_kol_account_id, brand_id)` with `brand_id` a FK to `public.brand`, so
 * a profile whose `brand_id` is null can be scored by Brand Match but never by
 * Brand Fit — there is no brand to be a fit FOR.
 *
 *   named brand, no link yet  -> INSERT one `public.brand`, link it
 *   caller supplied a brandId -> verify it exists, then link it
 *   already linked            -> keep it
 *
 * `public.brand` is written with identity only — name and category — and only
 * on creation. Later profile edits do not rewrite it: six other modules read
 * that table for identity, and Brand Fit prefers `brand_profile.brand_name`
 * anyway, so a renamed profile costs nothing and touches nothing.
 *
 * A non-existent `brandId` is rejected rather than stored. The column has no FK
 * of its own, so an unchecked id would sit there looking valid and produce a
 * 404 from the Brand Fit route much later, far from the cause.
 */
async function resolveBrandLink(
  agencyId: string,
  input: BrandProfileInput,
  current: BrandProfile,
  name: string | null,
  category: string | null,
): Promise<string | null> {
  if ('brandId' in input) {
    const wanted = str(input.brandId)
    if (!wanted) return null
    // Only one of this agency's own brands can be linked. Another agency's
    // brand id answers exactly like an unknown one, so ids cannot be probed.
    const { rows } = await kolDb().query<{ id: string }>(
      'SELECT id FROM public.brand WHERE id = $1 AND agency_id = $2', [wanted, agencyId])
    if (!rows[0]) {
      throw new BrandProfileError('No such brand in this agency.')
    }
    return rows[0].id
  }

  if (current.brandId) return current.brandId
  if (!name) return null

  // First save that names a brand. Two agencies naming the same brand get a
  // row each, which is correct: `public.brand` is keyed by agency, and the
  // row carries its owner so Brand Fit can check it.
  const { rows } = await kolDbWrite().query<{ id: string }>(
    `INSERT INTO public.brand (agency_id, name, category, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW(), NOW())
     RETURNING id`,
    [agencyId, name, category])
  return rows[0].id
}

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

  // Resolved BEFORE the upsert so a bad brandId fails without writing anything.
  const brandId = await resolveBrandLink(organizationId, input, current, name, category)

  const ageMin = has('targetAgeMin') ? age(input.targetAgeMin) : current.targetAgeMin
  const ageMax = has('targetAgeMax') ? age(input.targetAgeMax) : current.targetAgeMax
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    throw new BrandProfileError('targetAgeMin cannot be greater than targetAgeMax')
  }

  const website = has('companyWebsite') ? str(input.companyWebsite) : current.companyWebsite
  if (website !== null && website.length > WEBSITE_MAX) {
    throw new BrandProfileError(`companyWebsite must be at most ${WEBSITE_MAX} characters`)
  }

  const next = {
    brandId,
    brandName: name,
    brandDescription: has('brandDescription') ? str(input.brandDescription) : current.brandDescription,
    companyWebsite: website,
    brandCategory: category,
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
    // Closed vocabulary of six; anything else (`brand_safety` included) is
    // dropped, the same way audienceInterests treats an unknown interest key.
    whatMatters: has('whatMatters') ? cleanWhatMatters(input.whatMatters) : current.whatMatters,
  }

  // `kolDbWrite()`, not `kolDb()`: this is the one place Brand Match writes to
  // the KOL server, and the function name is how a reader grepping for writes
  // finds it. Same server and same credentials — the split is about intent.
  const { rows } = await kolDbWrite().query<Row>(`
    INSERT INTO public.brand_profile (
      organization_id, brand_id, brand_name, brand_description, brand_category,
      gender_majority, target_country, target_city, audience_interests,
      target_age_min, target_age_max,
      preferred_categories, preferred_platforms, preferred_tiers, content_styles,
      what_matters, updated_by, company_website, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
    ON CONFLICT (organization_id) DO UPDATE SET
      brand_id = EXCLUDED.brand_id,
      brand_name = EXCLUDED.brand_name,
      brand_description = EXCLUDED.brand_description,
      brand_category = EXCLUDED.brand_category,
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
      updated_at = NOW()
    RETURNING ${COLUMNS}`,
  [
    organizationId, next.brandId, next.brandName, next.brandDescription, next.brandCategory,
    next.genderMajority, next.targetCountry, next.targetCity,
    next.audienceInterests, next.targetAgeMin, next.targetAgeMax,
    next.preferredCategories, next.preferredPlatforms, next.preferredTiers, next.contentStyles,
    next.whatMatters, updatedBy, next.companyWebsite,
  ])

  return fromRow(rows[0])
}
