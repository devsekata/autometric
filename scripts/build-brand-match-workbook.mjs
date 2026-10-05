/**
 * Generates `Autometric_Brand_Match_Engine.xlsx` — the source of truth for the
 * Brand Match calculation logic.
 *
 *   npm install --no-save exceljs          (build-time only; not an app dependency)
 *   node scripts/build-brand-match-workbook.mjs
 *   node scripts/verify-brand-match-workbook.mjs
 *
 * Sheet order is the reading order: README, the two input sheets, the engine,
 * then the views that only look things up.
 *
 * Build order is not the same as sheet order and cannot be: Lookup_Lists has to
 * run first because it is what registers the address of every weight, matrix and
 * calibration cell the other sheets point at, and Brand_Profile has to run
 * before the engine because it registers the row of every brand field. The
 * `sheetOrder` pass at the end puts them back in reading order.
 */

import ExcelJS from 'exceljs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLookups, K, F } from './brand-match/build.mjs'
import { buildBrandProfile, buildKolDatabase, buildMatchingEngine } from './brand-match/engine.mjs'
import {
  buildMatchExplanation, buildDiscoveryFilters, buildFilterLogic,
  buildDiscoveryRanking, buildSampleBrands, buildSampleOutput, buildTaxonomy, buildReadme,
} from './brand-match/views.mjs'

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'Autometric_Brand_Match_Engine.xlsx')

/**
 * exceljs writes a `containsText` conditional-format rule with its evaluation
 * formula but without the `operator` and `text` attributes the schema asks for.
 * Excel is usually forgiving about it; "usually" is not a property you want in a
 * file that gets mailed around, and the repair dialog would be the first thing a
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
wb.creator = 'Autometric — Brand Match Engine generator'
wb.lastModifiedBy = 'scripts/build-brand-match-workbook.mjs'
wb.created = new Date()
wb.modified = new Date()
// Formulas are written without cached results, so the file must recalculate on
// open. Without this, a reader would see empty cells until they pressed F9.
wb.calcProperties.fullCalcOnLoad = true

buildLookups(wb)
buildBrandProfile(wb)
const { medianCpeFormula } = buildKolDatabase(wb)

// CAL_MEDIAN_CPE is the one constant that is measured rather than chosen: it is
// the roster's own median CPE, and Cost Efficiency divides by it. Written after
// KOL_Database exists so it tracks the data instead of a memory of it.
{
  const [, addr] = K.CAL_MEDIAN_CPE.split('!')
  wb.getWorksheet('Lookup_Lists').getCell(addr.replace(/\$/g, '')).value = F(medianCpeFormula)
}

buildMatchingEngine(wb)
buildMatchExplanation(wb)
buildDiscoveryFilters(wb)
buildFilterLogic(wb)
buildDiscoveryRanking(wb)
buildSampleBrands(wb)
buildSampleOutput(wb)
buildTaxonomy(wb)
buildReadme(wb)

const ORDER = [
  'README', 'Brand_Profile', 'KOL_Database', 'Matching_Engine', 'Match_Explanation',
  'Discovery_Filters', 'Discovery_Ranking', 'Filter_Logic', 'Taxonomy', 'Sample_Brands',
  'Sample_Output', 'Lookup_Lists',
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
await repairContainsTextRules(OUT)
console.log(`wrote ${OUT}`)
for (const ws of wb.worksheets) {
  console.log(`  ${String(ws.orderNo).padStart(2)}. ${ws.name.padEnd(20)} ${ws.rowCount} rows x ${ws.columnCount} cols`)
}
