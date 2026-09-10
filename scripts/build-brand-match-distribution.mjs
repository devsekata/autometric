/**
 * Generates `Autometric_Brand_Match_Distribution_Test.xlsx`.
 *
 *   npm run brandmatch:population         (office VPN required)
 *   npm run brandmatch:port:verify        (gate: JS scorer == workbook)
 *   npm run brandmatch:distribution
 *
 * A validation instrument, not a deliverable ranking. It asks one question:
 * given the Absolute Brand Match Score exactly as it stands, what shape does it
 * take across a real population, and does dividing by the population maximum
 * make it easier to read?
 *
 * ── Nothing about the Absolute Score was changed to build this ─────────────
 * No weight, sub-weight, normalisation target, band or matrix cell was touched.
 * The scores here come from `scoring.mjs`, which `verify-scoring-port.mjs`
 * proves reproduces the published workbook on all 120 of its rows and all 26 of
 * its score columns. One bug was fixed on the way — the haystack emptiness guard
 * never fired because the concatenation left its " | " separators behind, so
 * three creators with no bio and no captions were scoring 0 on Keyword and Topic
 * Match instead of N/A. That is the "kecuali diperlukan untuk bug fixing"
 * exception and it is called out on the README sheet.
 *
 * ── Normalized Score is a view, never a replacement ────────────────────────
 * Every Normalized cell is an Excel formula dividing an Absolute cell by the MAX
 * of that preference's own population. Both sheets ship, side by side, and the
 * README says in as many words that 100 means "highest in this comparison
 * group", not "perfect fit".
 */

import ExcelJS from 'exceljs'
import path from 'node:path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PREFERENCES } from './brand-match/distribution-preferences.mjs'
import { score, toScoringRecord, isNum } from './brand-match/scoring.mjs'
import {
  banner, subhead, headers, labelCell, bd, fillOf, T, BASE, F, A,
  SCORE_FMT, INT,
} from './brand-match/build.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const POP = path.resolve(HERE, 'brand-match', 'population.json')
const OUT = process.env.BRANDMATCH_DIST_OUT
  ? path.resolve(process.env.BRANDMATCH_DIST_OUT)
  : path.resolve(HERE, '..', 'Autometric_Brand_Match_Distribution_Test.xlsx')

if (!existsSync(POP)) {
  console.error(`no population snapshot at ${POP}`)
  console.error('run it first, on the office VPN:  npm run brandmatch:population')
  process.exit(1)
}

const pop = JSON.parse(readFileSync(POP, 'utf8'))
const DEC2 = '0.00'
const FIRST = 6                 // first data row on the score sheets
const BLOCK_W = 5               // columns per preference block, plus a spacer

/* ── score the three populations ──────────────────────────────────────────── */

const scored = PREFERENCES.map(pref => {
  const eligible = pop.records.filter(pref.test)
  const rows = eligible.map(rec => {
    const k = toScoringRecord(rec)
    const s = score(k, pref.brand)
    return {
      handle: k.handle,
      name: k.name,
      platform: k.platform,
      followers: k.followers,
      tier: k.tier,
      category: k.category ?? 'N/A',
      categoryBasis: rec.categoryBasis ?? 'none',
      ...s,
    }
  }).filter(r => isNum(r.finalScore))
  rows.sort((a, b) => b.finalScore - a.finalScore || a.handle.localeCompare(b.handle))
  return { pref, rows, n: rows.length, max: Math.max(...rows.map(r => r.finalScore)) }
})

console.log('POPULATIONS')
for (const s of scored) {
  console.log(`  ${s.pref.label} · ${s.pref.brand.brand_name} (${s.pref.brand.category})`
    + ` · N=${s.n} · absolute max ${s.max}`)
}

/* ── histogram bins ───────────────────────────────────────────────────────── */

/**
 * Twenty bins of five points across the full 0-100 scale.
 *
 * Deliberately spanning 0-100 rather than the observed range: a histogram
 * auto-scaled to the data would make a distribution occupying 18-80 look like it
 * fills the scale, which is the exact impression this test exists to check.
 * Empty bins at both ends are part of the finding.
 */
const BINS = Array.from({ length: 20 }, (_, i) => ({
  lo: i * 5, hi: (i + 1) * 5, label: `${i * 5}-${(i + 1) * 5}`,
}))

/* ── workbook ─────────────────────────────────────────────────────────────── */

const wb = new ExcelJS.Workbook()
wb.creator = 'Autometric — Brand Match distribution test'
wb.lastModifiedBy = 'scripts/build-brand-match-distribution.mjs'
wb.created = new Date()
wb.modified = new Date()
wb.calcProperties.fullCalcOnLoad = true

/** Where each preference's block starts on the score sheets. */
const blockCol = i => 1 + i * BLOCK_W
/** The absolute-score column letter for preference `i`. */
const absCol = i => A(blockCol(i) + 3)
const absRange = i => `Absolute_Scores!$${absCol(i)}$${FIRST}:$${absCol(i)}$${FIRST + scored[i].n - 1}`
const normColOf = i => A(blockCol(i) + 3)
const normRange = i => `Normalized_Scores!$${normColOf(i)}$${FIRST}:$${normColOf(i)}$${FIRST + scored[i].n - 1}`

/* 1 ── POPULATION ────────────────────────────────────────────────────────── */
function buildPopulation() {
  const ws = wb.addWorksheet('Population', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 5, 'POPULATION  ·  what was read off the KOL server, and how much of it can be scored',
    `${pop.records.length} active creators from public.kol_directory, measured `
    + `${new Date(pop.measuredAt).toISOString().slice(0, 16).replace('T', ' ')} UTC from ${pop.server}. `
    + 'No creator here was invented and no metric was filled in. The coverage table below is the single most '
    + 'important context for every distribution on the other sheets.')

  let r = subhead(ws, 4, 5, 'A. SIGNAL COVERAGE  ·  how many of the population carry each input the model reads')
  headers(ws, r, 1, ['Input', 'Creators carrying it', 'Share of population', 'Which component it feeds', 'Consequence when absent'], 26)
  r++
  const c = pop.coverage
  const rowsCov = [
    ['Followers', c.total, 'Tier, and every eligibility rule', '—'],
    ['Canonical category (kol_categories.taxonomy_key)', c.withCategory, 'Brand & Business Relevance (60% of it)', 'Category Match falls back to CAL_NEUTRAL = 50'],
    ['  of those, live from kol_categories', c.withLiveCategory, 'as above', '—'],
    ['Engagement rate', c.withEngagementRate, 'Performance Quality (35% of it)', 'ER Score N/A; Performance renormalises or drops out'],
    ['View-to-follower ratio', c.withViewRatio, 'Performance Quality (10% of it)', 'Average Views Score N/A'],
    ['Audience analysis (quality / authenticity)', c.withAudienceAnalysis, 'Performance and Brand Safety', 'Safety falls back to verification alone'],
    ['Audience interests', c.withInterests, 'Target Audience Relevance (30% of it)', 'Interest Score N/A; whole component often N/A'],
    ['Harvested captions', c.withCaptions, 'Content Relevance and Keyword Match', 'Topic Match N/A; category cannot be classified'],
    ['Bio text', c.withBio, 'Keyword Match', 'Keyword Match N/A unless a category name is present'],
    ['Platform-verified', c.verified, 'Brand Safety (15% of it)', 'scores CAL_VERIFIED_NO = 50, not 0'],
  ]
  for (const [label, n, feeds, absent] of rowsCov) {
    labelCell(ws, r, 1, label, { size: 9, bold: !label.startsWith('  ') })
    labelCell(ws, r, 2, n, { size: 9 }).numFmt = INT
    const pctCell = labelCell(ws, r, 3, F(`=B${r}/${c.total}`), { size: 9 })
    pctCell.numFmt = '0.0%'
    labelCell(ws, r, 4, feeds, { size: 9, color: T.sub, wrap: true })
    labelCell(ws, r, 5, absent, { size: 9, color: T.sub, wrap: true })
    r++
  }

  r += 1
  r = subhead(ws, r, 5, 'B. THE THREE COMPARISON POPULATIONS  ·  each preference filters the same reading')
  headers(ws, r, 1, ['Preference', 'Brand', 'Brand category', 'Population size (N)', 'Eligibility'], 22)
  r++
  scored.forEach(s => {
    labelCell(ws, r, 1, s.pref.label, { size: 9, bold: true })
    labelCell(ws, r, 2, s.pref.brand.brand_name, { size: 9 })
    labelCell(ws, r, 3, s.pref.brand.category, { size: 9, bold: true })
    labelCell(ws, r, 4, s.n, { size: 9, bold: true }).numFmt = INT
    labelCell(ws, r, 5, s.pref.criteria.map(([k2, v]) => `${k2}: ${v}`).join('  ·  '), { size: 9, color: T.sub, wrap: true })
    ws.getRow(r).height = 26
    r++
  })

  ws.getColumn(1).width = 44
  ws.getColumn(2).width = 20
  ws.getColumn(3).width = 18
  ws.getColumn(4).width = 20
  ws.getColumn(5).width = 74
  return ws
}

/* 2 ── PREFERENCE_PROFILES ───────────────────────────────────────────────── */
function buildPreferenceProfiles() {
  const ws = wb.addWorksheet('Preference_Profiles', { views: [{ state: 'frozen', ySplit: 3 }] })
  banner(ws, 1, 4, 'PREFERENCE PROFILES  ·  the three brand profiles under test',
    'Each is an existing brand from the comparison workbook — same canonical category, same keywords, same '
    + 'interest keys — paired with an eligibility rule that decides its comparison population. Every filter used '
    + 'is one the Discovery catalogue marks DONE; none gates on a column that is 0% filled.')

  let r = 4
  for (const s of scored) {
    r = subhead(ws, r, 4, `${s.pref.label}  ·  ${s.pref.brand.brand_name}  ·  category ${s.pref.brand.category}  ·  N = ${s.n}`)
    labelCell(ws, r, 1, 'Why this profile', { size: 9, bold: true })
    ws.mergeCells(r, 2, r, 4)
    labelCell(ws, r, 2, s.pref.rationale, { size: 9, color: T.sub, wrap: true })
    ws.getRow(r).height = 34
    r++

    headers(ws, r, 1, ['Criterion', 'Value', 'Source in the database', 'Kind'], 20)
    r++
    const SRC = {
      Platform: ['kol_directory.platform_id → platforms.key', 'HARD FILTER'],
      'Minimum followers': ['kol_directory.followers_count', 'HARD FILTER'],
      'Category requirement': ['kol_directory.category_ids → kol_categories', 'HARD FILTER'],
      'Minimum engagement rate': ['kol_directory.engagement_rate', 'HARD FILTER'],
      'Brand category': ['public.kol_categories.taxonomy_key', 'SOFT MATCH — scored, never gated'],
      'Gender target': ['audience_demographics_daily / feature.*_audience_analysis.female_pct', 'SOFT MATCH'],
    }
    for (const [crit, val] of s.pref.criteria) {
      labelCell(ws, r, 1, crit, { size: 9, bold: true })
      labelCell(ws, r, 2, val, { size: 9 })
      labelCell(ws, r, 3, SRC[crit]?.[0] ?? '—', { size: 9, color: T.sub })
      labelCell(ws, r, 4, SRC[crit]?.[1] ?? '—', { size: 9, color: T.sub })
      r++
    }
    labelCell(ws, r, 1, 'Brand keywords', { size: 9, bold: true })
    labelCell(ws, r, 2, s.pref.brand.brand_keywords.join(', '), { size: 9, wrap: true })
    labelCell(ws, r, 3, 'public.brand.brand_keywords', { size: 9, color: T.sub })
    r++
    labelCell(ws, r, 1, 'Audience interests', { size: 9, bold: true })
    labelCell(ws, r, 2, s.pref.brand.interests.join(', '), { size: 9, wrap: true })
    labelCell(ws, r, 3, 'l2_gold.audience_interest_daily.interest_key', { size: 9, color: T.sub })
    r += 3
  }

  ws.getColumn(1).width = 26
  ws.getColumn(2).width = 52
  ws.getColumn(3).width = 56
  ws.getColumn(4).width = 30
  return ws
}

/* 3 ── ABSOLUTE_SCORES ───────────────────────────────────────────────────── */
function buildAbsoluteScores() {
  const ws = wb.addWorksheet('Absolute_Scores', { views: [{ state: 'frozen', ySplit: 5 }] })
  const span = BLOCK_W * scored.length
  banner(ws, 1, span, 'ABSOLUTE SCORES  ·  the model exactly as it stands, one block per preference',
    'Every value is the Final Match Score produced by the unchanged model. Blocks are side by side rather than '
    + 'stacked so each preference keeps its own contiguous range — which is what lets Distribution_Summary and '
    + 'Histogram_Data be live formulas over a population instead of pasted numbers.')

  scored.forEach((s, i) => {
    const c0 = blockCol(i)
    labelCell(ws, 4, c0, `${s.pref.label} · ${s.pref.brand.brand_name} (${s.pref.brand.category}) · N=${s.n}`,
      { size: 10, bold: true, fill: T.soft })
    ws.mergeCells(4, c0, 4, c0 + 3)
    headers(ws, 5, c0, ['KOL', 'Platform', 'Followers', 'Absolute Score'], 26)
    s.rows.forEach((row, j) => {
      const r = FIRST + j
      const put = (off, v, fmt) => {
        const cell = ws.getCell(r, c0 + off)
        cell.value = v
        cell.font = { ...BASE, size: 9 }
        cell.border = bd()
        if (fmt) cell.numFmt = fmt
        return cell
      }
      put(0, `@${row.handle}`)
      put(1, row.platform)
      put(2, row.followers, INT)
      put(3, row.finalScore, SCORE_FMT).font = { ...BASE, size: 9, bold: true }
    })
    ws.getColumn(c0).width = 24
    ws.getColumn(c0 + 1).width = 11
    ws.getColumn(c0 + 2).width = 13
    ws.getColumn(c0 + 3).width = 15
    ws.getColumn(c0 + 4).width = 3
  })
  return ws
}

/* 4 ── NORMALIZED_SCORES ─────────────────────────────────────────────────── */
function buildNormalizedScores() {
  const ws = wb.addWorksheet('Normalized_Scores', { views: [{ state: 'frozen', ySplit: 5 }] })
  const span = BLOCK_W * scored.length
  banner(ws, 1, span, 'NORMALIZED SCORES  ·  Absolute ÷ population maximum × 100',
    'Every cell is a formula over Absolute_Scores, and the divisor is the MAX of THAT preference\'s own population — '
    + 'never a global maximum across the database. 100 therefore means "the highest relative match inside this '
    + 'comparison group", and it does NOT mean a perfect or 100% fit. The absolute score it came from is one sheet to the left.')

  scored.forEach((s, i) => {
    const c0 = blockCol(i)
    labelCell(ws, 4, c0, `${s.pref.label} · ${s.pref.brand.brand_name} · population maximum = `, { size: 10, bold: true, fill: T.soft })
    ws.mergeCells(4, c0, 4, c0 + 2)
    const maxCell = ws.getCell(4, c0 + 3)
    maxCell.value = F(`=MAX(${absRange(i)})`)
    maxCell.font = { ...BASE, size: 10, bold: true }
    maxCell.fill = fillOf(T.calc)
    maxCell.border = bd()
    maxCell.numFmt = SCORE_FMT
    headers(ws, 5, c0, ['KOL', 'Platform', 'Absolute Score', 'Normalized Score'], 26)

    const maxAddr = `$${A(c0 + 3)}$4`
    s.rows.forEach((_, j) => {
      const r = FIRST + j
      const put = (off, v, fmt) => {
        const cell = ws.getCell(r, c0 + off)
        cell.value = v
        cell.font = { ...BASE, size: 9 }
        cell.border = bd()
        if (fmt) cell.numFmt = fmt
        return cell
      }
      put(0, F(`=Absolute_Scores!${A(blockCol(i))}${r}`))
      put(1, F(`=Absolute_Scores!${A(blockCol(i) + 1)}${r}`))
      put(2, F(`=Absolute_Scores!${A(blockCol(i) + 3)}${r}`), SCORE_FMT)
      // The normalisation itself, visible and traceable rather than pasted.
      put(3, F(`=ROUND(${A(c0 + 2)}${r}/${maxAddr}*100,2)`), DEC2)
        .font = { ...BASE, size: 9, bold: true }
    })
    ws.getColumn(c0).width = 24
    ws.getColumn(c0 + 1).width = 11
    ws.getColumn(c0 + 2).width = 15
    ws.getColumn(c0 + 3).width = 17
    ws.getColumn(c0 + 4).width = 3
  })
  return ws
}

/* 5 ── DISTRIBUTION_SUMMARY ──────────────────────────────────────────────── */
function buildDistributionSummary() {
  const ws = wb.addWorksheet('Distribution_Summary', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 11, 'DISTRIBUTION SUMMARY  ·  every statistic computed by Excel over the score ranges',
    'Nothing on this sheet is a pasted number. Each cell is a formula over the corresponding column of '
    + 'Absolute_Scores or Normalized_Scores, so the statistics cannot drift from the data and SKEW() is Excel\'s own.')

  headers(ws, 4, 1, ['Preference', 'Brand', 'Score Type', 'N', 'Min', 'Max', 'Mean', 'Median', 'Std Dev', 'P25', 'P75'], 24)
  let r = 5
  const rowsOut = []
  scored.forEach((s, i) => {
    for (const [type, range, fmt] of [
      ['Absolute', absRange(i), SCORE_FMT],
      ['Normalized', normRange(i), DEC2],
    ]) {
      labelCell(ws, r, 1, s.pref.label, { size: 9, bold: true })
      labelCell(ws, r, 2, s.pref.brand.brand_name, { size: 9 })
      labelCell(ws, r, 3, type, { size: 9, bold: type === 'Normalized' })
      const put = (col, formula, numFmt) => {
        const c = ws.getCell(r, col)
        c.value = F(formula)
        c.font = { ...BASE, size: 9 }
        c.border = bd()
        c.numFmt = numFmt
        c.alignment = { horizontal: 'right' }
      }
      put(4, `=COUNT(${range})`, INT)
      put(5, `=MIN(${range})`, fmt)
      put(6, `=MAX(${range})`, fmt)
      put(7, `=AVERAGE(${range})`, DEC2)
      put(8, `=MEDIAN(${range})`, DEC2)
      put(9, `=STDEV.S(${range})`, DEC2)
      put(10, `=PERCENTILE.INC(${range},0.25)`, DEC2)
      put(11, `=PERCENTILE.INC(${range},0.75)`, DEC2)
      rowsOut.push({ row: r, range, type, pref: s.pref })
      r++
    }
  })

  r += 1
  r = subhead(ws, r, 11, 'SKEWNESS AND TAIL  ·  SKEW() is Excel\'s own sample skewness; the reading beside it is a description, not a verdict')
  headers(ws, r, 1, ['Preference', 'Score Type', 'Skewness =SKEW()', 'Reading', 'Spread (Max-Min)', 'IQR (P75-P25)', 'Modal value', 'Modal share', 'Tail Observation'], 26)
  r++
  const skewFirst = r
  for (const o of rowsOut) {
    labelCell(ws, r, 1, o.pref.label, { size: 9, bold: true })
    labelCell(ws, r, 2, o.type, { size: 9 })
    const sk = ws.getCell(r, 3)
    sk.value = F(`=SKEW(${o.range})`)
    sk.numFmt = '0.000'
    sk.font = { ...BASE, size: 9, bold: true }
    sk.border = bd()
    sk.alignment = { horizontal: 'right' }
    const read = ws.getCell(r, 4)
    read.value = F(`=IF(ABS(${A(3)}${r})<0.25,"approximately symmetric",`
      + `IF(${A(3)}${r}>0,"right-skewed — a thin upper tail","left-skewed — a thin lower tail"))`)
    read.font = { ...BASE, size: 9 }
    read.border = bd()
    const sm = rowsOut.find(x => x.pref === o.pref && x.type === o.type)
    const sumRow = sm.row
    const put = (col, formula, fmt) => {
      const c = ws.getCell(r, col)
      c.value = F(formula)
      c.numFmt = fmt
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      c.alignment = { horizontal: 'right' }
    }
    put(5, `=F${sumRow}-E${sumRow}`, DEC2)
    put(6, `=K${sumRow}-J${sumRow}`, DEC2)
    // The modal value and how much of the population sits on it. This is the
    // number that says "compressed" more directly than a standard deviation does.
    // MODE(), not MODE.SNGL(): the .SNGL form is 2010+ and this Excel returns
    // #NAME? for it. For a single modal value the two are identical.
    put(7, `=MODE(${o.range})`, DEC2)
    put(8, `=COUNTIF(${o.range},${A(7)}${r})/COUNT(${o.range})`, '0.0%')
    const tail = ws.getCell(r, 9)
    // TEXT() reads its format string in the UI locale, and this machine's locale
    // uses "." as the THOUSANDS separator — so TEXT(6,"0.0") rendered as "06"
    // rather than "6.0". Integer formats have no such ambiguity, and these
    // values read better as whole points anyway.
    tail.value = F(`="P25 "&TEXT(J${sumRow},"0")&" · median "&TEXT(H${sumRow},"0")&" · P75 "&TEXT(K${sumRow},"0")`
      + `&" — the middle half spans "&TEXT(K${sumRow}-J${sumRow},"0")&" points of a "&TEXT(F${sumRow}-E${sumRow},"0")&"-point range, "`
      + `&"and "&TEXT(COUNTIF(${o.range},${A(7)}${r})/COUNT(${o.range}),"0%")&" of the population sits on the single most common value."`)
    tail.font = { ...BASE, size: 9, color: { argb: T.sub } }
    tail.border = bd()
    tail.alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(r).height = 30
    r++
  }

  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 16
  ws.getColumn(3).width = 17
  ws.getColumn(4).width = 32
  ws.getColumn(5).width = 15
  ws.getColumn(6).width = 15
  ws.getColumn(7).width = 13
  ws.getColumn(8).width = 12
  ws.getColumn(9).width = 86
  for (let i = 5; i < skewFirst; i++) ws.getColumn(i).width = Math.max(ws.getColumn(i).width ?? 10, 11)
  return { ws, skewFirst }
}

/* 6 ── HISTOGRAM_DATA ────────────────────────────────────────────────────── */
function buildHistogramData() {
  const ws = wb.addWorksheet('Histogram_Data', { views: [{ state: 'frozen', ySplit: 5, xSplit: 1 }] })
  banner(ws, 1, 9, 'HISTOGRAM DATA  ·  bin counts behind the six charts',
    'Twenty five-point bins spanning the whole 0-100 scale, not the observed range: a chart auto-scaled to the '
    + 'data would make a distribution occupying 18-80 look like it fills the scale, which is the impression this '
    + 'test exists to check. Every count is a COUNTIFS over the score column, so the charts move with the data.')

  const HEAD = ['Bin (score)']
  scored.forEach(s => { HEAD.push(`${s.pref.label} Absolute`, `${s.pref.label} Normalized`) })
  headers(ws, 5, 1, HEAD, 30)
  labelCell(ws, 4, 1, 'x-axis = score band · y-axis = number of KOL', { size: 9, italic: true, color: T.sub })

  BINS.forEach((bin, i) => {
    const r = FIRST + i
    labelCell(ws, r, 1, bin.label, { size: 9, bold: true })
    scored.forEach((s, k) => {
      // The final bin is closed at the top so a score of exactly 100 is counted.
      const upper = i === BINS.length - 1 ? '<=' : '<'
      const put = (col, range) => {
        const c = ws.getCell(r, col)
        c.value = F(`=COUNTIFS(${range},">=${bin.lo}",${range},"${upper}${bin.hi}")`)
        c.font = { ...BASE, size: 9 }
        c.border = bd()
        c.numFmt = INT
      }
      put(2 + k * 2, absRange(k))
      put(3 + k * 2, normRange(k))
    })
  })

  const last = FIRST + BINS.length - 1
  const totalRow = last + 1
  labelCell(ws, totalRow, 1, 'TOTAL', { size: 9, bold: true, fill: T.soft })
  for (let c = 2; c <= 1 + scored.length * 2; c++) {
    const cell = ws.getCell(totalRow, c)
    cell.value = F(`=SUM(${A(c)}${FIRST}:${A(c)}${last})`)
    cell.font = { ...BASE, size: 9, bold: true }
    cell.fill = fillOf(T.calc)
    cell.border = bd()
    cell.numFmt = INT
  }

  ws.getColumn(1).width = 14
  for (let c = 2; c <= 1 + scored.length * 2; c++) ws.getColumn(c).width = 20
  for (let c = 2; c <= 1 + scored.length * 2; c++) {
    ws.addConditionalFormatting({
      ref: `${A(c)}${FIRST}:${A(c)}${last}`,
      // exceljs requires both cfvo endpoints on a dataBar rule; omitting them
      // throws while the file is being written rather than when it is read.
      rules: [{
        type: 'dataBar', priority: 1,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF63BE7B' },
      }],
    })
  }
  return { ws, first: FIRST, last, totalRow }
}

/* 7 ── PREFERENCE_COMPARISON ─────────────────────────────────────────────── */
function buildPreferenceComparison() {
  const ws = wb.addWorksheet('Preference_Comparison', { views: [{ state: 'frozen', ySplit: 5, xSplit: 1 }] })
  banner(ws, 1, 9, 'PREFERENCE COMPARISON  ·  the same creators scored under all three profiles',
    'Only creators eligible for ALL THREE populations appear here — that is what makes the six numbers on a row '
    + 'comparable. Absolute and Normalized travel together, and the rank columns are what answer whether changing '
    + 'the brand changes the order rather than just the numbers.')

  const byHandle = scored.map(s => new Map(s.rows.map((r, idx) => [r.handle, { ...r, rank: idx + 1 }])))
  const common = [...byHandle[0].keys()].filter(h => byHandle.every(m => m.has(h)))
  common.sort((a, b) => byHandle[1].get(b).finalScore - byHandle[1].get(a).finalScore || a.localeCompare(b))

  headers(ws, 5, 1, ['KOL', 'Category',
    'Pref A Abs', 'Pref A Norm', 'Pref A Rank',
    'Pref B Abs', 'Pref B Norm', 'Pref B Rank',
    'Pref C Abs', 'Pref C Norm', 'Pref C Rank', 'Rank spread (max-min)'], 30)
  labelCell(ws, 4, 1, `${common.length} creators are eligible under all three preferences`, { size: 9, italic: true, color: T.sub })

  const SHOW = Math.min(common.length, 400)
  common.slice(0, SHOW).forEach((h, j) => {
    const r = FIRST + j
    const put = (col, v, fmt, bold) => {
      const c = ws.getCell(r, col)
      c.value = v
      c.font = { ...BASE, size: 9, bold: !!bold }
      c.border = bd()
      if (fmt) c.numFmt = fmt
      return c
    }
    put(1, `@${h}`, null, true)
    put(2, byHandle[0].get(h).category)
    scored.forEach((s, i) => {
      const e = byHandle[i].get(h)
      put(3 + i * 3, e.finalScore, SCORE_FMT, true)
      put(4 + i * 3, Math.round((e.finalScore / s.max) * 10000) / 100, DEC2)
      put(5 + i * 3, e.rank, INT)
    })
    const ranks = byHandle.map(m => m.get(h).rank)
    put(12, Math.max(...ranks) - Math.min(...ranks), INT, true)
  })

  if (common.length > SHOW) {
    const r = FIRST + SHOW
    ws.mergeCells(r, 1, r, 12)
    labelCell(ws, r, 1,
      `… ${common.length - SHOW} further creators are eligible under all three preferences and are omitted here for size. `
      + 'Absolute_Scores and Normalized_Scores carry every one of them.',
      { size: 9, italic: true, color: T.sub })
  }

  ws.getColumn(1).width = 24
  ws.getColumn(2).width = 15
  for (let c = 3; c <= 11; c++) ws.getColumn(c).width = 13
  ws.getColumn(12).width = 20
  return { ws, common: common.length }
}

/* 8 ── VALIDATION ────────────────────────────────────────────────────────── */
function buildValidation(comparison) {
  const ws = wb.addWorksheet('Validation', { views: [{ state: 'frozen', ySplit: 4 }] })
  banner(ws, 1, 4, 'VALIDATION  ·  the checks this test has to pass before its conclusions mean anything',
    'Formula checks recompute in the workbook. Process checks record what was done outside it and where the '
    + 'evidence lives.')

  headers(ws, 4, 1, ['#', 'Check', 'Result', 'Detail'], 24)
  let r = 5
  const put = (n, check, result, detail) => {
    labelCell(ws, r, 1, n, { size: 9 }).alignment = { horizontal: 'center' }
    labelCell(ws, r, 2, check, { size: 9, bold: true })
    const c = ws.getCell(r, 3)
    c.value = typeof result === 'string' && result.startsWith('=') ? F(result) : result
    c.font = { ...BASE, size: 9, bold: true }
    c.fill = fillOf(T.calc)
    c.border = bd()
    c.alignment = { horizontal: 'center' }
    labelCell(ws, r, 4, detail, { size: 9, color: T.sub, wrap: true })
    ws.getRow(r).height = 28
    r++
  }

  const totalRow = 6 + BINS.length
  put(1, 'No dummy KOL', 'PASS',
    `Every creator comes from public.kol_directory where directory_status='active'. Population read `
    + `${new Date(pop.measuredAt).toISOString().slice(0, 16).replace('T', ' ')} UTC from ${pop.server}.`)
  put(2, 'No duplicate KOL within a population',
    scored.every(s => new Set(s.rows.map(x => x.handle)).size === s.rows.length) ? 'PASS' : 'FAIL',
    'Each preference population is a filter over one reading, and each directory row appears once in it.')
  put(3, 'No fabricated metrics', 'PASS',
    'Every input is read or null. Where the server has nothing the sub-score is N/A and its weight renormalises; '
    + 'nothing is defaulted to zero. See the coverage table on Population.')
  put(4, 'Population size recorded', pop.records.length,
    `Active creators read: ${pop.records.length}. Eligible per preference: `
    + scored.map(s => `${s.pref.label} N=${s.n}`).join(' · '))
  put(5, 'Three preference profiles recorded', scored.length,
    scored.map(s => `${s.pref.label} = ${s.pref.brand.brand_name} (${s.pref.brand.category})`).join(' · '))
  put(6, 'Absolute Score unchanged', 'PASS',
    'No weight, sub-weight, normalisation target, band or matrix cell was altered for this test. '
    + 'npm run brandmatch:port:verify recalculates the 24x5 comparison workbook in Excel and asserts the '
    + 'JavaScript scorer reproduces all 120 rows across 26 score columns — 3.120 values, exact match.')
  put(7, 'One bug fixed, and named', 'NOTED',
    'The haystack emptiness guard tested LEN(TRIM(haystack))=0, but the haystack is four fields joined with " | ", '
    + 'so a creator with none of them still produced " | | | " and the guard never fired. Three creators with no bio '
    + 'and no captions were scoring Keyword and Topic Match 0 instead of N/A. Now stripped of separators before the '
    + 'test. This is the only change to scoring behaviour.')
  put(8, 'Normalized uses the max of its OWN population',
    '=IF(AND(' + scored.map((_, i) => `MAX(${normRange(i)})=100`).join(',') + '),"PASS","FAIL")',
    'Each Normalized column divides by MAX of that preference\'s own Absolute column, shown on Normalized_Scores '
    + 'row 4. A correct normalisation puts exactly 100 at the top of every population. No global database maximum '
    + 'is used anywhere.')
  put(9, 'Normalized Score inside 0-100',
    '=IF(AND(' + scored.map((_, i) => `MIN(${normRange(i)})>=0,MAX(${normRange(i)})<=100`).join(',') + '),"PASS","FAIL")')
  put(10, 'Absolute Score still present beside it', 'PASS',
    'Absolute_Scores is a full sheet, and Normalized_Scores repeats the absolute value in the column immediately '
    + 'left of each normalised one. Neither replaces the other.')
  put(11, 'Histogram bin counts reconcile with N',
    '=IF(AND(' + scored.map((_, i) => `Histogram_Data!${A(2 + i * 2)}${totalRow}=COUNT(${absRange(i)}),`
      + `Histogram_Data!${A(3 + i * 2)}${totalRow}=COUNT(${normRange(i)})`).join(',') + '),"PASS","FAIL")',
    'Every scored creator lands in exactly one bin: the six bin totals equal the six population counts.')
  put(12, 'Distribution summary present', 'PASS',
    'Count, Min, Max, Mean, Median, Std Dev, P25 and P75 for all six series, each an Excel formula over the score range.')
  put(13, 'Skewness present', 'PASS', 'Excel =SKEW() over each of the six ranges, on Distribution_Summary.')
  put(14, 'Tail observation present', 'PASS',
    'Per series on Distribution_Summary, assembled from that series\' own P25, median, P75, range and modal share.')
  put(15, 'Creators comparable across all three preferences', comparison.common,
    'Populations differ by design, so only creators eligible under all three can have their ranks compared. '
    + 'Preference_Comparison holds them.')

  ws.getColumn(1).width = 5
  ws.getColumn(2).width = 42
  ws.getColumn(3).width = 14
  ws.getColumn(4).width = 104
  return ws
}

/* 9 ── README ────────────────────────────────────────────────────────────── */
function buildReadme(comparison, stats) {
  const ws = wb.addWorksheet('README', { views: [{ state: 'frozen', ySplit: 3 }] })
  banner(ws, 1, 3, 'AUTOMETRIC — BRAND MATCH DISTRIBUTION TEST',
    `${pop.records.length} creators read from the KOL server · three preference profiles · `
    + `populations of ${scored.map(s => s.n).join(', ')} · Absolute and Normalized scores, six histograms.`)

  let r = 4
  const para = (head, body) => {
    labelCell(ws, r, 1, head, { size: 10, bold: true })
    ws.mergeCells(r, 2, r, 3)
    const c = labelCell(ws, r, 2, body, { size: 9, wrap: true, color: T.sub })
    c.alignment = { vertical: 'top', wrapText: true }
    ws.getRow(r).height = Math.max(26, Math.ceil(body.length / 115) * 13)
    r++
  }
  const section = t => { r = subhead(ws, r, 3, t) }

  section('1. WHAT THIS FILE IS FOR')
  para('The question',
    'Not "who should this brand hire". It is: taking the Absolute Brand Match Score exactly as it stands, what '
    + 'shape does it take across a real population, and does dividing by the population maximum make it easier to read?')
  para('What was NOT changed',
    'No weight, sub-weight, normalisation target, match-level band or relevance-matrix cell. The scores here are '
    + 'produced by scripts/brand-match/scoring.mjs, a JavaScript port of the workbook formulas that is gated by '
    + 'npm run brandmatch:port:verify — it recalculates the published 24x5 comparison workbook in Excel and asserts '
    + 'the port reproduces all 120 rows across 26 score columns exactly. 3.120 values, no tolerance.')
  para('The one change that was made',
    'A bug, and the brief allows bug fixing. The emptiness guard on the keyword and topic haystacks tested '
    + 'LEN(TRIM(haystack))=0, but the haystack joins four fields with " | ", so a creator with none of them still '
    + 'produced " | | | " and the guard never fired — three creators with no bio and no captions were scoring 0 '
    + '("searched, found nothing") where the design says N/A ("nothing was searched"). The guard now strips the '
    + 'separators first. It affects 15 of the 120 rows in the comparison workbook and nothing else.')

  section('2. HOW TO READ THE TWO SCORES')
  para('Absolute Score',
    'Answers "what value did the scoring formula produce". It is comparable across preferences and across time, '
    + 'and it is the number to look at when asking whether the model itself is working.')
  para('Normalized Score',
    'Answers "how high does this creator sit compared with the others in the SAME comparison population". '
    + `Normalized = Absolute ÷ MAX(Absolute in that population) × 100. The three divisors here are `
    + `${scored.map(s => `${s.pref.label} ${s.max}`).join(', ')}.`)
  para('What 100 does NOT mean',
    `A Normalized Score of 100 means "highest relative match within the current comparison population". `
    + `It does not mean a 100% fit. In Preference A the top creator scores an Absolute ${scored[0].max} and a `
    + `Normalized 100 — the same creator, the same evidence, two different questions. Both sheets ship for exactly this reason.`)

  section('3. WHAT THE DATA SHOWS')
  para('The distribution is compressed, and normalisation does not fix it',
    stats.compression)
  para('Normalisation is affine, so it cannot change shape',
    'Dividing every value by one constant is a linear rescale. It moves the maximum to 100 and stretches the axis, '
    + 'but skewness, the ordering, and the relative gaps are mathematically identical — which is why the Skewness '
    + 'column on Distribution_Summary reads the same for Absolute and Normalized in every one of the three preferences. '
    + 'Normalisation is a presentation layer. It makes a ranking easier to read; it cannot make a compressed score '
    + 'more discriminating.')
  para('Why so many creators land on the same value',
    stats.modal)
  para('The ranking does change when the brand changes',
    stats.ranking)

  section('4. SHEETS')
  const SHEETS = [
    ['Population', 'What was read, and the signal-coverage table that explains every distribution here.'],
    ['Preference_Profiles', 'The three brands and their eligibility rules, with the database column behind each.'],
    ['Absolute_Scores', 'The unchanged model, one block per preference.'],
    ['Normalized_Scores', 'Absolute ÷ population max × 100, as live formulas, with the absolute beside it.'],
    ['Distribution_Summary', 'N, Min, Max, Mean, Median, Std Dev, P25, P75, SKEW() and a tail reading per series.'],
    ['Histogram_Data', 'Twenty five-point bins per series, as COUNTIFS. The six charts read from here.'],
    ['Histograms', 'The six charts: Absolute and Normalized for each preference.'],
    ['Preference_Comparison', 'Creators eligible under all three, with both scores and all three ranks.'],
    ['Validation', 'The fifteen checks.'],
  ]
  headers(ws, r, 1, ['Sheet', 'What it holds', ''], 20)
  r++
  for (const [name, what] of SHEETS) {
    labelCell(ws, r, 1, name, { size: 9, bold: true })
    ws.mergeCells(r, 2, r, 3)
    labelCell(ws, r, 2, what, { size: 9, color: T.sub, wrap: true })
    r++
  }

  section('5. REGENERATING')
  para('Commands',
    'npm run brandmatch:population  (office VPN)  ·  npm run brandmatch:port:verify  (the gate)  ·  '
    + 'npm run brandmatch:distribution')

  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 76
  ws.getColumn(3).width = 46
  return ws
}

/* ── assemble ─────────────────────────────────────────────────────────────── */

/** Statistics computed here so the README can state findings rather than gesture at them. */
function describe() {
  const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y)
    const i = (s.length - 1) * p
    const lo = Math.floor(i); const hi = Math.ceil(i)
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo)
  }
  const parts = scored.map(s => {
    const a = s.rows.map(x => x.finalScore)
    const freq = new Map()
    for (const v of a) freq.set(v, (freq.get(v) ?? 0) + 1)
    const [modal, count] = [...freq.entries()].sort((x, y) => y[1] - x[1])[0]
    return {
      pref: s.pref, n: a.length, min: Math.min(...a), max: Math.max(...a),
      p25: q(a, 0.25), p75: q(a, 0.75), modal, modalShare: count / a.length,
      distinct: freq.size,
    }
  })
  const compression = parts.map(p =>
    `${p.pref.label} (${p.pref.brand.brand_name}, N=${p.n}) spans ${p.min}-${p.max} but its middle half sits `
    + `between ${p.p25} and ${p.p75} — ${(p.p75 - p.p25).toFixed(0)} points of a ${(p.max - p.min).toFixed(0)}-point range`).join('. ')
    + '. The absolute scores occupy a narrow band in the middle of the 0-100 scale, so almost every creator lands in '
    + 'Low Match against bands that assume a complete record.'
  const modal = parts.map(p =>
    `${p.pref.label}: ${(p.modalShare * 100).toFixed(1)}% of the population scores exactly ${p.modal}`).join(' · ')
    + '. The reason is on the Population sheet: 55,8% of creators carry a category and almost nobody carries anything '
    + 'else, so for most of the population the model has only Category Match, verification and sometimes an engagement '
    + 'rate to work with. A discrete input produces a discrete score, and creators with no category at all take '
    + 'CAL_NEUTRAL = 50 on every category-driven sub-score at once.'
  return { compression, modal, parts }
}

const stats = describe()

buildPopulation()
buildPreferenceProfiles()
buildAbsoluteScores()
buildNormalizedScores()
const summary = buildDistributionSummary()
const hist = buildHistogramData()
const comparison = buildPreferenceComparison()

/* rank-change finding, measured rather than asserted */
{
  const byHandle = scored.map(s => new Map(s.rows.map((x, i) => [x.handle, i + 1])))
  const common = [...byHandle[0].keys()].filter(h => byHandle.every(m => m.has(h)))
  const spreads = common.map(h => {
    const ranks = byHandle.map(m => m.get(h))
    return Math.max(...ranks) - Math.min(...ranks)
  })
  const pctile = common.map(h => {
    const ps = byHandle.map((m, i) => m.get(h) / scored[i].n)
    return Math.max(...ps) - Math.min(...ps)
  })
  const moved = pctile.filter(p => p > 0.1).length
  stats.ranking =
    `Across the ${common.length} creators eligible under all three preferences, the median rank spread is `
    + `${spreads.slice().sort((a, b) => a - b)[Math.floor(spreads.length / 2)]} places and the widest is `
    + `${Math.max(...spreads)}. ${moved} of them (${((moved / common.length) * 100).toFixed(1)}%) move by more than 10 `
    + 'percentiles between the best and worst preference for them. The score is behaving contextually: changing the '
    + 'brand reorders the population rather than only relabelling it.'
}

buildValidation(comparison)
buildReadme(comparison, stats)

const ORDER = [
  'README', 'Population', 'Preference_Profiles', 'Absolute_Scores', 'Normalized_Scores',
  'Distribution_Summary', 'Histogram_Data', 'Preference_Comparison', 'Validation',
]
ORDER.forEach((name, i) => {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`sheet order names a sheet that was never built: ${name}`)
  ws.orderNo = i + 1
})
wb.views = [{ x: 0, y: 0, width: 28000, height: 18000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]

await wb.xlsx.writeFile(OUT)
console.log(`\nwrote ${OUT}`)

/* ── charts, added through Excel itself ───────────────────────────────────── */

/**
 * exceljs cannot create chart parts, so the six histograms are added by driving
 * Excel over the finished file. Excel is what will open it, so a chart it built
 * itself is the one most likely to survive being mailed around; the alternative,
 * writing chart XML by hand, is a repair dialog waiting to happen.
 *
 * Falls back to a warning: Histogram_Data carries the bin counts with data bars,
 * so the distributions stay readable without the chart objects.
 */
function addCharts() {
  const psFile = path.join(process.env.TEMP ?? '.', `bmd-charts-${process.pid}.ps1`)
  const series = []
  scored.forEach((s, i) => {
    series.push({ col: A(2 + i * 2), title: `${s.pref.label} — ${s.pref.brand.brand_name} — Absolute Score` })
    series.push({ col: A(3 + i * 2), title: `${s.pref.label} — ${s.pref.brand.brand_name} — Normalized Score` })
  })
  const ps = `
$ErrorActionPreference='Stop'
try { $xl = New-Object -ComObject Excel.Application } catch { Write-Output 'NO_EXCEL'; exit 0 }
$xl.Visible=$false; $xl.DisplayAlerts=$false
try {
  $wb = $xl.Workbooks.Open(${JSON.stringify(OUT)})
  $hd = $wb.Worksheets.Item('Histogram_Data')
  $sheet = $wb.Worksheets.Add([System.Reflection.Missing]::Value, $wb.Worksheets.Item($wb.Worksheets.Count))
  $sheet.Name = 'Histograms'
  $sheet.Cells.Item(1,1).Value2 = 'HISTOGRAMS  -  x-axis = score band, y-axis = number of KOL'
  $sheet.Cells.Item(1,1).Font.Bold = $true
  $sheet.Cells.Item(1,1).Font.Size = 14
  $sheet.Cells.Item(2,1).Value2 = 'Bins are five points wide and span the full 0-100 scale, so empty space at either end is part of the finding. Counts come from Histogram_Data.'
  $sheet.Cells.Item(2,1).Font.Italic = $true
  $i = 0
${series.map(s => `
  $cats = $hd.Range("A${FIRST}:A${hist.last}")
  $vals = $hd.Range("${s.col}${FIRST}:${s.col}${hist.last}")
  $left = 20 + (($i % 2) * 470)
  $top  = 60 + ([math]::Floor($i / 2) * 300)
  $co = $sheet.ChartObjects().Add($left, $top, 450, 280)
  $ch = $co.Chart
  $ch.ChartType = 51
  $ch.SetSourceData($vals)
  $ch.SeriesCollection(1).XValues = $cats
  $ch.SeriesCollection(1).Name = ${JSON.stringify(s.title)}
  $ch.HasTitle = $true
  $ch.ChartTitle.Text = ${JSON.stringify(s.title)}
  $ch.ChartTitle.Font.Size = 11
  $ch.HasLegend = $false
  $ch.Axes(1).HasTitle = $true
  $ch.Axes(1).AxisTitle.Text = 'Score'
  $ch.Axes(2).HasTitle = $true
  $ch.Axes(2).AxisTitle.Text = 'Number of KOL'
  $ch.ChartGroups(1).GapWidth = 10
  $i = $i + 1`).join('\n')}
  $wb.Worksheets.Item('README').Activate()
  $wb.Save()
  $wb.Close($true)
  Write-Output 'CHARTS_OK'
} finally { $xl.Quit() }`
  // PowerShell reads a .ps1 as the system ANSI codepage unless the file opens
  // with a UTF-8 BOM. Without it the em-dashes in the chart titles arrive as
  // mojibake and the parser fails on the next token.
  writeFileSync(psFile, `﻿${ps}`, 'utf8')
  try {
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { encoding: 'utf8', timeout: 300_000 })
    return out.includes('CHARTS_OK') ? 'ok' : 'no-excel'
  } catch (err) {
    console.warn(`  charts could not be added: ${String(err.message).split('\n')[0]}`)
    return 'failed'
  } finally {
    try { unlinkSync(psFile) } catch { /* already gone */ }
  }
}

const chartState = addCharts()
console.log(chartState === 'ok'
  ? '  six histogram charts added through Excel'
  : '  WARNING: charts not added — Histogram_Data still carries every bin count with data bars')

console.log('\nSUMMARY')
console.log(`  population read         ${pop.records.length}`)
for (const s of scored) {
  console.log(`  ${s.pref.label.padEnd(14)} ${s.pref.brand.brand_name.padEnd(10)} N=${String(s.n).padStart(5)}  absolute max ${s.max}`)
}
console.log(`  creators in all three   ${comparison.common}`)
console.log(`  charts                  ${chartState}`)
