import {
  CRITERIA_ORDER, CRITERIA_LABELS, type CriterionKey,
} from './model'
import {
  audienceQualityScore, communityStrengthScore,
  consistencyScore, contentQualityScore, contributingCount, engagementScore,
  reachProxyScore, whatMattersScore, type CriterionScores,
} from './score'
import {
  whatMattersPopulation, whatMattersRecordsFor,
  type WhatMattersPopulation, type WhatMattersRecord,
} from './records'

export * from './model'
export * from './score'
export * from './records'

/**
 * What Matters Most, as one call.
 *
 *     selected criteria + public.kol_directory -> per-criterion scores -> rank
 *
 * Everything is read from the KOL server through `kolDb()`. Nothing here
 * touches the warehouse, and nothing writes.
 */

export interface WhatMattersResult {
  /** Every criterion, so the UI can show an unmeasured one as unmeasured. */
  scores: CriterionScores
  /** Mean over the SELECTED criteria that have a value. Null if none do. */
  score: number | null
  /** How many selected criteria contributed — read the score beside it. */
  contributing: number
  /** How many were selected in total. */
  selected: number
}

/** Keeps only known keys, in canonical order, de-duplicated. */
export function parseMatters(param: string | readonly string[] | null | undefined): CriterionKey[] {
  if (!param) return []
  const raw = typeof param === 'string' ? param.split(',') : param
  const seen = new Set<string>()
  const out: CriterionKey[] = []
  for (const part of raw) {
    const key = String(part).trim().toLowerCase()
    // Unknown keys are ignored rather than failing the request: a newer UI may
    // send a criterion this build does not know yet.
    if ((CRITERIA_ORDER as readonly string[]).includes(key) && !seen.has(key)) {
      seen.add(key)
      out.push(key as CriterionKey)
    }
  }
  return out
}

/** Every criterion score for one creator, against one population. */
export function scoreRecord(
  k: WhatMattersRecord,
  pop: WhatMattersPopulation,
): CriterionScores {
  return {
    engagement: engagementScore(k.engagementRate, pop.er),
    audience_quality: audienceQualityScore(k.audienceQuality, k.authenticity),
    consistency: consistencyScore(k.performanceStability, k.postFrequencyReliability),
    community: communityStrengthScore(k.audienceQuality, k.engagementRate, pop.er),
    reach: reachProxyScore(k.medianViews, pop.medianViews),
    content_quality: contentQualityScore(
      k.cqErPct, pop.cqEr, k.cqMedianViews, pop.cqMedianViews, k.cqErSdPp, k.cqErPosts),
  }
}

/**
 * Scores a set of creators against the selected criteria.
 *
 * Returns a map keyed by creator id. A creator the roster does not have is
 * absent rather than present with zeros.
 */
export async function matchWhatMatters(
  creatorIds: string[],
  selected: readonly CriterionKey[],
): Promise<Map<string, WhatMattersResult>> {
  const out = new Map<string, WhatMattersResult>()
  if (!creatorIds.length) return out

  const [records, pop] = await Promise.all([
    whatMattersRecordsFor(creatorIds),
    whatMattersPopulation(),
  ])

  for (const [id, record] of records) {
    const scores = scoreRecord(record, pop)
    out.set(id, {
      scores,
      score: whatMattersScore(scores, selected),
      contributing: contributingCount(scores, selected),
      selected: selected.length,
    })
  }
  return out
}

/**
 * Ranks a page by What Matters score.
 *
 * Same contract as `rankByMatch` in `../kolDirectory`: unmeasured last in BOTH
 * directions, nothing coerced into a number, and stable on ties so equal scores
 * keep the incoming SQL order.
 */
export function rankByWhatMatters<T>(
  rows: readonly T[],
  scoreOf: (row: T) => number | null,
  dir: string | null | undefined,
): T[] {
  const asc = dir === 'asc'
  return [...rows].sort((a, b) => {
    const x = scoreOf(a)
    const y = scoreOf(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return asc ? x - y : y - x
  })
}

export { CRITERIA_ORDER, CRITERIA_LABELS }
export type { CriterionKey }
