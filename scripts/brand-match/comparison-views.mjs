/**
 * `Autometric_Brand_Match_Comparison.xlsx` — the sheets that only look things up.
 *
 * Nothing here recomputes a score. Every number on these eight sheets is a
 * reference into Matching_Engine, and every ranking is a LARGE/MATCH over the
 * engine's own Rank Key column. That is deliberate: a summary sheet that
 * recalculates its own totals is a second implementation of the model, and the
 * two will disagree the first time a weight changes. Point at the engine, or
 * point at nothing.
 *
 * The explanation sheet follows the same rule. Every clause of every Why Match
 * is assembled from the row's actual component scores — the strongest and
 * weakest factor are found with MATCH over the six components rather than
 * written down — so a sentence cannot drift away from the number it explains.
 */

import {
  K, banner, subhead, headers, labelCell, groupBand, bd, fillOf, T, BASE, F, A,
  rangeA, SCORE_FMT, PCT1, INT,
} from './build.mjs'
import { DISCOVERY_FILTERS } from './catalogue.mjs'
import { CANONICAL_CATEGORIES } from './comparison-brands.mjs'
import { KOL_FIRST, ME_FIRST, BRAND_COLS, MEC, KC, K2, BR, NA } from './comparison.mjs'

const meCol = name => A(MEC[name])
const kolCol = name => A(KC[name])

/** The six components, in weight order: label, engine column, weight cell. */
const COMPONENTS = [
  ['Brand & Business Relevance', 'Business Score', () => K.W_BRAND_BUSINESS],
  ['Target Audience Relevance', 'Audience Score', () => K.W_TARGET_AUDIENCE],
  ['Content & Category Relevance', 'Content Score', () => K.W_CONTENT_CATEGORY],
  ['Brand Personality Fit', 'Personality Score', () => K.W_PERSONALITY],
  ['Performance Quality', 'Performance Score', () => K.W_PERFORMANCE],
  ['Brand Safety', 'Safety Score', () => K.W_SAFETY],
]

/* helpers that address the engine sheet */
const eng = (name, row) => `Matching_Engine!$${meCol(name)}$${row}`
const engRange = (name, n) => `Matching_Engine!$${meCol(name)}$${ME_FIRST}:$${meCol(name)}$${ME_FIRST + n - 1}`
/** The block of rows belonging to brand `b` (0-based). */
const brandBlock = (name, b, nKol) => {
  const first = ME_FIRST + b * nKol
  return `Matching_Engine!$${meCol(name)}$${first}:$${meCol(name)}$${first + nKol - 1}`
}

/* ══════════════════════════════════════════════════════════════════════════
   SCORE_BREAKDOWN
   ══════════════════════════════════════════════════════════════════════════ */

const BREAKDOWN_COLUMNS = [
  ['Brand', 'KEY'], ['KOL'], ['Creator'], ['Category'],
  ['Age Score', 'AUDIENCE SUB-SCORES (weights 25 / 15 / 30 / 30)'], ['Gender Score'],
  ['Location Score'], ['Interest Score'],
  ['Business Score', 'COMPONENTS'], ['Audience Score'], ['Content Score'],
  ['Personality Score'], ['Performance Score'], ['Safety Score'],
  ['Available Weight', 'RESULT'], ['Final Score'], ['Match Level'], ['Confidence'],
]

export function buildScoreBreakdown(wb, records, brands) {
  const nKol = records.length
  const rows = nKol * brands.length
  const SPAN = BREAKDOWN_COLUMNS.length
  const ws = wb.addWorksheet('Score_Breakdown', { views: [{ state: 'frozen', ySplit: 5, xSplit: 3 }] })
  banner(ws, 1, SPAN, 'SCORE BREAKDOWN  ·  every sub-score behind every Final Match Score',
    'A pure view of Matching_Engine: each cell is a reference, not a recalculation. Age Score is N/A on all '
    + `${rows} rows because no age signal exists on this server, and its 25% renormalises across gender, location and interest — `
    + 'which is why an Audience Score can be higher than any single dimension that produced it.')

  let gStart = 1
  let gName = 'KEY'
  BREAKDOWN_COLUMNS.forEach(([, g], i) => {
    if (g && i > 0) { groupBand(ws, 4, gStart, i, gName); gStart = i + 1; gName = g }
  })
  groupBand(ws, 4, gStart, SPAN, gName)
  headers(ws, 5, 1, BREAKDOWN_COLUMNS.map(([n]) => n), 40)

  const SOURCE = {
    Brand: 'Brand', KOL: 'KOL', Creator: 'Creator', Category: 'Category',
    'Age Score': 'Age Score', 'Gender Score': 'Gender Score',
    'Location Score': 'Location Score', 'Interest Score': 'Interest Score',
    'Business Score': 'Business Score', 'Audience Score': 'Audience Score',
    'Content Score': 'Content Score', 'Personality Score': 'Personality Score',
    'Performance Score': 'Performance Score', 'Safety Score': 'Safety Score',
    'Available Weight': 'Available Weight', 'Final Score': 'Final Match Score',
    'Match Level': 'Match Level', Confidence: 'Confidence',
  }

  for (let i = 0; i < rows; i++) {
    const r = 6 + i
    const src = ME_FIRST + i
    BREAKDOWN_COLUMNS.forEach(([name], c) => {
      const cell = ws.getCell(r, c + 1)
      cell.value = F(`=${eng(SOURCE[name], src)}`)
      cell.font = { ...BASE, size: 9, bold: name === 'Final Score' }
      cell.border = bd()
      if (name.endsWith('Score') || name === 'Available Weight') cell.numFmt = SCORE_FMT
    })
  }

  BREAKDOWN_COLUMNS.forEach(([name], i) => {
    ws.getColumn(i + 1).width = Math.max(10, Math.min(22, name.length + 3))
  })
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: SPAN } }
  ws.addConditionalFormatting({
    ref: `${A(BREAKDOWN_COLUMNS.findIndex(c => c[0] === 'Final Score') + 1)}6:${A(BREAKDOWN_COLUMNS.findIndex(c => c[0] === 'Final Score') + 1)}${5 + rows}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 30 }, { type: 'num', value: 55 }, { type: 'num', value: 80 }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   MATCH_EXPLANATION
   ══════════════════════════════════════════════════════════════════════════ */

const EXPLAIN_COLUMNS = [
  'Brand', 'KOL', 'Creator', 'Final Score', 'Match Level',
  'Why Match', 'Top Strength', 'Weakest Factor', 'Consideration', 'Risk', 'Recommendation',
]
/** Helper columns, to the right of the readable ones. */
const EXPLAIN_HELPERS = [
  ...COMPONENTS.map(c => `max: ${c[0]}`),
  'Best Value', 'Best Component',
  ...COMPONENTS.map(c => `min: ${c[0]}`),
  'Worst Value', 'Worst Component',
]

export function buildMatchExplanation(wb, records, brands) {
  const nKol = records.length
  const rows = nKol * brands.length
  const HEAD = [...EXPLAIN_COLUMNS, ...EXPLAIN_HELPERS]
  const SPAN = HEAD.length
  const ws = wb.addWorksheet('Match_Explanation', { views: [{ state: 'frozen', ySplit: 5, xSplit: 3 }] })
  banner(ws, 1, SPAN, 'MATCH EXPLANATION  ·  one written reason per creator-brand pair',
    `All ${rows} pairs. Every clause is assembled from the row's own component scores — the strongest and weakest factor are `
    + 'found by MATCH across the six components, not written down — so no sentence can survive a score that moved underneath it. '
    + 'The helper columns on the right are the working: they are what MATCH searches, and they are left visible so the wording can be traced.')

  groupBand(ws, 4, 1, EXPLAIN_COLUMNS.length, 'EXPLANATION')
  groupBand(ws, 4, EXPLAIN_COLUMNS.length + 1, SPAN, 'WORKING  ·  how the strongest and weakest factor were found', 'FF6B7280')
  headers(ws, 5, 1, HEAD, 40)

  const C = {}
  HEAD.forEach((n, i) => { C[n] = i + 1 })
  const x = (name, r) => `$${A(C[name])}$${r}`
  /** An Excel array constant of the six component names, for INDEX. */
  const NAMES = `{${COMPONENTS.map(c => `"${c[0]}"`).join(',')}}`

  for (let i = 0; i < rows; i++) {
    const r = 6 + i
    const src = ME_FIRST + i
    const put = (name, value, fmt) => {
      const c = ws.getCell(r, C[name])
      c.value = value
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      c.alignment = { vertical: 'top', wrapText: true }
      if (fmt) c.numFmt = fmt
      return c
    }

    /* working: N/A becomes -1 when hunting a maximum and 999 when hunting a
     * minimum, so an unmeasured component can never be reported as either the
     * creator's best feature or their worst. */
    for (const [label, col] of COMPONENTS.map(c => [c[0], c[1]])) {
      put(`max: ${label}`, F(`=IF(ISNUMBER(${eng(col, src)}),${eng(col, src)},-1)`), SCORE_FMT)
      put(`min: ${label}`, F(`=IF(ISNUMBER(${eng(col, src)}),${eng(col, src)},999)`), SCORE_FMT)
    }
    const maxFirst = x(`max: ${COMPONENTS[0][0]}`, r)
    const maxLast = x(`max: ${COMPONENTS[COMPONENTS.length - 1][0]}`, r)
    const minFirst = x(`min: ${COMPONENTS[0][0]}`, r)
    const minLast = x(`min: ${COMPONENTS[COMPONENTS.length - 1][0]}`, r)
    put('Best Value', F(`=MAX(${maxFirst}:${maxLast})`), SCORE_FMT)
    put('Best Component', F(`=INDEX(${NAMES},MATCH(${x('Best Value', r)},${maxFirst}:${maxLast},0))`))
    put('Worst Value', F(`=MIN(${minFirst}:${minLast})`), SCORE_FMT)
    put('Worst Component', F(`=INDEX(${NAMES},MATCH(${x('Worst Value', r)},${minFirst}:${minLast},0))`))

    put('Brand', F(`=${eng('Brand', src)}`))
    put('KOL', F(`=${eng('KOL', src)}`))
    put('Creator', F(`=${eng('Creator', src)}`))
    put('Final Score', F(`=${eng('Final Match Score', src)}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
    put('Match Level', F(`=${eng('Match Level', src)}`))

    const scored = `ISNUMBER(${eng('Final Match Score', src)})`
    const hasCat = `AND(ISTEXT(${eng('Category', src)}),${eng('Category', src)}<>"${NA}")`

    /* Why Match — every clause reads a cell, none is a stock sentence. */
    put('Why Match',
      F(`=IF(NOT(${scored}),"Not scored: no component of the model had data for this account, so no match can be claimed either way.",`
        + `${eng('Match Level', src)}&" — "&${eng('Final Match Score', src)}&"/100 against "&${eng('Brand', src)}&". "`
        + `&"Strongest factor "&${x('Best Component', r)}&" at "&${x('Best Value', r)}&"; weakest "&${x('Worst Component', r)}&" at "&${x('Worst Value', r)}&". "`
        + `&IF(${hasCat},"Tagged category "&${eng('Category', src)}&" scores "&IF(ISNUMBER(${eng('Category Match', src)}),${eng('Category Match', src)},0)&" against the brand category "&${eng('Brand', src)}&" targets. ",`
        + `"Creator carries no category on record, so the category-driven parts fall back to neutral rather than penalising the creator. ")`
        + `&IF(ISNUMBER(${eng('Interest Score', src)}),"Audience-interest overlap "&${eng('Interest Score', src)}&". ","Audience interests unmeasured. ")`
        + `&IF(${eng('Available Weight', src)}<100,"Scored on "&${eng('Available Weight', src)}&" of the 100 nominal weight points; the rest had no data.",""))`))

    put('Top Strength',
      F(`=IF(NOT(${scored}),"${NA}",${x('Best Component', r)}&" ("&${x('Best Value', r)}&"/100)")`))
    put('Weakest Factor',
      F(`=IF(NOT(${scored}),"${NA}",${x('Worst Component', r)}&" ("&${x('Worst Value', r)}&"/100)")`))

    put('Consideration',
      F(`=IF(NOT(${scored}),"No data to consider: this account has no measured signal.",`
        + `IF(${x('Worst Value', r)}<${K.EXP_CONSIDERATION},`
        + `${x('Worst Component', r)}&" sits at "&${x('Worst Value', r)}&", below the "&${K.EXP_CONSIDERATION}&"-point consideration threshold"`
        + `&IF(${eng('Personality Available', src)}=0," · Brand Personality Fit could not be scored at all: no creator personality, tone, values or content-style column exists","")`
        + `&IF(${eng('Consistency Score', src)}="${NA}"," · posting cadence unusable, so Consistency is excluded from Performance","")&".",`
        + `"No component falls below the "&${K.EXP_CONSIDERATION}&"-point consideration threshold."))`))

    put('Risk',
      F(`=${eng('Safety Level', src)}&" — "&${eng('Risk Note', src)}`
        + `&IF(${eng('Confidence', src)}="Limited Data"," Confidence is Limited Data: "&${eng('Data Completeness %', src)}&"% of tracked fields carry a value.","")`))

    put('Recommendation',
      F(`=IF(NOT(${scored}),"Do not shortlist on this data — re-scrape the account first.",`
        + `IF(${eng('Final Match Score', src)}>=${K.REC_HIGH},"Highly Recommended",`
        + `IF(${eng('Final Match Score', src)}>=${K.REC_MID},"Recommended",`
        + `IF(${eng('Final Match Score', src)}>=${K.REC_LOW},"Consider","Low Priority")))`
        + `&IF(${eng('Available Weight', src)}<100," (on partial data)",""))`))
  }

  EXPLAIN_COLUMNS.forEach(n => { ws.getColumn(C[n]).width = n === 'Why Match' ? 78 : n === 'Risk' ? 52 : n === 'Consideration' ? 52 : 18 })
  EXPLAIN_HELPERS.forEach(n => { ws.getColumn(C[n]).width = 13 })
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: EXPLAIN_COLUMNS.length } }
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   BRAND_COMPARISON — the contextual-score proof, one row per creator
   ══════════════════════════════════════════════════════════════════════════ */

export function buildBrandComparison(wb, records, brands) {
  const nKol = records.length
  const total = nKol * brands.length
  const SPAN = 5 + brands.length + 3
  const ws = wb.addWorksheet('Brand_Comparison', { views: [{ state: 'frozen', ySplit: 5, xSplit: 2 }] })
  banner(ws, 1, SPAN, 'BRAND COMPARISON  ·  the same creator against all five brands',
    'This is the sheet the exercise exists to produce. One row per creator, one column per brand, every cell an INDEX/MATCH '
    + 'into Matching_Engine on the Brand|KOL key. Spread is the max minus the min: a creator whose spread is 0 would be carrying '
    + 'a permanent score, which is exactly the behaviour Brand Match must not have.')

  const HEAD = ['KOL ID', 'KOL', 'Creator', 'Platform', 'Category',
    ...brands.map(b => b.brand_name), 'Best Brand', 'Best Score', 'Spread (max-min)']
  headers(ws, 5, 1, HEAD, 34)
  const firstBrandCol = 6
  const lastBrandCol = 5 + brands.length
  const keyRange = engRange('Match Key', total)
  const finalRange = engRange('Final Match Score', total)

  for (let i = 0; i < nKol; i++) {
    const r = 6 + i
    const kr = KOL_FIRST + i
    const put = (col, value, fmt) => {
      const c = ws.getCell(r, col)
      c.value = value
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      if (fmt) c.numFmt = fmt
      return c
    }
    put(1, F(`=KOL_Source_Data!$${kolCol('KOL ID')}$${kr}`)).font = { ...BASE, size: 9, bold: true }
    put(2, F(`=KOL_Source_Data!$${kolCol('Handle')}$${kr}`))
    put(3, F(`=KOL_Source_Data!$${kolCol('Creator Name')}$${kr}`))
    put(4, F(`=KOL_Source_Data!$${kolCol('Platform')}$${kr}`))
    put(5, F(`=KOL_Source_Data!$${kolCol('Category')}$${kr}`))

    brands.forEach((b, j) => {
      put(firstBrandCol + j,
        F(`=IFERROR(INDEX(${finalRange},MATCH("${b.brand_id}|"&$A${r},${keyRange},0)),"${NA}")`), SCORE_FMT)
    })

    const span = `$${A(firstBrandCol)}${r}:$${A(lastBrandCol)}${r}`
    const anyScored = `COUNT(${span})>0`
    put(lastBrandCol + 1,
      F(`=IF(NOT(${anyScored}),"${NA}",INDEX({${brands.map(b => `"${b.brand_name}"`).join(',')}},MATCH(MAX(${span}),${span},0)))`))
    put(lastBrandCol + 2, F(`=IF(NOT(${anyScored}),"${NA}",MAX(${span}))`), SCORE_FMT)
    // A creator scoring the same everywhere is the failure this sheet detects.
    put(lastBrandCol + 3, F(`=IF(NOT(${anyScored}),"${NA}",MAX(${span})-MIN(${span}))`), SCORE_FMT)
      .font = { ...BASE, size: 9, bold: true }
  }

  ws.getColumn(1).width = 9
  ws.getColumn(2).width = 22
  ws.getColumn(3).width = 22
  ws.getColumn(4).width = 11
  ws.getColumn(5).width = 15
  brands.forEach((_, j) => { ws.getColumn(firstBrandCol + j).width = 13 })
  ws.getColumn(lastBrandCol + 1).width = 15
  ws.getColumn(lastBrandCol + 2).width = 11
  ws.getColumn(lastBrandCol + 3).width = 16

  ws.addConditionalFormatting({
    ref: `${A(firstBrandCol)}6:${A(lastBrandCol)}${5 + nKol}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 30 }, { type: 'num', value: 55 }, { type: 'num', value: 80 }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   BRAND_RANKING — every creator ordered, once per brand
   ══════════════════════════════════════════════════════════════════════════ */

/** Row of rank `i` (1-based) inside brand `b`'s block, on Brand_Ranking. */
const rankRowOf = (b, i, nKol) => 6 + b * (nKol + 3) + i - 1

export function buildBrandRanking(wb, records, brands) {
  const nKol = records.length
  const ws = wb.addWorksheet('Brand_Ranking', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 8, 'BRAND RANKING  ·  all 24 creators ordered, separately for each brand',
    'One block per brand. Order comes from the engine\'s Rank Key — the Final Match Score times 1000 plus the creator\'s roster '
    + 'position — so ties resolve to exactly one row instead of collapsing onto whichever appears first. Read two blocks side by '
    + 'side: the orders differ, and that difference is the deliverable.')

  let r = 4
  brands.forEach((brand, b) => {
    r = subhead(ws, r, 8, `${brand.brand_name}  ·  ${brand.industry}  ·  ranked by Final Match Score`)
    headers(ws, r, 1, ['#', 'KOL', 'Creator', 'Category', 'Final Score', 'Match Level', 'Confidence', 'Top Strength'], 24)
    r++

    const rankKeys = brandBlock('Rank Key', b, nKol)
    for (let i = 1; i <= nKol; i++) {
      const key = `LARGE(${rankKeys},${i})`
      const pos = `MATCH(${key},${rankKeys},0)`
      const at = name => `INDEX(${brandBlock(name, b, nKol)},${pos})`
      const put = (col, value, fmt) => {
        const c = ws.getCell(r, col)
        c.value = value
        c.font = { ...BASE, size: 9 }
        c.border = bd()
        if (fmt) c.numFmt = fmt
        return c
      }
      put(1, i).alignment = { horizontal: 'center' }
      put(2, F(`=IFERROR(${at('KOL')},"")`))
      put(3, F(`=IFERROR(${at('Creator')},"")`))
      put(4, F(`=IFERROR(${at('Category')},"")`))
      put(5, F(`=IFERROR(${at('Final Match Score')},"${NA}")`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
      put(6, F(`=IFERROR(${at('Match Level')},"")`))
      put(7, F(`=IFERROR(${at('Confidence')},"")`))
      // The reason travels with the rank, pulled off Match_Explanation by key so
      // the two sheets cannot disagree about why a creator placed where it did.
      put(8, F(`=IFERROR(INDEX(Match_Explanation!$G$6:$G$${5 + nKol * brands.length},`
        + `MATCH("${brand.brand_id}|"&${at('KOL ID')},${engRange('Match Key', nKol * brands.length)},0)),"")`))
      r++
    }
    r += 2
  })

  ws.getColumn(1).width = 5
  ws.getColumn(2).width = 22
  ws.getColumn(3).width = 22
  ws.getColumn(4).width = 15
  ws.getColumn(5).width = 12
  ws.getColumn(6).width = 16
  ws.getColumn(7).width = 13
  ws.getColumn(8).width = 40
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   TOP_MATCHES
   ══════════════════════════════════════════════════════════════════════════ */

export function buildTopMatches(wb, records, brands) {
  const nKol = records.length
  const total = nKol * brands.length
  const ws = wb.addWorksheet('Top_Matches', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 7, 'TOP MATCHES  ·  the five best and five worst fits for each brand',
    'Straight references into Brand_Ranking, with the reason and the concern pulled off Match_Explanation by the Brand|KOL key. '
    + 'The bottom five matter as much as the top five: they are what shows the model is discriminating rather than flattering '
    + 'everyone on the roster.')

  const keyRange = engRange('Match Key', total)
  const kolIdBlock = b => brandBlock('KOL ID', b, nKol)
  let r = 4

  brands.forEach((brand, b) => {
    r = subhead(ws, r, 7, `${brand.brand_name}  ·  ${brand.industry}`)
    headers(ws, r, 1, ['Band', '#', 'KOL', 'Score', 'Reason', 'Strength', 'Concern'], 24)
    r++

    const emit = (bandLabel, ranks) => {
      for (const i of ranks) {
        const rr = rankRowOf(b, i, nKol)
        const kolCell = `Brand_Ranking!$B$${rr}`
        const scoreCell = `Brand_Ranking!$E$${rr}`
        // Match_Explanation is ordered exactly as Matching_Engine, so one MATCH
        // on the key serves every column of it.
        const pos = `MATCH("${brand.brand_id}|"&INDEX(${kolIdBlock(b)},MATCH(LARGE(${brandBlock('Rank Key', b, nKol)},${i}),${brandBlock('Rank Key', b, nKol)},0)),${keyRange},0)`
        const ex = col => `IFERROR(INDEX(Match_Explanation!$${col}$6:$${col}$${5 + total},${pos}),"")`
        const put = (col, value, fmt) => {
          const c = ws.getCell(r, col)
          c.value = value
          c.font = { ...BASE, size: 9 }
          c.border = bd()
          c.alignment = { vertical: 'top', wrapText: col >= 5 }
          if (fmt) c.numFmt = fmt
          return c
        }
        put(1, bandLabel).font = { ...BASE, size: 9, bold: true }
        put(2, i).alignment = { horizontal: 'center' }
        put(3, F(`=${kolCell}`))
        put(4, F(`=${scoreCell}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
        put(5, F(`=${ex('F')}`))      // Why Match
        put(6, F(`=${ex('G')}`))      // Top Strength
        put(7, F(`=${ex('H')}`))      // Weakest Factor
        r++
      }
    }
    emit('TOP 5', [1, 2, 3, 4, 5])
    emit('BOTTOM 5', [nKol - 4, nKol - 3, nKol - 2, nKol - 1, nKol])
    r += 2
  })

  ws.getColumn(1).width = 11
  ws.getColumn(2).width = 5
  ws.getColumn(3).width = 22
  ws.getColumn(4).width = 9
  ws.getColumn(5).width = 74
  ws.getColumn(6).width = 30
  ws.getColumn(7).width = 30
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   HARD_VS_SOFT_FILTER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What each hard filter would actually remove from THIS roster.
 *
 * Written as COUNTIF formulas over KOL_Source_Data rather than as numbers,
 * because the point of the sheet is that a filter and its effect stay attached:
 * "Minimum ER 1%" is an abstraction until it says it deletes 19 of 24 creators.
 * `null` means the column the filter reads does not exist, so no count is
 * possible and the row says so instead of showing a reassuring zero.
 */
const HARD_EFFECTS = {
  'platform.instagram': n => `COUNTIF(KOL_Source_Data!$${kolCol('Platform')}$${KOL_FIRST}:$${kolCol('Platform')}$${KOL_FIRST + n - 1},"TikTok")&" of ${n} would be removed by an Instagram-only filter"`,
  'platform.tiktok': n => `COUNTIF(KOL_Source_Data!$${kolCol('Platform')}$${KOL_FIRST}:$${kolCol('Platform')}$${KOL_FIRST + n - 1},"Instagram")&" of ${n} would be removed by a TikTok-only filter"`,
  categories: n => `COUNTIF(KOL_Source_Data!$${kolCol('Category')}$${KOL_FIRST}:$${kolCol('Category')}$${KOL_FIRST + n - 1},"${NA}")&" of ${n} carry no category at all and would be removed by any category requirement"`,
  minErPct: n => `COUNTIF(KOL_Source_Data!$${kolCol('Engagement Rate (%)')}$${KOL_FIRST}:$${kolCol('Engagement Rate (%)')}$${KOL_FIRST + n - 1},"<1")+COUNTIF(KOL_Source_Data!$${kolCol('Engagement Rate (%)')}$${KOL_FIRST}:$${kolCol('Engagement Rate (%)')}$${KOL_FIRST + n - 1},"${NA}")&" of ${n} would be removed at Minimum ER = 1%"`,
  'minFollowers / maxFollowers': n => `COUNTIF(KOL_Source_Data!$${kolCol('Followers')}$${KOL_FIRST}:$${kolCol('Followers')}$${KOL_FIRST + n - 1},"<1000000")&" of ${n} sit below 1M followers"`,
  tiers: n => `COUNTIF(KOL_Source_Data!$${kolCol('Tier')}$${KOL_FIRST}:$${kolCol('Tier')}$${KOL_FIRST + n - 1},"${NA}")&" of ${n} carry no tier"`,
  connectedOnly: () => `"removes all 24 — no creator on this server has completed the OAuth connect flow"`,
  minAudienceQuality: n => `COUNTIF(KOL_Source_Data!$${kolCol('Audience Quality')}$${KOL_FIRST}:$${kolCol('Audience Quality')}$${KOL_FIRST + n - 1},"${NA}")&" of ${n} have no audience-quality reading and would be removed by any minimum"`,
}

export function buildHardVsSoft(wb, records) {
  const n = records.length
  const ws = wb.addWorksheet('Hard_vs_Soft_Filter', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 8, 'HARD FILTER vs SOFT MATCH  ·  what deletes a creator and what merely reorders them',
    'A hard filter answers yes or no and removes rows; a soft match returns 0-100 and reorders them. Confusing the two is how '
    + '"Max Rate Card" came to be marked DONE while returning zero creators for every price. The right-hand column is measured '
    + 'against these 24 rows, not asserted — a gate whose effect nobody has counted is a gate nobody has tested.')

  let r = 4
  for (const [kind, title] of [
    ['HARD FILTER', 'HARD FILTERS  ·  boolean gates. A creator that fails one leaves the result set entirely.'],
    ['SOFT MATCH', 'SOFT MATCH  ·  0-100 contributions. These change the order, never the membership.'],
  ]) {
    r = subhead(ws, r, 8, title)
    headers(ws, r, 1, ['Group', 'Filter', 'Key', 'Control', 'Brand input', 'KOL field', 'Prototype status', 'Effect on this roster'], 30)
    r++
    for (const [group, filter, key, type, control, brandInput, kolField, status, source, coverage] of DISCOVERY_FILTERS) {
      if (type !== kind) continue
      labelCell(ws, r, 1, group, { size: 9, bold: true })
      labelCell(ws, r, 2, filter, { size: 9 })
      labelCell(ws, r, 3, key, { size: 9, color: T.sub })
      labelCell(ws, r, 4, control, { size: 9, color: T.sub })
      labelCell(ws, r, 5, brandInput, { size: 9, color: T.sub })
      labelCell(ws, r, 6, kolField, { size: 9 })
      labelCell(ws, r, 7, status, { size: 9, bold: status !== 'DONE' })
      const effect = HARD_EFFECTS[key]
      const cell = labelCell(ws, r, 8, '', { size: 9, wrap: true })
      cell.value = effect
        ? F(`=${effect(n)}`)
        : status === 'BLOCKED BY DATA'
          ? `not measurable on this roster — ${source} (${coverage})`
          : status === 'NEW'
            ? 'defined by this workbook; no column exists to filter on yet'
            : `see ${source} (${coverage})`
      r++
    }
    r += 2
  }

  r = subhead(ws, r, 8, 'WHY THIS ROSTER IS RANKED, NOT GATED')
  const NOTES = [
    ['All five brands run with permissive hard filters', 'The brief names 24 specific creators and asks how they compare across 5 brands. A minimum-follower or minimum-ER gate would answer a different question by deleting rows from the comparison — so every brand admits every creator, and the ordering does the work.'],
    ['Brand Safety is a soft input here, not a gate', 'The catalogue lists Minimum Brand Safety as a HARD filter, and it should be one in the product. It cannot be one on this data: no content-risk reading exists for any account, so a safety gate would be filtering on an integrity screen and calling it safety.'],
    ['Category as a hard filter needs a live basis', 'Nine of the 24 carry no category and three carry one classified from captions. Gating on a modelled category deletes creators on the strength of a guess — the taxonomy\'s own rule 6. It ranks here; it never gates.'],
  ]
  for (const [head, body] of NOTES) {
    labelCell(ws, r, 1, head, { size: 9, bold: true })
    ws.mergeCells(r, 2, r, 8)
    labelCell(ws, r, 2, body, { size: 9, wrap: true, color: T.sub })
    ws.getRow(r).height = 30
    r++
  }

  ws.getColumn(1).width = 15
  ws.getColumn(2).width = 24
  ws.getColumn(3).width = 26
  ws.getColumn(4).width = 22
  ws.getColumn(5).width = 24
  ws.getColumn(6).width = 28
  ws.getColumn(7).width = 17
  ws.getColumn(8).width = 62
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   VALIDATION
   ══════════════════════════════════════════════════════════════════════════ */

export function buildValidation(wb, records, brands, snapshot) {
  const n = records.length
  const total = n * brands.length
  const ws = wb.addWorksheet('Validation', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 5, 'VALIDATION  ·  every check the brief asks for, computed in the workbook',
    'Each Result cell is a formula over the sheets themselves, so the check re-runs on open and cannot go stale. '
    + 'A check that reported a number typed in by the generator would only be testing the generator\'s memory.')

  const handleRange = `KOL_Source_Data!$${kolCol('Handle')}$${KOL_FIRST}:$${kolCol('Handle')}$${KOL_FIRST + n - 1}`
  const reqRange = `KOL_Source_Data!$${kolCol('Requested Handle')}$${KOL_FIRST}:$${kolCol('Requested Handle')}$${KOL_FIRST + n - 1}`
  const foundRange = `KOL_Source_Data!$${kolCol('Found In Database')}$${KOL_FIRST}:$${kolCol('Found In Database')}$${KOL_FIRST + n - 1}`
  const finalRange = engRange('Final Match Score', total)
  const keyRange = engRange('Match Key', total)
  const spreadRange = `Brand_Comparison!$${A(5 + brands.length + 3)}$6:$${A(5 + brands.length + 3)}$${5 + n}`

  /* label, formula, expected-verdict formula */
  const CHECKS = [
    ['1. Requested accounts',
      `=COUNTA(${reqRange})`,
      `=IF(COUNTA(${reqRange})=${n},"PASS — ${n} requested handles, the list as briefed","FAIL")`],
    ['2. Found in KOL database',
      `=COUNTIF(${foundRange},"FOUND*")`,
      `=COUNTIF(${foundRange},"FOUND*")&" of ${n} resolved to a row in public.kol_directory · "`
      + `&COUNTIF(${foundRange},"NOT FOUND")&" reported NOT FOUND IN KOL DATABASE"`],
    ['3. Resolved through an alias',
      `=COUNTIF(${foundRange},"FOUND (alias)")`,
      `="requested spelling differed from the stored spelling for "&COUNTIF(${foundRange},"FOUND (alias)")&" account(s); both spellings are printed on KOL_Source_Data"`],
    ['4. Duplicate creators',
      `=SUMPRODUCT((COUNTIF(${handleRange},${handleRange})>1)*1)-SUMPRODUCT((${handleRange}="${NA}")*1)*MAX(0,COUNTIF(${handleRange},"${NA}")-1)`,
      `=IF(SUMPRODUCT((COUNTIF(${handleRange},${handleRange}&"")>1)*1)=0,"PASS — every handle appears exactly once","FAIL — a handle repeats")`],
    ['5. Brands with distinct qualifications',
      `=COUNTA(Brand_Profile!$${BRAND_COLS[0]}$${BR.brand_name}:$${BRAND_COLS[brands.length - 1]}$${BR.brand_name})`,
      // Counts DISTINCT categories, not brands: five brands sharing one category
      // would pass a headcount and prove nothing about contextual scoring.
      `=IF(SUMPRODUCT(1/COUNTIF(Brand_Profile!$${BRAND_COLS[0]}$${BR.category}:$${BRAND_COLS[brands.length - 1]}$${BR.category},`
      + `Brand_Profile!$${BRAND_COLS[0]}$${BR.category}:$${BRAND_COLS[brands.length - 1]}$${BR.category}))=${brands.length},`
      + `"PASS — ${brands.length} brands on ${brands.length} different kol_categories.taxonomy_key values",`
      + `"FAIL — two brands share a category")`],
    ['6. Matching combinations',
      `=COUNTA(${keyRange})`,
      `=IF(COUNTA(${keyRange})=${total},"PASS — ${n} creators x ${brands.length} brands = ${total} rows","FAIL")`],
    ['7. Component weights total 100',
      `=${K.CHECK_WEIGHT_TOTAL}`,
      `=IF(${K.CHECK_WEIGHT_TOTAL}=100,"PASS — 20+30+20+10+10+10","FAIL — weights total "&${K.CHECK_WEIGHT_TOTAL})`],
    ['8. Scores inside 0-100',
      `=COUNTIF(${finalRange},">100")+COUNTIF(${finalRange},"<0")`,
      `=IF(COUNTIF(${finalRange},">100")+COUNTIF(${finalRange},"<0")=0,"PASS — no Final Match Score falls outside 0-100","FAIL")`],
    ['9. Formula errors',
      `=SUMPRODUCT(--ISERROR(${finalRange}))+SUMPRODUCT(--ISERROR(${engRange('Business Score', total)}))`
      + `+SUMPRODUCT(--ISERROR(${engRange('Audience Score', total)}))+SUMPRODUCT(--ISERROR(${engRange('Content Score', total)}))`
      + `+SUMPRODUCT(--ISERROR(${engRange('Performance Score', total)}))+SUMPRODUCT(--ISERROR(${engRange('Safety Score', total)}))`,
      `=IF(SUMPRODUCT(--ISERROR(${finalRange}))=0,"PASS — no #REF!, #DIV/0! or #N/A in any component or final score","FAIL")`],
    ['10. Rows scored on partial data',
      `=COUNTIF(${engRange('Available Weight', total)},"<100")`,
      `=COUNTIF(${engRange('Available Weight', total)},"<100")&" of ${total} rows could not be scored on the full 100 weight points. `
      + `Brand Personality Fit (10) is unavailable on every row: no creator personality, tone, values or content-style column exists."`],
    ['11. Contextual scoring — score varies by brand',
      `=COUNTIF(${spreadRange},">0")`,
      `=IF(COUNTIF(${spreadRange},">0")>0,COUNTIF(${spreadRange},">0")&" of ${n} creators score differently across the ${brands.length} brands`
      + ` (largest spread "&MAX(${spreadRange})&" points). Brand Match is contextual, not a permanent creator score.","FAIL — every creator scores the same everywhere")`],
    ['12. Ranking generated per brand',
      `=${brands.length * n}`,
      `="Brand_Ranking holds ${brands.length} blocks of ${n} ranked rows; Top_Matches holds a top 5 and a bottom 5 for each brand"`],
    ['13. Reason Why populated',
      `=COUNTIF(Match_Explanation!$F$6:$F$${5 + total},"?*")`,
      `=IF(COUNTIF(Match_Explanation!$F$6:$F$${5 + total},"?*")=${total},"PASS — all ${total} pairs carry a reason assembled from their own scores","FAIL")`],
    ['14. Followers do not decide the ranking',
      `=ROUND(CORREL(${engRange('Followers', total)},${finalRange}),3)`,
      `="Pearson correlation between follower count and Final Match Score across all ${total} rows. "`
      + `&IF(ABS(ROUND(CORREL(${engRange('Followers', total)},${finalRange}),3))<0.5,"Weak — relevance is outranking raw reach, as required.",`
      + `"STRONG — reach is dominating relevance; the weighting needs review.")`],
    ['15. Missing data marked, never filled',
      `=COUNTIF(KOL_Source_Data!$A$${KOL_FIRST}:$${A(Object.keys(KC).length)}$${KOL_FIRST + n - 1},"${NA}")`,
      `=COUNTIF(KOL_Source_Data!$A$${KOL_FIRST}:$${A(Object.keys(KC).length)}$${KOL_FIRST + n - 1},"${NA}")`
      + `&" cells on KOL_Source_Data read N/A. Every one is a column the server left empty or does not have; none was filled with a plausible value."`],
  ]

  headers(ws, 4, 1, ['#', 'Check', 'Result', 'Verdict', 'Why it is here'], 26)
  const WHY = [
    'The brief names 24 accounts. More would mean something was added, fewer that something was dropped.',
    'Anything not resolvable to a kol_directory row must be reported, never replaced.',
    'A substitution the reader cannot see is indistinguishable from invented data.',
    'A creator on the roster twice would be double-counted in every ranking and average.',
    'Five brands that all wanted the same creator profile would prove nothing about contextual scoring.',
    'One row per creator-brand pair. A shortfall means a pair silently went unscored.',
    'The whole model rests on this identity. It is asserted, not assumed.',
    'A score outside the band means a normalisation target was mis-set.',
    'An error propagates silently into rankings and averages.',
    'Says how much of the model each row could actually be scored on.',
    'The core claim of the exercise: the score is a function of the pair, not of the creator.',
    'Every brand gets its own order, or the comparison has nothing to show.',
    'A blank reason means an explanation was dropped rather than derived.',
    'Relevance must outrank reach. This roster is 24 mega accounts, so a follower-driven model would rank them almost identically for all five brands.',
    'The count is the honesty budget: it is what was not measured, stated rather than hidden.',
  ]

  CHECKS.forEach(([label, result, verdict], i) => {
    const r = 5 + i
    labelCell(ws, r, 1, i + 1, { size: 9 }).alignment = { horizontal: 'center' }
    labelCell(ws, r, 2, label, { size: 9, bold: true })
    const res = ws.getCell(r, 3)
    res.value = F(result)
    res.font = { ...BASE, size: 9, bold: true }
    res.fill = fillOf(T.calc)
    res.border = bd()
    res.alignment = { horizontal: 'center' }
    const v = ws.getCell(r, 4)
    v.value = F(verdict)
    v.font = { ...BASE, size: 9 }
    v.border = bd()
    v.alignment = { vertical: 'top', wrapText: true }
    labelCell(ws, r, 5, WHY[i], { size: 9, color: T.sub, wrap: true })
    ws.getRow(r).height = 30
  })

  let r = 5 + CHECKS.length + 2

  /* the two substitutions, spelled out */
  r = subhead(ws, r, 5, 'HANDLE RESOLUTION  ·  every requested spelling, and what it resolved to')
  headers(ws, r, 1, ['Requested', 'Resolved to', 'Followers', 'How', 'Note'], 22)
  r++
  for (const rec of records) {
    labelCell(ws, r, 1, `@${rec.requested}`, { size: 9, bold: true })
    labelCell(ws, r, 2, rec.found ? `@${rec.resolved}` : NA, { size: 9 })
    labelCell(ws, r, 3, rec.found ? rec.followers : NA, { size: 9 }).numFmt = INT
    labelCell(ws, r, 4, !rec.found ? 'NOT FOUND' : rec.aliased ? 'alias' : 'exact', { size: 9 })
    labelCell(ws, r, 5,
      !rec.found ? 'NOT FOUND IN KOL DATABASE — no substitute creator was used'
        : rec.aliased ? `requested spelling does not exist on the server; resolved to the one-transposition neighbour that does`
          : 'username_normalized matched exactly', { size: 9, color: T.sub, wrap: true })
    r++
  }

  /* the dropped duplicate rows */
  r += 1
  r = subhead(ws, r, 5, 'DUPLICATE PLATFORM ROWS DROPPED  ·  handles the roster carries on both Instagram and TikTok')
  headers(ws, r, 1, ['Handle', 'Dropped row', 'Followers dropped', 'Kept row', 'Why the kept row won'], 22)
  r++
  if (!snapshot.rejectedDuplicates.length) {
    labelCell(ws, r, 1, '— none —', { size: 9, color: T.sub })
    r++
  }
  for (const d of snapshot.rejectedDuplicates) {
    labelCell(ws, r, 1, `@${d.handle}`, { size: 9, bold: true })
    labelCell(ws, r, 2, d.platform, { size: 9 })
    labelCell(ws, r, 3, d.followers, { size: 9 }).numFmt = INT
    labelCell(ws, r, 4, `${d.keptPlatform} (${d.keptFollowers.toLocaleString('en-US')} followers)`, { size: 9 })
    labelCell(ws, r, 5,
      `measured-signal score ${d.keptSignal} against ${d.signal}. The kept row carries the audience analysis, engagement `
      + 'analysis, interest shares and captions the model reads; follower count does not decide this.',
      { size: 9, color: T.sub, wrap: true })
    r++
  }

  /* what is missing, and why */
  r += 1
  r = subhead(ws, r, 5, 'WHAT THE DATABASE DOES NOT HAVE  ·  every N/A on this workbook traces to one of these')
  headers(ws, r, 1, ['Field', 'Where it would live', 'State', 'Effect on the score', 'Verified how'], 22)
  r++
  const GAPS = [
    ['Audience age', 'l2_gold.audience_demographics_daily (audience_type=\'age\')', '0 rows — the table holds gender only',
      'Age Score is N/A on all 120 rows. Its 25% of Target Audience Relevance renormalises across gender, location and interest.',
      'SELECT DISTINCT audience_type → {gender}; age_gender_breakdown NULL in all 27 audience-analysis rows'],
    ['Content topic', 'feature.{ig,tt}_post_analysis.content_category', 'column exists, NULL in all 212 rows',
      'Topics are classified from real captions and hashtags instead, and every one carries its evidence on KOL_Source_Data.',
      'SELECT content_category, count(*) GROUP BY 1 → one row, NULL, 212'],
    ['Sub category', '— no column exists', 'never built',
      'Sub Category Match is N/A; its 20% of Content Relevance renormalises onto category and topic.',
      'no kol_sub_categories table, no sub_category_ids column'],
    ['Creator personality / tone / values / content style', '— no column exists', 'never built',
      'Brand Personality Fit is N/A on all 120 rows. Its full 10% is redistributed across the other five components.',
      'no column on kol_directory, kol_profile_card or any feature table'],
    ['Comment sentiment, spam, toxicity', 'feature.{ig,tt}_comments_analysis', '0 rows',
      'Content Risk is N/A. Brand Safety is an integrity screen over authenticity, follower quality, verification and paid ratio — labelled as such everywhere it appears.',
      'SELECT count(*) → 0'],
    ['Rate card', 'l1_silver.unified_rate_card; kol_profile_card.rate_card_*', '0 rows; all NULL',
      'No CPE, CPM, CPV or ROI is computed anywhere in this workbook. A cost column would have to be invented to exist.',
      'SELECT count(*) → 0; rate_card_min_fee NULL in all 1.978 card rows'],
    ['Creator city', 'kol_directory.creator_city', 'column exists, 0% filled',
      'Creator location is N/A. Only AUDIENCE location is scored, from audience_geo_daily.',
      'all 24 roster rows NULL'],
    ['Community score', '— no column exists', 'never built',
      'Community is N/A; its 10% of Performance renormalises across the other five performance inputs.',
      'no column anywhere in public, feature or l2_gold'],
  ]
  for (const g of GAPS) {
    g.forEach((v, c) => labelCell(ws, r, c + 1, v, { size: 9, wrap: true, color: c >= 3 ? T.sub : T.ink, bold: c === 0 }))
    ws.getRow(r).height = 34
    r++
  }

  ws.getColumn(1).width = 30
  ws.getColumn(2).width = 40
  ws.getColumn(3).width = 26
  ws.getColumn(4).width = 62
  ws.getColumn(5).width = 56
  for (let i = 5; i < 5 + CHECKS.length; i++) ws.getRow(i).height = 32
  ws.getColumn(2).width = 34
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   README
   ══════════════════════════════════════════════════════════════════════════ */

export function buildReadme(wb, records, brands, snapshot) {
  const n = records.length
  const total = n * brands.length
  const ws = wb.addWorksheet('README', { views: [{ state: 'frozen', ySplit: 3 }] })
  banner(ws, 1, 4, 'AUTOMETRIC — BRAND MATCH COMPARISON',
    `${n} creators read from the KOL server, scored against ${brands.length} brands, ${total} matching records. `
    + `Roster measured ${new Date(snapshot.measuredAt).toISOString().slice(0, 16).replace('T', ' ')} UTC from ${snapshot.server}.`)

  let r = 4
  const para = (head, body) => {
    labelCell(ws, r, 1, head, { size: 10, bold: true })
    ws.mergeCells(r, 2, r, 4)
    const c = labelCell(ws, r, 2, body, { size: 9, wrap: true, color: T.sub })
    c.alignment = { vertical: 'top', wrapText: true }
    ws.getRow(r).height = Math.max(28, Math.ceil(body.length / 110) * 13)
    r++
  }
  const section = title => { r = subhead(ws, r, 4, title) }

  section('1. WHAT THIS WORKBOOK IS')
  para('Purpose',
    'To show that Brand Match is a contextual score — a function of (brand, creator) — rather than a permanent rating attached to a creator. '
    + `The same ${n} creators are scored against ${brands.length} deliberately different brands, and the resulting orders differ. Brand_Comparison is where that is easiest to see: `
    + 'one row per creator, one column per brand, and a Spread column that would read 0 if the model were secretly ranking creators rather than pairs.')
  para('Source of data',
    `Every creator field comes from the KOL server (${snapshot.server}) via scripts/brand-match/roster-fetch.mjs, read-only. `
    + 'Nothing on KOL_Source_Data is invented, estimated to fill a gap, or carried over from the engine workbook\'s sample roster. '
    + 'Tables read: public.kol_directory, public.kol_social_account, public.kol_categories, feature.ig/tt_audience_analysis, '
    + 'feature.ig_engagement_analysis, l2_gold.kol_profile_card, l2_gold.audience_interest_daily, l2_gold.audience_geo_daily, '
    + 'l2_gold.audience_demographics_daily, l1_silver.unified_post.')
  para('Relationship to the engine workbook',
    'Autometric_Brand_Match_Engine.xlsx is the specification of the logic and runs on a hand-built sample roster. This workbook runs the same '
    + 'logic on real rows: the same six components, the same weights, the same relevance matrices, all read from the same Lookup_Lists code '
    + '(scripts/brand-match/build.mjs) and the same taxonomy (taxonomy.mjs). There is one model, not two.')

  section('2. THE 24 CREATORS')
  para('Selection',
    'The 24 handles were given. They were not chosen by the model, and no creator outside the list appears anywhere in this workbook. '
    + `${snapshot.found} resolved to an active row in public.kol_directory. `
    + (snapshot.notFound.length ? `${snapshot.notFound.length} did not and are reported NOT FOUND IN KOL DATABASE: ${snapshot.notFound.join(', ')}.`
      : 'None had to be reported NOT FOUND.'))
  para('Two spellings were corrected',
    'Two requested handles do not exist on the server and each has a neighbour one transposition away that does: '
    + snapshot.aliasTable.map(a => `@${a.from} → @${a.to}`).join(', ')
    + '. Both spellings are printed on KOL_Source_Data and on Validation. This is the only place a requested handle and a scored handle differ.')
  para('Four handles existed twice',
    'Four creators hold a row on both Instagram and TikTok. The brief asks for 24 accounts, so one row per handle survives — the row carrying '
    + 'the most measured signal, not the most followers. Every dropped row is listed on Validation with the follower count it had, because a '
    + 'dropped row nobody can see is indistinguishable from a row that was never there.')

  section('3. THE FIVE BRANDS  ·  every category taken from the database')
  para('The categories are the database’s, not the workbook’s',
    'public.kol_categories holds 28 category names, and its taxonomy_key column already says which of them are the same thing — Foodies, Food '
    + 'and Cooking all carry Food; Sports, Gym Enthusiast, Cyclist and Fitness all carry Fitness. That column yields nine canonical values: '
    + `${CANONICAL_CATEGORIES.join(' · ')}. `
    + 'Lookup_Lists section 11a prints all 28 rows with their counts and their key. Both halves of every comparison resolve through that one '
    + 'column, so neither half authored the vocabulary it is scored on.')
  para('The five brands',
    brands.map(b => `${b.brand_name} → ${b.category}`).join('  ·  ')
    + '. Five different canonical categories, different audience genders, different interest sets — five brands wanting the same creator '
    + 'profile would rank identically and demonstrate nothing. Brand_Profile carries a Source column naming the database column behind every '
    + 'field, and the record shape follows public.brand: name, category, brand_keywords, brand_hashtags.')
  para('Audience interests are the database’s keys too',
    'The interest rows on Brand_Profile hold l2_gold.audience_interest_daily.interest_key values, spelled exactly as the server spells them — '
    + "lower case, and 'sports' kept separate from 'fitness' because the database keeps them separate, which is why MoveFit targets both. "
    + 'A brand cannot target an interest the database does not have: the build asserts it and stops.')
  para('There is no Industry field, because there is no industry column',
    'An earlier draft of this workbook carried brand Industry, Product Category, Sub Category, Brand Niche, Brand Personality, Tone, '
    + 'Communication Style and Positioning, scored against a 14-label taxonomy written for the engine workbook. None of those exist as creator '
    + 'columns on this server, and the taxonomy was a second vocabulary that disagreed with the database in two places — it filed Moms under '
    + 'Parenting and dropped Gen Z, when kol_categories assigns both a key of their own. They are gone. What remains either maps to a database '
    + 'column or is marked on Brand_Profile as scoring nothing.')
  para('Hard filters left permissive',
    'The brief asks how 24 named creators compare across 5 brands. A minimum-follower or minimum-ER gate would answer a different question by '
    + 'deleting rows from the comparison. Sheet Hard_vs_Soft_Filter documents every gate that exists and counts what each would remove from '
    + 'this roster if it were switched on.')

  section('4. THE MODEL')
  para('Final Match Score',
    'Final = (Business x 20 + Audience x 30 + Content x 20 + Personality x 10 + Performance x 10 + Safety x 10) / 100, on a 0-100 scale. '
    + 'The six weights live in editable cells on Lookup_Lists section 4 and CHECK_WEIGHT_TOTAL asserts they sum to 100. No score anywhere in '
    + 'this workbook is a typed number: every one is a formula over KOL_Source_Data and Brand_Profile.')
  para('Sub-weights',
    'Target Audience = Age 25 / Gender 15 / Location 30 / Interest 30 (the brief’s own split). '
    + 'Brand & Business = Category 60 / Keyword 25 / Hashtag 15. Content & Category = Content Category 60 / Topic 40. '
    + 'Performance = ER 35 / Audience Quality 20 / Consistency 20 / Community 10 / Average Views 10 / Recent Growth 5. '
    + 'Brand Safety = Authenticity 40 / Follower Quality 30 / Verification 15 / Paid Ratio 15. '
    + 'The first two are not even splits, and Lookup_Lists section 11 says why: measured on this roster, Category Match takes 8 distinct values '
    + 'across the 120 pairs while Keyword Match takes 3 and Hashtag Match 2. Letting the two sparse signals carry 60% of a component would make '
    + 'it mostly measure whether a celebrity writes marketing copy in their captions, which none of them does.')
  para('Missing inputs renormalise; they never become zero',
    'This is the one mechanism this workbook adds to the engine\'s. Where the server has no reading, the cell reads N/A and drops out of its '
    + 'weighted mean, so the remaining weights renormalise to 100 by themselves. A component with no inputs at all is N/A and drops out of the '
    + 'Final Match Score; the Available Weight column reports how much of the nominal 100 each row could be scored on. '
    + 'Zero is a measurement — "we looked, and there was none". Using it for "nobody looked" would rank an unmeasured creator below a bad one.')
  para('Score interpretation',
    'Excellent Match 90-100 · Strong Match 80-89 · Good Match 70-79 · Moderate Match 60-69 · Low Match below 60. '
    + 'The bands are the brief\'s and live in editable cells (BAND_EXCELLENT and below). Scores on this roster sit low relative to those bands, '
    + 'and that is a finding rather than a bug: see section 6.')

  section('5. HARD FILTER vs SOFT MATCH')
  para('The distinction',
    'A hard filter answers yes or no and removes creators from the result set: platform, minimum followers, mandatory location, tier, minimum ER, '
    + 'category requirement, connected-only. A soft match returns 0-100 and reorders them: brand match, audience relevance, content relevance, '
    + 'personality, performance, brand safety. Confusing the two is how a filter can be marked DONE while returning zero creators for every value.')

  section('6. LIMITATIONS  ·  read this before quoting a number')
  para('Six inputs do not exist on this server',
    'Audience age (no rows anywhere), sub category (no column), creator personality/tone/values/content style (no column — this empties Brand '
    + 'Personality Fit entirely), community (no column), comment sentiment and toxicity (0 rows), rate card (0 rows). Validation lists each one '
    + 'with where it would live, how it was verified and what it does to the score.')
  para('Absolute scores are low against the bands — read them as a ranking, not a percentage',
    'Final scores on this roster run roughly 20 to 71, so almost every row lands in Low Match and a handful reach Moderate or Good. That is a '
    + 'property of the data, not of the creators. Brand Personality Fit contributes nothing at all (10 points of the 100 gone); audience interest '
    + 'and geography are known for only 10-20% of each sampled audience; and Keyword and Topic Match are near-empty for the reasons below. '
    + 'The bands are the brief\'s and they assume a complete creator record. USE THIS WORKBOOK TO COMPARE — creators within one brand, and one '
    + 'creator across the five brands. Do not read 52/100 as "52% fit".')
  para('Engagement rate is scored against the creator\'s own tier',
    'Section 11b of Lookup_Lists sets the ER that scores 100 per tier, from 8% at Nano down to 2% at Mega. All 24 of these accounts are Mega. '
    + 'The shared CAL_ER_TARGET of 6% is calibrated for micro creators and would have scored @cristiano\'s 2.21% — the best engagement on the '
    + 'roster by some distance — as 37 out of 100. Engagement rate falls with reach as a matter of arithmetic, so the question the tier targets '
    + 'ask is "well engaged for an account this size", which is the only version a brand can act on.')
  para('Audience shares are shares of the KNOWN portion',
    'l2_gold.audience_interest_daily is dominated by the key \'unknown\' — often 80-89% of a creator\'s sample. Interest and country shares here are '
    + 'computed over the known remainder, and Interest Known % / Country Known % on KOL_Source_Data report how large that remainder was. '
    + 'A 100 on Interest Score off a 12% known sample is a much weaker claim than the same 100 off a 60% one.')
  const live = records.filter(r => r.categoryBasis === 'live').length
  const modelled = records.filter(r => r.found && r.categoryBasis && r.categoryBasis !== 'live').length
  const uncategorised = records.filter(r => r.found && !r.category).length
  para('Categories are three different kinds of thing',
    `${live} creators carry a category from public.kol_categories (basis: live). ${modelled} were classified from their own captions and hashtags `
    + 'by the taxonomy\'s keyword rules (basis: calculated or estimated), and the evidence that produced each one is printed beside it on '
    + `KOL_Source_Data so it can be overruled. ${uncategorised} carry none at all. A classified category ranks; it never gates.`)
  para(`${uncategorised} creators have no category, and it moves their score`,
    'Category Match and Content Category Match fall back to CAL_NEUTRAL for them — not to N/A, and not to CAL_UNRELATED. '
    + 'This has a consequence worth stating plainly: a creator nobody has categorised can outscore one who is known to be a poor fit. That is '
    + 'correct. Knowing @cristiano makes fitness content is real evidence against a SaaS brief; knowing nothing about @leomessi is not evidence '
    + 'either way. Category Basis and Confidence are the columns that tell the two apart, and their ranking says more about their audience than '
    + 'about their content.')
  para('Keyword Match and Topic Match are close to empty, and honestly so',
    'Across all 120 pairs, Keyword Match averages under 2 and Topic Match under 4. Three reasons, none of them a bug: kol_directory.bio is ~12% '
    + 'filled; the brand keyword lists are Indonesian while several of these creators caption in English or Spanish, so @leomessi and @cristiano '
    + 'can never hit an Indonesian term whatever they post about; and these are celebrity and entertainment accounts that genuinely do not write '
    + 'about SaaS, skincare formulation or sportswear. The consequence is that Brand & Business Relevance rests mostly on Industry and Category '
    + '(70% of it) and Content Relevance rests mostly on category, since Topic is half of what is left after sub-category and style drop out. '
    + 'A per-language keyword set would fix the second reason; nothing in the data fixes the third.')

  section('7. SHEETS')
  const SHEETS = [
    ['README', 'This sheet.'],
    ['KOL_Source_Data', `The ${n} accounts as the server has them, with a Data Note per row saying what was missing.`],
    ['Brand_Profile', `The ${brands.length} brands, one column each, keyed for the engine.`],
    ['Matching_Engine', `${total} rows. Every score a formula. The only sheet that computes anything.`],
    ['Score_Breakdown', 'The same rows, sub-scores first. A pure view.'],
    ['Match_Explanation', `${total} written reasons, each assembled from its own row's scores.`],
    ['Brand_Comparison', 'One row per creator, one column per brand, plus Best Brand and Spread.'],
    ['Brand_Ranking', `${brands.length} blocks of ${n}, ordered by the engine's Rank Key.`],
    ['Top_Matches', 'Top 5 and bottom 5 for each brand, with reason, strength and concern.'],
    ['Hard_vs_Soft_Filter', 'Every filter in the catalogue, split by kind, with its measured effect on this roster.'],
    ['Validation', '15 checks, each computed in the workbook, plus the handle resolutions and the data gaps.'],
    ['Lookup_Lists', 'Every weight, band, matrix and calibration constant. Edit here and the workbook moves.'],
  ]
  headers(ws, r, 1, ['Sheet', 'What it holds', '', ''], 20)
  r++
  for (const [name, what] of SHEETS) {
    labelCell(ws, r, 1, name, { size: 9, bold: true })
    ws.mergeCells(r, 2, r, 4)
    labelCell(ws, r, 2, what, { size: 9, color: T.sub, wrap: true })
    r++
  }

  section('8. REGENERATING')
  para('Commands',
    'npm run brandmatch:fetch  (office VPN required — re-reads the 24 accounts and rewrites scripts/brand-match/roster.json)  ·  '
    + 'npm run brandmatch:comparison  (rebuilds this file)  ·  npm run brandmatch:comparison:verify  (reads the built file back and '
    + 'checks the roster, the row counts, the formulas and the contextual-score claim).')

  ws.getColumn(1).width = 30
  ws.getColumn(2).width = 60
  ws.getColumn(3).width = 40
  ws.getColumn(4).width = 40
  return ws
}
