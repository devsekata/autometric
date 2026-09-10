/**
 * Proves the JavaScript scorer reproduces the workbook, cell for cell.
 *
 *   npm run brandmatch:port:verify
 *
 * The distribution test scores thousands of creators in JavaScript because the
 * workbook's scores live in Excel formulas that only Excel can evaluate. That is
 * only legitimate if the two agree. This drives Excel over the published
 * 24 x 5 comparison workbook, reads every computed component, and asserts
 * `scoring.mjs` produces the same value for all 120 rows.
 *
 * It compares components, not just the final number. Two different models can
 * agree on a total while disagreeing about everything underneath it, and the
 * distribution test reads the components too.
 *
 * A mismatch here means the distribution test would be measuring the port rather
 * than the model, so this exits non-zero and the pipeline stops.
 */

import path from 'node:path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BRANDS } from './brand-match/comparison-brands.mjs'
import { score, toScoringRecord, NA } from './brand-match/scoring.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROSTER = path.resolve(HERE, 'brand-match', 'roster.json')
const WORKBOOK = process.env.BRANDMATCH_OUT
  ? path.resolve(process.env.BRANDMATCH_OUT)
  : path.resolve(HERE, '..', 'Autometric_Brand_Match_Comparison.xlsx')

if (!existsSync(ROSTER)) {
  console.error(`no roster snapshot at ${ROSTER} — run: npm run brandmatch:fetch`)
  process.exit(1)
}
if (!existsSync(WORKBOOK)) {
  console.error(`no workbook at ${WORKBOOK} — run: npm run brandmatch:comparison`)
  console.error('(or point BRANDMATCH_OUT at a staging build)')
  process.exit(1)
}

/** Engine column -> the key `score()` returns it under. */
const COMPARE = [
  ['Category Match', 'categoryMatch'],
  ['Keyword Match', 'keywordMatch'],
  ['Hashtag Match', 'hashtagMatch'],
  ['Business Score', 'businessScore'],
  ['Age Score', 'ageScore'],
  ['Gender Score', 'genderScore'],
  ['Location Score', 'locationScore'],
  ['Interest Score', 'interestScore'],
  ['Audience Score', 'audienceScore'],
  ['Content Category Match', 'contentCategoryMatch'],
  ['Topic Match', 'topicMatch'],
  ['Content Score', 'contentScore'],
  ['Personality Score', 'personalityScore'],
  ['ER Score', 'erScore'],
  ['Audience Quality Score', 'audienceQualityScore'],
  ['Consistency Score', 'consistencyScore'],
  ['Average Views Score', 'averageViewsScore'],
  ['Recent Growth Score', 'recentGrowthScore'],
  ['Performance Score', 'performanceScore'],
  ['Authenticity Score', 'authenticityScore'],
  ['Follower Quality Score', 'followerQualityScore'],
  ['Verification Score', 'verificationScore'],
  ['Paid Ratio Score', 'paidRatioScore'],
  ['Safety Score', 'safetyScore'],
  ['Available Weight', 'availableWeight'],
  ['Final Match Score', 'finalScore'],
]

const snapshot = JSON.parse(readFileSync(ROSTER, 'utf8'))
const records = snapshot.records
const nKol = records.length

/* ── read what Excel computes ─────────────────────────────────────────────── */

const tsv = path.join(process.env.TEMP ?? '.', `bmc-port-${process.pid}.tsv`)
const psFile = path.join(process.env.TEMP ?? '.', `bmc-port-${process.pid}.ps1`)
const wanted = ['KOL', ...COMPARE.map(c => c[0])]

writeFileSync(psFile, `
$ErrorActionPreference='Stop'
try { $xl = New-Object -ComObject Excel.Application } catch { Write-Output 'NO_EXCEL'; exit 0 }
$xl.Visible=$false; $xl.DisplayAlerts=$false
try {
  $wb = $xl.Workbooks.Open(${JSON.stringify(WORKBOOK)}, 0, $true)
  $xl.CalculateFullRebuild()
  $ws = $wb.Worksheets.Item('Matching_Engine')
  $cols = @{}
  for ($c=1; $c -le 90; $c++) { $n = $ws.Cells.Item(5,$c).Text; if ($n) { $cols[$n] = $c } }
  $want = @(${wanted.map(w => `'${w}'`).join(',')})
  $lines = @(($want -join "\`t"))
  for ($r=6; $r -le ${5 + nKol * BRANDS.length}; $r++) {
    $v = @(); foreach ($w in $want) { $v += $ws.Cells.Item($r,$cols[$w]).Text }
    $lines += ($v -join "\`t")
  }
  Set-Content -Path ${JSON.stringify(tsv)} -Value $lines -Encoding utf8
  Write-Output 'OK'
  $wb.Close($false)
} finally { $xl.Quit() }`, 'utf8')

let raw
try {
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
    { encoding: 'utf8', timeout: 300_000 })
  if (out.includes('NO_EXCEL')) {
    console.error('Excel is not available here, so the port cannot be verified against the workbook.')
    console.error('Refusing to pass: an unverified port is exactly what this check exists to prevent.')
    process.exit(1)
  }
  raw = readFileSync(tsv, 'utf8')
} finally {
  for (const f of [psFile, tsv]) { try { unlinkSync(f) } catch { /* already gone */ } }
}

// PowerShell's -Encoding utf8 writes a BOM; left in place it becomes part of the
// first header name and every lookup of that column returns undefined.
const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
const head = lines[0].split('\t')
const excelRows = lines.slice(1).map(l => {
  const f = l.split('\t')
  const o = {}
  head.forEach((h, i) => { o[h] = f[i] })
  return o
})

/* ── compare ──────────────────────────────────────────────────────────────── */

/** Excel prints numbers with the locale's decimal separator; every value here is an integer. */
const asValue = text => {
  if (text === NA) return NA
  const n = Number(String(text).replace(',', '.'))
  return Number.isFinite(n) ? n : text
}

let checked = 0
let mismatches = 0
const samples = []

BRANDS.forEach((brand, b) => {
  records.forEach((rec, i) => {
    const row = excelRows[b * nKol + i]
    if (!row) { mismatches++; return }
    const js = score(toScoringRecord(rec), brand)

    if (row.KOL !== `@${rec.resolved}`) {
      mismatches++
      samples.push(`row ${b * nKol + i + 6}: workbook has ${row.KOL}, roster has @${rec.resolved}`)
      return
    }
    for (const [col, key] of COMPARE) {
      const fromExcel = asValue(row[col])
      const fromJs = js[key]
      checked++
      const same = fromExcel === NA ? fromJs === NA
        : (typeof fromJs === 'number' && Math.abs(fromExcel - fromJs) < 1e-9)
      if (!same) {
        mismatches++
        if (samples.length < 12) {
          samples.push(`${brand.brand_name} / @${rec.resolved} / ${col}: Excel ${JSON.stringify(fromExcel)} vs JS ${JSON.stringify(fromJs)}`)
        }
      }
    }
  })
})

console.log(`compared ${checked} values across ${excelRows.length} rows and ${COMPARE.length} columns`)
console.log(`workbook: ${path.basename(WORKBOOK)}`)
if (mismatches) {
  console.log(`\n${mismatches} MISMATCH(ES):`)
  for (const s of samples) console.log(`  ${s}`)
  console.log('\nthe JavaScript scorer does not reproduce the workbook.')
  console.log('the distribution test would be measuring the port, not the model. stopping.')
  process.exitCode = 1
} else {
  console.log('\nPASS — the JavaScript scorer reproduces every component of every row exactly.')
  console.log('the distribution test may use it to score the wider population.')
}
