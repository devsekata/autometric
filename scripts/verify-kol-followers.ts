/**
 * D090 — My Creators "Followers" dropdown.
 *
 *   npm run verify:kol-followers
 *
 * Static and render-only: nothing connects to a database. The real
 * `KolFilterPanel` is rendered to HTML with `react-dom/server` for both scopes,
 * so the checks are on what the panel actually draws, not on source text.
 *
 * Covers: the six labels and values exactly as the requirement names them, the
 * dropdown on My Creators, the untouched slider on the Creator Database, the
 * D092 Profiling Status control, the shared `follMin` parameter, a saved
 * non-standard value kept as its own marked option, D124's relax hint, and no
 * new parameter or warehouse import.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  KolFilterPanel, KOL_FILTERS_DEFAULT, MY_CREATORS_FOLLOWER_OPTIONS, FOLLOWER_STEPS,
  filtersToParams, relaxSuggestions, type KolFilters,
} from '../src/components/discover/KolDirectoryFilters'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const ALL_SECTIONS = new Set(['platform', 'tier', 'reach', 'format', 'location', 'audience', 'other',
  'category', 'agency', 'updated', 'discovery', 'calculated'])
const render = (scope: 'database' | 'mine', patch: Partial<KolFilters> = {}) => renderToStaticMarkup(
  createElement(KolFilterPanel, {
    scope, filters: { ...KOL_FILTERS_DEFAULT, ...patch }, facets: null, open: ALL_SECTIONS,
    onToggleSection: () => {}, onChange: () => {}, onClear: () => {}, onCollapse: () => {},
  }))
/** The follower <select> of a rendered panel, or '' when there is none. */
const followerSelect = (html: string) => {
  const i = html.indexOf('id="kol-filter-followers"')
  if (i < 0) return ''
  return html.slice(html.lastIndexOf('<select', i), html.indexOf('</select>', i) + 9)
}

console.log('the six options')
ok('labels are exactly Any / 1K+ / 10K+ / 50K+ / 100K+ / 1M+',
  JSON.stringify(MY_CREATORS_FOLLOWER_OPTIONS.map(o => o.label))
    === JSON.stringify(['Any', '1K+', '10K+', '50K+', '100K+', '1M+']))
ok('values are exactly 0 / 1000 / 10000 / 50000 / 100000 / 1000000',
  JSON.stringify(MY_CREATORS_FOLLOWER_OPTIONS.map(o => o.value))
    === JSON.stringify([0, 1_000, 10_000, 50_000, 100_000, 1_000_000]))

console.log('\nMy Creators renders the dropdown')
const mine = render('mine')
const sel = followerSelect(mine)
ok('a Followers <select> is drawn', sel.length > 0)
for (const o of MY_CREATORS_FOLLOWER_OPTIONS) {
  ok(`option ${o.label} → value ${o.value}`, sel.includes(`<option value="${o.value}"`) && sel.includes(`>${o.label}</option>`))
}
ok('exactly six options when the value is official', (sel.match(/<option /g) ?? []).length === 6)
ok('Any is selected by default', /<option value="0" selected="">Any<\/option>/.test(sel))
ok('the follower slider is NOT drawn on My Creators', !mine.includes('Min. followers'))

console.log('\nthe Creator Database keeps its slider')
const db = render('database')
ok('no Followers dropdown on the Creator Database', followerSelect(db) === '')
ok('the Min. followers slider is still drawn', db.includes('Min. followers') && db.includes('type="range"'))
ok('the slider still steps through the same FOLLOWER_STEPS',
  JSON.stringify(FOLLOWER_STEPS) === JSON.stringify([0, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000,
    250_000, 500_000, 1_000_000, 5_000_000, 10_000_000]))

console.log('\nD092 Profiling Status is untouched')
ok('the Profiling Status select is still drawn on My Creators', mine.includes('id="kol-filter-profiling"'))
ok('and still absent on the Creator Database', !db.includes('id="kol-filter-profiling"'))

console.log('\nsaved non-standard values are kept, not snapped')
const saved = followerSelect(render('mine', { follMin: 25_000 }))
ok('a saved 25K becomes its own marked option',
  saved.includes('<option value="25000" selected="">25K+ (saved filter)</option>'), 'value 25000 kept')
ok('it is not snapped to 10K or 50K',
  !/<option value="10000" selected=""/.test(saved) && !/<option value="50000" selected=""/.test(saved))
ok('the six official options are still offered beside it', (saved.match(/<option /g) ?? []).length === 7)
const official = followerSelect(render('mine', { follMin: 100_000 }))
ok('an official value selects its own option and adds nothing',
  /<option value="100000" selected="">100K\+<\/option>/.test(official) && !official.includes('saved filter'))
const big = followerSelect(render('mine', { follMin: 5_000_000 }))
ok('a saved 5M reads 5M+ (saved filter)', big.includes('>5M+ (saved filter)</option>'))

console.log('\nthe parameter, the API and D124 are unchanged')
ok('follMin still travels as the same parameter',
  JSON.stringify(filtersToParams({ ...KOL_FILTERS_DEFAULT, follMin: 50_000 })) === JSON.stringify({ follMin: '50000' }))
ok('a saved 25K still sends 25000, unrounded',
  filtersToParams({ ...KOL_FILTERS_DEFAULT, follMin: 25_000 }).follMin === '25000')
ok('Any sends no follower parameter at all', !('follMin' in filtersToParams(KOL_FILTERS_DEFAULT)))
const relax = relaxSuggestions({ ...KOL_FILTERS_DEFAULT, follMin: 1_000_000 }, '')
ok('D124 still offers to lower the minimum followers, back to Any',
  relax.some(h => h.id === 'follMin' && 'patch' in h && h.patch.follMin === 0))
const route = read('src/app/api/organizations/[id]/discover/kol-directory/route.ts')
ok('the route still reads the one existing parameter', route.includes("minFollowers: num('follMin')"))
const svc = read('src/lib/discover/kolDirectory.ts')
ok('the service still filters followers_count through the same bound',
  svc.includes('query.minFollowers ? Math.trunc(query.minFollowers) : null'))

console.log('\nsafety')
const filt = read('src/components/discover/KolDirectoryFilters.tsx')
ok('the filter panel imports no warehouse pool', !filt.includes("from '@/lib/db'"))
ok('no new fetch or endpoint in the panel', !filt.includes('fetch('))

console.log(bad === 0 ? '\nall checks passed' : `\n${bad} check(s) failed`)
if (bad) process.exit(1)
