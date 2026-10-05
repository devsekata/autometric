/**
 * ESTIMATED audience age — a modelled distribution, not a measurement.
 *
 * Audience age has two real sources (see ./curatedAudience): a usable measured
 * split, or the curated label. Most creators added through "Add New KOL" have
 * neither: their followers' bios almost never state an age, and the curated
 * workbook covers only the original cohort. For those creators the Age block
 * was empty.
 *
 * This module fills that gap, and only that gap, with a distribution modelled
 * from what IS known about the creator: the platform, the creator's category,
 * the audience's top interest and the creator's own age band. Nothing here is
 * read from or written to the database, and the result is always labelled
 * `estimated` so it can never be mistaken for an observed figure.
 *
 *   usable measured split   -> shown as measured          (untouched)
 *   curated label           -> shown as curated           (untouched)
 *   neither                 -> the estimate below, blended with whatever ages
 *                              followers DID state (too few to be usable alone)
 *
 * The numbers are priors chosen to be plausible, not statistics about any
 * creator. They are deliberately few and readable so they can be argued with.
 */

/** The bands the estimate is expressed in, youngest first. */
export const ESTIMATE_AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45+'] as const
export type EstimateAgeBand = (typeof ESTIMATE_AGE_BANDS)[number]

/**
 * Starting split per platform, in percent. `13-17` starts at 0 and appears only
 * when a follower actually stated an age in that band.
 */
const BASE: Record<string, Record<EstimateAgeBand, number>> = {
  instagram: { '13-17': 0, '18-24': 32, '25-34': 41, '35-44': 19, '45+': 8 },
  tiktok:    { '13-17': 0, '18-24': 38, '25-34': 37, '35-44': 17, '45+': 8 },
}
const DEFAULT_PLATFORM = 'instagram'

/**
 * How far one unit of tilt moves each band (exponent of the reweighting).
 * Negative tilt = younger audience, positive = older.
 */
const BAND_SLOPE: Record<EstimateAgeBand, number> = {
  '13-17': -0.6, '18-24': -0.45, '25-34': 0, '35-44': 0.35, '45+': 0.5,
}
const TILT_LIMIT = 1.5

/** `kol_categories.taxonomy_key` -> tilt. Keys not listed are neutral. */
const CATEGORY_TILT: Record<string, number> = {
  'gen z': -1, entertainment: -0.5, tech: -0.5, moms: 1,
}
/** `feature.*_audience_analysis.interest_top` -> tilt. */
const INTEREST_TILT: Record<string, number> = {
  education: -0.5, entertainment: -0.5, music: -0.5, technology: -0.5,
  parenting: 1, business: 0.5, religion: 0.5, automotive: 0.5,
}
/** `l2_gold.kol_profile_card.creator_age_band` -> tilt: audiences cluster near the creator's age. */
const CREATOR_AGE_TILT: Record<string, number> = {
  '13-17': -0.5, '18-24': -0.5, '35-44': 0.5, '45+': 1,
}

/**
 * How many followers the prior is worth when blended with stated ages. Equal to
 * the classification's MIN_KNOWN: below that many known ages the measured split
 * is not usable on its own, so the prior carries at least as much weight.
 */
export const PRIOR_WEIGHT = 5

export interface AgeEstimateSignals {
  platform?: string | null
  /** `kol_categories.taxonomy_key` of the creator's category. */
  categoryKey?: string | null
  /** The audience's top inferred interest. */
  interestTop?: string | null
  /** The creator's own age band. */
  creatorAgeBand?: string | null
}

export interface AgeEstimate {
  /** One slice per band with a non-zero share, youngest first; `pct` sums to exactly 100. */
  slices: { label: string; pct: number; n: number }[]
  /** Followers whose stated age was blended in (0 = pure model). */
  observedKnown: number
  /** What the estimate was built from, in display order. */
  basis: string[]
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

/** Rounds shares to one decimal so they sum to exactly 100 (largest remainder). */
function toPercentages(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return weights.map(() => 0)
  const tenths = weights.map(w => (w / total) * 1000)
  const floors = tenths.map(Math.floor)
  let left = 1000 - floors.reduce((a, b) => a + b, 0)
  const order = tenths
    .map((t, i) => ({ i, frac: t - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return floors.map(f => f / 10)
}

/**
 * The estimated age split for one creator.
 *
 * `observed` is the number of followers per band who stated an age — real
 * evidence too thin to stand alone. It is kept, not discarded: each band's share
 * is `(prior x PRIOR_WEIGHT + observed) / (PRIOR_WEIGHT + total observed)`, so
 * the model only fills in what the evidence cannot.
 */
export function estimateAudienceAge(
  signals: AgeEstimateSignals,
  observed: Partial<Record<string, number>> = {},
): AgeEstimate {
  const platform = norm(signals.platform)
  const base = BASE[platform] ?? BASE[DEFAULT_PLATFORM]
  const basis: string[] = [BASE[platform] ? `platform ${platform}` : 'platform tidak dikenal']

  let tilt = 0
  const add = (table: Record<string, number>, raw: string | null | undefined, label: string) => {
    const t = table[norm(raw)]
    if (!t) return
    tilt += t
    basis.push(`${label} ${String(raw).trim()}`)
  }
  add(CATEGORY_TILT, signals.categoryKey, 'kategori')
  add(INTEREST_TILT, signals.interestTop, 'minat audiens')
  add(CREATOR_AGE_TILT, signals.creatorAgeBand, 'umur kreator')
  tilt = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, tilt))

  const prior = toPercentages(ESTIMATE_AGE_BANDS.map(b => base[b] * Math.exp(tilt * BAND_SLOPE[b])))

  const counts = ESTIMATE_AGE_BANDS.map(b => {
    const n = Number(observed[b] ?? 0)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
  })
  const observedKnown = counts.reduce((a, b) => a + b, 0)
  if (observedKnown > 0) basis.push(`${observedKnown} follower yang menyebut umur`)

  const pct = toPercentages(prior.map((p, i) => (p / 100) * PRIOR_WEIGHT + counts[i]))
  return {
    slices: ESTIMATE_AGE_BANDS
      .map((label, i) => ({ label, pct: pct[i], n: counts[i] }))
      .filter(s => s.pct > 0),
    observedKnown,
    basis,
  }
}
