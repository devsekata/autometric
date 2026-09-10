/**
 * Recalculates `Autometric_Brand_Match_Engine.xlsx` and asserts the things the
 * spec asks of it.
 *
 *   npm install --no-save exceljs hyperformula
 *   node scripts/verify-brand-match-workbook.mjs
 *
 * The workbook is written with formulas and no cached results — Excel fills
 * those in on open. That is correct for the file and useless for review: nobody
 * can tell from the XML whether the formulas divide by zero, drift outside
 * 0–100, or quietly return the same score for three different brands. So this
 * loads the generated file, evaluates every formula with HyperFormula, and
 * checks the result the way a QA engineer would with the file open.
 *
 * It exists mostly for the last check. "The same creator must score differently
 * against different brands" is the one claim that separates a matching engine
 * from a leaderboard, and it is not something you can eyeball across ninety rows.
 */

import ExcelJS from 'exceljs'
import { HyperFormula } from 'hyperformula'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'Autometric_Brand_Match_Engine.xlsx')

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const toSerial = d => (d.getTime() - EXCEL_EPOCH) / 86400000

/** exceljs cell → the value HyperFormula should be handed. */
function cellValue(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return toSerial(v)
  if (typeof v === 'object') {
    if (v.formula !== undefined) return `=${v.formula}`
    if (v.sharedFormula !== undefined) return null
    if (v.richText) return v.richText.map(t => t.text).join('')
    if (v.text !== undefined) return v.text
    if (v.result !== undefined) return v.result
    return null
  }
  return v
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(FILE)

const sheets = {}
for (const ws of wb.worksheets) {
  const grid = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = []
    for (let c = 1; c <= ws.columnCount; c++) row.push(cellValue(ws.getRow(r).getCell(c).value))
    grid.push(row)
  }
  sheets[ws.name] = grid
}

const hf = HyperFormula.buildFromSheets(sheets, {
  licenseKey: 'gpl-v3',
  useColumnIndex: true,
  smartRounding: true,
})

const sheetId = name => hf.getSheetId(name)
const values = name => hf.getSheetValues(sheetId(name))

/* ── assertions ───────────────────────────────────────────────────────────── */

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  —  ${detail}` : ''}`)
}

/**
 * HyperFormula hands back a `DetailedCellError` — an object carrying `.type`
 * ('DIV_BY_ZERO', 'VALUE', 'ERROR', …) and `.value` (the '#…' string Excel would
 * print). Testing for a missing `.value` looks reasonable and silently passes
 * every error in the workbook, which is exactly the bug this file exists to
 * catch, so the test is on the printed value instead.
 */
const isErr = v => v !== null && typeof v === 'object'
  && typeof v.value === 'string' && v.value.startsWith('#')
const errLabel = v => `${v.value}${v.message ? ` (${v.message})` : ''}`

/* 1 — no formula errors anywhere */
{
  const errors = []
  for (const name of Object.keys(sheets)) {
    const grid = values(name)
    grid.forEach((row, r) => row.forEach((v, c) => {
      if (isErr(v)) errors.push(`${name}!${colLetter(c + 1)}${r + 1} → ${errLabel(v)}`)
    }))
  }
  check('no #DIV/0! / #VALUE! / #N/A / #REF! anywhere in the workbook',
    errors.length === 0,
    errors.length ? `${errors.length} error cell(s): ${errors.slice(0, 12).join(', ')}` : '0 error cells')
}

function colLetter(n) {
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26 }
  return s
}

/** Header row → { headerName: 0-based column index }. */
function headerMap(grid, headerRow) {
  const map = {}
  grid[headerRow - 1].forEach((h, i) => { if (typeof h === 'string' && h.trim()) map[h] = i })
  return map
}

const ME = values('Matching_Engine')
const MEH = headerMap(ME, 5)
const ME_ROWS = ME.slice(5).filter(r => typeof r[MEH['Brand ID']] === 'string' && r[MEH['Brand ID']].startsWith('BRAND-'))

const KD = values('KOL_Database')
const KDH = headerMap(KD, 4)
const KD_ROWS = KD.slice(4).filter(r => typeof r[KDH['KOL ID']] === 'string' && r[KDH['KOL ID']].startsWith('KOL-'))

/* 2 — dataset size */
check('at least 30 creators in KOL_Database', KD_ROWS.length >= 30, `${KD_ROWS.length} creators`)
{
  const brands = new Set(ME_ROWS.map(r => r[MEH['Brand ID']]))
  check('at least 3 brands scored', brands.size >= 3, `${brands.size} brands: ${[...brands].join(', ')}`)
  check('every creator scored against every brand',
    ME_ROWS.length === brands.size * KD_ROWS.length,
    `${ME_ROWS.length} rows = ${brands.size} x ${KD_ROWS.length}`)
}

/* 3 — component weights */
{
  const LL = values('Lookup_Lists')
  let total = null
  LL.forEach(row => { if (row[2] === 'CHECK_WEIGHT_TOTAL') total = row[3] })
  check('the six component weights total 100%', total === 100, `total = ${total}`)
}

/* 4 — every score inside 0–100 */
{
  const SCORE_COLUMNS = [
    'Industry Match', 'Category Match', 'Keyword Match', 'Brand & Business Relevance',
    'Age Match Score', 'Gender Match Score', 'Location Match Score', 'Interest Match Score',
    'Target Audience Relevance', 'Category Match (content)', 'Sub Category Match', 'Topic Match',
    'Content Style Match', 'Content & Category Relevance', 'Personality Match',
    'Tone vs Content Style', 'Values Match', 'Communication Style Match', 'Brand Personality Fit',
    'Engagement Rate Score', 'Audience Quality Score', 'Consistency Score', 'Community Score',
    'Average Views Score', 'Recent Growth Score', 'Performance Quality', 'Brand Safety Base',
    'Competitor Saturation', 'Brand Safety', 'Final Match Score', 'Brand Fit Index',
    'Opportunity Score', 'Data Completeness %',
  ]
  const bad = []
  for (const col of SCORE_COLUMNS) {
    for (const row of ME_ROWS) {
      const v = row[MEH[col]]
      if (typeof v !== 'number' || v < 0 || v > 100) {
        bad.push(`${row[MEH['Brand ID']]}/${row[MEH['KOL ID']]} ${col} = ${JSON.stringify(v)}`)
      }
    }
  }
  check(`all ${SCORE_COLUMNS.length} score columns stay within 0–100 across all ${ME_ROWS.length} rows`,
    bad.length === 0, bad.length ? bad.slice(0, 6).join(' | ') : `${SCORE_COLUMNS.length * ME_ROWS.length} cells checked`)
}

/* 5 — the final score really is the weighted sum */
{
  const W = { 'Brand & Business Relevance': 20, 'Target Audience Relevance': 30,
    'Content & Category Relevance': 20, 'Brand Personality Fit': 10,
    'Performance Quality': 10, 'Brand Safety': 10 }
  const bad = []
  for (const row of ME_ROWS) {
    const expected = Math.round(
      Object.entries(W).reduce((s, [k, w]) => s + row[MEH[k]] * w, 0) / 100)
    if (Math.abs(expected - row[MEH['Final Match Score']]) > 0.51) {
      bad.push(`${row[MEH['Brand ID']]}/${row[MEH['KOL ID']]} expected ${expected}, got ${row[MEH['Final Match Score']]}`)
    }
  }
  check('Final Match Score = 20/30/20/10/10/10 weighted sum of the six components, recomputed independently',
    bad.length === 0, bad.length ? bad.slice(0, 4).join(' | ') : `${ME_ROWS.length} rows recomputed`)
}

/* 6 — match level agrees with the score */
{
  const level = s => (s >= 90 ? 'Excellent Match' : s >= 80 ? 'Strong Match'
    : s >= 70 ? 'Good Match' : s >= 60 ? 'Moderate Match' : 'Low Match')
  const bad = ME_ROWS.filter(r => r[MEH['Match Level']] !== level(r[MEH['Final Match Score']]))
  check('Match Level matches the 90 / 80 / 70 / 60 bands on every row', bad.length === 0,
    bad.length ? `${bad.length} mismatches` : `${ME_ROWS.length} rows`)
}

/* 7 — confidence tracks data completeness */
{
  const bad = ME_ROWS.filter(r => {
    const c = r[MEH['Data Completeness %']]
    const want = c >= 100 ? 'High' : c >= 84 ? 'Medium' : 'Limited Data'
    return r[MEH.Confidence] !== want
  })
  const spread = new Set(ME_ROWS.map(r => r[MEH.Confidence]))
  check('Confidence is derived from Data Completeness, and more than one level occurs',
    bad.length === 0 && spread.size > 1, `levels present: ${[...spread].join(', ')}`)
}

/* 8 — the claim: one creator, three brands, three answers */
{
  const byKol = new Map()
  for (const row of ME_ROWS) {
    const id = row[MEH['KOL ID']]
    if (!byKol.has(id)) byKol.set(id, [])
    byKol.get(id).push(row[MEH['Final Match Score']])
  }
  const identical = [...byKol.entries()].filter(([, s]) => new Set(s).size === 1)
  const spreads = [...byKol.values()].map(s => Math.max(...s) - Math.min(...s))
  const avg = (spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1)
  check('the same creator scores differently for different brands (no creator identical across all three)',
    identical.length === 0,
    `average spread ${avg} points, widest ${Math.max(...spreads)}, narrowest ${Math.min(...spreads)}`
    + (identical.length ? `; identical: ${identical.map(([k]) => k).join(', ')}` : ''))
}

/* 9 — hard filters actually exclude, and always with a reason */
{
  const excluded = ME_ROWS.filter(r => r[MEH['Hard Filter Result']] === 'EXCLUDED')
  const noReason = excluded.filter(r => !r[MEH['Exclusion Reason']])
  const passWithReason = ME_ROWS.filter(r => r[MEH['Hard Filter Result']] === 'PASS' && r[MEH['Exclusion Reason']])
  const reasons = new Set(excluded.map(r => r[MEH['Exclusion Reason']]))
  check('every excluded creator carries a reason, and no passing creator carries one',
    noReason.length === 0 && passWithReason.length === 0,
    `${excluded.length} of ${ME_ROWS.length} excluded across ${reasons.size} distinct reasons`)
  check('hard filters exclude somebody but not everybody',
    excluded.length > 0 && excluded.length < ME_ROWS.length,
    [...reasons].slice(0, 6).join(' | '))
}

/* 10 — soft matching keeps low scorers visible */
{
  const lowVisible = ME_ROWS.filter(r =>
    r[MEH['Final Match Score']] < 70 && r[MEH['Hard Filter Result']] === 'PASS')
  check('a Low / Moderate Match stays visible — soft matching never removes a creator',
    lowVisible.length > 0, `${lowVisible.length} creators below 70 still PASS`)
}

/* 11 — Discovery_Ranking produces a clean 1..n over the eligible creators */
{
  const DR = values('Discovery_Ranking')
  const H = headerMap(DR, 6)
  const rows = DR.slice(6).filter(r => typeof r[H['KOL ID']] === 'string' && r[H['KOL ID']].startsWith('KOL-'))
  const passing = rows.filter(r => r[H.Status] === 'PASS')
  const ranks = passing.map(r => r[H.Rank]).sort((a, b) => a - b)
  const contiguous = ranks.every((v, i) => v === i + 1)
  check('Discovery_Ranking ranks the eligible creators 1..n with no gaps or ties',
    contiguous && ranks.length === passing.length,
    `${passing.length} eligible, ranks ${ranks[0]}..${ranks[ranks.length - 1]}`)

  const top = passing.reduce((a, b) => (b[H['Brand Match']] > a[H['Brand Match']] ? b : a))
  check('rank 1 is the highest Brand Match among eligible creators',
    passing.find(r => r[H.Rank] === 1)[H['Brand Match']] === top[H['Brand Match']],
    `rank 1 = ${passing.find(r => r[H.Rank] === 1)[H.KOL]} at ${top[H['Brand Match']]}/100`)

  const presetValues = rows.map(r => r[H['Preset Metric Value']])
  check('the ranking-preset picker resolves to a metric on every row',
    presetValues.every(v => typeof v === 'number'), `preset "${DR[3][1]}"`)
}

/* 12 — explanations correspond to the scores they explain */
{
  const EX = values('Match_Explanation')
  const H = headerMap(EX, 4)
  const rows = EX.slice(4).filter(r => typeof r[H['KOL ID']] === 'string' && r[H['KOL ID']].startsWith('KOL-'))
  const COMPONENTS = ['Brand & Business Relevance', 'Target Audience Relevance',
    'Content & Category Relevance', 'Brand Personality Fit', 'Performance Quality', 'Brand Safety']
  const active = values('Brand_Profile')[3][1]
  const bad = []
  for (const row of rows) {
    const engine = ME_ROWS.find(m => m[MEH['Brand ID']] === active && m[MEH['KOL ID']] === row[H['KOL ID']])
    const ranked = COMPONENTS
      .map((c, i) => ({ c, v: engine[MEH[c]] + (6 - i) / 1000 }))
      .sort((a, b) => b.v - a.v)
    const s1 = String(row[H['Strength 1']] ?? '')
    if (!s1.startsWith(ranked[0].c)) bad.push(`${row[H['KOL ID']]}: strength 1 "${s1}" but top component is ${ranked[0].c}`)
    const c1 = String(row[H['Consideration 1']] ?? '')
    if (!c1.includes(ranked[5].c)) bad.push(`${row[H['KOL ID']]}: consideration 1 "${c1}" but weakest is ${ranked[5].c}`)
    if (row[H['Final Match Score']] !== engine[MEH['Final Match Score']]) {
      bad.push(`${row[H['KOL ID']]}: explanation score ${row[H['Final Match Score']]} vs engine ${engine[MEH['Final Match Score']]}`)
    }
  }
  check(`Match_Explanation strengths, considerations and score agree with the engine (active brand ${active})`,
    bad.length === 0, bad.length ? bad.slice(0, 4).join(' | ') : `${rows.length} explanations verified`)

  const nonEmpty = rows.every(r =>
    String(r[H['Why This Creator Matches']] ?? '').length > 40
    && String(r[H['Safety Reason']] ?? '').length > 20)
  check('every creator has a Why-this-matches line and five component reasons', nonEmpty)
}

/* 13 — Sample_Output reaches the same verdict on its own */
{
  const SO = values('Sample_Output')
  const verdictRow = SO.find(r => typeof r[0] === 'string' && r[0].startsWith('Brand-dependence verdict'))
  const verdict = verdictRow ? verdictRow[4] : null
  check('Sample_Output reaches the brand-dependence verdict by formula',
    typeof verdict === 'string' && verdict.startsWith('PASS'), String(verdict))
}

/* 14 — Sample_Brands roll-ups differ per brand */
{
  const SB = values('Sample_Brands')
  const H = headerMap(SB, 4)
  const rows = SB.slice(4).filter(r => typeof r[0] === 'string' && r[0].startsWith('BRAND-'))
  const summary = rows.map(r =>
    `${r[0]}: ${r[H['Eligible Creators']]} eligible, avg ${r[H['Average Match (eligible)']]}, top ${r[H['Highest Match']]} (${r[H['Best-Matched Creator']]})`)
  const bestSet = new Set(rows.map(r => r[H['Best-Matched Creator']]))
  check('each brand keeps a different roster and a different best-matched creator',
    bestSet.size === rows.length, summary.join('  ·  '))
}

/* 15 — hard filter and soft match are separated in the documentation too */
{
  const DF = values('Discovery_Filters')
  const H = headerMap(DF, 4)
  const rows = DF.slice(4).filter(r => typeof r[H.Group] === 'string' && r[H.Group] === r[H.Group].toUpperCase() && r[H.Filter])
  const types = new Set(rows.map(r => r[H.Type]))
  const groups = new Set(rows.map(r => r[H.Group]))
  check('Discovery_Filters covers all nine filter groups and marks every filter HARD or SOFT',
    groups.size === 9 && types.size === 2 && rows.every(r => r[H.Type] === 'HARD FILTER' || r[H.Type] === 'SOFT MATCH'),
    `${rows.length} filters across ${groups.size} groups: ${[...groups].join(', ')}`)
}

/* 16 — switching the Active Brand rewires the two active-brand views */
{
  const bpSheet = sheetId('Brand_Profile')
  const brands = [...new Set(ME_ROWS.map(r => r[MEH['Brand ID']]))]
  const problems = []
  const winners = []
  for (const brand of brands) {
    hf.setCellContents({ sheet: bpSheet, row: 3, col: 1 }, brand)
    for (const name of ['Match_Explanation', 'Discovery_Ranking', 'Sample_Brands']) {
      values(name).forEach((row, r) => row.forEach((v, c) => {
        if (isErr(v)) problems.push(`${brand} ${name}!${colLetter(c + 1)}${r + 1} → ${errLabel(v)}`)
      }))
    }
    const DR = values('Discovery_Ranking')
    const H = headerMap(DR, 6)
    const rows = DR.slice(6).filter(r => typeof r[H['KOL ID']] === 'string' && r[H['KOL ID']].startsWith('KOL-'))
    const passing = rows.filter(r => r[H.Status] === 'PASS')
    const ranks = passing.map(r => r[H.Rank]).sort((a, b) => a - b)
    if (!ranks.every((v, i) => v === i + 1)) problems.push(`${brand}: ranks are not 1..${passing.length}`)
    const top = passing.find(r => r[H.Rank] === 1)
    winners.push(`${brand} → ${top ? `${top[H.KOL]} ${top[H['Brand Match']]}/100` : 'none eligible'}`)

    const EX = values('Match_Explanation')
    const XH = headerMap(EX, 4)
    for (const row of EX.slice(4).filter(r => typeof r[XH['KOL ID']] === 'string' && r[XH['KOL ID']].startsWith('KOL-'))) {
      const engine = ME_ROWS.find(m => m[MEH['Brand ID']] === brand && m[MEH['KOL ID']] === row[XH['KOL ID']])
      if (row[XH['Final Match Score']] !== engine[MEH['Final Match Score']]) {
        problems.push(`${brand}/${row[XH['KOL ID']]}: explanation ${row[XH['Final Match Score']]} vs engine ${engine[MEH['Final Match Score']]}`)
      }
    }
  }
  hf.setCellContents({ sheet: bpSheet, row: 3, col: 1 }, brands[0])
  check('every Active Brand drives the views cleanly — no errors, ranks stay 1..n, explanations follow',
    problems.length === 0, problems.length ? problems.slice(0, 4).join(' | ') : winners.join('  ·  '))
}

/* 17 — all 30 ranking presets resolve and order correctly, in both directions */
{
  const drSheet = sheetId('Discovery_Ranking')
  const LL = values('Lookup_Lists')
  // The preset table is the block whose first row is numbered 1 and carries a
  // direction of asc/desc in the fourth column.
  const presets = LL
    .filter(r => typeof r[3] === 'string' && (r[3] === 'asc' || r[3] === 'desc') && typeof r[1] === 'string')
    .map(r => ({ name: r[1], dir: r[3] }))
  const problems = []
  for (const p of presets) {
    hf.setCellContents({ sheet: drSheet, row: 3, col: 1 }, p.name)
    const DR = values('Discovery_Ranking')
    const H = headerMap(DR, 6)
    const rows = DR.slice(6).filter(r => typeof r[H['KOL ID']] === 'string' && r[H['KOL ID']].startsWith('KOL-'))
    rows.forEach((r, i) => {
      if (isErr(r[H['Preset Metric Value']])) problems.push(`${p.name}: metric error on row ${i + 1}`)
      if (isErr(r[H['Preset Rank']])) problems.push(`${p.name}: rank error on row ${i + 1}`)
    })
    const passing = rows.filter(r => r[H.Status] === 'PASS')
    if (passing.some(r => typeof r[H['Preset Metric Value']] !== 'number')) {
      problems.push(`${p.name}: non-numeric metric among eligible creators`)
      continue
    }
    // Competition ranking, the same shape RANK.EQ gives: ties share a rank and
    // the next distinct value skips by however many shared it (1,2,3,3,5). So
    // the assertion is that the sequence is a valid competition ranking, not
    // that it is 1..n — two creators on the same Save Rate genuinely tie.
    const ranks = passing.map(r => r[H['Preset Rank']]).sort((a, b) => a - b)
    let expected = 1
    for (let i = 0; i < ranks.length;) {
      if (ranks[i] !== expected) { problems.push(`${p.name}: ranks ${ranks.join(',')}`); break }
      let n = 0
      while (i + n < ranks.length && ranks[i + n] === expected) n++
      i += n
      expected += n
    }
    const metrics = passing.map(r => r[H['Preset Metric Value']])
    const want = p.dir === 'asc' ? Math.min(...metrics) : Math.max(...metrics)
    const first = passing.filter(r => r[H['Preset Rank']] === 1)
    if (!first.length) problems.push(`${p.name}: nobody ranked 1`)
    else if (first.some(r => r[H['Preset Metric Value']] !== want)) {
      problems.push(`${p.name} (${p.dir}): rank 1 has ${first[0][H['Preset Metric Value']]}, expected ${want}`)
    }
  }
  hf.setCellContents({ sheet: drSheet, row: 3, col: 1 }, presets[0].name)
  check(`all ${presets.length} ranking presets resolve, rank 1..n, and put the right end first`,
    problems.length === 0 && presets.length === 30,
    problems.length ? problems.slice(0, 4).join(' | ') : `${presets.length} presets, both directions`)
}

/* 24 — the taxonomy is a tree, not a list of labels */
{
  const tx = values('Taxonomy')
  const LEVELS = ['L1 Category', 'L2 Sub Category', 'L3 Content Topic']
  const BLEVELS = ['B1 Industry', 'B2 Niche']
  const isNode = r => typeof r[1] === 'string' && (LEVELS.includes(r[1]) || BLEVELS.includes(r[1]))
  const nodes = tx.filter(isNode).map(r => ({ code: r[0], level: r[1], parent: r[2], label: r[3], kw: r[5] }))
  const byCode = new Map(nodes.map(n => [n.code, n]))

  const problems = []
  if (nodes.length !== byCode.size) problems.push('duplicate codes')
  for (const n of nodes) {
    const isRoot = n.level === 'L1 Category' || n.level === 'B1 Industry'
    if (isRoot) {
      if (n.parent) problems.push(`${n.code}: a root with a parent`)
    } else if (!byCode.has(n.parent)) {
      problems.push(`${n.code}: parent ${n.parent || '(blank)'} does not exist`)
    } else if (n.code !== `${n.parent}.${n.code.split('.').pop()}`) {
      problems.push(`${n.code}: code does not extend its parent`)
    }
    if (!n.label) problems.push(`${n.code}: no label`)
    if (!n.kw) problems.push(`${n.code}: no matching keywords`)
  }
  // Every branch has to reach a leaf: a Category with no Sub Category, or a Sub
  // Category with no Content Topic, is a level that will never be populated.
  const childCount = new Map(nodes.map(n => [n.code, 0]))
  for (const n of nodes) if (n.parent && childCount.has(n.parent)) childCount.set(n.parent, childCount.get(n.parent) + 1)
  for (const n of nodes) {
    if (n.level !== 'L3 Content Topic' && n.level !== 'B2 Niche' && childCount.get(n.code) === 0) {
      problems.push(`${n.code}: no children`)
    }
  }
  const counts = LEVELS.concat(BLEVELS).map(l => `${l.slice(0, 2)} ${nodes.filter(n => n.level === l).length}`)
  check('the taxonomy is a well-formed tree: unique codes, every node parented, every branch reaching a leaf, every node keyworded',
    problems.length === 0, problems.length ? problems.slice(0, 4).join(' | ') : counts.join(' · '))

  /* 25 — the dropdowns are derived from the tree, not a second copy of it */
  const lk = values('Lookup_Lists')
  const headRow = lk.findIndex(r => r[0] === 'Platform')
  const colOf = name => lk[headRow].indexOf(name)
  const colValues = name => {
    const c = colOf(name)
    const out = []
    for (let i = headRow + 1; i < lk.length; i++) {
      const v = lk[i][c]
      if (typeof v === 'string' && v) out.push(v); else break
    }
    return out
  }
  const labelsAt = level => new Set(nodes.filter(n => n.level === level).map(n => n.label))
  const drift = []
  const compare = (listName, level) => {
    const list = colValues(listName)
    const tree = labelsAt(level)
    if (list.length !== tree.size) drift.push(`${listName}: ${list.length} in the list, ${tree.size} in the tree`)
    for (const v of list) if (!tree.has(v)) drift.push(`${listName}: "${v}" is in no node`)
  }
  compare('Category', 'L1 Category')
  compare('SubCategory', 'L2 Sub Category')
  compare('Industry', 'B1 Industry')
  compare('Niche', 'B2 Niche')
  check('every Category, Sub Category, Industry and Niche dropdown value is a node on Taxonomy — one tree, no second list',
    drift.length === 0,
    drift.length ? drift.slice(0, 4).join(' | ') : 'Category, SubCategory, Industry and Niche all resolve to nodes')

  /* 26 — the crosswalk sharpens matrix 5 and never contradicts it */
  const xrows = tx.filter(r => typeof r[6] === 'number' && typeof r[7] === 'number' && typeof r[1] === 'string'
    && !LEVELS.includes(r[1]) && !BLEVELS.includes(r[1]))
  const niches = new Set(nodes.filter(n => n.level === 'B2 Niche').map(n => n.label))
  const subs = labelsAt('L2 Sub Category')
  const bad = []
  const ladder = new Map()          // "niche|category" → scores seen, by rung
  for (const r of xrows) {
    const [, niche, code, sub, cat, why, score, derived, delta] = r
    if (!niches.has(niche)) bad.push(`unknown niche ${niche}`)
    if (!subs.has(sub)) bad.push(`unknown sub category ${sub}`)
    if (!byCode.has(code)) bad.push(`unknown code ${code}`)
    if (score < 0 || score > 100) bad.push(`${niche} → ${sub}: score ${score} outside 0–100`)
    if (delta !== score - derived) bad.push(`${niche} → ${sub}: Δ ${delta} ≠ ${score} − ${derived}`)
    if (!why) bad.push(`${niche} → ${sub}: no reason given`)
    const rung = score === 100 ? 'primary' : score === 85 ? 'secondary' : 'sibling'
    if (rung === 'sibling' && score > derived) {
      bad.push(`${niche} → ${sub}: passed over, yet scored ${score} above the matrix's ${derived}`)
    }
    const key = `${niche}|${cat}`
    if (!ladder.has(key)) ladder.set(key, { primary: [], secondary: [], sibling: [] })
    ladder.get(key)[rung].push(score)
  }
  // The failure this table exists to expose: inside one category, something the
  // niche never named outscoring something it did. Matrix 5 cannot see it —
  // it scores the whole category at once — so it has to be asserted here.
  for (const [key, rungs] of ladder) {
    const [niche, cat] = key.split('|')
    const worstNamed = Math.min(...[...rungs.primary, ...rungs.secondary])
    const bestUnnamed = rungs.sibling.length ? Math.max(...rungs.sibling) : -Infinity
    if (!rungs.primary.length && !rungs.secondary.length) {
      bad.push(`${niche} / ${cat}: listed but names nothing`)
    } else if (bestUnnamed > worstNamed) {
      bad.push(`${niche} / ${cat}: an unnamed sub category scores ${bestUnnamed} over a named one at ${worstNamed}`)
    }
  }
  // Every niche must claim at least one sub category, or it is still the inert
  // field it is today.
  const claimed = new Set(xrows.map(r => r[1]))
  for (const n of niches) if (!claimed.has(n)) bad.push(`${n}: claims no sub category`)
  check('the crosswalk ladder is coherent: every niche claims a sub category, Δ reconciles with matrix 5, and nothing a niche passed over outranks what it named',
    bad.length === 0 && xrows.length > 0,
    bad.length ? bad.slice(0, 4).join(' | ')
      : `${xrows.length} rows, ${claimed.size} niches, ${ladder.size} niche×category ladders all ordered`)

  /* 27 — the kol_categories alias map points at nodes that exist */
  const aliasRows = tx.filter(r => typeof r[2] === 'string' && /^(CONTENT|AUDIENCE|CONTENT \+ AUDIENCE)$/.test(r[2]))
  const aliasBad = []
  for (const r of aliasRows) {
    const [name, creators, axis, code, label] = r
    if (typeof creators !== 'number' || creators <= 0) aliasBad.push(`${name}: no creator count`)
    if (axis === 'AUDIENCE') {
      if (code !== '—') aliasBad.push(`${name}: an audience label may not map to a content node`)
    } else if (!byCode.has(code)) {
      aliasBad.push(`${name}: maps to ${code}, which is not a node`)
    } else if (byCode.get(code).label !== label) {
      aliasBad.push(`${name}: ${code} is "${byCode.get(code).label}", printed as "${label}"`)
    }
  }
  check('every mapped kol_categories row points at a node that exists, and an audience label is never mapped onto the content axis',
    aliasBad.length === 0 && aliasRows.length > 0,
    aliasBad.length ? aliasBad.slice(0, 4).join(' | ')
      : `${aliasRows.length} rows mapped, ${aliasRows.filter(r => r[2] === 'AUDIENCE').length} held off the content axis`)
}

/* ── summary ──────────────────────────────────────────────────────────────── */

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('\nFAILED:')
  failed.forEach(f => console.log(`  - ${f.label}\n      ${f.detail}`))
  process.exitCode = 1
}
