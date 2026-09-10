/**
 * Generates `Autometric_Brand_Match_Comparison.xlsx` — 24 real creators from the
 * KOL database scored against 5 brands, 120 matching records.
 *
 *   npm run brandmatch:fetch            (office VPN required; writes roster.json)
 *   npm run brandmatch:comparison
 *   npm run brandmatch:comparison:verify
 *
 * Build order is not sheet order and cannot be. Lookup_Lists has to run first
 * because it is what registers the address of every weight, matrix and
 * calibration cell the other sheets point at; Brand_Profile has to run before
 * the engine because it registers the row of every brand field and every token
 * slot; KOL_Source_Data has to run before the engine because it registers the
 * column of every creator field. The `ORDER` pass at the end puts the sheets
 * back into reading order.
 */

import ExcelJS from 'exceljs'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BRANDS, CANONICAL_CATEGORIES } from './brand-match/comparison-brands.mjs'
import {
  buildComparisonLookups, buildBrandProfile, buildKolSourceData, buildMatchingEngine,
} from './brand-match/comparison.mjs'
import {
  buildScoreBreakdown, buildMatchExplanation, buildBrandComparison, buildBrandRanking,
  buildTopMatches, buildHardVsSoft, buildValidation, buildReadme,
} from './brand-match/comparison-views.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROSTER = path.resolve(HERE, 'brand-match', 'roster.json')
/**
 * `BRANDMATCH_OUT` overrides the destination.
 *
 * Windows locks an open workbook, so a rebuild while the reviewer has the file
 * up in Excel fails with EBUSY. Building to a temp path lets the full
 * build-and-verify cycle run against a locked original instead of asking
 * whoever is reading it to close it first.
 */
const OUT = process.env.BRANDMATCH_OUT
  ? path.resolve(process.env.BRANDMATCH_OUT)
  : path.resolve(HERE, '..', 'Autometric_Brand_Match_Comparison.xlsx')

if (!existsSync(ROSTER)) {
  console.error(`no roster snapshot at ${ROSTER}`)
  console.error('run it first, on the office VPN:  npm run brandmatch:fetch')
  console.error('this workbook has no fallback data on purpose — an invented roster is the one')
  console.error('failure it exists to avoid.')
  process.exit(1)
}

const snapshot = JSON.parse(readFileSync(ROSTER, 'utf8'))
const records = snapshot.records

if (records.length !== 24) {
  throw new Error(`roster.json holds ${records.length} records; the brief names 24`)
}
const handles = records.filter(r => r.found).map(r => r.resolved)
if (new Set(handles).size !== handles.length) {
  throw new Error('roster.json carries the same handle twice — the duplicate-row pick failed')
}

/**
 * The canonical category list is asserted against the snapshot, not trusted.
 *
 * CANONICAL_CATEGORIES is written down in comparison-brands.mjs because the
 * relatedness matrix needs a fixed row and column order. The database is the
 * authority for its contents, so if a taxonomy_key is added, retired or
 * respelled on the server, this build stops rather than scoring five brands
 * against a list that has quietly gone stale.
 */
const fromDb = [...new Set((snapshot.categoryMaster ?? []).map(c => c.taxonomy_key).filter(Boolean))].sort()
const known = [...CANONICAL_CATEGORIES].sort()
if (JSON.stringify(fromDb) !== JSON.stringify(known)) {
  throw new Error(
    'kol_categories.taxonomy_key has changed since this workbook was written. '
    + `database: [${fromDb.join(', ')}] · workbook: [${known.join(', ')}] · `
    + 'update CANONICAL_CATEGORIES and CATEGORY_RELATEDNESS in scripts/brand-match/comparison-brands.mjs')
}
for (const b of BRANDS) {
  if (!fromDb.includes(b.category)) {
    throw new Error(`brand ${b.brand_name} uses category "${b.category}", which is not a kol_categories.taxonomy_key value`)
  }
  const strayInterests = b.interests.filter(i => !(snapshot.interestKeys ?? []).includes(i))
  if (strayInterests.length) {
    throw new Error(`brand ${b.brand_name} targets interest key(s) the database does not have: ${strayInterests.join(', ')}`)
  }
}

/**
 * exceljs writes a `containsText` conditional-format rule with its evaluation
 * formula but without the `operator` and `text` attributes the schema asks for.
 * Excel is usually forgiving; "usually" is not a property you want in a file
 * that gets mailed around, and a repair dialog would be the first thing a
 * reviewer saw. This rewrites the attributes back in from the formula that is
 * already there — same rules, same order, no behaviour change.
 *
 * JSZip is exceljs's own dependency, so this adds nothing to install.
 */
async function repairContainsTextRules(file) {
  const { default: JSZip } = await import('jszip')
  const { readFile, writeFile } = await import('node:fs/promises')
  const zip = await JSZip.loadAsync(await readFile(file))
  let patched = 0
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue
    const xml = await zip.file(name).async('string')
    const next = xml.replace(
      /<cfRule type="containsText"([^>]*?)><formula>NOT\(ISERROR\(SEARCH\(&quot;(.*?)&quot;,/g,
      (_m, attrs, text) => {
        patched++
        return `<cfRule type="containsText"${attrs} operator="containsText" text="${text}">`
          + `<formula>NOT(ISERROR(SEARCH(&quot;${text}&quot;,`
      })
    if (next !== xml) zip.file(name, next)
  }
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return patched
}

const wb = new ExcelJS.Workbook()
wb.creator = 'Autometric — Brand Match comparison generator'
wb.lastModifiedBy = 'scripts/build-brand-match-comparison.mjs'
wb.created = new Date()
wb.modified = new Date()
// Formulas are written without cached results, so the file must recalculate on
// open. Without this a reader sees empty cells until they press F9.
wb.calcProperties.fullCalcOnLoad = true

buildComparisonLookups(wb, BRANDS, snapshot)
const { TOK } = buildBrandProfile(wb, BRANDS)
buildKolSourceData(wb, records)
buildMatchingEngine(wb, records, BRANDS, TOK)
buildScoreBreakdown(wb, records, BRANDS)
buildMatchExplanation(wb, records, BRANDS)
buildBrandComparison(wb, records, BRANDS)
buildBrandRanking(wb, records, BRANDS)
buildTopMatches(wb, records, BRANDS)
buildHardVsSoft(wb, records)
buildValidation(wb, records, BRANDS, snapshot)
buildReadme(wb, records, BRANDS, snapshot)

const ORDER = [
  'README', 'KOL_Source_Data', 'Brand_Profile', 'Matching_Engine', 'Score_Breakdown',
  'Match_Explanation', 'Brand_Comparison', 'Brand_Ranking', 'Top_Matches',
  'Hard_vs_Soft_Filter', 'Validation', 'Lookup_Lists',
]
ORDER.forEach((name, i) => {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`sheet order names a sheet that was never built: ${name}`)
  ws.orderNo = i + 1
})
if (wb.worksheets.length !== ORDER.length) {
  throw new Error(`built ${wb.worksheets.length} sheets but ordered ${ORDER.length}`)
}

wb.views = [{ x: 0, y: 0, width: 28000, height: 18000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]

await wb.xlsx.writeFile(OUT)
const patched = await repairContainsTextRules(OUT)

console.log(`wrote ${OUT}`)
console.log(`  ${records.filter(r => r.found).length} creators x ${BRANDS.length} brands = ${records.length * BRANDS.length} matching records`)
console.log(`  roster measured ${snapshot.measuredAt} from ${snapshot.server}`)
console.log(`  patched ${patched} containsText rules`)
for (const ws of wb.worksheets) {
  console.log(`  ${String(ws.orderNo).padStart(2)}. ${ws.name.padEnd(20)} ${ws.rowCount} rows x ${ws.columnCount} cols`)
}
