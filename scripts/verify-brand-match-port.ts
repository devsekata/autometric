/**
 * Proves the TypeScript Brand Match engine reproduces the JavaScript one.
 *
 *   npm run brandmatch:port:verify:ts
 *
 * The chain the product depends on is:
 *
 *     Autometric_Brand_Match_Comparison.xlsx        (the model, in Excel)
 *       └─ scripts/brand-match/scoring.mjs          verified by verify-scoring-port.mjs
 *            └─ src/lib/discover/brandMatch/score.ts   verified HERE
 *
 * `verify-scoring-port.mjs` drives Excel and pins the middle link to the
 * workbook. This pins the last link to the middle one, so the app's scores are
 * transitively the workbook's scores. Without it the port is an assertion.
 *
 * It compares every component, not just the Final Match Score: two different
 * models can agree on a total while disagreeing about everything underneath it,
 * and the UI shows the components as the match explanation.
 *
 * It also asserts every constant and every relatedness cell, because a silent
 * divergence in a weight is exactly the failure a total-only check would pass.
 *
 * Needs no database and no Excel — it runs off the published roster snapshot.
 * Exits non-zero on any disagreement.
 */

import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * The JavaScript side — the already-verified model.
 *
 * `allowJs` resolves these, so they arrive as `any` rather than as errors. They
 * are re-declared below with the shapes this script actually relies on, so a
 * change to one of them fails here instead of silently comparing undefined
 * against undefined and reporting success.
 */
import * as jsScoring from './brand-match/scoring.mjs'
import * as jsBrands from './brand-match/comparison-brands.mjs'
import * as jsBuild from './brand-match/build.mjs'
import * as jsComparison from './brand-match/comparison.mjs'

type ConstRow = [string | null, string, string, number | null, string]
type Matrix = Record<string, Record<string, number>>

const jsScore = jsScoring.score as (k: unknown, b: unknown) => Record<string, unknown>
const toScoringRecord = jsScoring.toScoringRecord as (rec: unknown) => ScoringRecord
const JS_NA = jsScoring.NA as string
const BRANDS = jsBrands.BRANDS as { brand_name: string }[]
const ENGINE_CONSTS = jsBuild.ENGINE_CONSTS as ConstRow[]
const EXTRA_CONSTS = jsComparison.EXTRA_CONSTS as ConstRow[]
const JS_MATRIX = jsBrands.CATEGORY_RELATEDNESS as Matrix
const JS_INTERESTS = jsBrands.INTEREST_KEYS as string[]
const JS_CATEGORIES = jsBrands.CANONICAL_CATEGORIES as string[]

// The TypeScript side — what the app actually runs.
import {
  score as tsScore, NA as TS_NA, type ScoreResult, type ScoringBrand, type ScoringRecord,
} from '../src/lib/discover/brandMatch/score'
import {
  CATEGORY_RELATEDNESS as TS_MATRIX, INTEREST_KEYS as TS_INTERESTS,
  CANONICAL_CATEGORIES as TS_CATEGORIES, V as TS_V,
} from '../src/lib/discover/brandMatch/model'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROSTER = path.resolve(HERE, 'brand-match', 'roster.json')

if (!existsSync(ROSTER)) {
  console.error(`no roster snapshot at ${ROSTER} — run: npm run brandmatch:fetch`)
  process.exit(1)
}

let failures = 0
const fail = (msg: string) => { failures++; console.error(`  FAIL  ${msg}`) }

/* ── 1. constants ─────────────────────────────────────────────────────────── */

console.log('constants')
const jsConsts: Record<string, number> = {}
for (const [, , key, value] of [...ENGINE_CONSTS, ...EXTRA_CONSTS]) {
  if (typeof value === 'number') jsConsts[key] = value
}

let checked = 0
for (const [key, tsValue] of Object.entries(TS_V)) {
  if (!(key in jsConsts)) { fail(`${key} is in model.ts but in neither constants array`); continue }
  if (jsConsts[key] !== tsValue) fail(`${key}: scripts say ${jsConsts[key]}, model.ts says ${tsValue}`)
  checked++
}
console.log(`  ${checked} constants compared`)

/* ── 2. lookup tables ─────────────────────────────────────────────────────── */

console.log('lookup tables')
if (JS_CATEGORIES.join('|') !== TS_CATEGORIES.join('|')) {
  fail(`canonical categories differ:\n    js: ${JS_CATEGORIES.join(', ')}\n    ts: ${TS_CATEGORIES.join(', ')}`)
}
if (JS_INTERESTS.join('|') !== TS_INTERESTS.join('|')) {
  fail(`interest keys differ:\n    js: ${JS_INTERESTS.join(', ')}\n    ts: ${TS_INTERESTS.join(', ')}`)
}
let cells = 0
for (const row of JS_CATEGORIES) {
  for (const col of JS_CATEGORIES) {
    const j = JS_MATRIX[row]?.[col]
    const t = TS_MATRIX[row]?.[col]
    if (j !== t) fail(`relatedness[${row}][${col}]: js ${j}, ts ${t}`)
    cells++
  }
}
console.log(`  ${JS_CATEGORIES.length} categories · ${JS_INTERESTS.length} interests · ${cells} matrix cells`)

/* ── 3. every score, component by component ───────────────────────────────── */

const COMPONENTS: (keyof ScoreResult)[] = [
  'categoryMatch', 'keywordMatch', 'hashtagMatch', 'businessScore',
  'ageScore', 'genderScore', 'locationScore', 'interestScore', 'audienceScore',
  'contentCategoryMatch', 'subCategoryMatch', 'topicMatch', 'contentStyleMatch', 'contentScore',
  'personalityScore',
  'erScore', 'audienceQualityScore', 'consistencyScore', 'communityScore',
  'averageViewsScore', 'recentGrowthScore', 'performanceScore',
  'authenticityScore', 'followerQualityScore', 'verificationScore', 'paidRatioScore', 'safetyScore',
  'availableWeight', 'finalScore', 'level', 'dataCompleteness', 'confidence',
]

const roster = JSON.parse(readFileSync(ROSTER, 'utf8'))
const records = (roster.records ?? roster).filter((r: { found?: boolean }) => r.found !== false)

console.log(`scores — ${records.length} creators x ${BRANDS.length} brands`)

let pairs = 0
let compared = 0
for (const rec of records) {
  const k = toScoringRecord(rec)
  for (const b of BRANDS) {
    const js = jsScore(k, b)
    const ts = tsScore(k, b as unknown as ScoringBrand) as unknown as Record<string, unknown>
    pairs++
    for (const key of COMPONENTS) {
      // The two modules each define their own N/A sentinel; they must be the
      // same string, and are compared as values rather than by identity.
      const j = js[key] === JS_NA ? TS_NA : js[key]
      const t = ts[key]
      if (j !== t) {
        fail(`${rec.resolved} x ${b.brand_name} · ${String(key)}: js ${String(j)}, ts ${String(t)}`)
      }
      compared++
    }
  }
}
console.log(`  ${pairs} pairs · ${compared} values compared`)

/* ── verdict ──────────────────────────────────────────────────────────────── */

if (failures) {
  console.error(`\n${failures} disagreement${failures > 1 ? 's' : ''} — the app is NOT running the verified model.`)
  process.exit(1)
}
console.log('\nOK — src/lib/discover/brandMatch reproduces scripts/brand-match/scoring.mjs exactly.')
