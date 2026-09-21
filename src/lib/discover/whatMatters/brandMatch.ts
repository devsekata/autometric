import kolDb from '@/lib/kolDb'
import { CRITERIA_LABELS, type CriterionKey } from './model'
import { contributingCount, whatMattersScore, type CriterionScores } from './score'
import { matchWhatMatters } from './index'
import { resetPopulationCache } from './records'

/**
 * Brand Match — the What Matters a workspace chose on its Brand Profile,
 * averaged.
 *
 *     brand_profile.what_matters → the KOL's score on each → arithmetic mean
 *
 * Nothing is recomputed here. Every score is the one What Matters already
 * produces (`scoreRecord` in `./index`), and the mean is `whatMattersScore`
 * from `./score`: equal weight per chosen criterion, no extra weights, and a
 * chosen criterion whose score is null leaves the DENOMINATOR instead of
 * counting as zero. Nothing chosen, or every chosen score null, gives a null
 * Match % — never an invented one.
 *
 * ── Two vocabularies, one mapping ──────────────────────────────────────────
 * The Brand Profile stores its own keys (`WHAT_MATTERS_KEYS`); What Matters
 * scores under its criterion keys. `WHAT_MATTERS_CRITERION` is the only place
 * the two meet, so neither vocabulary has to change for the other. Brand
 * Safety is not one of the six and cannot be chosen.
 */

/** What a Brand Profile can store in `what_matters`, in UI order. */
export const WHAT_MATTERS_KEYS = [
  'strong_engagement', 'high_audience_quality', 'consistent_performance',
  'strong_community', 'high_reach', 'content_quality',
] as const
export type WhatMattersKey = (typeof WHAT_MATTERS_KEYS)[number]

/** Brand Profile key → the What Matters criterion that scores it. */
export const WHAT_MATTERS_CRITERION: Record<WhatMattersKey, CriterionKey> = {
  strong_engagement: 'engagement',
  high_audience_quality: 'audience_quality',
  consistent_performance: 'consistency',
  strong_community: 'community',
  high_reach: 'reach',
  content_quality: 'content_quality',
}

/**
 * The labels What Matters itself uses, so the form, the breakdown and the
 * criterion agree on one name. (Strong Community reads "Audiens Aktif & Asli":
 * What Matters chose that label because the score measures a real, reacting
 * audience, not a community.)
 */
export const WHAT_MATTERS_OPTIONS: readonly { key: WhatMattersKey; label: string }[] =
  WHAT_MATTERS_KEYS.map(key => ({ key, label: CRITERIA_LABELS[WHAT_MATTERS_CRITERION[key]] }))

/**
 * A selection, cleaned: known keys only, canonical order, no duplicates.
 * Anything else — `brand_safety`, a typo, a non-string — is dropped.
 */
export function cleanWhatMatters(value: unknown): WhatMattersKey[] {
  if (!Array.isArray(value)) return []
  const picked = new Set(value.filter((v): v is string => typeof v === 'string').map(v => v.trim()))
  return WHAT_MATTERS_KEYS.filter(k => picked.has(k))
}

/** One chosen criterion, as the UI explains it. */
export interface BrandMatchComponent {
  key: WhatMattersKey
  label: string
  /** The What Matters score, 0–100, or null when it could not be measured. */
  score: number | null
  /** Whether it entered the mean — false exactly when `score` is null. */
  counted: boolean
}

export interface BrandMatchResult {
  /** Mean of the chosen criteria that have a score. Null if none do. */
  matchPct: number | null
  /** Why `matchPct` is null, when it is. */
  unavailable?: 'no_selection' | 'no_scores'
  /** How many chosen criteria contributed a score. */
  contributing: number
  /** How many were chosen. */
  selected: number
  /** Every chosen criterion, in order — what the Match % is made of. */
  breakdown: BrandMatchComponent[]
}

/**
 * Brand Match for one KOL from scores What Matters already computed. Pure.
 * Only the chosen criteria are read; nothing else in `scores` can move it.
 */
export function brandMatchFromScores(
  scores: CriterionScores,
  whatMatters: readonly string[],
): BrandMatchResult {
  const chosen = cleanWhatMatters(whatMatters)
  const criteria = chosen.map(k => WHAT_MATTERS_CRITERION[k])
  const breakdown: BrandMatchComponent[] = chosen.map(key => {
    const v = scores[WHAT_MATTERS_CRITERION[key]]
    const score = typeof v === 'number' && Number.isFinite(v) ? v : null
    return {
      key, label: CRITERIA_LABELS[WHAT_MATTERS_CRITERION[key]], score, counted: score !== null,
    }
  })

  const matchPct = whatMattersScore(scores, criteria)
  const result: BrandMatchResult = {
    matchPct,
    contributing: contributingCount(scores, criteria),
    selected: chosen.length,
    breakdown,
  }
  if (matchPct === null) result.unavailable = chosen.length ? 'no_scores' : 'no_selection'
  return result
}

/** What the KOL Directory returns under `brandMatch`. */
export interface DirectoryBrandMatch {
  /** The Brand Profile's saved choice, cleaned. */
  whatMatters: WhatMattersKey[]
  /** The six a profile can choose from, with labels. */
  options: readonly { key: WhatMattersKey; label: string }[]
  /** Set when nothing is chosen: no KOL was scored, and none gets a Match %. */
  unavailable?: 'no_selection'
  /** Creator id → Match % and its breakdown. */
  rows: Record<string, BrandMatchResult>
}

/**
 * Which state of the population tables the last Brand Match was ranked against.
 *
 * `count(*)` and `max(updated_at)` per table — the fingerprint the Dagster
 * `l0_raw_new_data_sensor` uses on `l0_raw`. Every writer of these tables stamps
 * `updated_at = now()` on a real change: the transform chain's `kol_profile_card`,
 * `post_metric` and `feature.*_engagement_analysis` upserts, and the roster
 * ingest and Add KOL on `kol_directory`. A write moves the max and a delete
 * moves the count. `kol_social_account` decides which accounts' Feature ER join
 * the population and has no `updated_at`; links are only ever added or
 * removed, so its count is enough.
 */
const POPULATION_VERSION_SQL = `
  SELECT concat_ws('|',
    (SELECT count(*) || ':' || COALESCE(max(updated_at)::text, '') FROM public.kol_directory),
    (SELECT count(*) || ':' || COALESCE(max(updated_at)::text, '') FROM l2_gold.kol_profile_card),
    (SELECT count(*) || ':' || COALESCE(max(updated_at)::text, '') FROM l2_gold.post_metric),
    (SELECT count(*) || ':' || COALESCE(max(updated_at)::text, '') FROM feature.ig_engagement_analysis),
    (SELECT count(*) || ':' || COALESCE(max(updated_at)::text, '') FROM feature.tt_engagement_analysis),
    (SELECT count(*)::text FROM public.kol_social_account)
  ) AS v`

let seenVersion: string | null = null

/**
 * The fingerprint of the KOL data Brand Match reads, as it is right now. A
 * stored Brand Match result records it (`brand_match_result.data_version`) and
 * is used only while it is still current.
 */
export async function currentDataVersion(): Promise<string> {
  const { rows: [{ v }] } = await kolDb().query<{ v: string }>(POPULATION_VERSION_SQL)
  return v
}

/**
 * Drops What Matters' cached population when the KOL data under it changed.
 *
 * That cache is time-based (`./records`), so without this a Brand Match asked
 * right after a pipeline run could rank against the population from before it
 * for up to the cache's TTL. Done here rather than in `./records`, which stays
 * the What Matters port it is checked to be. One round trip per request.
 *
 * The version is read BEFORE the population: a write landing in between leaves
 * `seenVersion` behind the data, so the next request resets again — it can
 * rebuild once too often, never serve a population older than its version.
 */
async function dropPopulationIfDataChanged(): Promise<void> {
  const { rows: [{ v }] } = await kolDb().query<{ v: string }>(POPULATION_VERSION_SQL)
  if (v !== seenVersion) {
    resetPopulationCache()
    seenVersion = v
  }
}

/**
 * Brand Match for a page of KOLs, from a Brand Profile's saved choice.
 *
 * Scores come from `matchWhatMatters` — the same records, population and
 * formulas What Matters uses — read from the KOL database only. With nothing
 * chosen it returns without querying anything.
 *
 * Nothing is stored and nothing about the profile is cached: the caller reads
 * `whatMatters` from `brand_profile` on the same request, and the population is
 * dropped whenever the KOL data changed. So a saved Brand Profile and a finished
 * pipeline run both reach the very next Brand Match.
 */
export async function brandMatchForDirectory(
  creatorIds: string[],
  whatMatters: readonly string[],
): Promise<DirectoryBrandMatch> {
  const chosen = cleanWhatMatters(whatMatters)
  const base = { whatMatters: chosen, options: WHAT_MATTERS_OPTIONS }
  if (!chosen.length) return { ...base, unavailable: 'no_selection', rows: {} }
  if (!creatorIds.length) return { ...base, rows: {} }

  await dropPopulationIfDataChanged()
  const scored = await matchWhatMatters(creatorIds, chosen.map(k => WHAT_MATTERS_CRITERION[k]))
  const rows: Record<string, BrandMatchResult> = {}
  for (const [id, r] of scored) rows[id] = brandMatchFromScores(r.scores, chosen)
  return { ...base, rows }
}
