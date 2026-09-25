/**
 * Brand Fit input mapping — no database.
 *
 *   npm run verify:brand-fit-input
 *
 * Covers the two inputs that used to reach Brand Fit in the wrong shape:
 *
 *   1. `top_interest` is a jsonb array of {interest, count}. `interestShares`
 *      must turn it into known-population shares, not null.
 *   2. Brand personality words are compared through
 *      `BRAND_TO_CREATOR_PERSONALITY`, which must equal the single
 *      highest-affinity label of `PERSONALITY_FIT` in
 *      scripts/brand-match/vocabulary.mjs and point only at creator labels.
 */
import { interestShares } from '../src/lib/discover/brandFit/records'
import {
  BRAND_TO_CREATOR_PERSONALITY, mapBrandPersonality,
} from '../src/lib/discover/brandFit/personalityMap'
import { analyseBrandFit, type BrandFitInputs } from '../src/lib/discover/brandFit/engine'
import { PERSONALITY_FIT, CREATOR_PERSONALITIES } from './brand-match/vocabulary.mjs'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9

/* ── 1. top_interest ───────────────────────────────────────────────────────── */

// Shape copied from a live feature.ig_audience_analysis row.
const live = [
  { count: 92, interest: 'unknown' }, { count: 2, interest: 'parenting' },
  { count: 1, interest: 'beauty' }, { count: 1, interest: 'food' },
]
const shares = interestShares(live)
check('array top_interest parses (was null)', shares !== null, JSON.stringify(shares))
check('unknown bucket dropped', shares !== null && !('unknown' in shares))
check('rescaled over known followers', !!shares
  && close(shares.parenting, 50) && close(shares.beauty, 25) && close(shares.food, 25))
check('object input still accepted', close(interestShares({ beauty: 3, food: 1 })?.beauty, 75))
check('repeated key summed', close(interestShares([
  { interest: 'food', count: 1 }, { interest: 'Food', count: 1 }, { interest: 'art', count: 2 },
])?.food, 50))
check('only unknown -> null, not 0', interestShares([{ interest: 'unknown', count: 9 }]) === null)
check('malformed items ignored', interestShares(['beauty', null, { interest: 'art' }]) === null)
check('non-array scalar -> null', interestShares('beauty') === null)

/* ── 2. personality map ────────────────────────────────────────────────────── */

const fit = PERSONALITY_FIT as Record<string, Record<string, number>>
const creatorLabels = new Set(CREATOR_PERSONALITIES as string[])
for (const [brandWord, row] of Object.entries(fit)) {
  const top = Math.max(...Object.values(row))
  const best = Object.keys(row).filter(k => row[k] === top)
  const mapped = BRAND_TO_CREATOR_PERSONALITY[brandWord]
  if (best.length === 1) {
    check(`${brandWord} -> ${best[0]} (affinity ${top})`, mapped === best[0], `map says ${mapped ?? 'unmapped'}`)
  } else {
    check(`${brandWord} unmapped (tie: ${best.join(' / ')} at ${top})`, mapped === undefined, `map says ${mapped}`)
  }
}
for (const [brandWord, label] of Object.entries(BRAND_TO_CREATOR_PERSONALITY)) {
  check(`${brandWord} has PERSONALITY_FIT evidence`, brandWord in fit)
  check(`${brandWord} target ${label} is a creator label`, creatorLabels.has(label))
}

const m = mapBrandPersonality(['Playful', 'premium', 'Warm', 'Friendly', 'Authentic', 'Warm', ' '])
check('mapped labels de-duplicated, case-insensitive',
  JSON.stringify(m.labels) === JSON.stringify(['Entertaining', 'Premium', 'Relatable']), JSON.stringify(m.labels))
check('unmapped kept and reported once', JSON.stringify(m.unmapped) === JSON.stringify(['Warm']), JSON.stringify(m.unmapped))

/* ── 3. engine: Values and Interest end to end ─────────────────────────────── */

function inputs(personality: string[], attributes: string[], tagged = true): BrandFitInputs {
  return {
    brand: {
      category: null,
      attributes: personality,
      audience: { interests: ['parenting'] },
      performanceTargets: {},
    },
    creator: {
      categories: [],
      attributes,
      hasAttributeMapping: tagged,
      audience: {
        femalePct: null, malePct: null, genderKnownPct: null,
        ageBuckets: null, ageCoveragePct: null, countries: null, cities: null,
        interests: interestShares(live), interestTop: 'parenting',
      },
      performance: {},
    },
  } as unknown as BrandFitInputs
}

const a1 = analyseBrandFit(inputs(['Playful', 'Premium'], ['Entertaining', 'Educational']))
check('Playful matches an Entertaining creator (was 0)', a1.sub_scores.values_alignment.score === 50,
  String(a1.sub_scores.values_alignment.score))
const a2 = analyseBrandFit(inputs(['Playful', 'Warm'], ['Entertaining']))
check('unmapped Warm left out of the denominator', a2.sub_scores.values_alignment.score === 100,
  String(a2.sub_scores.values_alignment.score))
check('unmapped Warm named in notes', a2.meta.notes.some(n => n.includes('Warm')))
const a3 = analyseBrandFit(inputs(['Warm', 'Youthful'], ['Entertaining']))
check('only unmapped words -> not measured, not 0', a3.sub_scores.values_alignment.score === null)
const a4 = analyseBrandFit(inputs(['Playful'], [], false))
check('untagged creator still not measured', a4.sub_scores.values_alignment.score === null)
const a5 = analyseBrandFit(inputs(['Playful'], ['Reviewer']))
check('tagged creator with no match still genuinely 0', a5.sub_scores.values_alignment.score === 0)
check('Interest dimension measured from the array', a1.meta.audienceMeasured.includes('interest'),
  JSON.stringify(a1.meta.audienceMeasured))
check('Interest uses share (50), not present/absent (100)', a1.audience_overlap_pct === 50,
  String(a1.audience_overlap_pct))

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
