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
 * Reach for one creator across `units` posts.
 *
 * Successive posts to the same audience overlap heavily, so this is not
 * `reach × units`. Each additional post is discounted geometrically (0.65^n),
 * which keeps a 10-post buy from claiming ten times the audience of a 1-post
 * buy — the single most common way influencer reach gets overstated.
 */
export function reachFor(profile: KolProfile, units: number): number {
  if (units <= 0) return 0
  const base = profile.estimatedReach.value
  let total = 0
  for (let i = 0; i < units; i++) total += base * Math.pow(0.65, i)
  return Math.round(total)
}

/** Engagement follows reach at the creator's own measured engagement rate. */
export function engagementFor(profile: KolProfile, units: number): number {
  return Math.round(reachFor(profile, units) * (profile.erPct.value / 100))
}

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
  emv: number
  /** EMV relative to spend — the campaign's modelled return. */
  roi: number
  avgBrandFit: number
  avgAuthenticity: number
  avgAudienceQuality: number
}

export function estimateCampaign(selected: SelectedKol[]): CampaignEstimate {
  const totalCost = selected.reduce((n, s) => n + s.cost, 0)
  const totalUnits = selected.reduce((n, s) => n + s.units, 0)
  const reach = selected.reduce((n, s) => n + reachFor(s.profile, s.units), 0)
  const engagement = selected.reduce((n, s) => n + engagementFor(s.profile, s.units), 0)

  // EMV scales each creator's historical EMV by the share of their output being
  // bought, so a 2-post buy from a big account does not inherit its whole
  // lifetime value.
  const emv = Math.round(selected.reduce((n, s) => {
    const share = s.profile.posts.value > 0
      ? Math.min(1, s.units / s.profile.posts.value) : 0
    return n + s.profile.emv.value * share
  }, 0))

  const mean = (f: (s: SelectedKol) => number) =>
    selected.length ? selected.reduce((n, s) => n + f(s), 0) / selected.length : 0

  return {
    totalCost,
    totalUnits,
    creators: selected.length,
    reach,
    engagement,
    costPerReach: reach > 0 ? totalCost / reach : 0,
    costPerEngagement: engagement > 0 ? totalCost / engagement : 0,
    emv,
    roi: totalCost > 0 ? emv / totalCost : 0,
    avgBrandFit: mean(s => s.profile.brandFit.value),
    avgAuthenticity: mean(s => s.profile.authenticity.value),
    avgAudienceQuality: mean(s => s.profile.audienceQuality.value),
  }
}

/* ── predicted success ───────────────────────────────────────────────────── */

export interface SuccessFactor {
  key: string
  label: string
  /** 0–100 contribution score. */
  score: number
  /** Share of the final number. */
  weight: number
  detail: string
}

export interface SuccessPrediction {
  rate: number
  band: 'Low' | 'Moderate' | 'Strong' | 'Excellent'
  factors: SuccessFactor[]
}

/**
 * Predicted campaign success rate.
 *
 * Six weighted factors, exactly the ones requested: brand fit, audience
 * quality, engagement, historical campaign performance, demographic match and
 * paid-content performance. Each is surfaced with its own score and weight so
 * the number is auditable rather than a black box — a 71% that cannot be
 * explained is not usable for a spend decision.
 *
 * `demographicMatch` compares the selected creators' modelled audiences against
 * the campaign's target bands; with no target set it is neutral (not free
 * marks), so an unconfigured campaign cannot score better than a configured one.
 */
export function predictSuccess(
  selected: SelectedKol[],
  opts: { targetAges?: string[]; targetGender?: 'female' | 'male' | 'all' } = {},
): SuccessPrediction {
  if (selected.length === 0) {
    return { rate: 0, band: 'Low', factors: [] }
  }

  const mean = (f: (s: SelectedKol) => number) =>
    selected.reduce((n, s) => n + f(s), 0) / selected.length

  const brandFit = mean(s => s.profile.brandFit.value)
  const audienceQuality = mean(s => s.profile.audienceQuality.value)

  // ER of 5%+ is treated as a full score; that is a strong rate for this market.
  const engagement = Math.min(100, mean(s => s.profile.erPct.value) * 20)

  // Historical performance: accounts that have actually run paid content before,
  // and held their engagement while doing it, are lower risk.
  const historical = mean(s => {
    const p = s.profile
    if (p.paidRatio.value <= 0) return 45          // never run paid — unknown, not bad
    const retention = p.organicErPct.value > 0
      ? Math.min(1.3, p.paidErPct.value / p.organicErPct.value) : 1
    return Math.min(100, 55 + retention * 35)
  })

  const targetAges = opts.targetAges ?? []
  const targetGender = opts.targetGender ?? 'all'
  const demographic = (targetAges.length === 0 && targetGender === 'all')
    ? 60                                            // neutral when untargeted
    : mean(s => {
        const p = s.profile
        const ageHit = targetAges.length === 0
          ? 60
          : p.ageSplit.value
              .filter(b => targetAges.includes(b.band))
              .reduce((n, b) => n + b.pct, 0)
        const genderHit = targetGender === 'all'
          ? 60
          : targetGender === 'female'
            ? p.genderSplit.value.female
            : p.genderSplit.value.male
        return Math.min(100, ageHit * 0.6 + genderHit * 0.4)
      })

  // Paid performance: does this creator's sponsored content hold up against
  // their organic baseline?
  const paidPerf = mean(s => {
    const p = s.profile
    if (p.paidErPct.value <= 0) return 50
    if (p.organicErPct.value <= 0) return 65
    return Math.min(100, (p.paidErPct.value / p.organicErPct.value) * 65)
  })

  const factors: SuccessFactor[] = [
    { key: 'brandFit', label: 'Brand Fit', score: brandFit, weight: 0.25, detail: 'Rata-rata skor kecocokan brand dari KOL terpilih' },
    { key: 'audienceQuality', label: 'Audience Quality', score: audienceQuality, weight: 0.2, detail: 'Kualitas audiens gabungan ER terukur dan autentisitas' },
    { key: 'engagement', label: 'Engagement', score: engagement, weight: 0.2, detail: 'ER rata-rata; 5% dianggap skor penuh' },
    { key: 'historical', label: 'Historical Performance', score: historical, weight: 0.15, detail: 'Rekam jejak konten berbayar yang pernah dijalankan' },
    { key: 'demographic', label: 'Demographic Match', score: demographic, weight: 0.1, detail: 'Kecocokan umur & gender audiens dengan target campaign' },
    { key: 'paid', label: 'Paid Content Performance', score: paidPerf, weight: 0.1, detail: 'Performa konten berbayar dibanding baseline organik' },
  ]

  const rate = Math.round(factors.reduce((n, f) => n + f.score * f.weight, 0))
  const band: SuccessPrediction['band'] =
    rate >= 80 ? 'Excellent' : rate >= 65 ? 'Strong' : rate >= 50 ? 'Moderate' : 'Low'

  return { rate, band, factors: factors.map(f => ({ ...f, score: Math.round(f.score) })) }
}

/* ── budget optimiser ────────────────────────────────────────────────────── */

export interface OptimiseResult {
  picked: { profile: KolProfile; units: number; cost: number }[]
  spent: number
  leftover: number
  skipped: { username: string; reason: string }[]
}

/**
 * Greedy selection under a budget cap.
 *
 * Candidates are ranked by reach per rupiah weighted by brand fit — cheap reach
 * from a poorly matched creator should not beat slightly dearer reach from a
 * good one. Units are added one at a time, so the geometric reach discount is
 * respected: a second post from the same creator competes on its *marginal*
 * value against a first post from someone new, which is what stops the
 * optimiser from dumping the whole budget on one account.
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

      const marginalReach = reachFor(c.profile, units + 1) - reachFor(c.profile, units)
      if (marginalReach <= 0) continue
      // Reach per rupiah, tilted by brand fit.
      const gain = (marginalReach / c.unitCost) * (0.5 + c.profile.brandFit.value / 200)
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

  return { picked: [...picked.values()], spent, leftover: budget - spent, skipped }
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
