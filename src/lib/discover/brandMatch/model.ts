/**
 * The Brand Match model's constants and lookup tables.
 *
 * ── This is a PORT, and the port is checked ────────────────────────────────
 * Every value here is copied from `scripts/brand-match/`, which is where the
 * model was built and where the Excel workbook still reads it from:
 *
 *   `ENGINE_CONSTS` in `build.mjs`       — component and sub-weights, targets, bands
 *   `EXTRA_CONSTS`  in `comparison.mjs`  — the roster-specific overrides
 *   `CATEGORY_RELATEDNESS`, `INTEREST_KEYS`, `CANONICAL_CATEGORIES`
 *                                        in `comparison-brands.mjs`
 *
 * It is copied rather than imported because `scoring.mjs` reaches its constants
 * through `build.mjs`, and `build.mjs` imports `exceljs` — a devDependency that
 * writes .xlsx files. Importing the chain would pull a spreadsheet writer into
 * the Next.js server bundle in order to read forty numbers out of it.
 *
 * Copying two sets of numbers is how they drift, so they are not trusted to
 * stay equal: `scripts/verify-brand-match-port.mjs` asserts every constant and
 * every matrix cell in this file equals the one the scripts hold, and asserts
 * `score()` in `./score.ts` reproduces `score()` in `scoring.mjs` on the
 * published 24 x 5 comparison. That check is what makes this file safe.
 *
 * ── Nothing here is tunable by a user ──────────────────────────────────────
 * No weight in this file is exposed in any UI, and none should be. A brand
 * states what it wants; the system decides how much each signal is worth.
 * Weight sliders would let a user tune the answer until it agreed with them,
 * which is the opposite of a match score.
 */

/** Component and sub-weights, normalisation targets, and the score bands. */
export const V = {
  /* component weights — total 100 */
  W_BRAND_BUSINESS: 20,
  W_TARGET_AUDIENCE: 30,
  W_CONTENT_CATEGORY: 20,
  W_PERSONALITY: 10,
  W_PERFORMANCE: 10,
  W_SAFETY: 10,

  /**
   * Brand & Business sub-weights.
   *
   * 60/25/15 rather than section 4's 40/30/30, per `EXTRA_CONSTS`: measured on
   * the built workbook, Category Match takes 8 distinct values across the 120
   * pairs while Keyword takes 3 and Hashtag 2, both mostly 0. Letting the two
   * sparse signals carry 60% of the component would make Brand & Business
   * Relevance mostly measure whether a creator writes marketing copy in their
   * captions — which none of them does.
   */
  W_BB_CAT: 60,
  W_BB_KW: 25,
  W_BB_HASH: 15,

  /* target audience sub-weights (base) */
  W_TA_AGE: 25,
  W_TA_GENDER: 15,
  W_TA_LOCATION: 30,
  W_TA_INTEREST: 30,

  /* location sub-weights — Region has no column, so its 25 renormalises away */
  W_LOC_COUNTRY: 50,
  W_LOC_CITY: 25,

  /* content & category sub-weights */
  W_CC_CAT: 60,
  W_CC_TOPICS: 40,
  W_CC_SUBCATEGORY: 20,
  W_CC_STYLE: 20,

  /* personality sub-weights — every input is a column that does not exist */
  W_BP_PERSONALITY: 35,
  W_BP_TONE: 25,
  W_BP_VALUES: 25,
  W_BP_COMM: 15,

  /* performance sub-weights */
  W_PQ_ER: 35,
  W_PQ_AUDIENCE: 20,
  W_PQ_CONSISTENCY: 20,
  W_PQ_COMMUNITY: 10,
  W_PQ_VIEWS: 10,
  W_PQ_GROWTH: 5,

  /* brand safety screen sub-weights */
  W_BS_AUTHENTICITY: 40,
  W_BS_FOLLOWER_QUALITY: 30,
  W_BS_VERIFICATION: 15,
  W_BS_PAID: 15,

  /* normalisation targets */
  CAL_ER_TARGET: 6,
  CAL_AGE_TARGET: 45,
  CAL_GENDER_TARGET: 65,
  CAL_GROWTH_TARGET: 8,
  CAL_COUNTRY_TARGET: 60,
  CAL_CITY_TARGET: 25,
  CAL_INTEREST_TARGET: 45,
  CAL_CONSISTENCY_TARGET: 12,
  /**
   * A `post_frequency_monthly` extrapolated from a one- or two-day window is
   * arithmetic, not a cadence — the roster carries readings of 300/month off a
   * single observed day. Below this many days, Consistency reports N/A.
   */
  CAL_MIN_OBS_DAYS: 21,
  /**
   * Replaces the engine's shared 0.5 for this roster. Every creator carrying a
   * view-to-follower ratio is above 0.5, so the shared target scored all of them
   * 100 and the sub-score carried no information at all.
   */
  CAL_VFR_TARGET_ROSTER: 1.5,
  CAL_PAID_CEILING: 40,

  /** What a comparison scores when the brand left the field blank. */
  CAL_NEUTRAL: 50,
  /** Bottom of the 100/80/60/40/20 relevance ladder — nothing is ever 0. */
  CAL_UNRELATED: 20,
  CAL_VERIFIED_YES: 100,
  /** Not zero: unverified is an unanswered question, not evidence of harm. */
  CAL_VERIFIED_NO: 50,

  /* match level bands */
  BAND_EXCELLENT: 90,
  BAND_STRONG: 80,
  BAND_GOOD: 70,
  BAND_MODERATE: 60,

  /* confidence bands, over the 12 tracked fields */
  CONF_HIGH: 100,
  CONF_MEDIUM: 84,
} as const

/**
 * The nine canonical categories, as `public.kol_categories.taxonomy_key` holds
 * them. A brand's category is one of these and nothing else — not a synonym,
 * not a re-spelling, not a name invented for this app.
 */
export const CANONICAL_CATEGORIES = [
  'Beauty', 'Entertainment', 'Fashion', 'Fitness', 'Food', 'Gen Z', 'Lifestyle', 'Moms', 'Tech',
] as const
export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number]

/**
 * Every interest key in `l2_gold.audience_interest_daily`, spelled as the
 * database spells it — lower case, and `sports` kept distinct from `fitness`
 * because the database keeps them distinct.
 *
 * `unknown` is deliberately absent: it is not an interest but the share of the
 * sampled audience the pipeline could not classify. It is counted in the
 * denominator of every share and reported as Interest Known %, never targeted.
 */
export const INTEREST_KEYS = [
  'art', 'automotive', 'beauty', 'business', 'education', 'entertainment',
  'fashion', 'fitness', 'food', 'gaming', 'music', 'parenting', 'pets',
  'photography', 'religion', 'sports', 'technology', 'travel',
] as const
export type InterestKey = (typeof INTEREST_KEYS)[number]

/**
 * Relatedness between two canonical categories, on the 100/80/60/40/20 ladder.
 * Row = what the brand wants, column = what the creator is.
 *
 * Two of the nine are not content categories at all — `Moms` and `Gen Z`
 * describe an audience — which is why each gets a hand-set row. They still have
 * to be scoreable: 542 creators carry Moms and 145 carry Gen Z, and a brand
 * match that errored for 687 creators would be worse than one that returns a
 * defensible middle.
 *
 * Nothing is 0. An unrelated creator with a large relevant audience is a worse
 * buy than a related one, not a disqualified one.
 */
export const CATEGORY_RELATEDNESS: Record<string, Record<string, number>> = {
  Beauty: { Beauty: 100, Fashion: 80, Lifestyle: 70, 'Gen Z': 60, Entertainment: 50, Moms: 50, Fitness: 40, Food: 30, Tech: 20 },
  Entertainment: { Entertainment: 100, 'Gen Z': 70, Lifestyle: 60, Fashion: 50, Beauty: 40, Food: 40, Moms: 40, Fitness: 30, Tech: 30 },
  Fashion: { Fashion: 100, Beauty: 80, Lifestyle: 70, 'Gen Z': 60, Entertainment: 50, Moms: 40, Fitness: 40, Food: 20, Tech: 20 },
  Fitness: { Fitness: 100, Lifestyle: 60, Food: 60, Beauty: 40, 'Gen Z': 40, Fashion: 40, Moms: 40, Entertainment: 30, Tech: 20 },
  Food: { Food: 100, Lifestyle: 70, Moms: 60, Entertainment: 50, Fitness: 50, 'Gen Z': 40, Beauty: 30, Fashion: 20, Tech: 20 },
  'Gen Z': { 'Gen Z': 100, Entertainment: 70, Fashion: 60, Beauty: 60, Lifestyle: 60, Tech: 50, Food: 40, Fitness: 40, Moms: 20 },
  Lifestyle: { Lifestyle: 100, Beauty: 70, Fashion: 70, Food: 70, Moms: 60, Entertainment: 60, Fitness: 60, 'Gen Z': 60, Tech: 40 },
  Moms: { Moms: 100, Lifestyle: 60, Food: 60, Beauty: 50, Fashion: 40, Fitness: 40, Entertainment: 40, Tech: 20, 'Gen Z': 20 },
  Tech: { Tech: 100, 'Gen Z': 50, Lifestyle: 40, Entertainment: 30, Fashion: 20, Beauty: 20, Fitness: 20, Food: 20, Moms: 20 },
}

/**
 * The tier bands and their engagement-rate targets, mirroring Lookup_Lists
 * sections 3 and 11b.
 *
 * These are the KOL platform's own follower bands. A Nano creator is held to 8%
 * ER and a Mega to 2% because that is what each population actually achieves —
 * scoring both against one target would rank every small account above every
 * large one and call it a match.
 */
export const TIERS = [
  { name: 'Nano', min: 0, erTarget: 8 },
  { name: 'Micro', min: 10_000, erTarget: 6 },
  { name: 'Mid-tier', min: 50_000, erTarget: 4.5 },
  { name: 'Macro', min: 100_000, erTarget: 3 },
  { name: 'Mega', min: 1_000_000, erTarget: 2 },
] as const

export function tierOf(followers: number | null | undefined): string | null {
  if (typeof followers !== 'number' || !Number.isFinite(followers)) return null
  for (let i = TIERS.length - 1; i >= 0; i--) if (followers >= TIERS[i].min) return TIERS[i].name
  return 'Nano'
}

export const erTargetFor = (tier: string | null): number =>
  TIERS.find(t => t.name === tier)?.erTarget ?? V.CAL_ER_TARGET
