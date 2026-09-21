/**
 * UI data-availability cleanup — controls whose source is empty are not drawn;
 * everything with data, and everything a requirement asks to show disabled,
 * still is.
 *
 *   npm run verify:kol-ui-availability
 *
 * Render-only: nothing connects to a database. The real `KolFilterPanel` and
 * the real `SmartDiscovery` are rendered to HTML with `react-dom/server`, so the
 * checks are on what the UI actually draws. `KolDirectoryPage` needs the Next
 * router, so its one change (the Rate card column) is checked on the source.
 *
 * A tiny `window.localStorage` stand-in is installed for the hooks
 * SmartDiscovery calls; it is test scaffolding and touches no product code.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

;(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  addEventListener: () => {}, removeEventListener: () => {},
}

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

async function main() {
  const F = await import('../src/components/discover/KolDirectoryFilters')
  const { KolFilterPanel, KOL_FILTERS_DEFAULT, DATA_AVAILABLE, relaxSuggestions, filtersToParams } = F
  type KolFilters = typeof KOL_FILTERS_DEFAULT

  const ALL = new Set(['platform', 'tier', 'reach', 'format', 'location', 'audience', 'other', 'category',
    'agency', 'updated', 'discovery', 'calculated'])
  const panel = (scope: 'database' | 'mine', patch: Partial<KolFilters> = {}) => renderToStaticMarkup(
    createElement(KolFilterPanel, {
      scope, filters: { ...KOL_FILTERS_DEFAULT, ...patch },
      // A platform is picked so the dependent Tier section is drawn too.
      facets: null, open: ALL,
      onToggleSection: () => {}, onChange: () => {}, onClear: () => {}, onCollapse: () => {},
    }))

  console.log('the availability switch reflects the audit')
  ok('rate card is off (unified_rate_card intentionally empty)', DATA_AVAILABLE.rateCard === false)
  ok('creator city is off (creator_city 0/1,980)', DATA_AVAILABLE.creatorCity === false)
  ok('connected is off (no connected account)', DATA_AVAILABLE.connected === false)

  for (const scope of ['database', 'mine'] as const) {
    console.log(`\nfilter panel — ${scope === 'mine' ? 'My Creators' : 'Creator Database'}`)
    const html = panel(scope, { platform: 'instagram' })
    // hidden
    ok('"Max. rate card" is not drawn', !html.includes('Max. rate card'))
    ok('"Connected creators only" is not drawn', !html.includes('Connected creators only'))
    // kept because a requirement asks for them disabled (D079-D083)
    ok('D079 audience age chips are still drawn (disabled)', html.includes('13–17') || html.includes('13-17'))
    ok('D080 "Major Female (%)" is still drawn (disabled)', html.includes('Major Female (%)'))
    ok('D081 Creator location is still drawn (disabled)', html.includes('Creator location'))
    ok('D083 "Min. authenticity" / "Min. brand fit" are still drawn (disabled)',
      html.includes('Min. authenticity') && html.includes('Min. brand fit'))
    // kept because they have data
    ok('"Min. engagement" is still drawn', html.includes('Min. engagement'))
    ok('Growth is still drawn', html.includes('>Growth<'))
    ok('"Min. female %" (calculated metric) is still drawn', html.includes('Min. female %'))
    ok('Verified toggle is still drawn', /Verified/.test(html))
    ok('Platform and Tier sections are still drawn', html.includes('All Platform') && html.includes('All tiers'))
  }

  console.log('\nscope-specific controls are untouched')
  const mine = panel('mine')
  const db = panel('database')
  ok('D090 Followers dropdown still drawn on My Creators', mine.includes('id="kol-filter-followers"'))
  ok('Creator Database still has the Min. followers slider', db.includes('Min. followers'))
  ok('D092 Profiling Status still drawn on My Creators', mine.includes('id="kol-filter-profiling"'))
  ok('and still not on the Creator Database', !db.includes('id="kol-filter-profiling"'))

  console.log('\na saved value keeps its control visible (nothing is silently dropped)')
  ok('a saved rate ceiling brings "Max. rate card" back so it can be cleared',
    panel('database', { maxRate: 5_000_000 }).includes('Max. rate card'))
  ok('a saved Connected-only brings its switch back so it can be turned off',
    panel('mine', { connectedOnly: true }).includes('Connected creators only'))
  ok('the saved rate ceiling is still sent unchanged',
    filtersToParams({ ...KOL_FILTERS_DEFAULT, maxRate: 5_000_000 }).maxRate === '5000000')
  ok('the saved Connected-only is still sent unchanged',
    filtersToParams({ ...KOL_FILTERS_DEFAULT, connectedOnly: true }).connected === '1')

  console.log('\nD124 relax suggestions are intact')
  const r1 = relaxSuggestions({ ...KOL_FILTERS_DEFAULT, maxRate: 5_000_000, follMin: 1_000 }, '')
  ok('a rate ceiling is still the first thing offered to release', r1[0]?.id === 'maxRate' && r1.length === 2)
  const r2 = relaxSuggestions({ ...KOL_FILTERS_DEFAULT, connectedOnly: true }, '')
  ok('Connected-only can still be released', r2.some(h => h.id === 'connectedOnly'))

  console.log('\nSmart Discovery')
  const SD = (await import('../src/components/discover/SmartDiscovery')).default
  let sd = ''
  try {
    sd = renderToStaticMarkup(createElement(SD, { orgId: '00000000-0000-0000-0000-000000000000' } as never))
  } catch (e) {
    ok('Smart Discovery renders', false, e instanceof Error ? e.message : String(e))
  }
  if (sd) {
    ok('D114 rate-card pill ("Any rate card", payments icon) is not drawn', !sd.includes('Any rate card') && !sd.includes('>payments<'))
    ok('D115 "Lower price than the reference" is not drawn', !sd.includes('Lower price than the reference'))
    ok('D116 "Any location" is not drawn', !sd.includes('Any location'))
    ok('D113 "Any tier" is still drawn', sd.includes('Any tier'))
    ok('the platform chips are still drawn', sd.includes('Platform'))
  }

  console.log('\nflags on — the same components draw every hidden control again')
  // Test-only: the switch is read at render time, so flipping the runtime
  // object proves each hide is gated by it and by nothing else.
  const flags = DATA_AVAILABLE as { rateCard: boolean; creatorCity: boolean; connected: boolean }
  const saved = { ...flags }
  Object.assign(flags, { rateCard: true, creatorCity: true, connected: true })
  try {
    for (const scope of ['database', 'mine'] as const) {
      const html = panel(scope, { platform: 'instagram' })
      ok(`${scope}: "Max. rate card" is drawn`, html.includes('Max. rate card'))
      ok(`${scope}: "Connected creators only" is drawn`, html.includes('Connected creators only'))
    }
    const on = renderToStaticMarkup(createElement(SD, { orgId: '00000000-0000-0000-0000-000000000000' } as never))
    ok('Smart Discovery: rate-card pill ("Any rate card", payments icon) is drawn', on.includes('Any rate card') && on.includes('>payments<'))
    ok('Smart Discovery: "Lower price than the reference" is drawn', on.includes('Lower price than the reference'))
    ok('Smart Discovery: "Any location" is drawn', on.includes('Any location'))
  } finally {
    Object.assign(flags, saved)
  }
  ok('flags restored to off after the check', !DATA_AVAILABLE.rateCard && !DATA_AVAILABLE.creatorCity && !DATA_AVAILABLE.connected)

  console.log('\nDirectory table (source check — the page needs the Next router)')
  const page = read('src/components/discover/KolDirectoryPage.tsx')
  ok('the Rate card column is off by default unless rate cards exist', page.includes('rate: DATA_AVAILABLE.rateCard, agency: false'))
  ok('the column chooser does not offer it', page.includes(".filter(c => c !== 'rate' || DATA_AVAILABLE.rateCard)"))
  ok('its column definition is kept (export, saved state untouched)', page.includes("rate: { label: 'Rate card', get: r => rateLabel(r) }"))
  ok('other columns keep their defaults',
    page.includes('tier: true, growth: true, reach: true, platform: true, category: false, updated: false,'))

  console.log('\nno new data path')
  const sdSrc = read('src/components/discover/SmartDiscovery.tsx')
  const fSrc = read('src/components/discover/KolDirectoryFilters.tsx')
  ok('no warehouse import in any changed file',
    ![sdSrc, fSrc, page].some(s => s.includes("from '@/lib/db'")))
  ok('Smart Discovery still sends the same parameters when set',
    sdSrc.includes("if (maxRate) qs.set('maxRate', String(maxRate))") && sdSrc.includes("if (city) qs.set('city', city)")
    && sdSrc.includes("if (cheaper) qs.set('cheaper', '1')"))
  ok('no fetch added to the filter panel', !fSrc.includes('fetch('))

  console.log(bad === 0 ? '\nall checks passed' : `\n${bad} check(s) failed`)
  if (bad) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
