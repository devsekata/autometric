/**
 * OLD vs NEW campaign optimizer, on the same real shortlist and budget.
 *
 *   npm run verify:optimizer-regression
 *
 * Phase 2A removed the generated inputs from `predictSuccess()` and
 * `optimiseSelection()`. The results are EXPECTED to differ - that is the point
 * of the change, not a defect. This script exists to say by how much, so the
 * behavioural shift is a measured fact in the completion report rather than an
 * assurance.
 *
 * ── How "OLD" is reconstructed ─────────────────────────────────────────────
 * Entirely inside this file, and nowhere else.
 *
 * Phase 2B deleted the five generated profile fields the old model read -
 * `brandFit`, `audienceQuality`, `authenticity`, `ageSplit`, `genderSplit` -
 * along with the old `estimatedReach`. Every one of those formulas is restated
 * below, verbatim from the versions that shipped, so the comparison reproduces
 * the exact numbers the old build produced rather than a plausible imitation.
 *
 * They are restated HERE rather than kept in `@/lib/discover/profile` on
 * purpose: a generated field left alive "for the harness" is a generated field
 * a future change can start reading again. The reconstruction belongs with the
 * comparison that needs it, and dies with it.
 *
 * `hash`/`between` are copied from the version of `profile.ts` that used them.
 *
 * Needs the warehouse only; no VPN.
 */
import pool from '@/lib/db'
import { listKolProfiles } from '@/lib/discover/profile'
import {
  estimateCampaign, optimiseSelection, predictSuccess, reachFor,
  type SelectedKol,
} from '@/lib/discover/campaign'
import type { KolProfile } from '@/lib/discover/profile'

/* ── the old generator, restated for reconstruction only ──────────────────── */

function hash(seed: string, salt: string): number {
  let h = 0x811c9dc5
  const s = `${seed}::${salt}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
const between = (seed: string, salt: string, lo: number, hi: number) =>
  lo + (hash(seed, salt) / 0x100000000) * (hi - lo)

/** The pre-Phase-2A `estimatedReach`: a measurement times a hash. */
const oldReachPerPost = (p: KolProfile): number =>
  Math.round(p.avgViews.value * between(p.account.id, 'reach', 0.55, 0.85))

/* ── the deleted generated fields, restated ───────────────────────────────── */

const oldAuthenticity = (p: KolProfile): number =>
  Math.round(between(p.account.id, 'auth', 68, 96))

const oldAudienceQuality = (p: KolProfile): number =>
  Math.round(Math.min(99, 45 + Math.min(30, p.erPct.value * 6) + (oldAuthenticity(p) - 68) * 0.5))

const oldBrandFit = (p: KolProfile): number =>
  Math.round(Math.min(99,
    oldAudienceQuality(p) * 0.35 + oldAuthenticity(p) * 0.3
    + Math.min(100, p.erPct.value * 12) * 0.2
    + Math.min(100, p.postFrequency.value * 6) * 0.15))

const OLD_AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'] as const

/** Six random bands summing to exactly 100, as `ageSplitFor` produced them. */
function oldAgeSplit(p: KolProfile): { band: string; pct: number }[] {
  const seed = p.account.id
  const weights = OLD_AGE_BANDS.map((_, i) =>
    between(seed, `age${i}`, 0.4, 1) * (i === 1 || i === 2 ? 3 : 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => Math.round((w / sum) * 100))
  const drift = 100 - raw.reduce((a, b) => a + b, 0)
  raw[raw.indexOf(Math.max(...raw))] += drift
  return OLD_AGE_BANDS.map((band, i) => ({ band, pct: raw[i] }))
}

function oldGenderSplit(p: KolProfile): { female: number; male: number } {
  const female = Math.round(between(p.account.id, 'gender', 28, 74))
  return { female, male: 100 - female }
}

/** The pre-Phase-2A `reachFor`, with the same 0.65^n overlap discount. */
function oldReachFor(p: KolProfile, units: number): number {
  if (units <= 0) return 0
  const base = oldReachPerPost(p)
  let total = 0
  for (let i = 0; i < units; i++) total += base * Math.pow(0.65, i)
  return Math.round(total)
}

/** The pre-Phase-2A optimiser: reach per rupiah, tilted by generated brand fit. */
function oldOptimise(
  candidates: { profile: KolProfile; unitCost: number }[],
  budget: number,
  maxUnitsPerKol = 4,
) {
  const picked = new Map<string, { profile: KolProfile; units: number; cost: number }>()
  let spent = 0
  const usable = candidates.filter(c => c.unitCost > 0 && c.unitCost <= budget)

  for (;;) {
    let best: { c: (typeof usable)[number]; gain: number } | null = null
    for (const c of usable) {
      const units = picked.get(c.profile.account.id)?.units ?? 0
      if (units >= maxUnitsPerKol) continue
      if (spent + c.unitCost > budget) continue
      const marginal = oldReachFor(c.profile, units + 1) - oldReachFor(c.profile, units)
      if (marginal <= 0) continue
      const gain = (marginal / c.unitCost) * (0.5 + oldBrandFit(c.profile) / 200)
      if (!best || gain > best.gain) best = { c, gain }
    }
    if (!best) break
    const cur = picked.get(best.c.profile.account.id)
    picked.set(best.c.profile.account.id, {
      profile: best.c.profile,
      units: (cur?.units ?? 0) + 1,
      cost: (cur?.cost ?? 0) + best.c.unitCost,
    })
    spent += best.c.unitCost
  }
  return { picked: [...picked.values()], spent }
}

/** The pre-Phase-2A six-factor prediction, including the three generated ones. */
function oldPredictSuccess(
  selected: SelectedKol[],
  opts: { targetAges?: string[]; targetGender?: 'female' | 'male' | 'all' } = {},
): { rate: number; band: string; factors: { key: string; score: number; weight: number }[] } {
  if (!selected.length) return { rate: 0, band: 'Low', factors: [] }
  const mean = (f: (s: SelectedKol) => number) =>
    selected.reduce((n, s) => n + f(s), 0) / selected.length

  const brandFit = mean(s => oldBrandFit(s.profile))
  const audienceQuality = mean(s => oldAudienceQuality(s.profile))
  const engagement = Math.min(100, mean(s => s.profile.erPct.value) * 20)
  const historical = mean(s => {
    const p = s.profile
    if (p.paidRatio.value <= 0) return 45
    const retention = p.organicErPct.value > 0
      ? Math.min(1.3, p.paidErPct.value / p.organicErPct.value) : 1
    return Math.min(100, 55 + retention * 35)
  })
  const targetAges = opts.targetAges ?? []
  const targetGender = opts.targetGender ?? 'all'
  const demographic = (targetAges.length === 0 && targetGender === 'all') ? 60
    : mean(s => {
      const p = s.profile
      const ageHit = targetAges.length === 0 ? 60
        : oldAgeSplit(p).filter(b => targetAges.includes(b.band)).reduce((n, b) => n + b.pct, 0)
      const g = oldGenderSplit(p)
      const genderHit = targetGender === 'all' ? 60
        : targetGender === 'female' ? g.female : g.male
      return Math.min(100, ageHit * 0.6 + genderHit * 0.4)
    })
  const paidPerf = mean(s => {
    const p = s.profile
    if (p.paidErPct.value <= 0) return 50
    if (p.organicErPct.value <= 0) return 65
    return Math.min(100, (p.paidErPct.value / p.organicErPct.value) * 65)
  })

  const factors = [
    { key: 'brandFit', score: brandFit, weight: 0.25 },
    { key: 'audienceQuality', score: audienceQuality, weight: 0.2 },
    { key: 'engagement', score: engagement, weight: 0.2 },
    { key: 'historical', score: historical, weight: 0.15 },
    { key: 'demographic', score: demographic, weight: 0.1 },
    { key: 'paid', score: paidPerf, weight: 0.1 },
  ]
  const rate = Math.round(factors.reduce((n, f) => n + f.score * f.weight, 0))
  const band = rate >= 80 ? 'Excellent' : rate >= 65 ? 'Strong' : rate >= 50 ? 'Moderate' : 'Low'
  return { rate, band, factors }
}

/* ── the comparison ───────────────────────────────────────────────────────── */

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')
const num = (n: number | null) => (n === null ? 'n/a' : n.toLocaleString('id-ID'))

;(async () => {
  const { rows: orgs } = await pool.query<{ id: string; name: string }>(
    `SELECT o.id, o.name FROM public.organizations o
      WHERE o.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM public.brands b WHERE b.organization_id=o.id AND b.deleted_at IS NULL)
      ORDER BY o.created_at`)

  let org = orgs[0]
  let profiles: KolProfile[] = []
  for (const o of orgs) {
    const p = await listKolProfiles(o.id)
    if (p.length > profiles.length) { org = o; profiles = p }
  }
  if (!profiles.length) { console.error('no tracked accounts to optimise'); process.exit(1) }

  console.log(`organization: ${org.name} — ${profiles.length} tracked accounts\n`)

  /*
   * The shortlist is every account carrying a rate card, because the optimiser
   * cannot buy one without a price. A synthetic unit cost stands in where the
   * roster has no rate — stated here so it is not mistaken for data: it is an
   * input to BOTH runs equally, so it cancels out of the comparison.
   */
  const UNIT = 2_500_000
  const candidates = profiles.map(p => ({
    profile: p,
    unitCost: p.baseRate > 0 ? p.baseRate : UNIT,
  }))
  const BUDGET = 50_000_000
  const TARGET = { targetAges: ['25-34'], targetGender: 'female' as const }

  console.log(`budget ${idr(BUDGET)} · max 4 units/KOL · target 25-34 female\n`)

  /* ── reach ladder, which is what drives the difference ──────────────── */

  const measured = profiles.filter(p => p.estimatedReach.confidence === 'live').length
  const calculated = profiles.filter(p => p.estimatedReach.confidence === 'calculated').length
  const none = profiles.filter(p => p.estimatedReach.value === null).length
  console.log('REACH LADDER')
  console.log(`  measured reach (platform insights) : ${measured}`)
  console.log(`  calculated from measured views     : ${calculated}`)
  console.log(`  unavailable                        : ${none}`)

  /* ── optimiser ──────────────────────────────────────────────────────── */

  const oldRun = oldOptimise(candidates, BUDGET)
  const newRun = optimiseSelection(candidates, BUDGET)

  const oldIds = new Set(oldRun.picked.map(p => p.profile.account.id))
  const newIds = new Set(newRun.picked.map(p => p.profile.account.id))
  const added = [...newIds].filter(i => !oldIds.has(i))
  const dropped = [...oldIds].filter(i => !newIds.has(i))
  const nameOf = (id: string) => profiles.find(p => p.account.id === id)?.account.username ?? id

  console.log('\nOPTIMIZER SELECTION')
  console.log(`  OLD  ${oldRun.picked.length} creators · ${idr(oldRun.spent)} spent`)
  console.log(`  NEW  ${newRun.picked.length} creators · ${idr(newRun.spent)} spent`
    + ` · ${newRun.pickedMeasured} on measured reach, ${newRun.pickedCalculated} on calculated`)
  console.log(`  changed: +${added.length} added, -${dropped.length} dropped`)
  if (added.length) console.log(`    added   ${added.slice(0, 8).map(nameOf).join(', ')}`)
  if (dropped.length) console.log(`    dropped ${dropped.slice(0, 8).map(nameOf).join(', ')}`)
  console.log(`  skipped by NEW (stated reasons): ${newRun.skipped.length}`)
  for (const sk of newRun.skipped.slice(0, 5)) console.log(`    @${sk.username} — ${sk.reason}`)

  /* ── unit allocation on the creators both runs kept ─────────────────── */

  const kept = [...newIds].filter(i => oldIds.has(i))
  let reallocated = 0
  for (const id of kept) {
    const a = oldRun.picked.find(p => p.profile.account.id === id)!.units
    const b = newRun.picked.find(p => p.profile.account.id === id)!.units
    if (a !== b) reallocated++
  }
  console.log(`  kept by both: ${kept.length}, of which ${reallocated} got a different unit count`)

  /* ── ranking order ──────────────────────────────────────────────────── */

  const oldOrder = oldRun.picked.map(p => p.profile.account.id)
  const newOrder = newRun.picked.map(p => p.profile.account.id)
  const common = newOrder.filter(i => oldOrder.includes(i))
  const orderChanged = common.some((id, i) =>
    oldOrder.filter(x => common.includes(x))[i] !== id)
  console.log(`  ranking order among common picks: ${orderChanged ? 'CHANGED' : 'unchanged'}`)

  /* ── predicted success on the SAME selection ────────────────────────── */

  const selection: SelectedKol[] = newRun.picked.map(p => ({
    profile: p.profile, units: p.units, cost: p.cost,
  }))
  const oldPred = oldPredictSuccess(selection, TARGET)
  const newPred = predictSuccess(selection, TARGET)

  console.log('\nPREDICTED SUCCESS (same selection, both models)')
  console.log(`  OLD  ${oldPred.rate}% ${oldPred.band}`)
  console.log(`  NEW  ${newPred.rate === null ? 'Limited Data' : `${newPred.rate}%`}`
    + ` · coverage ${newPred.coverage}% · confidence '${newPred.confidence}'`
    + ` · band ${newPred.bandIsMeaningful ? `shown (${newPred.band})` : 'SUPPRESSED (below 60% coverage)'}`)
  console.log('  factor by factor:')
  for (const f of newPred.factors) {
    const old = oldPred.factors.find(o => o.key === f.key)
    const oldTxt = old ? `${Math.round(old.score)} @ ${Math.round(old.weight * 100)}%` : 'not in OLD'
    const newTxt = f.score === null
      ? `N/A (renormalised away) — ${f.unavailable}`
      : `${f.score} @ ${Math.round(f.weight * 100)}%`
    console.log(`    ${f.label.padEnd(26)} OLD ${oldTxt.padEnd(16)} NEW ${newTxt}`)
  }
  for (const o of oldPred.factors.filter(x => !newPred.factors.some(n => n.key === x.key))) {
    console.log(`    ${o.key.padEnd(26)} OLD ${Math.round(o.score)} @ ${Math.round(o.weight * 100)}%`
      + '    NEW REMOVED (was generated)')
  }

  /* ── campaign totals ────────────────────────────────────────────────── */

  const est = estimateCampaign(selection)
  const oldReachTotal = selection.reduce((n, s) => n + oldReachFor(s.profile, s.units), 0)
  console.log('\nCAMPAIGN TOTALS (same selection)')
  console.log(`  OLD reach (hash-derived)  ${num(oldReachTotal)}`)
  console.log(`  NEW reach (real ladder)   ${num(est.reach)}`
    + ` · ${est.reachKnown}/${selection.length} creators knowable, ${est.reachMeasured} measured`)
  console.log(`  cost                      ${idr(est.totalCost)} (unchanged — cost is a price, not a model)`)
  const delta = oldReachTotal > 0
    ? Math.round(((est.reach - oldReachTotal) / oldReachTotal) * 100) : null
  console.log(`  reach delta               ${delta === null ? 'n/a' : `${delta > 0 ? '+' : ''}${delta}%`}`)

  /* ── per-creator reach, old vs new ──────────────────────────────────── */

  console.log('\nPER-CREATOR REACH (first 8 picks)')
  for (const s of selection.slice(0, 8)) {
    const o = oldReachFor(s.profile, s.units)
    const n = reachFor(s.profile, s.units)
    console.log(`  @${s.profile.account.username.padEnd(22)} units ${s.units}`
      + ` · OLD ${num(o).padStart(12)} · NEW ${num(n).padStart(12)}`
      + ` · ${s.profile.estimatedReach.confidence}`)
  }

  console.log('\nDifferences above are expected: they are the generated inputs leaving the model.')
  process.exit(0)
})().catch(err => {
  console.error('\nregression comparison could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
