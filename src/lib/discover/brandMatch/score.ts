/**
 * The Brand Match model, in TypeScript.
 *
 * This is a PORT of `scripts/brand-match/scoring.mjs`, which is itself a port of
 * the Excel formulas in `Autometric_Brand_Match_Comparison.xlsx`. Every formula
 * below is the same formula, every constant comes from `./model`, and nothing
 * here has its own opinion about a weight.
 *
 * The chain is: workbook → `scoring.mjs` → this file. `verify-scoring-port.mjs`
 * already pins the middle link to the workbook by driving Excel and comparing
 * all 120 Final Match Scores plus every component. `verify-brand-match-port.mjs`
 * pins this link to the middle one the same way — component by component, not
 * just on the total, because two different models can agree on a total while
 * disagreeing about everything underneath it.
 *
 * ── Why the port exists at all ─────────────────────────────────────────────
 * `scoring.mjs` reaches its constants through `build.mjs`, which imports
 * `exceljs`. The app needs the model on every Creator Database request; it does
 * not need a spreadsheet writer in its server bundle. See `./model`.
 *
 * ── N/A is not zero, and this is the whole point ───────────────────────────
 * Most of this roster is unmeasured: audience analysis exists for 24 creators
 * out of ~7.000, captions for 50, a rate card for none. A model that scored a
 * missing measurement as 0 would rank every unmeasured creator below every bad
 * one and call that a match. So a part that cannot be computed returns `NA`,
 * contributes to neither numerator nor denominator, and the remaining weights
 * renormalise to 100 by themselves. All parts N/A returns N/A — never 0.
 *
 * Pure and client-safe: no `pg`, no fetch. The server computes it per row.
 */

import {
  CATEGORY_RELATEDNESS, INTEREST_KEYS, V, erTargetFor,
} from './model'

/** The sentinel a score carries when the database had nothing to compute it from. */
export const NA = 'N/A'
export type Scored = number | typeof NA

export const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/**
 * Excel's ROUND: half away from zero. JavaScript's `Math.round` is half toward
 * +Infinity, which disagrees on negatives. Every score here is non-negative so
 * the two agree in practice, but the port is written to the rule rather than to
 * the range the data happens to occupy today.
 */
export const round0 = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))

/** Excel SEARCH inside ISNUMBER: case-insensitive containment. */
const found = (needle: string, hay: string): boolean =>
  !!needle && hay.toLowerCase().includes(needle.toLowerCase())

/**
 * A weighted mean over only the parts that are numbers. See the N/A note above.
 *
 * Exported for `./explain`, which merges pairs of components into the four bars
 * the UI shows and has to fold N/A the same way this file does. Exporting is
 * the whole change — the body, and every number it is ever called with here, is
 * untouched, and `verify-brand-match-port.ts` still pins all 3.840 values to the
 * workbook. A second copy of this rule in `explain.ts` would be the one piece of
 * arithmetic in the system that must never drift, written down twice.
 */
export function weighted(parts: [Scored, number][]): Scored {
  let num = 0
  let den = 0
  for (const [v, w] of parts) {
    if (!isNum(v)) continue
    num += v * w
    den += w
  }
  return den === 0 ? NA : round0(num / den)
}

/** Share of a brand's token slots present in a haystack. */
function overlap(terms: string[], haystack: string): number {
  const filled = (terms ?? []).filter(t => t && t.length)
  if (!filled.length) return V.CAL_NEUTRAL
  const hits = filled.reduce((n, t) => n + (found(t, haystack) ? 1 : 0), 0)
  return round0((hits / filled.length) * 100)
}

/** Matrix 11d, canonical category x canonical category. */
const dbcat = (brandCat: string, creatorCat: string): number =>
  CATEGORY_RELATEDNESS[brandCat]?.[creatorCat] ?? V.CAL_UNRELATED

/* ── the two inputs ───────────────────────────────────────────────────────── */

/**
 * One creator, in the shape the model reads. Built by `toScoringRecord` in
 * `./records` from what `public.kol_directory` and the medallion schemas hold.
 *
 * Every field is nullable because almost every one of them is null for most of
 * the roster. That is a fact about the database, not a defect in this type.
 */
export interface ScoringRecord {
  handle: string | null
  name: string | null
  platform: string | null
  followers: number | null
  tier: string | null
  /** 'Yes' | 'No' — the platform's verified flag, the one complete identity signal. */
  verified: string | null

  /** Canonical `kol_categories.taxonomy_key` the creator is TAGGED with. */
  category: string | null
  /** Canonical key classified from the creator's own captions, bio and hashtags. */
  classifiedCategory: string | null
  rawCategories: string | null
  contentTopics: string | null
  classificationEvidence: string | null
  bio: string | null
  captionDigest: string | null
  hashtagDigest: string | null

  agePrimaryShare: number | null
  ageSecondaryShare: number | null
  femalePct: number | null
  malePct: number | null
  audienceCountry: string | null
  countryShare: number | null
  cities: { key: string; pct: number | null }[]
  cityKnownPct: number | null
  /**
   * Read by `completeness()` and by nothing else.
   *
   * It is `undefined` for every creator, here and upstream: `scoring.mjs`
   * measures Data Completeness over a list containing `k.city1Share`, and its
   * own `toScoringRecord` builds `cities` instead and never sets this. So the
   * city slot of the 12 always counts as missing, and Data Completeness tops out
   * at 92% — which is below `CONF_HIGH` (100), meaning **no creator can ever
   * reach Confidence 'High'** through this path.
   *
   * Carried as a real optional field, and left unset by `./records`, because the
   * port's job is to reproduce the model that was verified against the workbook
   * — not to improve it. Populating it would raise the Confidence label on the
   * 24 measured creators and silently disagree with every published figure.
   * Fixing it is a change to the model, and belongs in `scripts/brand-match/`
   * where the workbook can be rebuilt and re-verified alongside it.
   */
  city1Share?: number | null
  interests: Record<string, number>
  interestKnownPct: number | null

  er: number | null
  avgViews: number | null
  vfr: number | null
  postFrequencyMonthly: number | null
  observationDays: number | null
  followersGrowth: number | null
  paidRatio: number | null

  audienceQuality: number | null
  authenticity: number | null
  followerQuality: number | null
}

/**
 * One brand, in the shape the model reads. Built by `toScoringBrand` in
 * `./profile` from the saved Brand Profile.
 *
 * The field names follow `public.brand` (`category`, `brand_keywords`,
 * `brand_hashtags`) because that is the project's own statement of what a brand
 * record is, and the workbook scored against exactly these.
 */
export interface ScoringBrand {
  category: string
  brand_keywords: string[]
  brand_hashtags: string[]
  /** 'Any' | 'Female' | 'Male' | 'Balanced'. */
  gender_majority: string
  target_country: string | null
  target_city: string | null
  /** Keys from `INTEREST_KEYS`. */
  interests: string[]
  /** Terms searched in the creator's captions for Topic Match. */
  caption_terms: string[]
}

export type MatchLevel =
  | 'Excellent Match' | 'Strong Match' | 'Good Match'
  | 'Moderate Match' | 'Low Match' | 'Not Scored'

export type MatchConfidence = 'High' | 'Medium' | 'Limited Data'

/** Every component and sub-score, so a caller can explain the number. */
export interface ScoreResult {
  categoryMatch: Scored
  keywordMatch: Scored
  hashtagMatch: Scored
  businessScore: Scored
  ageScore: Scored
  genderScore: Scored
  locationScore: Scored
  interestScore: Scored
  audienceScore: Scored
  contentCategoryMatch: Scored
  subCategoryMatch: Scored
  topicMatch: Scored
  contentStyleMatch: Scored
  contentScore: Scored
  personalityScore: Scored
  erScore: Scored
  audienceQualityScore: Scored
  consistencyScore: Scored
  communityScore: Scored
  averageViewsScore: Scored
  recentGrowthScore: Scored
  performanceScore: Scored
  authenticityScore: Scored
  followerQualityScore: Scored
  verificationScore: Scored
  paidRatioScore: Scored
  safetyScore: Scored
  /** Total weight of the components that could be computed, out of 100. */
  availableWeight: number
  finalScore: Scored
  level: MatchLevel
  dataCompleteness: number
  confidence: MatchConfidence
}

/* ── the model ────────────────────────────────────────────────────────────── */

/**
 * The 12 fields Data Completeness is measured over — the same list, in the same
 * order, as `completeness()` in `scoring.mjs`, so Confidence means the same
 * thing in both places.
 *
 * `city1Share` is one of the 12 and is never populated; see its note on
 * `ScoringRecord`. It is listed here rather than substituted because this
 * function's contract is to agree with the verified model, not to be right.
 */
function completeness(k: ScoringRecord): number {
  const tracked = [
    k.category, k.er, k.avgViews, k.vfr, k.femalePct, k.countryShare,
    k.city1Share, k.interestKnownPct, k.audienceQuality, k.authenticity,
    k.followerQuality, k.postFrequencyMonthly,
  ]
  return round0((tracked.filter(v => v !== null && v !== undefined).length / tracked.length) * 100)
}

/** Scores one creator against one brand. */
export function score(k: ScoringRecord, b: ScoringBrand): ScoreResult {
  const catKnown = !!k.category
  const capCatKnown = !!k.classifiedCategory

  /* haystacks — the creator's own words */
  const keywordHay = [k.bio, k.captionDigest, k.contentTopics, k.category, k.rawCategories]
    .filter(Boolean).join(' | ')
  const topicHay = [k.captionDigest, k.contentTopics, k.classificationEvidence, k.bio]
    .filter(Boolean).join(' | ')
  const hashtagHay = k.hashtagDigest ?? ''

  /* 1. Brand & Business Relevance */
  const categoryMatch: Scored = !catKnown ? V.CAL_NEUTRAL
    : (b.category === k.category ? 100 : dbcat(b.category, k.category as string))
  const keywordMatch: Scored = keywordHay.trim().length === 0 ? NA : overlap(b.brand_keywords, keywordHay)
  const hashtagMatch: Scored = !hashtagHay ? NA : overlap(b.brand_hashtags, hashtagHay)
  const businessScore = weighted([
    [categoryMatch, V.W_BB_CAT], [keywordMatch, V.W_BB_KW], [hashtagMatch, V.W_BB_HASH],
  ])

  /* 2. Target Audience Relevance */
  // Age: the five band columns are empty for every creator on this server, so
  // this is N/A throughout and its 25% renormalises away. Written as a live
  // branch so it starts working the day the pipeline fills an age row.
  const ageScore: Scored = isNum(k.agePrimaryShare)
    ? Math.min(100, round0(((k.agePrimaryShare
        + 0.5 * (isNum(k.ageSecondaryShare) ? k.ageSecondaryShare : 0)) / V.CAL_AGE_TARGET) * 100))
    : NA

  let genderScore: Scored
  if (b.gender_majority === 'Any') genderScore = 100
  else if (!isNum(k.femalePct)) genderScore = NA
  else if (b.gender_majority === 'Female') {
    genderScore = Math.min(100, round0((k.femalePct / V.CAL_GENDER_TARGET) * 100))
  } else if (b.gender_majority === 'Male') {
    const male = isNum(k.malePct) ? k.malePct : 100 - k.femalePct
    genderScore = Math.min(100, round0((male / V.CAL_GENDER_TARGET) * 100))
  } else genderScore = Math.max(0, round0(100 - Math.abs(k.femalePct - 50) * 2))

  const countryPart: Scored = !isNum(k.countryShare) ? NA
    : (k.audienceCountry !== b.target_country ? V.CAL_UNRELATED
      : Math.min(100, round0((k.countryShare / V.CAL_COUNTRY_TARGET) * 100)))
  const cityHit = [0, 1, 2].reduce((sum, i) => {
    const city = k.cities?.[i]
    return sum + (city && city.key === b.target_city && isNum(city.pct) ? city.pct : 0)
  }, 0)
  const cityPart: Scored = !isNum(k.cityKnownPct) ? NA
    : Math.min(100, round0((cityHit / V.CAL_CITY_TARGET) * 100))
  const locationScore = weighted([[countryPart, V.W_LOC_COUNTRY], [cityPart, V.W_LOC_CITY]])

  const interestSum = INTEREST_KEYS.reduce((sum, key) => {
    const pct = k.interests?.[key]
    return sum + (isNum(pct) && b.interests.includes(key) ? pct : 0)
  }, 0)
  const interestScore: Scored = !isNum(k.interestKnownPct) ? NA
    : Math.min(100, round0((interestSum / V.CAL_INTEREST_TARGET) * 100))

  const audienceScore = weighted([
    [ageScore, V.W_TA_AGE], [genderScore, V.W_TA_GENDER],
    [locationScore, V.W_TA_LOCATION], [interestScore, V.W_TA_INTEREST],
  ])

  /* 3. Content & Category Relevance */
  const contentCategoryMatch: Scored = !capCatKnown ? V.CAL_NEUTRAL
    : (b.category === k.classifiedCategory ? 100 : dbcat(b.category, k.classifiedCategory as string))
  const subCategoryMatch: Scored = NA          // no sub-category column exists
  const topicMatch: Scored = topicHay.trim().length === 0 ? NA : overlap(b.caption_terms, topicHay)
  const contentStyleMatch: Scored = NA         // no content-style column exists
  const contentScore = weighted([
    [contentCategoryMatch, V.W_CC_CAT], [subCategoryMatch, V.W_CC_SUBCATEGORY],
    [topicMatch, V.W_CC_TOPICS], [contentStyleMatch, V.W_CC_STYLE],
  ])

  /* 4. Brand Personality Fit — every input is a column that does not exist */
  const personalityScore = weighted([
    [NA, V.W_BP_PERSONALITY], [NA, V.W_BP_TONE], [NA, V.W_BP_VALUES], [NA, V.W_BP_COMM],
  ])

  /* 5. Performance Quality */
  const erScore: Scored = !isNum(k.er) ? NA
    : Math.min(100, round0((k.er / erTargetFor(k.tier)) * 100))
  const audienceQualityScore: Scored = !isNum(k.audienceQuality) ? NA
    : Math.min(100, Math.max(0, k.audienceQuality))
  const consistencyScore: Scored = (!isNum(k.postFrequencyMonthly) || !isNum(k.observationDays)
    || k.observationDays < V.CAL_MIN_OBS_DAYS) ? NA
    : Math.min(100, round0((k.postFrequencyMonthly / V.CAL_CONSISTENCY_TARGET) * 100))
  const communityScore: Scored = NA            // no column exists
  const averageViewsScore: Scored = !isNum(k.vfr) ? NA
    : Math.min(100, round0((k.vfr / V.CAL_VFR_TARGET_ROSTER) * 100))
  const recentGrowthScore: Scored = !isNum(k.followersGrowth) ? NA
    : Math.min(100, Math.max(0, round0(((k.followersGrowth + 2) / (V.CAL_GROWTH_TARGET + 2)) * 100)))
  const performanceScore = weighted([
    [erScore, V.W_PQ_ER], [audienceQualityScore, V.W_PQ_AUDIENCE],
    [consistencyScore, V.W_PQ_CONSISTENCY], [communityScore, V.W_PQ_COMMUNITY],
    [averageViewsScore, V.W_PQ_VIEWS], [recentGrowthScore, V.W_PQ_GROWTH],
  ])

  /* 6. Brand Safety — an integrity screen; no content-risk reading exists */
  const authenticityScore: Scored = !isNum(k.authenticity) ? NA
    : Math.min(100, Math.max(0, k.authenticity))
  const followerQualityScore: Scored = !isNum(k.followerQuality) ? NA
    : Math.min(100, Math.max(0, k.followerQuality))
  const verificationScore: Scored = k.verified === 'Yes' ? V.CAL_VERIFIED_YES
    : k.verified === 'No' ? V.CAL_VERIFIED_NO : NA
  const paidRatioScore: Scored = !isNum(k.paidRatio) ? NA
    : Math.max(0, round0(100 - (k.paidRatio / V.CAL_PAID_CEILING) * 100))
  const safetyScore = weighted([
    [authenticityScore, V.W_BS_AUTHENTICITY], [followerQualityScore, V.W_BS_FOLLOWER_QUALITY],
    [verificationScore, V.W_BS_VERIFICATION], [paidRatioScore, V.W_BS_PAID],
  ])

  /* result */
  const components: [Scored, number][] = [
    [businessScore, V.W_BRAND_BUSINESS], [audienceScore, V.W_TARGET_AUDIENCE],
    [contentScore, V.W_CONTENT_CATEGORY], [personalityScore, V.W_PERSONALITY],
    [performanceScore, V.W_PERFORMANCE], [safetyScore, V.W_SAFETY],
  ]
  const availableWeight = components.reduce((n, [v, w]) => n + (isNum(v) ? w : 0), 0)
  const finalScore: Scored = availableWeight === 0 ? NA
    : round0(components.reduce((n, [v, w]) => n + (isNum(v) ? v * w : 0), 0) / availableWeight)

  const level: MatchLevel = !isNum(finalScore) ? 'Not Scored'
    : finalScore >= V.BAND_EXCELLENT ? 'Excellent Match'
      : finalScore >= V.BAND_STRONG ? 'Strong Match'
        : finalScore >= V.BAND_GOOD ? 'Good Match'
          : finalScore >= V.BAND_MODERATE ? 'Moderate Match' : 'Low Match'

  const dataCompleteness = completeness(k)
  const confidence: MatchConfidence = dataCompleteness >= V.CONF_HIGH ? 'High'
    : dataCompleteness >= V.CONF_MEDIUM ? 'Medium' : 'Limited Data'

  return {
    categoryMatch, keywordMatch, hashtagMatch, businessScore,
    ageScore, genderScore, locationScore, interestScore, audienceScore,
    contentCategoryMatch, subCategoryMatch, topicMatch, contentStyleMatch, contentScore,
    personalityScore,
    erScore, audienceQualityScore, consistencyScore, communityScore,
    averageViewsScore, recentGrowthScore, performanceScore,
    authenticityScore, followerQualityScore, verificationScore, paidRatioScore, safetyScore,
    availableWeight, finalScore, level, dataCompleteness, confidence,
  }
}

/**
 * Normalized Score = Absolute / max(Absolute in the SAME comparison population)
 * x 100.
 *
 * The maximum is taken over the rows handed in and nowhere else — it answers
 * "how high does this creator sit among the creators actually being compared".
 *
 * **This is deliberately not used by the Creator Database.** A page of a 7.4k
 * roster is not a comparison population: normalising per page would move every
 * creator's score when you pressed Next, and the Match Status bands are defined
 * against the absolute score. Compare is the screen this belongs to, where the
 * population is exactly the creators the user picked.
 *
 * Never touches the absolute score. Both travel together everywhere.
 */
export function normalise<T>(rows: T[], getAbsolute: (r: T) => Scored): Scored[] {
  const scored = rows.filter(r => isNum(getAbsolute(r)))
  if (!scored.length) return rows.map(() => NA)
  const max = Math.max(...scored.map(r => getAbsolute(r) as number))
  if (max <= 0) return rows.map(r => (isNum(getAbsolute(r)) ? 0 : NA))
  return rows.map(r => (isNum(getAbsolute(r))
    ? Math.round(((getAbsolute(r) as number) / max) * 10000) / 100
    : NA))
}
