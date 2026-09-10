/**
 * Generates `Autometric_Brand_Match_Engine.xlsx` — the source of truth for the
 * Brand Match calculation logic.
 *
 *   npm install --no-save exceljs          (build-time only, not an app dependency)
 *   node scripts/build-brand-match-workbook.mjs
 *   node scripts/verify-brand-match-workbook.mjs
 *
 * Why a generator rather than a hand-built spreadsheet: the workbook holds
 * roughly seven thousand formulas across eleven sheets and every one of them has
 * to agree with the same six component weights, the same five relevance
 * matrices and the same calibration constants. Writing that by hand is how a
 * spec workbook ends up carrying three different versions of one formula. Here
 * each formula is written once and emitted for every row, and the companion
 * verifier recalculates the result to prove the file is sound before anyone
 * opens it.
 *
 * Terminology comes from the running prototype, not from this file: tiers,
 * categories, age bands and cities from `@/lib/discover/vocab`; the hard-filter
 * set from the `KolDirectoryQuery` shape in `@/lib/discover/kolDirectory`; the
 * Live / Calculated / Estimated data status from `KolDataStatus`; the match
 * verdict wording from `brandFit.verdict` in `@/lib/discover/kolSample`; and the
 * per-filter data source and coverage columns from `deliv.xlsx`
 * (`Mapping Filter-DB`) via `discovery-filter-deliverables-audit.md`.
 */

import {
  buildLookups, LK, MX, K, listRef, banner, subhead, headers, labelCell, groupBand,
  bd, fillOf, T, BASE, F, A, cellA, rangeA, SCORE_FMT, PCT1, INT, IDR, OUT, ExcelJS,
} from './build.mjs'
import { KOLS, BRANDS, BRAND_FIELDS, TOKEN_FIELDS } from './dataset.mjs'
import { DISCOVERY_FILTERS, RANKING_PRESETS } from './catalogue.mjs'

const BRAND_COLS = ['D', 'E', 'F']           // Brand_Profile columns, one per brand
const KOL_FIRST = 5                          // first KOL_Database data row
const ME_FIRST = 6                           // first Matching_Engine data row
const N_KOL = KOLS.length
const N_BRAND = BRANDS.length

/** Brand_Profile field key → row. Filled by buildBrandProfile. */
const BR = {}
/** Token helper rows: key → { slots:[r x5], count:r }. */
const TOK = {}
/** Derived audience weight rows: dimension → row. */
const WT = {}

const bp = (key, col) => `Brand_Profile!$${col}$${BR[key]}`
const bpActive = key => `Brand_Profile!$G$${BR[key]}`
const ACTIVE_BRAND = 'Brand_Profile!$B$4'

/* ══════════════════════════════════════════════════════════════════════════
   KOL_Database column map
   ══════════════════════════════════════════════════════════════════════════ */

const KOL_COLUMNS = [
  ['KOL ID', 'id', 'IDENTITY'],
  ['Creator Name', 'name'],
  ['Handle', 'handle'],
  ['Platform', 'platform'],
  ['Category', 'category'],
  ['Sub Category', 'subCategory'],
  ['Tier', '=formula'],
  ['Verified', 'verified'],
  ['Creator City', 'creatorCity'],
  ['Followers', 'followers', 'PERFORMANCE'],
  ['Engagement Rate (%)', 'er'],
  ['Average Views', 'avgViews'],
  ['Median Views', 'medianViews'],
  ['30D Growth (%)', 'g30'],
  ['90D Growth (%)', 'g90'],
  ['Consistency Score', 'consistency'],
  ['Community Score', 'community'],
  ['Audience Quality', 'audQual'],
  ['Audience Authenticity', 'audAuth'],
  ['Share Rate (%)', 'shareRate'],
  ['Save Rate (%)', 'saveRate'],
  ['Recent Performance', 'recentPerf'],
  ['Audience Age 13–17 %', 'age1317', 'AUDIENCE'],
  ['Audience Age 18–24 %', 'age1824'],
  ['Audience Age 25–34 %', 'age2534'],
  ['Audience Age 35–44 %', 'age3544'],
  ['Audience Age 45+ %', 'age45'],
  ['Female %', 'female'],
  ['Male %', 'male'],
  ['Audience Country', 'audienceCountry'],
  ['Audience Region', 'audienceRegion'],
  ['Audience City', 'audienceCity'],
  ['Audience Interests', 'audienceInterests'],
  ['Purchase Intent', 'purchaseIntent'],
  ['Content Topics', 'contentTopics', 'CONTENT'],
  ['Content Style', 'contentStyle'],
  ['Creator Personality', 'creatorPersonality'],
  ['Creator Values', 'creatorValues'],
  ['Content Quality', 'contentQuality'],
  ['Rate Card (IDR)', 'rate', 'COMMERCIAL'],
  ['CPV', '=formula'],
  ['CPE', '=formula'],
  ['CPM', '=formula'],
  ['Estimated Reach', '=formula'],
  ['Estimated ROI', '=formula'],
  ['Brand Safety Score', 'brandSafety', 'SAFETY'],
  ['Competitor Saturation', 'compSat'],
  ['Risk Flag', 'risk'],
  ['Already Selected', 'alreadySelected', 'EXCLUSION STATE'],
  ['In Cart', 'inCart'],
  ['Existing Partner', 'existingPartner'],
  ['Excluded Creator', 'excluded'],
  ['Added Date', 'addedDate', 'FRESHNESS'],
  ['Last Updated', 'updatedDate'],
  ['View-to-Follower Ratio', '=formula', 'DERIVED'],
  ['Cost Efficiency', '=formula'],
  ['Data Completeness %', '=formula'],
  ['Data Status', '=formula'],
]

/** header name → 1-based column index */
const KC = {}
KOL_COLUMNS.forEach(([name], i) => { KC[name] = i + 1 })
const kd = (name, row) => `KOL_Database!$${A(KC[name])}$${row}`

/* ══════════════════════════════════════════════════════════════════════════
   Brand_Profile
   ══════════════════════════════════════════════════════════════════════════ */

function buildBrandProfile(wb) {
  const ws = wb.addWorksheet('Brand_Profile', { views: [{ state: 'frozen', ySplit: 6, xSplit: 3 }] })
  const SPAN = 8
  banner(ws, 1, SPAN, 'BRAND PROFILE  ·  Company Profile · Target Audience · Brand Identification · Ideal Creator Profile',
    'The inputs. Columns D–F are the three brands, each cell typed by hand or picked from a dropdown; column G is whichever brand '
    + 'cell B4 names, and that is the column the engine reads for every active-brand view. Nothing on this sheet is calculated from a '
    + 'creator — it is what the brand says about itself before it has seen the roster.')

  labelCell(ws, 4, 1, 'Active Brand →', { bold: true, size: 10, fill: T.soft })
  const sel = ws.getCell(4, 2)
  sel.value = BRANDS[0].brand_id
  sel.font = { ...BASE, bold: true, size: 11 }
  sel.fill = fillOf(T.input)
  sel.border = bd('FFF59E0B')
  sel.alignment = { horizontal: 'center', vertical: 'middle' }
  sel.dataValidation = { type: 'list', allowBlank: false, formulae: [listRef('BrandID')] }
  ws.getRow(4).height = 22

  headers(ws, 6, 1, ['Section', 'Field', 'Field Key', BRANDS[0].brand_id, BRANDS[1].brand_id,
    BRANDS[2].brand_id, 'Active Value', 'Input type / allowed values'], 28)

  // Active column index — MATCH over the three brand headers, so adding a brand
  // column is a one-line change rather than a rewrite of every G formula.
  const helper = ws.getCell(4, 8)
  helper.value = F('=MATCH($B$4,$D$6:$F$6,0)')
  helper.font = { ...BASE, size: 8, color: { argb: T.sub } }
  labelCell(ws, 4, 7, 'active column →', { size: 8, color: T.sub, noBorder: true })
  labelCell(ws, 4, 3, '', { noBorder: true })

  let r = 7
  let section = ''
  for (const [sec, label, key, kind] of BRAND_FIELDS) {
    if (sec) {
      section = sec
      ws.mergeCells(r, 1, r, SPAN)
      const c = ws.getCell(r, 1)
      c.value = sec
      c.font = { ...BASE, bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
      c.fill = fillOf(T.group)
      c.alignment = { vertical: 'middle', indent: 1 }
      ws.getRow(r).height = 18
      r++
    }
    BR[key] = r
    labelCell(ws, r, 1, section.replace(/^[A-E]\. /, ''), { size: 8, color: T.sub })
    labelCell(ws, r, 2, label, { size: 9, bold: true })
    labelCell(ws, r, 3, key, { size: 9, color: T.sub })
    BRAND_COLS.forEach((col, bi) => {
      const c = ws.getCell(r, 4 + bi)
      c.value = BRANDS[bi][key]
      c.font = { ...BASE, size: 9 }
      c.fill = fillOf(T.input)
      c.border = bd('FFE8C77B')
      c.alignment = { vertical: 'middle', wrapText: true }
      if (kind === 'int') c.numFmt = INT
      if (kind === 'pct') c.numFmt = PCT1
      if (kind === 'score') c.numFmt = SCORE_FMT
      if (kind.startsWith('list:')) {
        c.dataValidation = { type: 'list', allowBlank: true, formulae: [listRef(kind.slice(5))] }
      }
    })
    const g = ws.getCell(r, 7)
    g.value = F(`=INDEX($D${r}:$F${r},1,$H$4)`)
    g.font = { ...BASE, size: 9, bold: true }
    g.fill = fillOf(T.calc)
    g.border = bd()
    g.alignment = { vertical: 'middle', wrapText: true }
    if (kind === 'int') g.numFmt = INT
    if (kind === 'pct') g.numFmt = PCT1
    if (kind === 'score') g.numFmt = SCORE_FMT
    labelCell(ws, r, 8, describeKind(kind), { size: 8, color: T.sub, wrap: true })
    r++
  }

  /* token helper — comma lists split into five addressable slots */
  r++
  r = subhead(ws, r, SPAN,
    'TOKEN HELPER (calculated)  ·  the comma-separated list fields split into five slots, so overlap can be counted with plain formulas rather than an array')
  headers(ws, r, 1, ['List field', 'Slot', 'Key', BRANDS[0].brand_id, BRANDS[1].brand_id,
    BRANDS[2].brand_id, 'Active Value', 'How it is built'], 22)
  r++
  const WIDTH = 120
  for (const [key, label] of TOKEN_FIELDS) {
    const slots = []
    for (let k = 1; k <= 5; k++) {
      labelCell(ws, r, 1, k === 1 ? label : '', { size: 9, bold: k === 1 })
      labelCell(ws, r, 2, `slot ${k}`, { size: 9, color: T.sub })
      labelCell(ws, r, 3, `${key}_${k}`, { size: 8, color: T.sub })
      BRAND_COLS.forEach((col, bi) => {
        const c = ws.getCell(r, 4 + bi)
        c.value = F(`=TRIM(MID(SUBSTITUTE($${col}$${BR[key]},",",REPT(" ",${WIDTH})),${(k - 1) * WIDTH + 1},${WIDTH}))`)
        c.font = { ...BASE, size: 9 }
        c.fill = fillOf(T.calc)
        c.border = bd()
      })
      const g = ws.getCell(r, 7)
      g.value = F(`=INDEX($D${r}:$F${r},1,$H$4)`)
      g.font = { ...BASE, size: 9 }
      g.fill = fillOf(T.calc)
      g.border = bd()
      labelCell(ws, r, 8, k === 1
        ? 'TRIM(MID(SUBSTITUTE(list, ",", REPT(" ",120)), (slot-1)*120+1, 120)) — the standard non-array split. Empty slots come back as "".'
        : '', { size: 8, color: T.sub, wrap: true })
      slots.push(r)
      r++
    }
    labelCell(ws, r, 1, '', { size: 9 })
    labelCell(ws, r, 2, 'count', { size: 9, bold: true })
    labelCell(ws, r, 3, `${key}_count`, { size: 8, color: T.sub })
    BRAND_COLS.forEach((col, bi) => {
      const c = ws.getCell(r, 4 + bi)
      c.value = F(`=${slots.map(s => `IF($${col}$${s}="",0,1)`).join('+')}`)
      c.font = { ...BASE, size: 9, bold: true }
      c.fill = fillOf(T.calc)
      c.border = bd()
      c.alignment = { horizontal: 'center' }
    })
    const g = ws.getCell(r, 7)
    g.value = F(`=INDEX($D${r}:$F${r},1,$H$4)`)
    g.font = { ...BASE, size: 9, bold: true }
    g.fill = fillOf(T.calc)
    g.border = bd()
    labelCell(ws, r, 8, 'Denominator for the overlap score. A brand that names three keywords is judged out of three, not out of five.',
      { size: 8, color: T.sub, wrap: true })
    TOK[key] = { slots, count: r }
    r++
  }

  /* derived audience sub-weights */
  r++
  r = subhead(ws, r, SPAN,
    'AUDIENCE SUB-WEIGHTS (calculated)  ·  Audience Demographics Priority moves weight onto one dimension and takes a third of the bonus off each of the others')
  headers(ws, r, 1, ['Dimension', 'Base weight', 'Key', BRANDS[0].brand_id, BRANDS[1].brand_id,
    BRANDS[2].brand_id, 'Active Value', 'Rule'], 22)
  r++
  const DIMS = [
    ['Age Match', 'Age', 'W_TA_AGE', 'w_age'],
    ['Gender Match', 'Gender', 'W_TA_GENDER', 'w_gender'],
    ['Location Match', 'Location', 'W_TA_LOCATION', 'w_location'],
    ['Interest Match', 'Interest', 'W_TA_INTEREST', 'w_interest'],
  ]
  for (const [label, priorityName, constKey, wkey] of DIMS) {
    labelCell(ws, r, 1, label, { size: 9, bold: true })
    const b = ws.getCell(r, 2)
    b.value = F(`=${K[constKey]}`)
    b.font = { ...BASE, size: 9 }
    b.border = bd()
    b.alignment = { horizontal: 'center' }
    labelCell(ws, r, 3, wkey, { size: 8, color: T.sub })
    BRAND_COLS.forEach((col, bi) => {
      const c = ws.getCell(r, 4 + bi)
      c.value = F(`=MAX(0,${K[constKey]}+IF($${col}$${BR.audience_priority}="${priorityName}",${K.W_TA_PRIORITY_BONUS},`
        + `IF($${col}$${BR.audience_priority}="Balanced",0,-${K.W_TA_PRIORITY_BONUS}/3)))`)
      c.font = { ...BASE, size: 9, bold: true }
      c.fill = fillOf(T.calc)
      c.border = bd()
      c.numFmt = '0.0'
      c.alignment = { horizontal: 'center' }
    })
    const g = ws.getCell(r, 7)
    g.value = F(`=INDEX($D${r}:$F${r},1,$H$4)`)
    g.font = { ...BASE, size: 9, bold: true }
    g.fill = fillOf(T.calc)
    g.border = bd()
    g.numFmt = '0.0'
    labelCell(ws, r, 8, `base + bonus when priority = ${priorityName}, base − bonus/3 otherwise`,
      { size: 8, color: T.sub, wrap: true })
    WT[wkey] = r
    r++
  }

  ws.getColumn(1).width = 22
  ws.getColumn(2).width = 30
  ws.getColumn(3).width = 26
  ws.getColumn(4).width = 34
  ws.getColumn(5).width = 34
  ws.getColumn(6).width = 34
  ws.getColumn(7).width = 34
  ws.getColumn(8).width = 46
  return ws
}

function describeKind(kind) {
  if (kind === 'text') return 'Free text'
  if (kind === 'int') return 'Whole number'
  if (kind === 'pct') return 'Percent, e.g. 3.5 means 3,5%'
  if (kind === 'score') return '0–100 (0 turns the rule off)'
  if (kind === 'tokens') return 'Up to 5 items, comma-separated'
  if (kind.startsWith('multi:')) return `One or more of the ${kind.slice(6)} list, comma-separated`
  if (kind.startsWith('list:')) return `Dropdown — Lookup_Lists.${kind.slice(5)}`
  return ''
}

/* ══════════════════════════════════════════════════════════════════════════
   KOL_Database
   ══════════════════════════════════════════════════════════════════════════ */

function buildKolDatabase(wb) {
  const ws = wb.addWorksheet('KOL_Database', { views: [{ state: 'frozen', ySplit: 4, xSplit: 3 }] })
  const SPAN = KOL_COLUMNS.length
  banner(ws, 1, SPAN, 'KOL DATABASE  ·  30 creators, Instagram and TikTok',
    'The other half of the inputs. Identity, performance, audience, content, commercial and safety — the same six blocks the creator '
    + 'workspace shows. Tier, CPV, CPE, CPM, Estimated Reach, Estimated ROI, View-to-Follower Ratio, Cost Efficiency, Data Completeness '
    + 'and Data Status are calculated from the columns beside them, so they cannot disagree with their own inputs. Several creators are '
    + 'deliberately missing a field: the real roster is full of holes and every formula here has to survive one.')

  // group bands over the header row
  let gStart = 1
  let gName = 'IDENTITY'
  KOL_COLUMNS.forEach(([, , group], i) => {
    if (group && i > 0) {
      groupBand(ws, 3, gStart, i, gName)
      gStart = i + 1
      gName = group
    }
  })
  groupBand(ws, 3, gStart, SPAN, gName)

  const rows = KOLS.map((k, i) => {
    const r = KOL_FIRST + i
    return KOL_COLUMNS.map(([name, prop]) => {
      if (prop !== '=formula') return k[prop] ?? null
      switch (name) {
        case 'Tier':
          return F(`=IFERROR(INDEX(${rangeA('Lookup_Lists', LK.TierName.col, LK.TierName.r1, LK.TierName.col, LK.TierName.r2)},`
            + `MATCH(${kd('Followers', r)},${rangeA('Lookup_Lists', LK.TierMin.col, LK.TierMin.r1, LK.TierMin.col, LK.TierMin.r2)},1)),"")`)
        case 'CPV':
          return F(`=IF(OR(${kd('Rate Card (IDR)', r)}="",${kd('Rate Card (IDR)', r)}=0,${kd('Average Views', r)}="",${kd('Average Views', r)}=0),"",`
            + `ROUND(${kd('Rate Card (IDR)', r)}/${kd('Average Views', r)},2))`)
        case 'CPE':
          return F(`=IF(OR(${kd('Rate Card (IDR)', r)}="",${kd('Rate Card (IDR)', r)}=0,${kd('Average Views', r)}="",${kd('Average Views', r)}=0,`
            + `${kd('Engagement Rate (%)', r)}="",${kd('Engagement Rate (%)', r)}=0),"",`
            + `ROUND(${kd('Rate Card (IDR)', r)}/(${kd('Average Views', r)}*${kd('Engagement Rate (%)', r)}/100),0))`)
        case 'CPM':
          return F(`=IF(OR(${kd('Rate Card (IDR)', r)}="",${kd('Rate Card (IDR)', r)}=0,${kd('Followers', r)}="",${kd('Followers', r)}=0),"",`
            + `ROUND(${kd('Rate Card (IDR)', r)}/${kd('Followers', r)}*1000,0))`)
        case 'Estimated Reach':
          return F(`=IF(OR(${kd('Average Views', r)}="",${kd('Followers', r)}=""),"",`
            + `ROUND(${kd('Average Views', r)}*${K.CAL_REACH_VIEWS}+${kd('Followers', r)}*${K.CAL_REACH_FOLL},0))`)
        case 'Estimated ROI':
          return F(`=IF(OR(${kd('Rate Card (IDR)', r)}="",${kd('Rate Card (IDR)', r)}=0,${kd('Estimated Reach', r)}=""),"",`
            + `ROUND(${kd('Estimated Reach', r)}*${kd('Engagement Rate (%)', r)}/100*${K.CAL_VALUE_PER_ENG}/${kd('Rate Card (IDR)', r)},2))`)
        case 'View-to-Follower Ratio':
          return F(`=IF(OR(${kd('Followers', r)}="",${kd('Followers', r)}=0,${kd('Average Views', r)}=""),"",`
            + `ROUND(${kd('Average Views', r)}/${kd('Followers', r)},3))`)
        case 'Cost Efficiency':
          return F(`=IF(OR(${kd('CPE', r)}="",${kd('CPE', r)}=0,${K.CAL_MEDIAN_CPE}=0),"",`
            + `MIN(100,ROUND(${K.CAL_MEDIAN_CPE}/${kd('CPE', r)}*100,0)))`)
        case 'Data Completeness %': {
          const tracked = ['Followers', 'Engagement Rate (%)', 'Average Views', 'Median Views',
            '30D Growth (%)', '90D Growth (%)', 'Consistency Score', 'Audience Quality',
            'Audience Authenticity', 'Audience Region', 'Audience City', 'Rate Card (IDR)']
          return F(`=ROUND((${tracked.map(t => `IF(${kd(t, r)}="",0,1)`).join('+')})/${tracked.length}*100,0)`)
        }
        case 'Data Status':
          return F(`=IF(${kd('Data Completeness %', r)}>=${K.CONF_HIGH},"Live",`
            + `IF(${kd('Data Completeness %', r)}>=${K.CONF_MEDIUM},"Calculated","Estimated"))`)
        default:
          return null
      }
    })
  })

  ws.addTable({
    name: 'tblKOL',
    ref: 'A4',
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: KOL_COLUMNS.map(([name]) => ({ name, filterButton: true })),
    rows,
  })

  // formats and widths
  const NUM = {
    Followers: INT, 'Average Views': INT, 'Median Views': INT, 'Estimated Reach': INT,
    'Rate Card (IDR)': IDR, CPE: IDR, CPM: IDR, CPV: '#,##0.00',
    'Engagement Rate (%)': PCT1, '30D Growth (%)': PCT1, '90D Growth (%)': PCT1,
    'Share Rate (%)': '0.00', 'Save Rate (%)': '0.00', 'Estimated ROI': '0.00',
    'View-to-Follower Ratio': '0.000', 'Added Date': 'yyyy-mm-dd', 'Last Updated': 'yyyy-mm-dd',
  }
  KOL_COLUMNS.forEach(([name], i) => {
    const col = ws.getColumn(i + 1)
    col.width = name.length > 22 ? 20 : Math.max(10, Math.min(20, name.length + 3))
    for (let r = KOL_FIRST; r < KOL_FIRST + N_KOL; r++) {
      const c = ws.getCell(r, i + 1)
      c.font = { ...BASE, size: 9 }
      if (NUM[name]) c.numFmt = NUM[name]
      else if (/%$|Score|Quality|Authenticity|Saturation|Performance|Efficiency/.test(name)) c.numFmt = SCORE_FMT
    }
  })
  ws.getColumn(KC['Audience Interests']).width = 34
  ws.getColumn(KC['Content Topics']).width = 30
  ws.getColumn(KC['Creator Values']).width = 30
  ws.getColumn(KC['Creator Name']).width = 18
  ws.getColumn(KC.Handle).width = 22

  // dropdowns on the categorical inputs
  const VAL = {
    Platform: 'Platform', Category: 'Category', 'Sub Category': 'SubCategory',
    Verified: 'YesNo', 'Creator City': 'City', 'Audience Country': 'Country',
    'Audience Region': 'Region', 'Audience City': 'City', 'Purchase Intent': 'PurchaseIntent',
    'Content Style': 'ContentStyle', 'Creator Personality': 'CreatorPersonality',
    'Risk Flag': 'RiskFlag', 'Already Selected': 'YesNo', 'In Cart': 'YesNo',
    'Existing Partner': 'YesNo', 'Excluded Creator': 'YesNo',
  }
  for (const [name, list] of Object.entries(VAL)) {
    for (let r = KOL_FIRST; r < KOL_FIRST + N_KOL; r++) {
      ws.getCell(r, KC[name]).dataValidation = {
        type: 'list', allowBlank: true, formulae: [listRef(list)],
      }
    }
  }

  const last = KOL_FIRST + N_KOL - 1
  ws.addConditionalFormatting({
    ref: `${A(KC['Engagement Rate (%)'])}${KOL_FIRST}:${A(KC['Engagement Rate (%)'])}${last}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 5 }, { type: 'num', value: 10 }],
      color: [{ argb: 'FFFEE2E2' }, { argb: 'FFFEF3C7' }, { argb: 'FFBBF7D0' }],
    }],
  })
  ws.addConditionalFormatting({
    ref: `${A(KC['Risk Flag'])}${KOL_FIRST}:${A(KC['Risk Flag'])}${last}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'High', priority: 1, style: { fill: fillOf('FFFEE2E2'), font: { bold: true, color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Medium', priority: 2, style: { fill: fillOf('FFFEF3C7'), font: { color: { argb: 'FF92400E' } } } },
    ],
  })
  ws.addConditionalFormatting({
    ref: `${A(KC['Data Status'])}${KOL_FIRST}:${A(KC['Data Status'])}${last}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'Live', priority: 1, style: { font: { bold: true, color: { argb: 'FF166534' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Estimated', priority: 2, style: { font: { color: { argb: 'FF92400E' } } } },
    ],
  })

  // The roster median CPE, which Cost Efficiency divides by. Written here rather
  // than typed into Lookup_Lists so it tracks the data instead of a memory of it.
  return { ws, medianCpeFormula: `=IFERROR(MEDIAN(${rangeA('KOL_Database', KC.CPE, KOL_FIRST, KC.CPE, last)}),0)` }
}

/* ══════════════════════════════════════════════════════════════════════════
   Matching_Engine — 3 brands x 30 creators
   ══════════════════════════════════════════════════════════════════════════ */

const ME_COLUMNS = [
  ['Brand ID', 'KEY'], ['Brand'], ['KOL ID'], ['Creator'], ['Handle'], ['Platform'],
  ['Category'], ['Tier'], ['Followers'], ['Engagement Rate (%)'],
  ['Industry Match', 'BRAND & BUSINESS RELEVANCE — 20%'], ['Category Match'], ['Keyword Match'],
  ['Brand & Business Relevance'],
  ['Age Match Score', 'TARGET AUDIENCE RELEVANCE — 30%'], ['Gender Match Score'],
  ['Location Match Score'], ['Interest Match Score'], ['Target Audience Relevance'],
  ['Category Match (content)', 'CONTENT & CATEGORY RELEVANCE — 20%'], ['Sub Category Match'],
  ['Topic Match'], ['Content Style Match'], ['Content & Category Relevance'],
  ['Personality Match', 'BRAND PERSONALITY FIT — 10%'], ['Tone vs Content Style'],
  ['Values Match'], ['Communication Style Match'], ['Brand Personality Fit'],
  ['Engagement Rate Score', 'PERFORMANCE QUALITY — 10%'], ['Audience Quality Score'],
  ['Consistency Score'], ['Community Score'], ['Average Views Score'], ['Recent Growth Score'],
  ['Performance Quality'],
  ['Brand Safety Base', 'BRAND SAFETY — 10%'], ['Competitor Saturation'], ['Risk Flag'],
  ['Risk Multiplier'], ['Brand Safety'],
  ['Final Match Score', 'RESULT'], ['Match Level'], ['Data Completeness %'], ['Confidence'],
  ['Brand Fit Index'], ['Opportunity Score'], ['Hard Filter Result'], ['Exclusion Reason'],
  ['Recommendation'], ['Final Match Score (eligible only)'], ['Match Key'],
  ['Brand Product Parent Category', 'HELPERS (intermediate lookups, kept visible on purpose)'],
  ['KOL Sub Parent Category'], ['Rel: Brand Product Parent → KOL Category'],
  ['Rel: Preferred Category → KOL Category'], ['Brand Preferred Sub Parent'],
  ['KOL Keyword Haystack'], ['KOL Topic Haystack'],
]
const MEC = {}
ME_COLUMNS.forEach(([name], i) => { MEC[name] = i + 1 })
const me = (name, row) => `Matching_Engine!$${A(MEC[name])}$${row}`
const meRange = name => rangeA('Matching_Engine', MEC[name], ME_FIRST, MEC[name], ME_FIRST + N_KOL * N_BRAND - 1)

/** Overlap of a brand token list against a creator text, as 0–100. */
function overlap(tokKey, bcol, haystack) {
  const t = TOK[tokKey]
  const terms = t.slots
    .map(s => `IF(Brand_Profile!$${bcol}$${s}="",0,IF(ISNUMBER(SEARCH(Brand_Profile!$${bcol}$${s},${haystack})),1,0))`)
    .join('+')
  const cnt = `Brand_Profile!$${bcol}$${t.count}`
  return `IF(${cnt}=0,${K.CAL_NEUTRAL},ROUND((${terms})/${cnt}*100,0))`
}

function mx(name, rowExpr, colExpr, fallback) {
  const m = MX[name]
  return `IFERROR(INDEX(${m.data},MATCH(${rowExpr},${m.rows},0),MATCH(${colExpr},${m.cols},0)),${fallback})`
}

function buildMatchingEngine(wb) {
  const ws = wb.addWorksheet('Matching_Engine', { views: [{ state: 'frozen', ySplit: 5, xSplit: 4 }] })
  const SPAN = ME_COLUMNS.length
  banner(ws, 1, SPAN, 'MATCHING ENGINE  ·  every creator scored against every brand',
    'Ninety rows: three brands x thirty creators. Not one score on this sheet is typed — each is a formula over Brand_Profile and '
    + 'KOL_Database, weighted by the constants on Lookup_Lists. Filter column A to one Brand ID to read a single brand; compare the same '
    + 'KOL ID across the three blocks to see that Brand Match is a function of the pair, not a ranking of creators.')

  let gStart = 1
  let gName = 'KEY'
  ME_COLUMNS.forEach(([, group], i) => {
    if (group && i > 0) { groupBand(ws, 4, gStart, i, gName); gStart = i + 1; gName = group }
  })
  groupBand(ws, 4, gStart, SPAN, gName)
  headers(ws, 5, 1, ME_COLUMNS.map(([n]) => n), 46)

  for (let b = 0; b < N_BRAND; b++) {
    const bcol = BRAND_COLS[b]
    for (let i = 0; i < N_KOL; i++) {
      const r = ME_FIRST + b * N_KOL + i
      const kr = KOL_FIRST + i
      writeEngineRow(ws, r, kr, bcol, b)
    }
  }

  // widths / formats
  ME_COLUMNS.forEach(([name], i) => {
    ws.getColumn(i + 1).width = name.length > 24 ? 22 : Math.max(9, Math.min(22, name.length + 2))
  })
  ws.getColumn(MEC['Exclusion Reason']).width = 40
  ws.getColumn(MEC['KOL Keyword Haystack']).width = 46
  ws.getColumn(MEC['KOL Topic Haystack']).width = 40
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + N_KOL * N_BRAND, column: SPAN } }

  const lastRow = ME_FIRST + N_KOL * N_BRAND - 1
  ws.addConditionalFormatting({
    ref: `${A(MEC['Final Match Score'])}${ME_FIRST}:${A(MEC['Final Match Score'])}${lastRow}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 40 }, { type: 'num', value: 70 }, { type: 'num', value: 95 }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  for (const [col, rules] of [
    [MEC['Match Level'], [
      ['Excellent', 'FFBBF7D0', 'FF14532D'], ['Strong', 'FFDCFCE7', 'FF166534'],
      ['Good', 'FFFEF9C3', 'FF854D0E'], ['Moderate', 'FFFEF3C7', 'FF92400E'],
      ['Low', 'FFFEE2E2', 'FF991B1B'],
    ]],
    [MEC['Hard Filter Result'], [['EXCLUDED', 'FFFEE2E2', 'FF991B1B'], ['PASS', 'FFDCFCE7', 'FF166534']]],
    [MEC['Risk Flag'], [['High', 'FFFEE2E2', 'FF991B1B'], ['Medium', 'FFFEF3C7', 'FF92400E']]],
    [MEC.Confidence, [['Limited', 'FFFEE2E2', 'FF991B1B'], ['Medium', 'FFFEF3C7', 'FF92400E']]],
  ]) {
    ws.addConditionalFormatting({
      ref: `${A(col)}${ME_FIRST}:${A(col)}${lastRow}`,
      rules: rules.map(([text, bg, fg], i) => ({
        type: 'containsText', operator: 'containsText', text, priority: i + 1,
        style: { fill: fillOf(bg), font: { bold: true, color: { argb: fg } } },
      })),
    })
  }
  return ws
}

function writeEngineRow(ws, r, kr, bcol, bIdx) {
  const put = (name, value, fmt) => {
    const c = ws.getCell(r, MEC[name])
    c.value = value
    c.font = { ...BASE, size: 9 }
    c.border = bd()
    if (fmt) c.numFmt = fmt
    return c
  }
  const B = key => bp(key, bcol)
  const Kd = name => kd(name, kr)
  const M = name => me(name, r)

  /* key columns — read through from the two input sheets, never retyped */
  put('Brand ID', BRANDS[bIdx].brand_id).font = { ...BASE, size: 9, bold: true }
  put('Brand', F(`=${B('brand_name')}`))
  put('KOL ID', F(`=${Kd('KOL ID')}`))
  put('Creator', F(`=${Kd('Creator Name')}`))
  put('Handle', F(`=${Kd('Handle')}`))
  put('Platform', F(`=${Kd('Platform')}`))
  put('Category', F(`=${Kd('Category')}`))
  put('Tier', F(`=${Kd('Tier')}`))
  put('Followers', F(`=${Kd('Followers')}`), INT)
  put('Engagement Rate (%)', F(`=${Kd('Engagement Rate (%)')}`), PCT1)

  /* helpers */
  const subName = rangeA('Lookup_Lists', LK.SubName.col, LK.SubName.r1, LK.SubName.col, LK.SubName.r2)
  const subParent = rangeA('Lookup_Lists', LK.SubParent.col, LK.SubParent.r1, LK.SubParent.col, LK.SubParent.r2)
  put('Brand Product Parent Category', F(`=IFERROR(INDEX(${subParent},MATCH(${B('product_category')},${subName},0)),"")`))
  put('KOL Sub Parent Category', F(`=IFERROR(INDEX(${subParent},MATCH(${Kd('Sub Category')},${subName},0)),"")`))
  put('Brand Preferred Sub Parent', F(`=IFERROR(INDEX(${subParent},MATCH(${B('preferred_subcategory')},${subName},0)),"")`))
  put('Rel: Brand Product Parent → KOL Category',
    F(`=${mx('CAT_CAT', M('Brand Product Parent Category'), Kd('Category'), K.CAL_UNRELATED)}`), SCORE_FMT)
  put('Rel: Preferred Category → KOL Category',
    F(`=${mx('CAT_CAT', B('preferred_category'), Kd('Category'), K.CAL_UNRELATED)}`), SCORE_FMT)
  put('KOL Keyword Haystack',
    F(`=${Kd('Content Topics')}&", "&${Kd('Audience Interests')}&", "&${Kd('Sub Category')}&", "&${Kd('Category')}`))
  put('KOL Topic Haystack', F(`=${Kd('Content Topics')}&", "&${Kd('Audience Interests')}`))

  /* 1. Brand & Business Relevance — 20% */
  put('Industry Match',
    F(`=${mx('IND_CAT', B('industry'), Kd('Category'), K.CAL_UNRELATED)}`), SCORE_FMT)
  put('Category Match',
    F(`=IF(${Kd('Sub Category')}="",${M('Rel: Brand Product Parent → KOL Category')},`
      + `IF(${B('product_category')}=${Kd('Sub Category')},100,`
      + `IF(${M('Brand Product Parent Category')}=${Kd('Category')},80,`
      + `IF(${M('Rel: Brand Product Parent → KOL Category')}>=80,60,`
      + `IF(${M('Rel: Brand Product Parent → KOL Category')}>=60,40,${K.CAL_UNRELATED})))))`), SCORE_FMT)
  // Both keyword lists, averaged. Main Business Keywords say what the company
  // sells and Brand Keywords say how it talks about it; a creator who answers
  // one and not the other is a partial answer, not a full one.
  put('Keyword Match',
    F(`=ROUND((${overlap('business_keywords', bcol, M('KOL Keyword Haystack'))}`
      + `+${overlap('brand_keywords', bcol, M('KOL Keyword Haystack'))})/2,0)`), SCORE_FMT)
  put('Brand & Business Relevance',
    F(`=ROUND((${M('Industry Match')}*${K.W_BB_INDUSTRY}+${M('Category Match')}*${K.W_BB_CATEGORY}`
      + `+${M('Keyword Match')}*${K.W_BB_KEYWORD})/(${K.W_BB_INDUSTRY}+${K.W_BB_CATEGORY}+${K.W_BB_KEYWORD}),0)`), SCORE_FMT)

  /* 2. Target Audience Relevance — 30% */
  const ageRange = `${kd('Audience Age 13–17 %', kr)}:${kd('Audience Age 45+ %', kr)}`
  const ageList = listRef('AgeBand')
  const pri = `IFERROR(INDEX(${ageRange},1,MATCH(${B('primary_age_range')},${ageList},0)),0)`
  const sec = `IFERROR(INDEX(${ageRange},1,MATCH(${B('secondary_age_range')},${ageList},0)),0)`
  put('Age Match Score',
    F(`=IF(${B('primary_age_range')}="",${K.CAL_NEUTRAL},`
      + `MIN(100,ROUND((${pri}+0.5*${sec})/${K.CAL_AGE_TARGET}*100,0)))`), SCORE_FMT)
  put('Gender Match Score',
    F(`=IF(OR(${B('gender_majority')}="",${B('gender_majority')}="Any"),100,`
      + `IF(${B('gender_majority')}="Female",MIN(100,ROUND(${Kd('Female %')}/${K.CAL_GENDER_TARGET}*100,0)),`
      + `IF(${B('gender_majority')}="Male",MIN(100,ROUND(${Kd('Male %')}/${K.CAL_GENDER_TARGET}*100,0)),`
      + `MAX(0,ROUND(100-ABS(${Kd('Female %')}-50)*2,0)))))`), SCORE_FMT)
  const country = `IF(${B('target_country')}="",100,IF(${Kd('Audience Country')}=${B('target_country')},100,${K.CAL_UNRELATED}))`
  const region = `IF(OR(${B('target_region')}="",${B('target_region')}="Nasional"),100,`
    + `IF(${Kd('Audience Region')}="",${K.CAL_NEUTRAL},IF(${Kd('Audience Region')}=${B('target_region')},100,`
    + `IF(${Kd('Audience Country')}=${B('target_country')},40,${K.CAL_UNRELATED}))))`
  const city = `IF(OR(${B('target_city')}="",${B('target_city')}="Nasional"),100,`
    + `IF(${Kd('Audience City')}="",${K.CAL_NEUTRAL},IF(${Kd('Audience City')}=${B('target_city')},100,`
    + `IF(${Kd('Audience Region')}=${B('target_region')},60,${K.CAL_UNRELATED}))))`
  put('Location Match Score',
    F(`=ROUND((${country}*${K.W_LOC_COUNTRY}+${region}*${K.W_LOC_REGION}+${city}*${K.W_LOC_CITY})`
      + `/(${K.W_LOC_COUNTRY}+${K.W_LOC_REGION}+${K.W_LOC_CITY}),0)`), SCORE_FMT)
  put('Interest Match Score',
    F(`=${overlap('audience_interests', bcol, Kd('Audience Interests'))}`), SCORE_FMT)
  const wa = `Brand_Profile!$${bcol}$${WT.w_age}`
  const wg = `Brand_Profile!$${bcol}$${WT.w_gender}`
  const wl = `Brand_Profile!$${bcol}$${WT.w_location}`
  const wi = `Brand_Profile!$${bcol}$${WT.w_interest}`
  put('Target Audience Relevance',
    F(`=ROUND((${M('Age Match Score')}*${wa}+${M('Gender Match Score')}*${wg}`
      + `+${M('Location Match Score')}*${wl}+${M('Interest Match Score')}*${wi})`
      + `/MAX(1,${wa}+${wg}+${wl}+${wi}),0)`), SCORE_FMT)

  /* 3. Content & Category Relevance — 20% */
  put('Category Match (content)',
    F(`=IF(${B('preferred_category')}="",${K.CAL_NEUTRAL},${M('Rel: Preferred Category → KOL Category')})`), SCORE_FMT)
  put('Sub Category Match',
    F(`=IF(${B('preferred_subcategory')}="",${K.CAL_NEUTRAL},`
      + `IF(${B('preferred_subcategory')}=${Kd('Sub Category')},100,`
      + `IF(${M('Brand Preferred Sub Parent')}=${Kd('Category')},75,`
      + `IF(${M('Rel: Preferred Category → KOL Category')}>=80,${K.CAL_NEUTRAL},`
      + `IF(${M('Rel: Preferred Category → KOL Category')}>=60,35,${K.CAL_UNRELATED})))))`), SCORE_FMT)
  put('Topic Match',
    F(`=${overlap('preferred_content_topics', bcol, M('KOL Topic Haystack'))}`), SCORE_FMT)
  put('Content Style Match',
    F(`=IF(${B('preferred_content_style')}="",${K.CAL_NEUTRAL},`
      + `${mx('STYLE', B('preferred_content_style'), Kd('Content Style'), 45)})`), SCORE_FMT)
  put('Content & Category Relevance',
    F(`=ROUND((${M('Category Match (content)')}*${K.W_CC_CATEGORY}+${M('Sub Category Match')}*${K.W_CC_SUBCATEGORY}`
      + `+${M('Topic Match')}*${K.W_CC_TOPIC}+${M('Content Style Match')}*${K.W_CC_STYLE})`
      + `/(${K.W_CC_CATEGORY}+${K.W_CC_SUBCATEGORY}+${K.W_CC_TOPIC}+${K.W_CC_STYLE}),0)`), SCORE_FMT)

  /* 4. Brand Personality Fit — 10% */
  put('Personality Match',
    F(`=MIN(100,MAX(${mx('PERS', B('brand_personality'), Kd('Creator Personality'), 40)},`
      + `IF(${Kd('Creator Personality')}=${B('preferred_creator_personality')},95,0)))`), SCORE_FMT)
  put('Tone vs Content Style',
    F(`=${mx('TONE', B('brand_tone'), Kd('Content Style'), 45)}`), SCORE_FMT)
  put('Values Match',
    F(`=ROUND((${overlap('brand_values', bcol, Kd('Creator Values'))}`
      + `+${overlap('preferred_creator_values', bcol, Kd('Creator Values'))})/2,0)`), SCORE_FMT)
  put('Communication Style Match',
    F(`=${mx('COMM', B('communication_style'), Kd('Content Style'), 45)}`), SCORE_FMT)
  put('Brand Personality Fit',
    F(`=ROUND((${M('Personality Match')}*${K.W_BP_PERSONALITY}+${M('Tone vs Content Style')}*${K.W_BP_TONE}`
      + `+${M('Values Match')}*${K.W_BP_VALUES}+${M('Communication Style Match')}*${K.W_BP_COMM})`
      + `/(${K.W_BP_PERSONALITY}+${K.W_BP_TONE}+${K.W_BP_VALUES}+${K.W_BP_COMM}),0)`), SCORE_FMT)

  /* 5. Performance Quality — 10% */
  put('Engagement Rate Score',
    F(`=IF(${Kd('Engagement Rate (%)')}="",0,MIN(100,ROUND(${Kd('Engagement Rate (%)')}/${K.CAL_ER_TARGET}*100,0)))`), SCORE_FMT)
  put('Audience Quality Score',
    F(`=IF(${Kd('Audience Quality')}="",0,MIN(100,MAX(0,${Kd('Audience Quality')})))`), SCORE_FMT)
  put('Consistency Score',
    F(`=IF(${Kd('Consistency Score')}="",0,MIN(100,MAX(0,${Kd('Consistency Score')})))`), SCORE_FMT)
  put('Community Score',
    F(`=IF(${Kd('Community Score')}="",0,MIN(100,MAX(0,${Kd('Community Score')})))`), SCORE_FMT)
  put('Average Views Score',
    F(`=IF(OR(${Kd('Followers')}="",${Kd('Followers')}=0,${Kd('Average Views')}=""),0,`
      + `MIN(100,ROUND(${Kd('Average Views')}/${Kd('Followers')}/${K.CAL_VFR_TARGET}*100,0)))`), SCORE_FMT)
  put('Recent Growth Score',
    F(`=IF(${Kd('30D Growth (%)')}="",0,MIN(100,MAX(0,ROUND((${Kd('30D Growth (%)')}+2)/(${K.CAL_GROWTH_TARGET}+2)*100,0))))`), SCORE_FMT)
  put('Performance Quality',
    F(`=ROUND((${M('Engagement Rate Score')}*${K.W_PQ_ER}+${M('Audience Quality Score')}*${K.W_PQ_AUDIENCE}`
      + `+${M('Consistency Score')}*${K.W_PQ_CONSISTENCY}+${M('Community Score')}*${K.W_PQ_COMMUNITY}`
      + `+${M('Average Views Score')}*${K.W_PQ_VIEWS}+${M('Recent Growth Score')}*${K.W_PQ_GROWTH})`
      + `/(${K.W_PQ_ER}+${K.W_PQ_AUDIENCE}+${K.W_PQ_CONSISTENCY}+${K.W_PQ_COMMUNITY}+${K.W_PQ_VIEWS}+${K.W_PQ_GROWTH}),0)`), SCORE_FMT)

  /* 6. Brand Safety — 10% */
  put('Brand Safety Base',
    F(`=IF(${Kd('Brand Safety Score')}="",0,MIN(100,MAX(0,${Kd('Brand Safety Score')})))`), SCORE_FMT)
  put('Competitor Saturation', F(`=IF(${Kd('Competitor Saturation')}="",0,${Kd('Competitor Saturation')})`), SCORE_FMT)
  put('Risk Flag', F(`=IF(${Kd('Risk Flag')}="","None",${Kd('Risk Flag')})`))
  put('Risk Multiplier',
    F(`=IF(${M('Risk Flag')}="High",${K.RISK_HIGH},IF(${M('Risk Flag')}="Medium",${K.RISK_MEDIUM},`
      + `IF(${M('Risk Flag')}="Low",${K.RISK_LOW},${K.RISK_NONE})))`), '0.00')
  put('Brand Safety',
    F(`=ROUND(MIN(100,MAX(0,(${M('Brand Safety Base')}*${K.W_BS_BASE}+(100-${M('Competitor Saturation')})*${K.W_BS_SATURATION})`
      + `/(${K.W_BS_BASE}+${K.W_BS_SATURATION})*${M('Risk Multiplier')})),0)`), SCORE_FMT)

  /* result */
  const wsum = `(${K.W_BRAND_BUSINESS}+${K.W_TARGET_AUDIENCE}+${K.W_CONTENT_CATEGORY}+${K.W_PERSONALITY}+${K.W_PERFORMANCE}+${K.W_SAFETY})`
  const final = put('Final Match Score',
    F(`=ROUND((${M('Brand & Business Relevance')}*${K.W_BRAND_BUSINESS}+${M('Target Audience Relevance')}*${K.W_TARGET_AUDIENCE}`
      + `+${M('Content & Category Relevance')}*${K.W_CONTENT_CATEGORY}+${M('Brand Personality Fit')}*${K.W_PERSONALITY}`
      + `+${M('Performance Quality')}*${K.W_PERFORMANCE}+${M('Brand Safety')}*${K.W_SAFETY})/MAX(1,${wsum}),0)`), SCORE_FMT)
  final.font = { ...BASE, size: 10, bold: true }
  put('Match Level',
    F(`=IF(${M('Final Match Score')}>=${K.BAND_EXCELLENT},"Excellent Match",`
      + `IF(${M('Final Match Score')}>=${K.BAND_STRONG},"Strong Match",`
      + `IF(${M('Final Match Score')}>=${K.BAND_GOOD},"Good Match",`
      + `IF(${M('Final Match Score')}>=${K.BAND_MODERATE},"Moderate Match","Low Match"))))`))
  put('Data Completeness %', F(`=${Kd('Data Completeness %')}`), SCORE_FMT)
  put('Confidence',
    F(`=IF(${M('Data Completeness %')}>=${K.CONF_HIGH},"High",`
      + `IF(${M('Data Completeness %')}>=${K.CONF_MEDIUM},"Medium","Limited Data"))`))
  put('Brand Fit Index',
    F(`=ROUND((${M('Brand & Business Relevance')}+${M('Content & Category Relevance')}+${M('Brand Personality Fit')})/3,0)`), SCORE_FMT)
  put('Opportunity Score',
    F(`=ROUND(((100-${M('Competitor Saturation')})*${K.W_OP_HEADROOM}`
      + `+IF(${Kd('Cost Efficiency')}="",${K.CAL_NEUTRAL},${Kd('Cost Efficiency')})*${K.W_OP_COST}`
      + `+${M('Recent Growth Score')}*${K.W_OP_GROWTH}+${M('Engagement Rate Score')}*${K.W_OP_ER})`
      + `/(${K.W_OP_HEADROOM}+${K.W_OP_COST}+${K.W_OP_GROWTH}+${K.W_OP_ER}),0)`), SCORE_FMT)

  /* hard filters — the reason is computed first, the verdict reads from it */
  put('Exclusion Reason',
    F(`=IF(ISERROR(SEARCH(${Kd('Platform')},${B('preferred_platform')})),"Platform not in Preferred Platform",`
      + `IF(AND(${B('preferred_followers_min')}>0,${Kd('Followers')}<${B('preferred_followers_min')}),"Followers below Preferred Follower Range",`
      + `IF(AND(${B('preferred_followers_max')}>0,${Kd('Followers')}>${B('preferred_followers_max')}),"Followers above Preferred Follower Range",`
      + `IF(AND(${B('min_engagement_rate')}>0,IF(${Kd('Engagement Rate (%)')}="",0,${Kd('Engagement Rate (%)')})<${B('min_engagement_rate')}),"Engagement Rate below Minimum Engagement Rate",`
      + `IF(ISERROR(SEARCH(${Kd('Tier')},${B('preferred_tier')})),"Tier not in Preferred Tier",`
      + `IF(AND(${B('min_audience_quality')}>0,${M('Audience Quality Score')}<${B('min_audience_quality')}),"Audience Quality below Minimum Audience Quality",`
      + `IF(AND(${B('min_brand_safety')}>0,${M('Brand Safety Base')}<${B('min_brand_safety')}),"Brand Safety below Minimum Brand Safety",`
      + `IF(AND(${B('country_hard_filter')}="Yes",${Kd('Audience Country')}<>${B('target_country')}),"Audience Country does not match Target Country",`
      + `IF(AND(${B('category_hard_filter')}="Yes",${Kd('Category')}<>${B('preferred_category')}),"Category is not the Preferred Category",`
      + `IF(AND(${B('max_competitor_saturation')}>0,${M('Competitor Saturation')}>${B('max_competitor_saturation')}),"Competitor Saturation above Max Competitor Saturation",`
      + `IF(AND(${B('exclude_already_selected')}="Yes",${Kd('Already Selected')}="Yes"),"Already Selected",`
      + `IF(AND(${B('exclude_in_cart')}="Yes",${Kd('In Cart')}="Yes"),"Already in Cart",`
      + `IF(AND(${B('exclude_existing_partner')}="Yes",${Kd('Existing Partner')}="Yes"),"Existing Partner",`
      + `IF(AND(${B('exclude_excluded_creator')}="Yes",${Kd('Excluded Creator')}="Yes"),"Excluded Creator",`
      + `IF(AND(${B('min_brand_match')}>0,${M('Final Match Score')}<${B('min_brand_match')}),"Brand Match below Minimum Brand Match",`
      + `"")))))))))))))))`))
  put('Hard Filter Result', F(`=IF(${M('Exclusion Reason')}="","PASS","EXCLUDED")`))
  put('Recommendation',
    F(`=IF(${M('Hard Filter Result')}="EXCLUDED","Excluded",`
      + `IF(${M('Final Match Score')}>=${K.REC_HIGH},"Highly Recommended",`
      + `IF(${M('Final Match Score')}>=${K.REC_MID},"Recommended",`
      + `IF(${M('Final Match Score')}>=${K.REC_LOW},"Consider","Low Priority"))))`))
  // Blank rather than 0 for an excluded creator, so the per-brand roll-ups on
  // Sample_Brands can AVERAGE and MAX over eligible creators without a COUNTIFS
  // dance — a zero would drag the average down and read as a real score.
  put('Final Match Score (eligible only)',
    F(`=IF(${M('Hard Filter Result')}="PASS",${M('Final Match Score')},"")`), SCORE_FMT)
  put('Match Key', F(`=${M('Brand ID')}&"|"&${M('KOL ID')}`))
}

export { buildBrandProfile, buildKolDatabase, buildMatchingEngine, BR, TOK, WT, KC, kd, MEC, me, meRange, BRAND_COLS, KOL_FIRST, ME_FIRST, N_KOL, N_BRAND, ACTIVE_BRAND, bpActive, overlap }
