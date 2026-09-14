/**
 * What Matters Most — the seven criterion scores, and the average over the ones
 * a user selected.
 *
 * A PORT of `scripts/what-matters/what_matters_scoring.py` for six of the
 * seven; see `./model` for why it is ported rather than called, and for the
 * Content Quality rubrics that are this file's one deliberate divergence.
 *
 * ── NULL is not zero, and that is the whole point ──────────────────────────
 * Every function here returns `null` for "not measured" and never substitutes a
 * number. A criterion the user selected but whose value is null is dropped from
 * the DENOMINATOR of the average, not counted as zero — a creator must not fall
 * in the ranking because nobody has measured them yet. All selected criteria
 * null returns null, and the caller sorts those last.
 *
 * Pure and client-safe: no `pg`, no fetch.
 */

import {
  SKALA_MAX, SKALA_MIN, TINGKAT_RELIABILITAS, TINGKAT_STABILITAS,
  FORMAT_RUBRIC, TOPIC_SOURCE_RUBRIC, TOPIC_SOURCE_UNKNOWN,
  W_CQ_ENGAGEMENT, W_CQ_FORMAT, W_CQ_TOPIC,
  type CriterionKey,
} from './model'

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** Python's `round(x, 4)`. Kept so the port and the reference agree exactly. */
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

/** `klem` — clamp into 0..100. Null stays null. */
export function clamp(v: number | null): number | null {
  if (!isNum(v)) return null
  return Math.max(SKALA_MIN, Math.min(SKALA_MAX, v))
}

/**
 * `persentil_ke_skor` — percentile rank of `value` within `population`, 0..100.
 *
 * Percentile rather than a linear normalisation against the maximum, because
 * both metrics this is used on are severely skewed: engagement rate has a tail
 * to 223% and median views to 136 million, so dividing by the max would pin
 * almost the whole population to zero. A percentile needs no invented benchmark
 * and is immune to the outlier — a 223% ER simply ranks first.
 *
 * The population counts only MEASURED values; nulls are excluded rather than
 * treated as zero. The denominator is `n - 1` so a value from outside the
 * population cannot exceed 100.
 */
export function percentileScore(
  value: number | null,
  population: readonly (number | null)[],
): number | null {
  if (!isNum(value)) return null
  const measured = population.filter(isNum)
  if (!measured.length) return null
  if (measured.length === 1) return value >= measured[0] ? SKALA_MAX : SKALA_MIN
  const smaller = Math.min(
    measured.reduce((n, x) => n + (x < value ? 1 : 0), 0),
    measured.length - 1,
  )
  return round4((smaller / (measured.length - 1)) * SKALA_MAX)
}

/** `_rata_rata_tersedia` — mean over the values that exist. All null → null. */
export function meanAvailable(...values: (number | null)[]): number | null {
  const have = values.filter(isNum)
  if (!have.length) return null
  return have.reduce((a, b) => a + b, 0) / have.length
}

/** `_ordinal_ke_skor` — position on a ladder, normalised to 0..100. */
export function ordinalScore(
  label: string | null | undefined,
  ladder: readonly string[],
): number | null {
  if (!label) return null
  const i = ladder.indexOf(label)
  if (i === -1) return null
  return round4((i / (ladder.length - 1)) * SKALA_MAX)
}

/**
 * A weighted mean over only the parts that are numbers, renormalising the rest.
 *
 * The same rule `weighted()` in `brandMatch/score.ts` applies, written here
 * rather than imported because the two models are independent: Brand Match's
 * copy is pinned to the Excel workbook and must never move for a reason
 * originating in What Matters.
 */
function weighted(parts: [number | null, number][]): number | null {
  let num = 0
  let den = 0
  for (const [v, w] of parts) {
    if (!isNum(v)) continue
    num += v * w
    den += w
  }
  return den === 0 ? null : num / den
}

/* ── the seven criteria ───────────────────────────────────────────────────── */

/** 1. Strong Engagement — REAL. Percentile rank of engagement rate. */
export const engagementScore = (
  engagementRate: number | null,
  populationEr: readonly (number | null)[],
): number | null => percentileScore(engagementRate, populationEr)

/**
 * 2. High Audience Quality — REAL. Mean of two scores already on 0..100.
 *
 * Not renormalised, because both arrive on that scale already and rescaling
 * would destroy their meaning. If one is null the other is used as it stands.
 *
 * ── KNOWN DOUBLE COUNT, kept deliberately ─────────────────────────────────
 * `audience_quality_score` is itself `(follower_quality + authenticity) / 2`
 * upstream. Verified against live data: of the 27 rows carrying all three,
 * 27 land within one point of that identity and 13 match exactly.
 *
 * So this mean expands to `follower_quality/4 + 3 x authenticity/4` —
 * authenticity carries 75% of the criterion and follower quality 25%, which is
 * not what the name suggests.
 *
 * It is NOT corrected here. This function is a port whose whole value is that
 * `verify-what-matters-port.ts` proves it reproduces the Python reference; a
 * unilateral fix would break that proof and fork the two implementations on
 * the first day. Changing it is a model decision and belongs upstream, in
 * `scripts/what-matters/what_matters_scoring.py`, where the reference can move
 * first and this port can follow it. Reported in the completion notes.
 */
export const audienceQualityScore = (
  aq: number | null,
  authenticity: number | null,
): number | null => clamp(meanAvailable(aq, authenticity))

/**
 * 3. Consistent Performance — REAL. Mean of two ordinal labels.
 *
 * `performance_stability` already points the right way: it derives from
 * `er_stddev_pp`, where a SMALL deviation means stable, and the upstream
 * threshold function has already inverted it into High/Medium/Low.
 */
export const consistencyScore = (
  performanceStability: string | null,
  postFrequencyReliability: string | null,
): number | null => meanAvailable(
  ordinalScore(performanceStability, TINGKAT_STABILITAS),
  ordinalScore(postFrequencyReliability, TINGKAT_RELIABILITAS),
)

export const W_COMMUNITY_QUALITY = 0.70
export const W_COMMUNITY_ER = 0.30

/**
 * 4. Audiens Aktif & Asli — PROXY. Audience quality 70% + ER percentile 30%.
 *
 * NOT a measurement of community: no column in this database describes one. It
 * combines the two signals that do exist and that plausibly travel with a live
 * audience — an audience that is real, and an audience that reacts.
 *
 * The 70/30 split replaced a proposed 40/30/30 over audience quality,
 * authenticity and engagement, because `audience_quality_score` is LITERALLY
 * `(follower_quality + authenticity) / 2` upstream. The proposal would have
 * given authenticity 50% effective weight against follower quality's 20% —
 * counting one signal twice. See the double-counting note in the completion
 * report.
 */
export function communityStrengthScore(
  aq: number | null,
  engagementRate: number | null,
  populationEr: readonly (number | null)[],
): number | null {
  const er = percentileScore(engagementRate, populationEr)
  const q = clamp(aq)
  if (q === null && er === null) return null
  if (q === null) return er
  if (er === null) return q
  return q * W_COMMUNITY_QUALITY + er * W_COMMUNITY_ER
}

/**
 * 5. High Reach — PROXY OVER VIEWS, not Insights reach.
 *
 * `median_views` over `avg_views`: the two correlate at 0.957, but the mean is
 * dragged by viral posts (p50 638k against a median of 345k), so one exploding
 * post would lift an account past a consistent one.
 */
export const reachProxyScore = (
  medianViews: number | null,
  populationViews: readonly (number | null)[],
): number | null => percentileScore(medianViews, populationViews)

/**
 * 6. Content Quality — Engagement 40% + Format 30% + Topic 30%.
 *
 * The one criterion that is NOT a port: the Python returns null here by
 * design. See `./model` for the two rubrics and for why the topic axis scores
 * evidence strength rather than ranking one subject above another.
 *
 * Nullable-aware like everything else: a missing part renormalises the weights
 * of the parts that remain, and all three missing returns null rather than 0.
 */
export function contentQualityScore(
  engagementRate: number | null,
  populationEr: readonly (number | null)[],
  formatDominant: string | null,
  contentTopic: string | null,
  contentTopicSource: string | null,
): number | null {
  const engagement = percentileScore(engagementRate, populationEr)

  const format = formatDominant
    ? FORMAT_RUBRIC[formatDominant.trim().toLowerCase()] ?? null
    : null

  // A topic must exist before its source means anything: the source column
  // describes how the topic was arrived at, so without a topic there is
  // nothing for it to describe.
  const topic = contentTopic && contentTopic.trim()
    ? (contentTopicSource
        ? TOPIC_SOURCE_RUBRIC[contentTopicSource.trim().toLowerCase()] ?? TOPIC_SOURCE_UNKNOWN
        : TOPIC_SOURCE_UNKNOWN)
    : null

  return weighted([
    [engagement, W_CQ_ENGAGEMENT],
    [format, W_CQ_FORMAT],
    [topic, W_CQ_TOPIC],
  ])
}

export const W_BS_AUTHENTICITY = 40
export const W_BS_FOLLOWER_QUALITY = 30
export const W_BS_VERIFIED = 15
export const W_BS_PAID = 15

/**
 * 7. Brand Safety — Authenticity 40% + Follower Quality 30% + Verified 15% +
 * Paid 15%. The Brand Match formula, reused unchanged.
 *
 * ── What this actually measures ────────────────────────────────────────────
 * Creator and ACCOUNT INTEGRITY. It does not measure content risk. There is no
 * toxicity reading, no sentiment, no topic-safety taxonomy and no comment
 * analysis anywhere in this database — `*_comments_analysis` holds zero rows —
 * so nothing here may be described as content safety, risky content, toxicity
 * or sentiment. The name is kept because the Brand Match model is locked.
 *
 * `verified` is a boolean, not a measurement: true scores 100, false scores 50
 * rather than 0, because unverified is an unanswered question and not evidence
 * of harm. Null stays null and renormalises away.
 */
export function brandSafetyScore(
  authenticity: number | null,
  followerQuality: number | null,
  verified: boolean | null,
  paidRatio: number | null,
  paidCeiling = 40,
): number | null {
  const verifiedScore = verified === null || verified === undefined
    ? null : (verified ? 100 : 50)
  const paid = isNum(paidRatio)
    ? Math.max(0, 100 - (paidRatio / paidCeiling) * 100)
    : null
  return weighted([
    [clamp(authenticity), W_BS_AUTHENTICITY],
    [clamp(followerQuality), W_BS_FOLLOWER_QUALITY],
    [verifiedScore, W_BS_VERIFIED],
    [paid, W_BS_PAID],
  ])
}

/* ── the aggregate ────────────────────────────────────────────────────────── */

export type CriterionScores = Partial<Record<CriterionKey, number | null>>

/**
 * The mean over the criteria the user SELECTED and that have a value.
 *
 * A selected criterion whose value is null leaves the denominator rather than
 * scoring zero. Every criterion null returns null, and the caller ranks those
 * last — not via a zero that would put them level with creators who really are
 * poor.
 */
export function whatMattersScore(
  scores: CriterionScores,
  selected: readonly CriterionKey[],
): number | null {
  if (!selected.length) return null
  const have = selected.map(k => scores[k]).filter(isNum)
  if (!have.length) return null
  return have.reduce((a, b) => a + b, 0) / have.length
}

/** How many of the selected criteria actually contributed. */
export function contributingCount(
  scores: CriterionScores,
  selected: readonly CriterionKey[],
): number {
  return selected.map(k => scores[k]).filter(isNum).length
}
