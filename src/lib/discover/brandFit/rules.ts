/**
 * Brand Fit — the business rules, kept out of the calculation engine.
 *
 * `./calculator.ts` deliberately leaves three holes in the model: how two
 * categories relate, how an audience dimension is scored, and how past
 * performance is judged. This file fills those three holes, and it is the ONLY
 * file that has to change when product changes its mind about any of them.
 * The calculator stays untouched; the golden cases stay valid.
 *
 * Everything here is deterministic and pure — no database, no network, no
 * clock, no randomness. The same inputs always produce the same score.
 *
 * ── Status of each rule ────────────────────────────────────────────────────
 * Category      threshold >= 60 is a BRAND FIT DECISION (see below), applied
 *               to Brand Match's matrix, which is NOT modified.
 * Audience      one principle across all four dimensions: what share of the
 *               creator's audience matches what the brand asked for.
 * Performance   Option B, direct metric against a brand-stated target. No
 *               archetype anywhere, by design.
 * Weights       25/25/25/25, from the proposal, pending product approval.
 */
import { CATEGORY_RELATEDNESS } from '@/lib/discover/brandMatch/model'
import type {
  AudienceDimensions, CategoryResolver, CategoryVerdict, Score,
} from './calculator'
import { toScore } from './calculator'

/* ── 1. Category ──────────────────────────────────────────────────────────── */

/**
 * The relatedness value at or above which two categories count as `related`.
 *
 * THIS NUMBER IS A BRAND FIT DECISION, not a measurement. `CATEGORY_RELATEDNESS`
 * is Brand Match's 9x9 matrix of graded values (100, 80, 70, 60, 50, 40, 30, 20)
 * and it was never built to be cut into tiers — Brand Match uses the graded
 * value directly. Brand Fit needs three tiers (100 / 50 / 0), so a cut point has
 * to be chosen, and 60 is the one the proposal put forward. The POC could not
 * validate it: every one of its pairs scored `unrelated`, because the workbook's
 * brand vocabulary and the creator taxonomy never intersected, so no evidence
 * about where the line belongs was ever produced.
 *
 * Changing this number changes scores. It is deliberately a single named
 * constant so that change is one line, reviewable, and visible in a diff.
 */
export const RELATED_THRESHOLD = 60

/**
 * Compares a brand's canonical category with one of the creator's.
 *
 * Both sides are already canonical: `brand_profile.brand_category` is validated
 * against `CANONICAL_CATEGORIES` when it is saved, and creator categories come
 * from `kol_categories.taxonomy_key`, which is the same nine-key vocabulary.
 * No new taxonomy and no alias table are introduced here — if a label is not in
 * the matrix it is `unrelated`, not silently coerced to something near it.
 */
export const categoryResolver: CategoryResolver = (brandCategory, creatorCategory) => {
  if (brandCategory === creatorCategory) return 'match'
  const relatedness = CATEGORY_RELATEDNESS[brandCategory]?.[creatorCategory]
  if (typeof relatedness !== 'number') return 'unrelated'
  return relatedness >= RELATED_THRESHOLD ? 'related' : 'unrelated'
}

/** The tag vocabulary written to `category_fit_tags`. */
export const VERDICT_LABEL: Record<CategoryVerdict, string> = {
  match: 'cocok',
  related: 'related',
  unrelated: 'tidak cocok',
}

/* ── 2. Audience ──────────────────────────────────────────────────────────── */

/** Gender targets, spelled as `brand_profile.gender_majority` stores them. */
export type GenderTarget = 'Any' | 'Female' | 'Male' | 'Balanced'

/** The age buckets `age_gender_breakdown` reports, and the years each covers. */
export const AGE_BUCKETS: { key: string; min: number; max: number }[] = [
  { key: '13-17', min: 13, max: 17 },
  { key: '18-24', min: 18, max: 24 },
  { key: '25-34', min: 25, max: 34 },
  { key: '35-44', min: 35, max: 44 },
  // Open-ended in the data; bounded here so an intersection can be computed at
  // all. A brand targeting beyond 64 is targeting "45+" as far as this bucket
  // can tell, and the bucket is counted in full.
  { key: '45+', min: 45, max: 64 },
]

/** What the brand asked for. Every field is optional; absent means unmeasured. */
export interface BrandAudienceTarget {
  gender: GenderTarget
  ageMin: number | null
  ageMax: number | null
  country: string | null
  city: string | null
  interests: string[]
}

/** What the creator's audience actually looks like, as the DB reports it. */
export interface CreatorAudience {
  /** Share of the known-gender audience that is female, 0-100. */
  femalePct: number | null
  malePct: number | null
  /** Share of followers whose gender was resolved at all, 0-100. */
  genderKnownPct: number | null
  /** Bucket key -> share of audience, 0-100. */
  ageBuckets: Record<string, number> | null
  /** Share of the audience whose age was resolved at all, 0-100. */
  ageCoveragePct: number | null
  /** ISO-2 country -> share, 0-100. */
  countries: Record<string, number> | null
  /** City name -> share, 0-100. */
  cities: Record<string, number> | null
  /** Interest key -> share, 0-100, or a single top interest. */
  interests: Record<string, number> | null
  interestTop: string | null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Scores the four audience dimensions on one principle:
 *
 *     what share of this creator's audience is what the brand asked for
 *
 * Every dimension is therefore already a percentage in its own right, which is
 * what makes averaging them meaningful rather than an arbitrary blend of
 * different units.
 *
 * A dimension is `null` — NOT MEASURED — when either side is silent: the brand
 * stated no target, or the creator has no distribution for it. Null is never
 * turned into 0, because "the brand did not ask" and "no one in the audience
 * matched" are opposite findings.
 *
 * NOTE ON STATUS: the proposal marks this formula as not yet validated as a
 * similarity metric — the POC's audience column was a constant 40 and
 * demonstrated nothing. It is implemented here because the rest of Brand Fit
 * cannot be exercised without it, and it is isolated in this function so
 * replacing it touches nothing else.
 */
export function audienceDimensions(
  brand: BrandAudienceTarget,
  creator: CreatorAudience,
): AudienceDimensions {
  return {
    gender: genderScore(brand.gender, creator),
    age: ageScore(brand.ageMin, brand.ageMax, creator),
    location: locationScore(brand.country, brand.city, creator),
    interest: interestScore(brand.interests, creator),
  }
}

/**
 * `Any` is not a target — it is the absence of one, so the dimension is not
 * measured rather than scored 100. Scoring it 100 would reward a brand for
 * declining to answer.
 *
 * `Balanced` asks for an even split, so it is scored by how little the audience
 * departs from 50/50: a 50/50 audience is 100, a 100/0 audience is 0.
 */
function genderScore(target: GenderTarget, c: CreatorAudience): Score {
  if (target === 'Any') return null
  if (!isNum(c.genderKnownPct) || c.genderKnownPct <= 0) return null
  if (!isNum(c.femalePct) || !isNum(c.malePct)) return null
  if (target === 'Female') return toScore(c.femalePct)
  if (target === 'Male') return toScore(c.malePct)
  return toScore(100 - Math.abs(c.femalePct - c.malePct))
}

/**
 * The share of the audience whose age falls inside the brand's range.
 *
 * A bucket that straddles the boundary contributes the fraction of its own span
 * that overlaps, so a brand targeting 18-30 gets all of `18-24` and roughly
 * six tenths of `25-34` rather than all or nothing at the edge.
 */
function ageScore(min: number | null, max: number | null, c: CreatorAudience): Score {
  if (!isNum(min) && !isNum(max)) return null
  if (!c.ageBuckets || !isNum(c.ageCoveragePct) || c.ageCoveragePct <= 0) return null
  const lo = isNum(min) ? min : 0
  const hi = isNum(max) ? max : 200
  if (hi < lo) return null

  let matched = 0
  let total = 0
  for (const bucket of AGE_BUCKETS) {
    const share = c.ageBuckets[bucket.key]
    if (!isNum(share) || share <= 0) continue
    total += share
    const span = bucket.max - bucket.min + 1
    const overlap = Math.min(bucket.max, hi) - Math.max(bucket.min, lo) + 1
    if (overlap > 0) matched += share * (overlap / span)
  }
  // Denominator is the audience whose age is KNOWN, not the whole audience: an
  // unresolved follower is missing data, not a follower outside the range.
  if (total <= 0) return null
  return toScore((matched / total) * 100)
}

/**
 * Country and city are scored separately and averaged over whichever the brand
 * actually stated, so a brand that names only a country is not penalised for
 * leaving the city blank.
 */
function locationScore(country: string | null, city: string | null, c: CreatorAudience): Score {
  const parts: number[] = []
  if (country && c.countries) {
    const share = c.countries[country.toUpperCase()]
    if (isNum(share)) parts.push(share)
  }
  if (city && c.cities) {
    const wanted = city.trim().toLowerCase()
    const entry = Object.entries(c.cities).find(([name]) => name.trim().toLowerCase() === wanted)
    if (entry && isNum(entry[1])) parts.push(entry[1])
  }
  if (!parts.length) return null
  return toScore(parts.reduce((a, b) => a + b, 0) / parts.length)
}

/**
 * The share of the audience sitting in any interest the brand named.
 *
 * Where only a single top interest is known, the dimension falls back to a
 * present/absent reading — stated plainly rather than dressed up as a
 * distribution, because that is all the data supports.
 */
function interestScore(wanted: string[], c: CreatorAudience): Score {
  const keys = wanted.map(k => k.trim().toLowerCase()).filter(Boolean)
  if (!keys.length) return null
  if (c.interests && Object.keys(c.interests).length) {
    let matched = 0
    let total = 0
    for (const [key, share] of Object.entries(c.interests)) {
      if (!isNum(share) || share <= 0) continue
      total += share
      if (keys.includes(key.trim().toLowerCase())) matched += share
    }
    if (total > 0) return toScore((matched / total) * 100)
  }
  if (c.interestTop) {
    return toScore(keys.includes(c.interestTop.trim().toLowerCase()) ? 100 : 0)
  }
  return null
}

/* ── 3. Past Performance — Option B, direct metric ────────────────────────── */

/**
 * The five metrics the proposal named, spelled as the database spells them.
 *
 * There is no archetype here and there must not be one. The POC established
 * that the workbook's archetype pairs contradict each other — "Massive Reach &
 * Emotional Resonance" scores 0 against "High Reach" but 70 against "High
 * Engagement", while "High Impulse & Visual Engagement" does the reverse — so
 * no generic rule can be derived from those labels.
 */
export const PERFORMANCE_METRICS = [
  'engagement_rate',
  'median_views',
  'followers_growth',
  'post_frequency_reliability',
  'performance_stability',
] as const
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number]

export type PerformanceTargets = Partial<Record<PerformanceMetric, number>>
export type CreatorPerformance = Partial<Record<PerformanceMetric, number | null>>

export interface PerformanceFitResult {
  score: Score
  /** Per-metric detail, for the recommendation rules and for explaining a score. */
  metrics: { metric: PerformanceMetric; target: number; value: number; score: number }[]
  measured: PerformanceMetric[]
  missing: PerformanceMetric[]
}

/**
 * Each metric is scored as how far the creator got toward the brand's target,
 * capped at 100 — meeting the target is a full mark, and exceeding it is not
 * worth more than meeting it. The component is the mean of the metrics that
 * could be scored.
 *
 * A metric is skipped when the brand set no target for it OR the creator has no
 * value, and a brand that set no targets at all leaves the whole component NOT
 * MEASURED. That is the honest reading: Option B scores a creator against what
 * the brand asked for, so with nothing asked there is nothing to score.
 *
 * A target of 0 or less is ignored rather than divided by.
 */
export function performanceFit(
  targets: PerformanceTargets,
  creator: CreatorPerformance,
): PerformanceFitResult {
  const metrics: PerformanceFitResult['metrics'] = []
  const measured: PerformanceMetric[] = []
  const missing: PerformanceMetric[] = []

  for (const metric of PERFORMANCE_METRICS) {
    const target = targets[metric]
    const value = creator[metric]
    if (!isNum(target) || target <= 0 || !isNum(value)) {
      if (isNum(target) && target > 0) missing.push(metric)
      continue
    }
    const score = Math.min(100, Math.max(0, (value / target) * 100))
    metrics.push({ metric, target, value, score: toScore(score) as number })
    measured.push(metric)
  }

  if (!metrics.length) return { score: null, metrics: [], measured: [], missing }
  const mean = metrics.reduce((a, m) => a + m.score, 0) / metrics.length
  return { score: toScore(mean), metrics, measured, missing }
}

/* ── 4. Weighting ─────────────────────────────────────────────────────────── */

/**
 * Component weights for `partnership_score`.
 *
 * 25/25/25/25 comes from the workbook, whose own column reads "25% each for
 * dummy testing only", and the POC did not validate it — reproducing 48/48 only
 * showed that averaging four numbers gives the workbook's number, not that the
 * four deserve equal say. PENDING PRODUCT APPROVAL.
 *
 * They are weights rather than a hardcoded average so that approving a
 * different split is an edit to four numbers and nothing else.
 */
export const COMPONENT_WEIGHTS = {
  category: 25,
  audience: 25,
  values: 25,
  performance: 25,
} as const
export type ComponentKey = keyof typeof COMPONENT_WEIGHTS

/**
 * How many components must carry a value before a partnership score is worth
 * showing.
 *
 * 1 — any single measured component produces a score, and only an entirely
 * unmeasured pair returns NULL.
 *
 * DECISION PENDING: the proposal argued for a floor of 2, on the grounds that
 * one component renormalised to 100% reads as a complete Brand Fit when only
 * one thing was looked at. The workbook has no partial row and so says nothing
 * either way. Raising this to 2 is a one-line change, and `coverage` travels
 * with every result so a caller can apply a stricter floor without one.
 */
export const MIN_COMPONENTS = 1
