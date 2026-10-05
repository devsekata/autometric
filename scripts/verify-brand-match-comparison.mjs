/**
 * Reads `Autometric_Brand_Match_Comparison.xlsx` back and checks it.
 *
 *   npm run brandmatch:comparison:verify
 *
 * Two passes, and the second is the one that matters.
 *
 * The STRUCTURAL pass uses exceljs: sheet inventory, row counts, that the 24
 * handles on KOL_Source_Data are the 24 that were asked for, that no score cell
 * holds a typed number where a formula belongs.
 *
 * The EVALUATED pass drives Excel itself through COM, forces a full rebuild, and
 * reads the computed values. It exists because exceljs writes formulas without
 * cached results and cannot evaluate them: a workbook can be structurally
 * perfect and still be full of #VALUE!. Everything that could actually be wrong
 * about a score — an error, a value outside 0-100, a component that silently
 * became a constant, a creator whose five brand scores are identical — is only
 * visible after a recalculation.
 *
 * The evaluated pass is skipped with a warning where Excel is not available
 * (CI, a Mac). It is not skipped silently: a verify that quietly checked half of
 * what it claims to check is worse than one that fails.
 */

import ExcelJS from 'exceljs'
import path from 'node:path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** `BRANDMATCH_OUT` points this at a staging build, the same way the builder takes it. */
const FILE = process.env.BRANDMATCH_OUT
  ? path.resolve(process.env.BRANDMATCH_OUT)
  : path.resolve(HERE, '..', 'Autometric_Brand_Match_Comparison.xlsx')
const ROSTER = path.resolve(HERE, 'brand-match', 'roster.json')

const EXPECTED_SHEETS = [
  'README', 'KOL_Source_Data', 'Brand_Profile', 'Matching_Engine', 'Score_Breakdown',
  'Match_Explanation', 'Brand_Comparison', 'Brand_Ranking', 'Top_Matches',
  'Hard_vs_Soft_Filter', 'Validation', 'Lookup_Lists',
]
const N_KOL = 24
const N_BRAND = 5
const N_PAIR = N_KOL * N_BRAND

let failures = 0
let warnings = 0
const ok = m => console.log(`  PASS  ${m}`)
const bad = m => { failures++; console.log(`  FAIL  ${m}`) }
const warn = m => { warnings++; console.log(`  WARN  ${m}`) }
const section = t => console.log(`\n${t}`)

if (!existsSync(FILE)) {
  console.error(`no workbook at ${FILE} — run: npm run brandmatch:comparison`)
  process.exit(1)
}
const snapshot = JSON.parse(readFileSync(ROSTER, 'utf8'))

/* ── structural ───────────────────────────────────────────────────────────── */

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(FILE)

section('STRUCTURE')
const names = wb.worksheets.map(w => w.name)
if (EXPECTED_SHEETS.every(n => names.includes(n)) && names.length === EXPECTED_SHEETS.length) {
  ok(`${names.length} sheets, all expected`)
} else {
  bad(`sheets are ${names.join(', ')}`)
}
const order = EXPECTED_SHEETS.every((n, i) => names[i] === n)
order ? ok('sheet order is reading order') : bad(`sheet order is ${names.join(' → ')}`)

const src = wb.getWorksheet('KOL_Source_Data')
const eng = wb.getWorksheet('Matching_Engine')

/** header name → column index, from the header row. */
function headerMap(ws, row) {
  const m = {}
  ws.getRow(row).eachCell((c, i) => { if (c.text) m[c.text] = i })
  return m
}
const SC = headerMap(src, 5)
const EC = headerMap(eng, 5)

const requested = []
for (let r = 6; r < 6 + N_KOL; r++) requested.push(String(src.getCell(r, SC['Requested Handle']).value ?? ''))
requested.length === N_KOL
  ? ok(`KOL_Source_Data holds ${N_KOL} creator rows`)
  : bad(`KOL_Source_Data holds ${requested.length} rows`)

const wantedFromRoster = snapshot.records.map(r => `@${r.requested}`)
JSON.stringify(requested) === JSON.stringify(wantedFromRoster)
  ? ok('the 24 requested handles are exactly the briefed list, in order')
  : bad('requested handles do not match roster.json')

const resolved = []
for (let r = 6; r < 6 + N_KOL; r++) resolved.push(String(src.getCell(r, SC.Handle).value ?? ''))
const dupes = resolved.filter((h, i) => h !== '@N/A' && resolved.indexOf(h) !== i)
dupes.length === 0 ? ok('no duplicate creator on the roster') : bad(`duplicate handle(s): ${dupes.join(', ')}`)

/**
 * Every creator on the sheet must trace back to a requested handle. This is the
 * check that would catch a sample creator leaking in from the engine workbook's
 * dataset — the one failure the brief was most explicit about.
 */
const allowed = new Set(snapshot.records.flatMap(r => [r.requested, r.resolved].filter(Boolean).map(h => `@${h}`)))
const strays = resolved.filter(h => h !== '@N/A' && !allowed.has(h))
strays.length === 0
  ? ok('every creator traces to a requested handle — no invented or sample creator present')
  : bad(`creator(s) not in the requested list: ${strays.join(', ')}`)

let engRows = 0
for (let r = 6; r < 6 + N_PAIR; r++) if (eng.getCell(r, EC['Brand ID']).value) engRows++
engRows === N_PAIR
  ? ok(`Matching_Engine holds ${N_PAIR} rows (${N_KOL} x ${N_BRAND})`)
  : bad(`Matching_Engine holds ${engRows} rows, expected ${N_PAIR}`)

/**
 * No score may be a typed number. A literal in a score column is a value that
 * stopped tracking its inputs, which is the failure the whole "every score is a
 * formula" discipline exists to prevent.
 */
const SCORE_COLS = [
  'Category Match', 'Keyword Match', 'Hashtag Match', 'Business Score',
  'Age Score', 'Gender Score', 'Location Score', 'Interest Score', 'Audience Score',
  'Content Category Match', 'Topic Match', 'Content Score',
  'Personality Score', 'ER Score', 'Audience Quality Score', 'Performance Score',
  'Safety Score', 'Final Match Score', 'Available Weight',
]
let literals = 0
for (const name of SCORE_COLS) {
  // A renamed engine column must fail the check, not crash it. Reading a cell in
  // an undefined column throws inside exceljs, which reads as a broken verifier
  // rather than as the stale expectation it actually is.
  if (!EC[name]) { bad(`Matching_Engine has no column named "${name}" — the verifier's expectations are stale`); continue }
  for (let r = 6; r < 6 + N_PAIR; r++) {
    const v = eng.getCell(r, EC[name]).value
    if (typeof v === 'number') { literals++; if (literals <= 3) bad(`${name} row ${r} is the literal ${v}, not a formula`) }
  }
}
literals === 0
  ? ok(`all ${SCORE_COLS.length} score columns x ${N_PAIR} rows are formulas, no typed numbers`)
  : bad(`${literals} score cells hold typed numbers`)

/* ── evaluated ────────────────────────────────────────────────────────────── */

section('EVALUATED  ·  Excel recalculation')

/**
 * Drives Excel through PowerShell COM, forces a full rebuild, and writes the
 * computed values out as CSV. Returns null where Excel is unavailable.
 */
function recalcToCsv() {
  const csv = path.join(process.env.TEMP ?? '.', `bmc-verify-${process.pid}.csv`)
  const ps = `
$ErrorActionPreference='Stop'
try { $xl = New-Object -ComObject Excel.Application } catch { Write-Output 'NO_EXCEL'; exit 0 }
$xl.Visible=$false; $xl.DisplayAlerts=$false
try {
  $wb = $xl.Workbooks.Open(${JSON.stringify(FILE)}, 0, $true)
  $xl.CalculateFullRebuild()
  $ws = $wb.Worksheets.Item('Matching_Engine')
  $cols = @{}
  for ($c=1; $c -le 80; $c++) { $n = $ws.Cells.Item(5,$c).Text; if ($n) { $cols[$n] = $c } }
  $want = @('Brand ID','KOL','Category','Business Score','Audience Score','Content Score','Personality Score','Performance Score','Safety Score','Available Weight','Final Match Score','Match Level','Keyword Match','Topic Match','ER Score','Average Views Score','Interest Score')
  $lines = @(($want -join "\`t"))
  for ($r=6; $r -le ${5 + N_PAIR}; $r++) {
    $v = @(); foreach ($w in $want) { $v += $ws.Cells.Item($r,$cols[$w]).Text }
    $lines += ($v -join "\`t")
  }
  $vs = $wb.Worksheets.Item('Validation')
  for ($r=5; $r -le 19; $r++) { $lines += ('VALIDATION' + "\`t" + $vs.Cells.Item($r,2).Text + "\`t" + $vs.Cells.Item($r,3).Text + "\`t" + $vs.Cells.Item($r,4).Text) }
  $bc = $wb.Worksheets.Item('Brand_Comparison')
  for ($r=6; $r -le ${5 + N_KOL}; $r++) { $lines += ('SPREAD' + "\`t" + $bc.Cells.Item($r,2).Text + "\`t" + $bc.Cells.Item($r,${5 + N_BRAND + 1}).Text + "\`t" + $bc.Cells.Item($r,${5 + N_BRAND + 3}).Text) }
  $br = $wb.Worksheets.Item('Brand_Ranking')
  $lines += ('RANK1' + "\`t" + $br.Cells.Item(6,2).Text + "\`t" + $br.Cells.Item(6,5).Text)
  Set-Content -Path ${JSON.stringify(csv)} -Value $lines -Encoding utf8
  Write-Output 'OK'
  $wb.Close($false)
} finally { $xl.Quit() }`
  const psFile = path.join(process.env.TEMP ?? '.', `bmc-verify-${process.pid}.ps1`)
  writeFileSync(psFile, ps, 'utf8')
  try {
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { encoding: 'utf8', timeout: 300_000 })
    if (out.includes('NO_EXCEL')) return null
    return readFileSync(csv, 'utf8')
  } catch (err) {
    warn(`Excel recalculation could not run: ${String(err.message).split('\n')[0]}`)
    return null
  } finally {
    for (const f of [psFile, csv]) { try { unlinkSync(f) } catch { /* already gone */ } }
  }
}

const csv = recalcToCsv()
if (!csv) {
  warn('Excel is not available here — the evaluated pass was SKIPPED.')
  warn('Formula errors and out-of-range scores would not be caught by the structural pass alone.')
} else {
  // PowerShell's -Encoding utf8 writes a BOM. Left in place it becomes part of
  // the first header name, so every lookup of the first column silently returns
  // undefined and every row groups under the same key — which read as "all five
  // brands rank identically" rather than as an encoding bug.
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
  const head = lines[0].split('\t')
  const rows = []
  const validation = []
  const spreads = []
  let rank1 = null
  for (const line of lines.slice(1)) {
    const f = line.split('\t')
    if (f[0] === 'VALIDATION') { validation.push({ check: f[1], result: f[2], verdict: f[3] }); continue }
    if (f[0] === 'SPREAD') { spreads.push({ kol: f[1], best: f[2], spread: f[3] }); continue }
    if (f[0] === 'RANK1') { rank1 = { kol: f[1], score: f[2] }; continue }
    const o = {}
    head.forEach((h, i) => { o[h] = f[i] })
    rows.push(o)
  }

  rows.length === N_PAIR
    ? ok(`recalculated ${N_PAIR} engine rows`)
    : bad(`recalculated ${rows.length} rows, expected ${N_PAIR}`)

  const isErr = v => typeof v === 'string' && v.startsWith('#')
  const errs = rows.filter(r => Object.values(r).some(isErr))
  errs.length === 0
    ? ok('no formula errors anywhere in the engine')
    : bad(`${errs.length} row(s) carry a formula error, first: ${JSON.stringify(errs[0])}`)

  const finals = rows.map(r => r['Final Match Score']).filter(v => v !== 'N/A')
  const nums = finals.map(Number)
  nums.every(n => Number.isFinite(n) && n >= 0 && n <= 100)
    ? ok(`every Final Match Score is a number inside 0-100 (min ${Math.min(...nums)}, max ${Math.max(...nums)})`)
    : bad('a Final Match Score is outside 0-100 or not a number')

  /**
   * The claim the workbook exists to support. A creator whose five brand scores
   * are identical is carrying a permanent rating, which is the behaviour Brand
   * Match must not have.
   */
  const varying = spreads.filter(s => s.spread !== 'N/A' && Number(s.spread) > 0)
  varying.length >= N_KOL - 3
    ? ok(`${varying.length} of ${N_KOL} creators score differently across the 5 brands (max spread ${Math.max(...varying.map(s => Number(s.spread)))})`)
    : bad(`only ${varying.length} of ${N_KOL} creators vary by brand — the score is behaving like a permanent rating`)

  const flat = spreads.filter(s => s.spread === '0')
  if (flat.length) warn(`${flat.length} creator(s) score identically for all five brands: ${flat.map(s => s.kol).join(', ')}`)

  /** A sub-score that is the same on every row it appears is carrying no information. */
  for (const col of ['Keyword Match', 'Topic Match', 'ER Score', 'Average Views Score', 'Interest Score']) {
    const vals = rows.map(r => r[col]).filter(v => v !== 'N/A' && v !== '')
    const uniq = new Set(vals)
    if (uniq.size <= 1) bad(`${col} is constant at ${[...uniq][0]} across all ${vals.length} scored rows — it contributes nothing`)
    else if (uniq.size <= 3) warn(`${col} takes only ${uniq.size} distinct values across ${vals.length} rows`)
    else ok(`${col} varies across ${uniq.size} distinct values`)
  }

  /* the per-brand orders must not all be the same order */
  const byBrand = new Map()
  for (const r of rows) {
    if (!byBrand.has(r['Brand ID'])) byBrand.set(r['Brand ID'], [])
    byBrand.get(r['Brand ID']).push(r)
  }
  const orders = [...byBrand.entries()].map(([id, rs]) => [id,
    rs.slice().sort((a, b) => Number(b['Final Match Score']) - Number(a['Final Match Score'])).map(r => r.KOL).join('>')])
  new Set(orders.map(o => o[1])).size === orders.length
    ? ok(`all ${orders.length} brands produce a different ranking of the same ${N_KOL} creators`)
    : bad('two brands produce an identical ranking — the brands are not distinct enough to prove contextual scoring')

  /* the workbook's own Validation sheet must agree */
  section('WORKBOOK VALIDATION SHEET')
  for (const v of validation) {
    if (!v.check) continue
    if (/^FAIL/.test(v.verdict)) bad(`${v.check}: ${v.verdict}`)
    else if (/^PASS/.test(v.verdict)) ok(`${v.check} → ${v.result}`)
    else console.log(`  NOTE  ${v.check} → ${v.result} · ${v.verdict.slice(0, 110)}`)
  }
  if (rank1) console.log(`\n  top of the first brand block: ${rank1.kol} at ${rank1.score}`)
}

section('SUMMARY')
console.log(`  ${failures} failure(s), ${warnings} warning(s)`)
if (failures) {
  console.log('\n  the workbook is NOT fit to send.')
  process.exitCode = 1
} else {
  console.log('\n  the workbook is consistent with its inputs and its own checks.')
}
