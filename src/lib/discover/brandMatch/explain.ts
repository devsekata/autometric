import { isNum, weighted, type MatchLevel, type ScoreResult, type Scored } from './score'
import { V } from './model'

/**
 * Turning a Final Match Score into something a person can act on.
 *
 * A number with no reason behind it is not usable: a buyer told "72% match"
 * cannot tell whether that came from a creator who is exactly on-category with
 * no audience data, or one with a great audience in the wrong vertical. Those
 * are different decisions.
 *
 * ── What this deliberately does not show ───────────────────────────────────
 * No weights. Not the component weights, not the sub-weights, not the available
 * weight as a percentage the user is invited to reason about. The brief is
 * explicit and the product reason is stronger than the brief: the moment a user
 * can see that Target Audience is worth 30, the next thing they want is to
 * change it to 50, and a match score that each user has tuned to agree with
 * themselves is not a match score.
 *
 * So the explanation names the DIMENSIONS and says how each one did. That is
 * the honest half — it is what the score is made of — without being the half
 * that invites a fight with the model.
 */

/**
 * The four bars, in the brief's order.
 *
 * These are not the engine's six components — they are the four the product
 * states, and two of them fold a pair of components together:
 *
 *   Category Matching   Brand & Business Relevance  20  +  Content & Category  20
 *   Audience Relevance  Target Audience Relevance   30
 *   Values Alignment    Brand Personality Fit       10
 *   Past Performance    Performance Quality         10  +  Brand Safety        10
 *
 * The engine still computes and weights the SIX. Only the presentation folds,
 * and the fold is a weighted mean over the pair using those same weights, taken
 * through `weighted()` from `./score` so a missing half renormalises instead of
 * dragging the bar toward zero. Merging in the display never changes the Final
 * Match Score, which is computed from the six components directly.
 *
 * A bar carries a 0–100 SCORE, never a weighted contribution. "Audience
 * Relevance 82" means this creator's audience answers the brand's targeting at
 * 82 out of 100 — not that audience contributed 82 of the total.
 */
export const SIGNAL_LABELS = {
  category: 'Category Matching',
  audience: 'Audience Relevance',
  values: 'Values Alignment',
  performance: 'Past Performance',
} as const

export type SignalId = keyof typeof SIGNAL_LABELS

export interface MatchSignal {
  id: SignalId
  label: string
  /** 0–100, or null when this dimension could not be measured for this creator. */
  pct: number | null
  /**
   * Why `pct` is null. Shown instead of the bar, so an unmeasured dimension
   * reads as unmeasured rather than as a zero.
   */
  unavailable?: string
}

export interface MatchExplanation {
  level: MatchLevel
  /** The absolute Final Match Score, 0–100, or null when nothing was scoreable. */
  score: number | null
  confidence: ScoreResult['confidence']
  signals: MatchSignal[]
  /**
   * One sentence, naming what actually drove the number. Written from the
   * signals rather than from a template per band, so it cannot claim a strength
   * the creator does not have.
   */
  summary: string
  /**
   * How much of the model could be computed for this creator, 0–100. Surfaced
   * as coverage — "scored on 60% of the model" — never as a weight the user can
   * edit. It is the honest caveat on a score built from three components
   * instead of six.
   */
  coverage: number
}

/** What each bar reads, and what to say when its inputs are missing. */
const SOURCES: {
  id: SignalId
  of: (s: ScoreResult) => Scored
  unavailable: string
}[] = [
  {
    id: 'category',
    // Brand & Business Relevance + Content & Category Relevance, 20/20.
    of: s => weighted([
      [s.businessScore, V.W_BRAND_BUSINESS],
      [s.contentScore, V.W_CONTENT_CATEGORY],
    ]),
    unavailable: 'This creator carries no category, and their bio and captions were not harvested.',
  },
  {
    id: 'audience',
    of: s => s.audienceScore,
    unavailable: 'No audience analysis exists for this creator — demographics, location and interests are unmeasured.',
  },
  {
    id: 'values',
    // Brand Personality Fit. N/A for every creator on this server today:
    // personality, tone, values and communication have no creator-side column,
    // so `score()` passes a literal N/A for all four sub-scores and this bar
    // reports unmeasured rather than scoring a brand against nothing.
    of: s => s.personalityScore,
    unavailable: 'No personality, tone or values reading exists for any creator on this server yet.',
  },
  {
    id: 'performance',
    // Performance Quality + Brand Safety, 10/10.
    //
    // Brand Safety here is an INTEGRITY screen — authenticity, follower
    // quality, verification, paid ratio. It is not a content-risk reading, and
    // no content-risk source exists on this server, which is part of why it
    // sits inside Past Performance rather than claiming a bar of its own.
    of: s => weighted([
      [s.performanceScore, V.W_PERFORMANCE],
      [s.safetyScore, V.W_SAFETY],
    ]),
    unavailable: 'No engagement rate, view ratio, posting cadence or authenticity reading has been measured for this creator.',
  },
]

/** Reads well above a bar, and is the band the engine itself uses. */
const STRONG = V.BAND_STRONG
/** Below this a component is written up as a consideration, per `EXP_CONSIDERATION`. */
const CONSIDER = 75

export function explain(s: ScoreResult): MatchExplanation {
  const signals: MatchSignal[] = SOURCES.map(src => {
    const v = src.of(s)
    return isNum(v)
      ? { id: src.id, label: SIGNAL_LABELS[src.id], pct: v }
      : { id: src.id, label: SIGNAL_LABELS[src.id], pct: null, unavailable: src.unavailable }
  })

  const measured = signals.filter((x): x is MatchSignal & { pct: number } => x.pct !== null)
  const strengths = measured.filter(x => x.pct >= STRONG)
    .sort((a, b) => b.pct - a.pct)
  const concerns = measured.filter(x => x.pct < CONSIDER)
    .sort((a, b) => a.pct - b.pct)
  const missing = signals.filter(x => x.pct === null)

  const level = s.level
  const score = isNum(s.finalScore) ? s.finalScore : null

  /**
   * Joins labels into a readable clause, and reports whether the result is
   * plural — every verb in the sentences below agrees with a list whose length
   * is not known until runtime, and "brand safety align" is the kind of seam
   * that makes generated copy read as generated.
   */
  const clause = (xs: MatchSignal[]): { text: string; plural: boolean } => {
    const parts = xs.map(x => x.label.toLowerCase())
    const text = parts.length <= 1 ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    return { text, plural: parts.length > 1 }
  }

  const good = clause(strengths)
  const weak = clause(concerns.slice(0, 2))
  const gap = clause(missing)

  let summary: string
  if (score === null) {
    summary = 'Not enough is known about this creator to score them against your brand profile. '
      + 'Nothing in the model could be computed from what the database holds.'
  } else if (!strengths.length && !concerns.length) {
    summary = `${level} — every measured dimension sits in the middle of the range.`
  } else if (strengths.length && concerns.length) {
    summary = `${level} because ${good.text} ${good.plural ? 'align' : 'aligns'} with your brand `
      + `profile, though ${weak.text} ${weak.plural ? 'are' : 'is'} weaker.`
  } else if (strengths.length) {
    summary = `${level} because ${good.text} ${good.plural ? 'align' : 'aligns'} closely with `
      + 'your brand profile.'
  } else {
    summary = `${level} — ${weak.text} ${weak.plural ? 'sit' : 'sits'} below what your brand `
      + 'profile asks for.'
  }

  if (missing.length && score !== null) {
    summary += ` Scored on ${s.availableWeight}% of the model: ${gap.text} `
      + `${gap.plural ? 'are' : 'is'} not measured for this creator.`
  }

  return {
    level,
    score,
    confidence: s.confidence,
    signals,
    summary,
    coverage: s.availableWeight,
  }
}

/**
 * The short label a card wears. `Excellent Match` collapses into `Strong Match`
 * nowhere — the five bands the engine defines are the five statuses shown, and
 * `Not Scored` is a sixth state rather than a low score.
 */
export const LEVEL_TONE: Record<MatchLevel, 'excellent' | 'strong' | 'good' | 'moderate' | 'low' | 'none'> = {
  'Excellent Match': 'excellent',
  'Strong Match': 'strong',
  'Good Match': 'good',
  'Moderate Match': 'moderate',
  'Low Match': 'low',
  'Not Scored': 'none',
}
