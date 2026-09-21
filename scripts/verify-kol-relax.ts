/**
 * D124 — "Saran longgarkan filter": the empty-result hints of the Creator
 * Database and My Creators.
 *
 *   npm run verify:kol-relax
 *
 * `relaxSuggestions` is a pure function of the page's filter state, so this
 * checks it directly: order, the cap of three, only active filters, and that
 * each patch really switches its filter off (by `activeFilterCount`, the same
 * test the page uses). No database, no env.
 */
import {
  KOL_FILTERS_DEFAULT, activeFilterCount, filtersToParams, relaxSuggestions,
  type KolFilters, type RelaxSuggestion,
} from '../src/components/discover/KolDirectoryFilters'

let bad = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

const f = (patch: Partial<KolFilters>): KolFilters => ({ ...KOL_FILTERS_DEFAULT, ...patch })
const ids = (s: RelaxSuggestion[]) => s.map(x => x.id).join(',')
const apply = (filters: KolFilters, s: RelaxSuggestion): KolFilters =>
  ('patch' in s ? { ...filters, ...s.patch } : filters)

/* ── nothing active ─────────────────────────────────────────────────────── */
ok('no active filter and no keyword → no suggestion', relaxSuggestions(KOL_FILTERS_DEFAULT, '').length === 0)
ok('a blank keyword is not a keyword', relaxSuggestions(KOL_FILTERS_DEFAULT, '   ').length === 0)
ok('geoLevel alone is not an active filter', relaxSuggestions(f({ geoLevel: 'city' }), '').length === 0)

/* ── order ──────────────────────────────────────────────────────────────── */
let s = relaxSuggestions(f({ category: 'Beauty', follMin: 10_000, maxRate: 5_000_000 }), '')
ok('rate card comes first', s[0]?.id === 'maxRate', ids(s))
s = relaxSuggestions(f({ verifiedOnly: true, connectedOnly: true }), '')
ok('connected comes before verified', ids(s) === 'connectedOnly,verifiedOnly', ids(s))

const everything = f({
  maxRate: 1_000_000, connectedOnly: true, risingOnly: true, profilingStatus: 'failed', updatedWithin: 7,
  shareMin: 1, saveMin: 1, stability: 'High Stability', growth: 'up', growthClass: 'Low Growth',
  femaleMin: 50, maleMin: 50, audQuality: 'High', audInterest: 'food', geoKey: 'Bandung', geoLevel: 'city',
  contentTopic: 'food', formatDominant: 'Video', paidMax: 25, postFreqMin: 4, freqReliability: 'High',
  viralMin: 10, verifiedOnly: true, erMin: 2, priority: 'High', follMin: 1000,
  tier: 'Micro', category: 'Beauty', platform: 'instagram', agency: 'X',
})
const full = relaxSuggestions(everything, 'budi', 99)
const expected = [
  'maxRate', 'connectedOnly', 'risingOnly', 'profilingStatus', 'updatedWithin',
  'shareMin', 'saveMin', 'stability', 'growth', 'growthClass', 'femaleMin', 'maleMin',
  'audQuality', 'audInterest', 'geo', 'contentTopic', 'formatDominant', 'paidMax',
  'postFreqMin', 'freqReliability', 'viralMin', 'verifiedOnly', 'erMin', 'priority',
  'follMin', 'tier', 'category', 'platform', 'agency', 'query',
].join(',')
ok('full order matches the approved priority', ids(full) === expected, ids(full))

/* ── cap ────────────────────────────────────────────────────────────────── */
s = relaxSuggestions(everything, 'budi')
ok('at most three suggestions', s.length === 3 && ids(s) === 'maxRate,connectedOnly,risingOnly', ids(s))

/* ── only active filters ────────────────────────────────────────────────── */
s = relaxSuggestions(f({ erMin: 3, paidMax: 100, femaleMin: 0, updatedWithin: 0 }), '')
ok('inactive filters (defaults) never appear', ids(s) === 'erMin', ids(s))
ok('profiling status stripped by the Creator Database scope never appears',
  !ids(relaxSuggestions({ ...f({ tier: 'Nano' }), profilingStatus: '' }, '')).includes('profilingStatus'))

/* ── every patch switches its filter off ────────────────────────────────── */
// Covers every active filter at least once and no other filter along the way.
const categoryOff = (x: KolFilters) => x.category === ''
for (const sug of full) {
  if (!('patch' in sug)) continue
  const before = everything
  const after = apply(before, sug)
  const changed = (Object.keys(sug.patch) as (keyof KolFilters)[])
  const others = (Object.keys(before) as (keyof KolFilters)[]).filter(k => !changed.includes(k))
  const untouched = others.every(k => before[k] === after[k])
  const allDefault = changed.every(k => after[k] === KOL_FILTERS_DEFAULT[k])
  const dropped = sug.id === 'category'
    ? categoryOff(after) && activeFilterCount(after) === activeFilterCount(before)
    : sug.id === 'platform'
      // Platform also clears Tier (the panel's "All Platform" chip does the same).
      ? activeFilterCount(after) === activeFilterCount(before) - 2
      : activeFilterCount(after) === activeFilterCount(before) - 1
  ok(`patch "${sug.id}" releases only its filter`, untouched && allDefault && dropped,
    `${changed.join('+')} · active ${activeFilterCount(before)}→${activeFilterCount(after)}`)
}
const geo = full.find(x => x.id === 'geo')
ok('audience location releases geoKey and geoLevel together',
  !!geo && 'patch' in geo && geo.patch.geoKey === '' && geo.patch.geoLevel === ''
  && !('geoKey' in filtersToParams(apply(everything, geo))) && !('geoLevel' in filtersToParams(apply(everything, geo))))
const released = new Set(full.flatMap(x => ('patch' in x ? Object.keys(x.patch) : [])))
const activeKeys = (Object.keys(everything) as (keyof KolFilters)[]).filter(k => everything[k] !== KOL_FILTERS_DEFAULT[k])
ok('every active filter has a suggestion', activeKeys.every(k => released.has(k)),
  activeKeys.filter(k => !released.has(k)).join(','))

/* ── keyword ────────────────────────────────────────────────────────────── */
s = relaxSuggestions(KOL_FILTERS_DEFAULT, ' budi ')
ok('a keyword alone yields one clear-query action',
  s.length === 1 && s[0].id === 'query' && 'clearQuery' in s[0] && s[0].clearQuery === true && !('patch' in s[0]))
s = relaxSuggestions(f({ tier: 'Nano', category: 'Food', platform: 'tiktok' }), 'budi')
ok('keyword comes after every filter', ids(s) === 'tier,category,platform', ids(s))

/* ── no counts in labels ────────────────────────────────────────────────── */
ok('labels carry no numbers', full.every(x => !/\d/.test(x.label)), full.map(x => x.label).filter(l => /\d/.test(l)).join(' | '))

console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
process.exit(bad ? 1 : 0)
