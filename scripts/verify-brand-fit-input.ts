/**
 * Brand Fit input mapping — no database.
 *
 *   npm run verify:brand-fit-input
 *
 * Covers the input that used to reach Brand Fit in the wrong shape:
 *
 *   1. `top_interest` is a jsonb array of {interest, count}. `interestShares`
 *      must turn it into known-population shares, not null.
 *   2. Brand personality / Brand values are no longer inputs: the engine takes
 *      no personality, emits no Values component, and weighs three components.
 */
import { interestShares } from '../src/lib/discover/brandFit/records'
import { analyseBrandFit, type BrandFitInputs } from '../src/lib/discover/brandFit/engine'
import { COMPONENT_WEIGHTS } from '../src/lib/discover/brandFit/rules'

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

/* ── 2. engine: no personality / values, Interest end to end ─────────────── */

function inputs(): BrandFitInputs {
  return {
    brand: {
      category: null,
      audience: { interests: ['parenting'] },
      performanceTargets: {},
    },
    creator: {
      categories: [],
      audience: {
        femalePct: null, malePct: null, genderKnownPct: null,
        ageBuckets: null, ageCoveragePct: null, countries: null, cities: null,
        interests: interestShares(live), interestTop: 'parenting',
      },
      performance: {},
    },
  } as unknown as BrandFitInputs
}

const a1 = analyseBrandFit(inputs())
check('no values_alignment sub-score', !('values_alignment' in a1.sub_scores),
  Object.keys(a1.sub_scores).join(','))
check('no values_* recommendation', !a1.recommendations.some(r => r.code.startsWith('values_')),
  a1.recommendations.map(r => r.code).join(','))
check('no Values note', !a1.meta.notes.some(n => /^Values:|personality/i.test(n)))
check('weights are category/audience/performance only',
  Object.keys(COMPONENT_WEIGHTS).join(',') === 'category,audience,performance',
  Object.keys(COMPONENT_WEIGHTS).join(','))
check('status covers the three components', Object.keys(a1.meta.status).join(',') === 'category,audience,performance')
check('Interest dimension measured from the array', a1.meta.audienceMeasured.includes('interest'),
  JSON.stringify(a1.meta.audienceMeasured))
check('Interest uses share (50), not present/absent (100)', a1.audience_overlap_pct === 50,
  String(a1.audience_overlap_pct))

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
