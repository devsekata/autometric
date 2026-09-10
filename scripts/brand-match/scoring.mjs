/**
 * The Brand Match model, in JavaScript.
 *
 * This is a PORT, not a second model. Every formula below is the JavaScript of a
 * formula that `comparison.mjs` writes into a Matching_Engine cell, and every
 * constant is read out of `ENGINE_CONSTS` and `EXTRA_CONSTS` — the same arrays
 * `buildLookups` writes into Lookup_Lists. Nothing here has its own opinion about
 * a weight.
 *
 * It exists because the distribution test needs thousands of creators scored, and
 * the workbook's scores live in Excel formulas that only Excel can evaluate.
 * Writing 5.251 x 3 formula rows would produce a file nobody could open.
 *
 * ── The port is verified, not asserted ─────────────────────────────────────
 * `verify-scoring-port.mjs` recalculates the published 24 x 5 workbook in Excel
 * and asserts this file reproduces all 120 Final Match Scores and every
 * component exactly. If the two ever disagree the distribution test is measuring
 * the port rather than the model, so that check gates everything downstream.
 *
 * ── Nothing here changes the Absolute Score ────────────────────────────────
 * No weight, threshold, normalisation target or band was touched to build this.
 * The Normalized Score added by `normalise()` is a presentation layer computed
 * from the absolute score after the fact; it never feeds back into it.
 */

import { ENGINE_CONSTS } from './build.mjs'
import { EXTRA_CONSTS } from './comparison.mjs'
import { CATEGORY_RELATEDNESS, INTEREST_KEYS } from './comparison-brands.mjs'

/* ── constants, read from the same arrays the workbook writes ─────────────── */

const V = {}
for (const [, , key, value] of [...ENGINE_CONSTS, ...EXTRA_CONSTS]) {
  if (typeof value === 'number') V[key] = value
}

/**
 * The tier bands and their engagement-rate targets, mirroring Lookup_Lists
 * sections 3 and 11b. These two live in the sheet builder rather than in a
 * constants array, so they are the one thing this file restates — kept adjacent
 * and named so a change to either is visible in a diff of both.
 */
const TIERS = [
  { name: 'Nano', min: 0, erTarget: 8 },
  { name: 'Micro', min: 10000, erTarget: 6 },
  { name: 'Mid-tier', min: 50000, erTarget: 4.5 },
  { name: 'Macro', min: 100000, erTarget: 3 },
  { name: 'Mega', min: 1000000, erTarget: 2 },
]

export function tierOf(followers) {
  if (!Number.isFinite(followers)) return null
  for (let i = TIERS.length - 1; i >= 0; i--) if (followers >= TIERS[i].min) return TIERS[i].name
  return 'Nano'
}
const erTargetFor = tier => TIERS.find(t => t.name === tier)?.erTarget ?? V.CAL_ER_TARGET

/* ── Excel semantics ──────────────────────────────────────────────────────── */

/** The sentinel a score carries when the database had nothing to compute it from. */
export const NA = 'N/A'
const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * Excel's ROUND: half away from zero. JavaScript's Math.round is half toward
 * +Infinity, which disagrees on negatives. Every score here is non-negative so
 * the two agree in practice, but the port is written to the rule rather than to
 * the range the data happens to occupy today.
 */
const round0 = x => (x < 0 ? -Math.round(-x) : Math.round(x))

/** Excel SEARCH inside ISNUMBER: case-insensitive containment. */
const found = (needle, hay) => !!needle && hay.toLowerCase().includes(needle.toLowerCase())

/**
 * `weightedAvailable` from `comparison.mjs`: a weighted mean over only the parts
 * that are numbers. An N/A part contributes to neither numerator nor
 * denominator, so the remaining weights renormalise to 100 by themselves. All
 * parts N/A returns N/A rather than 0 — zero is a measurement, and using it for
 * "nobody looked" ranks an unmeasured creator below a bad one.
 */
function weighted(parts) {
  let num = 0
  let den = 0
  for (const [v, w] of parts) {
    if (!isNum(v)) continue
    num += v * w
    den += w
  }
  return den === 0 ? NA : round0(num / den)
}

/** The `overlap()` helper: share of a brand's token slots present in a haystack. */
function overlap(terms, haystack) {
  const filled = terms.filter(t => t && t.length)
  if (!filled.length) return V.CAL_NEUTRAL
  const hits = filled.reduce((n, t) => n + (found(t, haystack) ? 1 : 0), 0)
  return round0((hits / filled.length) * 100)
}

/** Matrix 11d, canonical category x canonical category. */
const dbcat = (brandCat, creatorCat) =>
  CATEGORY_RELATEDNESS[brandCat]?.[creatorCat] ?? V.CAL_UNRELATED

/* ── the model ────────────────────────────────────────────────────────────── */

/**
 * The 12 fields Data Completeness is measured over — the same list `TRACKED` in
 * `comparison.mjs` uses, so Confidence means the same thing in both places.
 */
function completeness(k) {
  const tracked = [
    k.category, k.er, k.avgViews, k.vfr, k.femalePct, k.countryShare,
    k.city1Share, k.interestKnownPct, k.audienceQuality, k.authenticity,
    k.followerQuality, k.postFrequencyMonthly,
  ]
  return round0((tracked.filter(v => v !== null && v !== undefined).length / tracked.length) * 100)
}

/**
 * Scores one creator against one brand. `k` is a scoring record (see
 * `toScoringRecord`), `b` is a brand from `comparison-brands.mjs`.
 *
 * Returns every component and sub-score, so the caller can check the port
 * against the workbook column by column rather than only on the final number.
 */
export function score(k, b) {
  const catKnown = !!k.category
  const capCatKnown = !!k.classifiedCategory

  /* haystacks — the creator's own words */
  const keywordHay = [k.bio, k.captionDigest, k.contentTopics, k.category, k.rawCategories].filter(Boolean).join(' | ')
  const topicHay = [k.captionDigest, k.contentTopics, k.classificationEvidence, k.bio].filter(Boolean).join(' | ')
  const hashtagHay = k.hashtagDigest ?? ''

  /* 1. Brand & Business Relevance */
  const categoryMatch = !catKnown ? V.CAL_NEUTRAL
    : (b.category === k.category ? 100 : dbcat(b.category, k.category))
  const keywordMatch = keywordHay.trim().length === 0 ? NA : overlap(b.brand_keywords, keywordHay)
  const hashtagMatch = !hashtagHay ? NA : overlap(b.brand_hashtags, hashtagHay)
  const businessScore = weighted([
    [categoryMatch, V.W_BB_CAT], [keywordMatch, V.W_BB_KW], [hashtagMatch, V.W_BB_HASH],
  ])

  /* 2. Target Audience Relevance */
  // Age: the five band columns are empty for every creator on this server, so
  // this is N/A throughout and its 25% renormalises away. Written as a live
  // branch so it starts working the day the pipeline fills an age row.
  const ageScore = isNum(k.agePrimaryShare)
    ? Math.min(100, round0(((k.agePrimaryShare + 0.5 * (isNum(k.ageSecondaryShare) ? k.ageSecondaryShare : 0)) / V.CAL_AGE_TARGET) * 100))
    : NA

  let genderScore
  if (b.gender_majority === 'Any') genderScore = 100
  else if (!isNum(k.femalePct)) genderScore = NA
  else if (b.gender_majority === 'Female') genderScore = Math.min(100, round0((k.femalePct / V.CAL_GENDER_TARGET) * 100))
  else if (b.gender_majority === 'Male') {
    const male = isNum(k.malePct) ? k.malePct : 100 - k.femalePct
    genderScore = Math.min(100, round0((male / V.CAL_GENDER_TARGET) * 100))
  } else genderScore = Math.max(0, round0(100 - Math.abs(k.femalePct - 50) * 2))

  const countryPart = !isNum(k.countryShare) ? NA
    : (k.audienceCountry !== b.target_country ? V.CAL_UNRELATED
      : Math.min(100, round0((k.countryShare / V.CAL_COUNTRY_TARGET) * 100)))
  const cityHit = [0, 1, 2].reduce((sum, i) => {
    const city = k.cities?.[i]
    return sum + (city && city.key === b.target_city && isNum(city.pct) ? city.pct : 0)
  }, 0)
  const cityPart = !isNum(k.cityKnownPct) ? NA : Math.min(100, round0((cityHit / V.CAL_CITY_TARGET) * 100))
  const locationScore = weighted([[countryPart, V.W_LOC_COUNTRY], [cityPart, V.W_LOC_CITY]])

  const interestSum = INTEREST_KEYS.reduce((sum, key) => {
    const pct = k.interests?.[key]
    return sum + (isNum(pct) && b.interests.includes(key) ? pct : 0)
  }, 0)
  const interestScore = !isNum(k.interestKnownPct) ? NA
    : Math.min(100, round0((interestSum / V.CAL_INTEREST_TARGET) * 100))

  const audienceScore = weighted([
    [ageScore, V.W_TA_AGE], [genderScore, V.W_TA_GENDER],
    [locationScore, V.W_TA_LOCATION], [interestScore, V.W_TA_INTEREST],
  ])

  /* 3. Content & Category Relevance */
  const contentCategoryMatch = !capCatKnown ? V.CAL_NEUTRAL
    : (b.category === k.classifiedCategory ? 100 : dbcat(b.category, k.classifiedCategory))
  const subCategoryMatch = NA          // no sub-category column exists
  const topicMatch = topicHay.trim().length === 0 ? NA : overlap(b.caption_terms, topicHay)
  const contentStyleMatch = NA         // no content-style column exists
  const contentScore = weighted([
    [contentCategoryMatch, V.W_CC_CAT], [subCategoryMatch, V.W_CC_SUBCATEGORY],
    [topicMatch, V.W_CC_TOPICS], [contentStyleMatch, V.W_CC_STYLE],
  ])

  /* 4. Brand Personality Fit — every input is a column that does not exist */
  const personalityScore = weighted([
    [NA, V.W_BP_PERSONALITY], [NA, V.W_BP_TONE], [NA, V.W_BP_VALUES], [NA, V.W_BP_COMM],
  ])

  /* 5. Performance Quality */
  const erScore = !isNum(k.er) ? NA
    : Math.min(100, round0((k.er / erTargetFor(k.tier)) * 100))
  const audienceQualityScore = !isNum(k.audienceQuality) ? NA
    : Math.min(100, Math.max(0, k.audienceQuality))
  const consistencyScore = (!isNum(k.postFrequencyMonthly) || !isNum(k.observationDays)
    || k.observationDays < V.CAL_MIN_OBS_DAYS) ? NA
    : Math.min(100, round0((k.postFrequencyMonthly / V.CAL_CONSISTENCY_TARGET) * 100))
  const communityScore = NA            // no column exists
  const averageViewsScore = !isNum(k.vfr) ? NA
    : Math.min(100, round0((k.vfr / V.CAL_VFR_TARGET_ROSTER) * 100))
  const recentGrowthScore = !isNum(k.followersGrowth) ? NA
    : Math.min(100, Math.max(0, round0(((k.followersGrowth + 2) / (V.CAL_GROWTH_TARGET + 2)) * 100)))
  const performanceScore = weighted([
    [erScore, V.W_PQ_ER], [audienceQualityScore, V.W_PQ_AUDIENCE],
    [consistencyScore, V.W_PQ_CONSISTENCY], [communityScore, V.W_PQ_COMMUNITY],
    [averageViewsScore, V.W_PQ_VIEWS], [recentGrowthScore, V.W_PQ_GROWTH],
  ])

  /* 6. Brand Safety — an integrity screen; no content-risk reading exists */
  const authenticityScore = !isNum(k.authenticity) ? NA : Math.min(100, Math.max(0, k.authenticity))
  const followerQualityScore = !isNum(k.followerQuality) ? NA : Math.min(100, Math.max(0, k.followerQuality))
  const verificationScore = k.verified === 'Yes' ? V.CAL_VERIFIED_YES
    : k.verified === 'No' ? V.CAL_VERIFIED_NO : NA
  const paidRatioScore = !isNum(k.paidRatio) ? NA
    : Math.max(0, round0(100 - (k.paidRatio / V.CAL_PAID_CEILING) * 100))
  const safetyScore = weighted([
    [authenticityScore, V.W_BS_AUTHENTICITY], [followerQualityScore, V.W_BS_FOLLOWER_QUALITY],
    [verificationScore, V.W_BS_VERIFICATION], [paidRatioScore, V.W_BS_PAID],
  ])

  /* result */
  const components = [
    [businessScore, V.W_BRAND_BUSINESS], [audienceScore, V.W_TARGET_AUDIENCE],
    [contentScore, V.W_CONTENT_CATEGORY], [personalityScore, V.W_PERSONALITY],
    [performanceScore, V.W_PERFORMANCE], [safetyScore, V.W_SAFETY],
  ]
  const availableWeight = components.reduce((n, [v, w]) => n + (isNum(v) ? w : 0), 0)
  const finalScore = availableWeight === 0 ? NA
    : round0(components.reduce((n, [v, w]) => n + (isNum(v) ? v * w : 0), 0) / availableWeight)

  const level = !isNum(finalScore) ? 'Not Scored'
    : finalScore >= V.BAND_EXCELLENT ? 'Excellent Match'
      : finalScore >= V.BAND_STRONG ? 'Strong Match'
        : finalScore >= V.BAND_GOOD ? 'Good Match'
          : finalScore >= V.BAND_MODERATE ? 'Moderate Match' : 'Low Match'

  const dataCompleteness = completeness(k)
  const confidence = dataCompleteness >= V.CONF_HIGH ? 'High'
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
 * Normalized Score = Absolute / max(Absolute in the SAME comparison population) x 100.
 *
 * The maximum is taken over the rows handed in and nowhere else. That is the
 * whole point of the column: it answers "how high does this creator sit among
 * the creators actually being compared", so a global maximum from the full
 * database would answer a question nobody asked and would move every number the
 * moment an unrelated creator was added.
 *
 * Rows that could not be scored at all are excluded from the maximum and carry
 * N/A through, rather than being treated as zero and dragging the scale.
 *
 * This never touches the absolute score. Both travel together everywhere.
 */
export function normalise(rows, getAbsolute = r => r.finalScore) {
  const scored = rows.filter(r => isNum(getAbsolute(r)))
  if (!scored.length) return rows.map(() => NA)
  const max = Math.max(...scored.map(getAbsolute))
  if (max <= 0) return rows.map(r => (isNum(getAbsolute(r)) ? 0 : NA))
  return rows.map(r => (isNum(getAbsolute(r))
    ? Math.round((getAbsolute(r) / max) * 10000) / 100     // two decimals, as the brief's worked example
    : NA))
}

/**
 * Turns a fetched creator record into the shape `score()` reads.
 *
 * The derived strings are built exactly as `buildKolSourceData` builds the cells
 * the formulas point at — same joins, same separators, same order — because the
 * haystack a keyword is searched in is part of the model, not a formatting
 * choice. A different separator here would score differently there.
 */
export function toScoringRecord(rec) {
  const interests = {}
  for (const it of rec.interests ?? []) interests[it.key] = it.pct
  const cities = (rec.cityShares ?? []).slice(0, 3)
  const idShare = (rec.countryShares ?? []).find(c => c.key === 'ID')?.pct ?? null

  const topics = (rec.classification?.topics ?? []).map(t => t.label).join(', ') || null
  const evidence = (rec.classification?.categoryScores ?? []).slice(0, 2)
    .map(c => `${c.label} ${c.points}pt [${c.evidence.slice(0, 3).join('; ')}]`).join('  ·  ') || null

  return {
    handle: rec.resolved,
    name: rec.name,
    platform: rec.platform,
    followers: rec.followers,
    tier: tierOf(rec.followers),
    verified: rec.verified,

    category: rec.category ?? null,
    classifiedCategory: rec.classifiedCategory ?? null,
    rawCategories: (rec.rawCategories ?? []).join(' | ') || null,
    contentTopics: topics,
    classificationEvidence: evidence,
    bio: rec.bio ?? null,
    captionDigest: rec.captionDigest ?? null,
    hashtagDigest: rec.hashtagDigest ?? null,

    // No age signal exists anywhere on this server; carried as null so Age Score
    // resolves to N/A through the same branch it would use with real data.
    agePrimaryShare: null,
    ageSecondaryShare: null,
    femalePct: rec.femalePct ?? null,
    malePct: rec.malePct ?? null,
    audienceCountry: idShare == null ? null : 'Indonesia',
    countryShare: idShare,
    cities,
    cityKnownPct: rec.cityKnownPct ?? null,
    interests,
    interestKnownPct: rec.interestKnownPct ?? null,

    er: rec.er ?? null,
    avgViews: rec.avgViews ?? null,
    vfr: rec.vfr ?? null,
    postFrequencyMonthly: rec.postFrequencyMonthly ?? null,
    observationDays: rec.observationDays ?? null,
    followersGrowth: rec.followersGrowth ?? null,
    paidRatio: rec.paidRatio ?? null,

    audienceQuality: rec.audienceQuality ?? null,
    authenticity: rec.authenticity ?? null,
    followerQuality: rec.followerQuality ?? null,
  }
}

export { V as CONSTANTS, isNum, round0 }
