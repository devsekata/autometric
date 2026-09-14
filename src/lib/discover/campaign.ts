import type { KolProfile } from './profile'

/**
 * Campaign modelling: what a budget buys, and how likely it is to work.
 *
 * This is the part the source platform faked — its checkout showed a total and
 * a decorative "campaign success" number with no inputs. Here every figure is
 * computed from the selected creators' own metrics, and each function states
 * its formula so the UI can show the working.
 *
 * Deliberately pure and dependency-free: no DB, no fetch. That makes the whole
 * model directly testable, and lets the same code price a cart on the server
 * and preview a budget in the browser without drifting apart.
 */

export interface SelectedKol {
  profile: KolProfile
  /** Deliverable count for this creator in the campaign. */
  units: number
  /** Cost of those units, in rupiah. */
  cost: number
}

/* ── reach & engagement ──────────────────────────────────────────────────── */

/**
 * Reach for one creator across `units` posts, or `null` when unknowable.
 *
 * Successive posts to the same audience overlap heavily, so this is not
 * `reach x units`. Each additional post is discounted geometrically (0.65^n),
 * which keeps a 10-post buy from claiming ten times the audience of a 1-post
 * buy - the single most common way influencer reach gets overstated.
 *
 * ── Why this returns null ──────────────────────────────────────────────────
 * `profile.estimatedReach` is now a three-state field: a measured reach, a
 * figure calculated from measured views, or nothing at all (see its note in
 * `@/lib/discover/profile`). It used to be a measured view count multiplied by
 * a hash of the account id, so it always had a value and this function always
 * returned a number.
 *
 * Returning 0 for the unknown case was the obvious alternative and is wrong:
 * 0 reach makes a creator look like the worst possible buy, when the truth is
 * that nobody has measured them. Callers have to decide what to do about that,
 * and null is what makes them.
 */
export function reachFor(profile: KolProfile, units: number): number | null {
  if (units <= 0) return 0
  const base = profile.estimatedReach.value
  if (base === null) return null
  let total = 0
  for (let i = 0; i < units; i++) total += base * Math.pow(0.65, i)
  return Math.round(total)
}

/**
 * Engagement follows reach at the creator's own measured engagement rate.
 * Null whenever reach is - engagement is a share OF reach, so it cannot be
 * known when reach is not.
 */
export function engagementFor(profile: KolProfile, units: number): number | null {
  const reach = reachFor(profile, units)
  return reach === null ? null : Math.round(reach * (profile.erPct.value / 100))
}

/** Whether this creator's reach rests on a measurement rather than a proxy. */
export const reachIsMeasured = (p: KolProfile): boolean =>
  p.estimatedReach.confidence === 'live'

export interface CampaignEstimate {
  totalCost: number
  totalUnits: number
  creators: number
  reach: number
  engagement: number
  /** Rupiah per person reached. */
  costPerReach: number
  /** Rupiah per engagement. */
  costPerEngagement: number
  /**
   * Campaign EMV. **Always null today.**
   *
   * Summed from `profile.emv`, which has no real source - see its note in
   * `@/lib/discover/profile`. Carried as null rather than removed so the shape
   * survives for the day a rate benchmark exists; every surface renders it
   * unavailable rather than as Rp0.
   */
  emv: number | null
  /** EMV relative to spend. Null whenever `emv` is - it is EMV over cost. */
  roi: number | null
  /**
   * How much of this campaign's reach figure rests on anything at all.
   *
   * `reachKnown` counts the selected creators whose reach could be computed;
   * `reachMeasured` the subset whose figure is a real reach measurement rather
   * than one calculated from views. `reach` above is the sum over the known
   * ones only, so a campaign where half the roster is unmeasured reports a
   * smaller number than the truth - which is the honest direction to be wrong
   * in, and the counts say by how much.
   *
   * `avgBrandFit`, `avgAuthenticity` and `avgAudienceQuality` used to sit here.
   * All three averaged a value generated from a hash of the account id.
   */
  reachKnown: number
  reachMeasured: number
}

export function estimateCampaign(selected: SelectedKol[]): CampaignEstimate {
  const totalCost = selected.reduce((n, s) => n + s.cost, 0)
  const totalUnits = selected.reduce((n, s) => n + s.units, 0)
  // Sum over the creators whose reach is knowable. `?? 0` here is not turning
  // an unknown into a zero - the unknowns are counted separately and reported
  // alongside, so the total is explicitly a total OF the known.
  const reach = selected.reduce((n, s) => n + (reachFor(s.profile, s.units) ?? 0), 0)
  const engagement = selected.reduce((n, s) => n + (engagementFor(s.profile, s.units) ?? 0), 0)
  const reachKnown = selected.filter(s => reachFor(s.profile, s.units) !== null).length
  const reachMeasured = selected.filter(s => reachIsMeasured(s.profile)).length

  // EMV scales each creator's historical EMV by the share of their output being
  // bought, so a 2-post buy from a big account does not inherit its whole
  // lifetime value.
  /*
   * Summed over the creators that carry an EMV, and null when none do - which
   * is every creator today. `?? 0` inside the fold would have turned "no price
   * benchmark exists" into "this campaign earns nothing".
   */
  const emvParts = selected
    .map(s => {
      const v = s.profile.emv.value
      if (v === null) return null
      const share = s.profile.posts.value > 0 ? Math.min(1, s.units / s.profile.posts.value) : 0
      return v * share
    })
    .filter((v): v is number => v !== null)
  const emv = emvParts.length ? Math.round(emvParts.reduce((n, v) => n + v, 0)) : null

  return {
    totalCost,
    totalUnits,
    creators: selected.length,
    reach,
    engagement,
    costPerReach: reach > 0 ? totalCost / reach : 0,
    costPerEngagement: engagement > 0 ? totalCost / engagement : 0,
    emv,
    roi: emv !== null && totalCost > 0 ? emv / totalCost : null,
    reachKnown,
    reachMeasured,
  }
}

/* -- predicted success ---------------------------------------------------- */

export interface SuccessFactor {
  key: string
  label: string
  /** 0-100 contribution score, or null when nothing could be measured for it. */
  score: number | null
  /**
   * Share of the final number, AFTER renormalisation over the factors that
   * could be computed. A factor scoring null carries weight 0 and the rest
   * grow to fill the gap, so these always sum to 1 across the scored factors.
   */
  weight: number
  /** The weight this factor would carry if every factor were available. */
  baseWeight: number
  detail: string
  /** Why `score` is null. Shown in place of the bar. */
  unavailable?: string
}

/**
 * How much of the model stood behind the number - a statement about DATA, not
 * about the creators.
 *
 * A shortlist of excellent creators nobody has measured scores `limited-data`;
 * so does a shortlist of poor ones. The word "limited" describes our knowledge.
 *
 *   `high`         coverage >= 80 - the band means what it says
 *   `limited`      coverage 60-79 - a real score, but not comparable to a
 *                  high-coverage one; the band is shown with a caveat
 *   `limited-data` coverage 30-59 - the number holds, the BAND does not, so it
 *                  must not be presented as a performance classification
 *   `insufficient` coverage < 30  - no number at all
 */
export type SuccessConfidence = 'high' | 'limited' | 'limited-data' | 'insufficient'

export interface SuccessPrediction {
  /** 0-100, or null when too little is measurable to predict anything. */
  rate: number | null
  band: 'Low' | 'Moderate' | 'Strong' | 'Excellent' | 'Limited Data'
  factors: SuccessFactor[]
  /** Total base weight of the factors that could be computed, out of 100. */
  coverage: number
  /** Derived from `coverage` alone. See `SuccessConfidence`. */
  confidence: SuccessConfidence
  /**
   * Whether `band` may be shown as a performance classification.
   *
   * False below 60% coverage. At 55% coverage one surviving factor can carry
   * two thirds of the weight, and a shortlist scoring 80 on that basis is not
   * the same claim as a shortlist scoring 80 on the whole model - calling both
   * "Excellent" would be the most misleading thing this screen could do.
   *
   * Exposed as a flag rather than left to each caller's own threshold so every
   * surface that shows this score hides the band at the same point.
   */
  bandIsMeaningful: boolean
}

/** Coverage thresholds. Presentation only - none of these touch the score. */
export const COVERAGE_HIGH = 80
export const COVERAGE_LIMITED = 60

export function confidenceFor(coverage: number): SuccessConfidence {
  if (coverage < MIN_COVERAGE) return 'insufficient'
  if (coverage >= COVERAGE_HIGH) return 'high'
  if (coverage >= COVERAGE_LIMITED) return 'limited'
  return 'limited-data'
}

/**
 * Predicted campaign success rate, from measured data only.
 *
 * ── What this used to be ───────────────────────────────────────────────────
 * Six weighted factors, of which 55% of the weight was generated:
 *
 *     brandFit        25%   a hash of the account id, three layers deep
 *     audienceQuality 20%   30% of that same hash
 *     demographic     10%   a random age split and a random gender split
 *     engagement      20%   REAL - measured engagement rate
 *     historical      15%   REAL - paid vs organic engagement
 *     paid            10%   REAL - paid vs organic engagement
 *
 * A buyer reading "71% predicted success" was reading a number that was more
 * than half noise, and the factor breakdown beside it made it look auditable.
 *
 * ── What it is now ─────────────────────────────────────────────────────────
 * The three generated factors are gone. The three real ones keep their relative
 * standing and renormalise over the weight that remains, and Demographic Match
 * returns as a real factor for the creators whose audience the platform
 * actually reports.
 *
 * ── N/A is not zero, and it is not a neutral either ────────────────────────
 * The old code filled gaps with constants - 45 for "never run paid", 50 and 65
 * for missing paid rates, 60 for an untargeted demographic. Those are invented
 * measurements wearing a plausible number, and they moved the score.
 *
 * Every factor here returns null when its inputs are missing, takes weight 0,
 * and the surviving weights renormalise to 100 by themselves. This is the same
 * rule `weightedAvailable` applies in the Brand Match Engine, deliberately: two
 * scoring models in one product that disagree about what missing data means
 * will eventually be compared, and the comparison will be meaningless.
 *
 * When too little survives, `rate` is null and the band is `Limited Data`.
 * A prediction resting on one factor is not a prediction.
 */

/** Below this much surviving base weight, the score is not worth stating. */
const MIN_COVERAGE = 30

export function predictSuccess(
  selected: SelectedKol[],
  opts: { targetAges?: string[]; targetGender?: 'female' | 'male' | 'all' } = {},
): SuccessPrediction {
  if (selected.length === 0) {
    return {
      rate: null, band: 'Limited Data', factors: [], coverage: 0,
      confidence: 'insufficient', bandIsMeaningful: false,
    }
  }

  /**
   * Mean over the creators that can answer, and null when none can.
   *
   * This is the whole discipline in four lines: a creator with no measurement
   * is skipped rather than scored, so one measured creator in a shortlist of
   * five produces that creator's number rather than a fifth of it.
   */
  const meanOf = (f: (s: SelectedKol) => number | null): number | null => {
    const vals = selected.map(f).filter((v): v is number => v !== null && Number.isFinite(v))
    return vals.length ? vals.reduce((n, v) => n + v, 0) / vals.length : null
  }

  /*
   * 1. Engagement - the measured engagement rate. 5%+ is a full score.
   *
   * Mean FIRST, then scale and cap - deliberately the original order. Capping
   * each creator before averaging is arguably the better statistic (it stops
   * one 25%-ER outlier from maxing the factor for a weak shortlist), but it is
   * a different question from the one this phase was asked to fix, and it moved
   * the score on real data. The only change here is that creators with no
   * measured rate are skipped instead of being averaged in as zero.
   */
  const meanEr = meanOf(s => (s.profile.erPct.value > 0 ? s.profile.erPct.value : null))
  const engagement = meanEr === null ? null : Math.min(100, meanEr * 20)

  /*
   * 2. Historical performance - has this account run paid content, and did its
   *    engagement hold up while doing it?
   *
   * Needs both halves measured. The old version scored 45 for "never run paid",
   * which quietly rewarded an unknown over a measured-but-mediocre account.
   */
  const historical = meanOf(s => {
    const p = s.profile
    if (p.paidRatio.value <= 0) return null
    if (p.organicErPct.value <= 0 || p.paidErPct.value <= 0) return null
    const retention = Math.min(1.3, p.paidErPct.value / p.organicErPct.value)
    return Math.min(100, 55 + retention * 35)
  })

  /*
   * 3. Demographic match - REAL audience demographics, from platform insights.
   *
   * Reads `ageBands` / `femalePct`, which come from
   * `l0_raw.*_profile_snapshots` via `@/lib/discover/accountFacts`. The fields
   * it used to read, `ageSplit` and `genderSplit`, were generated and are no
   * longer touched by this function.
   *
   * Null when no target is set - an untargeted campaign has no demographic
   * match to measure, and the old neutral 60 was free marks for not deciding.
   * Null per creator when that creator's audience is unreported, which is every
   * competitor account and every owned account below the platform's threshold.
   */
  const targetAges = opts.targetAges ?? []
  const targetGender = opts.targetGender ?? 'all'
  const untargeted = targetAges.length === 0 && targetGender === 'all'
  const demographic = untargeted ? null : meanOf(s => {
    const p = s.profile
    const ageHit = targetAges.length === 0 ? null
      : p.ageBands.value.length === 0 ? null
        : p.ageBands.value
          .filter(b => targetAges.includes(b.label))
          .reduce((n, b) => n + b.pct, 0)

    const genderHit = targetGender === 'all' ? null
      : p.femalePct.value === null ? null
        : targetGender === 'female' ? p.femalePct.value : 100 - p.femalePct.value

    // Each half renormalises the other away when it cannot be measured, rather
    // than contributing a zero.
    const parts: [number, number][] = []
    if (ageHit !== null) parts.push([ageHit, 0.6])
    if (genderHit !== null) parts.push([genderHit, 0.4])
    if (!parts.length) return null
    const den = parts.reduce((n, [, w]) => n + w, 0)
    return Math.min(100, parts.reduce((n, [v, w]) => n + v * w, 0) / den)
  })

  /* 4. Paid content performance against the account's own organic baseline. */
  const paidPerf = meanOf(s => {
    const p = s.profile
    if (p.paidErPct.value <= 0 || p.organicErPct.value <= 0) return null
    return Math.min(100, (p.paidErPct.value / p.organicErPct.value) * 65)
  })

  /*
   * Base weights, rescaled from the originals.
   *
   * The three surviving factors kept their ORIGINAL RATIO to one another -
   * 20 : 15 : 10 became 36 : 27 : 18 - and Demographic keeps its original 10
   * scaled the same way, so nothing was re-ranked by hand while removing the
   * generated factors. They total 100 when all four are available.
   */
  const defs: { key: string; label: string; score: number | null; baseWeight: number; detail: string; unavailable: string }[] = [
    {
      key: 'engagement', label: 'Engagement', score: engagement, baseWeight: 36,
      detail: 'Rata-rata engagement rate terukur; 5% dianggap skor penuh',
      unavailable: 'Belum ada engagement rate terukur pada KOL terpilih.',
    },
    {
      key: 'historical', label: 'Historical Performance', score: historical, baseWeight: 27,
      detail: 'Rekam jejak konten berbayar dibanding baseline organik akun sendiri',
      unavailable: 'Belum ada KOL terpilih yang pernah menjalankan konten berbayar terukur.',
    },
    {
      key: 'paid', label: 'Paid Content Performance', score: paidPerf, baseWeight: 18,
      detail: 'ER konten berbayar dibanding ER organik akun yang sama',
      unavailable: 'ER berbayar atau ER organik belum terukur untuk KOL terpilih.',
    },
    {
      key: 'demographic', label: 'Demographic Match', score: demographic, baseWeight: 19,
      detail: 'Kecocokan umur & gender audiens (data platform insights) dengan target campaign',
      unavailable: untargeted
        ? 'Target umur/gender campaign belum diatur, jadi tidak ada yang bisa dicocokkan.'
        : 'Platform belum melaporkan demografi audiens untuk KOL terpilih.',
    },
  ]

  const coverage = defs.reduce((n, d) => n + (d.score !== null ? d.baseWeight : 0), 0)

  const factors: SuccessFactor[] = defs.map(d => ({
    key: d.key,
    label: d.label,
    score: d.score === null ? null : Math.round(d.score),
    weight: d.score === null || coverage === 0 ? 0 : d.baseWeight / coverage,
    baseWeight: d.baseWeight,
    detail: d.detail,
    ...(d.score === null ? { unavailable: d.unavailable } : {}),
  }))

  if (coverage < MIN_COVERAGE) {
    return {
      rate: null, band: 'Limited Data', factors, coverage,
      confidence: 'insufficient', bandIsMeaningful: false,
    }
  }

  const rate = Math.round(
    defs.reduce((n, d) => n + (d.score === null ? 0 : d.score * (d.baseWeight / coverage)), 0))

  /*
   * The bands are unchanged from the six-factor version.
   *
   * They are a judgement about what a 0-100 score means, not about which
   * factors produced it, and the scale is still 0-100 because the surviving
   * weights renormalise. The regression script prints the before/after
   * distribution so the thresholds can be re-checked against real output
   * rather than assumed to have survived.
   */
  const band: SuccessPrediction['band'] =
    rate >= 80 ? 'Excellent' : rate >= 65 ? 'Strong' : rate >= 50 ? 'Moderate' : 'Low'

  /*
   * The bands are deliberately NOT recalibrated.
   *
   * They were set against a six-factor distribution and two of those factors
   * have been removed, so they no longer mean quite what they did. Moving the
   * thresholds to compensate would be choosing numbers to produce a desired
   * answer, which is the same class of mistake as the generated inputs this
   * work removed. Instead the score is published with the coverage that
   * produced it, and the band is suppressed below 60% - an honest presentation
   * of an unchanged model rather than a quiet re-tuning of it.
   */
  const confidence = confidenceFor(coverage)
  return {
    rate, band, factors, coverage, confidence,
    bandIsMeaningful: confidence === 'high' || confidence === 'limited',
  }
}

/* ── budget optimiser ────────────────────────────────────────────────────── */

export interface OptimiseResult {
  picked: { profile: KolProfile; units: number; cost: number }[]
  spent: number
  leftover: number
  skipped: { username: string; reason: string }[]
  /**
   * How many of the picked creators were ranked on a real reach measurement,
   * and how many on a figure calculated from measured views.
   *
   * Surfaced because the objective treats the two alike and they are not alike:
   * see the note on mixing them below. A plan built mostly on calculated reach
   * is still a defensible plan, but the reader should know that is what it is.
   */
  pickedMeasured: number
  pickedCalculated: number
}

/**
 * Greedy selection under a budget cap, ranked by marginal reach per rupiah.
 *
 * Units are added one at a time, so the geometric reach discount is respected:
 * a second post from the same creator competes on its *marginal* value against
 * a first post from someone new, which is what stops the optimiser from dumping
 * the whole budget on one account.
 *
 * ── The objective, and what left it ────────────────────────────────────────
 * It was:
 *
 *     gain = (marginalReach / unitCost) x (0.5 + brandFit / 200)
 *
 * `brandFit` was generated - a hash of the account id, three derivations deep,
 * with no knowledge of any brand (see `@/lib/discover/profile`). It spanned the
 * multiplier from 0.5 to 1.0, so it could double or halve a candidate's rank.
 * The optimiser was therefore allocating real money partly on noise.
 *
 * It is now:
 *
 *     gain = marginalReach / unitCost
 *
 * Reach efficiency, and nothing else. No replacement coefficient was invented
 * to fill the gap: the alternatives available - audience quality, authenticity,
 * demographic fit - are either generated too or unmeasured for most of this
 * population, and a second noisy term would have been the same mistake wearing
 * a different name. A transparent objective that says exactly what it optimises
 * is worth more than a richer one nobody can check.
 *
 * ── Candidates with no reach are skipped, not zeroed ───────────────────────
 * `reachFor` is nullable now. A null there means nobody has measured this
 * account's reach or views - not that its reach is zero. Ranking it as 0 would
 * bury it below every measured creator and look like a verdict; so it is
 * skipped with a stated reason, alongside the creators with no rate card. The
 * caller already renders `skipped`, so the exclusion is visible rather than
 * silent.
 *
 * ── Measured and calculated reach compete on equal terms ───────────────────
 * A candidate whose reach came from the platform's `reach` column and one whose
 * figure was calculated from measured views are ranked by the same number.
 * That is a real limitation and is reported rather than corrected: views tend
 * to run higher than reach on video, so a views-derived candidate can out-rank
 * a measured one on efficiency it does not have. Correcting it would mean
 * choosing a conversion factor between views and reach, and no such factor is
 * measured for this population - inventing one is the exact failure this pass
 * exists to remove. `pickedMeasured` / `pickedCalculated` say how exposed a
 * given plan is.
 */
export function optimiseSelection(
  candidates: { profile: KolProfile; unitCost: number }[],
  budget: number,
  maxUnitsPerKol = 4,
): OptimiseResult {
  const picked = new Map<string, { profile: KolProfile; units: number; cost: number }>()
  const skipped: OptimiseResult['skipped'] = []
  let spent = 0

  const usable = candidates.filter(c => {
    if (c.unitCost <= 0) {
      skipped.push({ username: c.profile.account.username, reason: 'belum ada rate card' })
      return false
    }
    if (c.unitCost > budget) {
      skipped.push({ username: c.profile.account.username, reason: 'satu deliverable melebihi budget' })
      return false
    }
    // Nothing to optimise for: no reach measurement and no views to derive one
    // from. Excluded explicitly rather than ranked as zero.
    if (c.profile.estimatedReach.value === null) {
      skipped.push({
        username: c.profile.account.username,
        reason: 'belum ada data reach maupun views terukur',
      })
      return false
    }
    return true
  })

  // Keep adding the best marginal unit until nothing affordable improves things.
  for (;;) {
    let best: { c: (typeof usable)[number]; gain: number } | null = null

    for (const c of usable) {
      const cur = picked.get(c.profile.account.id)
      const units = cur?.units ?? 0
      if (units >= maxUnitsPerKol) continue
      if (spent + c.unitCost > budget) continue

      /*
       * Both calls are non-null here: `usable` excluded every candidate whose
       * `estimatedReach` is null, and that is the only thing that makes
       * `reachFor` return null for units >= 1. Asserted rather than defaulted,
       * so a future change that breaks the invariant fails loudly instead of
       * silently ranking somebody at zero.
       */
      const next = reachFor(c.profile, units + 1)
      const now = reachFor(c.profile, units)
      if (next === null || now === null) continue

      const marginalReach = next - now
      if (marginalReach <= 0) continue

      // Reach efficiency. One term, no coefficient.
      const gain = marginalReach / c.unitCost
      if (!best || gain > best.gain) best = { c, gain }
    }

    if (!best) break
    const { c } = best
    const cur = picked.get(c.profile.account.id)
    picked.set(c.profile.account.id, {
      profile: c.profile,
      units: (cur?.units ?? 0) + 1,
      cost: (cur?.cost ?? 0) + c.unitCost,
    })
    spent += c.unitCost
  }

  const chosen = [...picked.values()]
  return {
    picked: chosen,
    spent,
    leftover: budget - spent,
    skipped,
    pickedMeasured: chosen.filter(x => reachIsMeasured(x.profile)).length,
    pickedCalculated: chosen.filter(x => !reachIsMeasured(x.profile)).length,
  }
}

/* ── goals ───────────────────────────────────────────────────────────────── */

export interface GoalProgress {
  label: string
  actual: number
  goal: number
  pct: number
  met: boolean
}

export const goalProgress = (label: string, actual: number, goal: number): GoalProgress => ({
  label, actual, goal,
  pct: goal > 0 ? Math.min(999, (actual / goal) * 100) : 0,
  met: goal > 0 && actual >= goal,
})
