/**
 * Brand Match has no dependency on the analytics warehouse (TSDB).
 *
 *   npm run verify:brand-match-no-tsdb
 *
 * Static only; nothing connects to any database.
 *
 * ── Why this is scoped to Brand Match, not to the app ──────────────────────
 * This branch still runs warehouse-backed features on purpose — brand
 * analytics, reports, the campaign surfaces — so an app-wide "no TSDB" check
 * would fail by design and tell nobody anything. What must hold is narrower and
 * absolute: BRAND MATCH reads the KOL server and only the KOL server.
 *
 * ── Why it cannot be left to code review ───────────────────────────────────
 * `l1_silver`, `l2_gold` and `feature` exist on BOTH servers under the same
 * names. A query that reaches the warehouse pool does not error, does not warn
 * and does not return nothing: it returns a DIFFERENT, plausible number. The
 * pool — not the table name — is what decides which database a query lands in,
 * so the import is the only place the mistake is visible, and reading imports
 * by hand is exactly the job that stops being done.
 *
 * -- Where the walk stops, and why that is not a loophole ------------------
 * The two routes authorise before they read anything, and authorisation is the
 * SHARED session and membership layer: `@/auth`, `src/lib/auth/*`,
 * `src/lib/organizations/*` and `src/lib/reports/access.ts`. Those do read the
 * warehouse on this branch - that is where users, sessions and memberships
 * live, and moving them is not Brand Match's to do.
 *
 * So the walk stops there, and says so out loud: the boundary is printed with
 * every module it covers, rather than skipped silently. What is claimed is
 * precise - no Brand Match INPUT comes from the warehouse. A new warehouse read
 * inside one of those shared modules is still whoever owns them to catch; a new
 * one anywhere on the scoring path is caught here.
 *
 * It walks the import graph transitively from every Brand Match entry point and
 * fails when any reachable file
 *
 *   * imports `@/lib/db` (the warehouse pool),
 *   * reads DATABASE_URL or the libpq PG* variables, or
 *   * builds its own `pg` Pool/Client.
 *
 * Comments are ignored, so a note explaining why `@/lib/db` is banned is not a
 * hit — those notes are wanted, and they are where the reason is written.
 * Type-only imports are ignored: they vanish at compile time and cannot carry a
 * connection. The walk reports the PATH to an offender, not just its name, so a
 * violation three modules deep is actionable rather than a riddle.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')

/**
 * Every way into Brand Match: the two routes that serve it, the engine, the
 * audience criteria, the background recalculation, and the Brand Profile it
 * scores against.
 */
const ENTRIES = [
  'src/app/api/organizations/[id]/discover/kol-directory/route.ts',
  'src/app/api/organizations/[id]/discover/brand-profile/route.ts',
  'src/lib/discover/whatMatters/brandMatch.ts',
  'src/lib/discover/whatMatters/brandMatchStore.ts',
  'src/lib/discover/whatMatters/audienceMatch.ts',
  'src/lib/discover/whatMatters/index.ts',
  'src/lib/discover/brandMatch/profile.ts',
  'src/lib/discover/brandMatch/records.ts',
]

/**
 * The shared session/membership layer. Reached by the routes for authorisation
 * only; no value it returns is a Brand Match input. Listed, not hidden.
 */
const AUTH_BOUNDARY = [
  'src/auth.ts',
  'src/lib/auth/',
  'src/lib/organizations/',
  'src/lib/reports/access.ts',
]
const atBoundary = (f: string) => AUTH_BOUNDARY.some(b => f === b || f.startsWith(b))

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Resolves a specifier to a file under src/, or null when it leaves the tree. */
function resolve(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(ROOT, from)), spec)
  // A bare specifier is a package; packages do not reach our pools.
  else return null

  for (const cand of [
    base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return rel(cand)
  }
  return null
}

/** Value imports only — `import type` and `import { type X }` carry nothing. */
function importsOf(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  const re = /import\s+(type\s+)?([\s\S]*?)from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m[3]) {
      if (m[1]) continue
      // `import { type A, type B } from 'x'` is also erased entirely.
      const clause = (m[2] ?? '').trim()
      const named = /^\{([\s\S]*)\}$/.exec(clause)
      if (named && named[1].split(',').filter(x => x.trim()).every(x => /^\s*type\s/.test(x))) continue
      out.push(m[3])
    } else if (m[4]) out.push(m[4])
  }
  return out
}

/** What makes a file a warehouse dependency. */
function offences(file: string, src: string): string[] {
  const code = stripComments(src)
  const hits: string[] = []
  if (/import\s+[\s\S]*?from\s*['"]@\/lib\/db['"]/.test(code) && !/^src\/lib\/db\./.test(file)) {
    hits.push("imports @/lib/db")
  }
  if (/process\.env\.DATABASE_URL/.test(code)) hits.push('reads DATABASE_URL')
  if (/process\.env\.PG(HOST|USER|PASSWORD|DATABASE|PORT)\b/.test(code)) hits.push('reads PG* (libpq)')
  // `@/lib/kolDb` is the one module allowed to build a pool, and it builds the
  // KOL one. Anything else constructing its own has chosen a server by hand.
  if (/\bnew\s+(Pool|Client)\s*\(/.test(code) && file !== 'src/lib/kolDb.ts') {
    hits.push('constructs its own pg Pool/Client')
  }
  return hits
}

console.log('\nBrand Match — static warehouse boundary\n')

const seen = new Set<string>()
const stoppedAt = new Set<string>()
const bad: string[] = []

/** Depth-first, carrying the path so a violation names how it was reached. */
function walk(file: string, trail: string[]) {
  if (seen.has(file)) return
  seen.add(file)
  // Authorisation, not scoring. Recorded and not followed - see the header.
  if (atBoundary(file)) { stoppedAt.add(file); return }
  if (!existsSync(path.join(ROOT, file))) return
  const src = readFileSync(path.join(ROOT, file), 'utf8')

  for (const why of offences(file, src)) {
    bad.push(`${[...trail, file].join(' -> ')}  (${why})`)
  }
  for (const spec of importsOf(src)) {
    const next = resolve(file, spec)
    if (next) walk(next, [...trail, file])
  }
}

for (const entry of ENTRIES) {
  check(`entry point exists: ${entry}`, existsSync(path.join(ROOT, entry)))
  walk(entry, [])
}

check(`nothing on the Brand Match data path touches the warehouse (${
  seen.size - stoppedAt.size} files walked)`,
  bad.length === 0, bad.join('\n        '))

// Printed rather than passed over: a reader has to be able to see WHICH modules
// the walk declined to follow, and judge for themselves that none feeds a score.
console.log(`  note  authorisation boundary, not followed (no Brand Match input): ${
  [...stoppedAt].sort().join(', ') || 'none reached'}`)
check('the walk stopped only at the shared session/membership layer',
  [...stoppedAt].every(atBoundary), [...stoppedAt].filter(f => !atBoundary(f)).join(', '))

// The engine must also be visibly ON the KOL pool. "No warehouse import" alone
// would also be true of a module that reads no database at all, which is not
// what is being claimed here.
const ENGINE = [
  'src/lib/discover/whatMatters/brandMatch.ts',
  'src/lib/discover/whatMatters/audienceMatch.ts',
  'src/lib/discover/whatMatters/records.ts',
  'src/lib/discover/brandMatch/profile.ts',
]
const onKol = ENGINE.filter(f =>
  existsSync(path.join(ROOT, f))
  && /from '@\/lib\/kolDb'/.test(readFileSync(path.join(ROOT, f), 'utf8')))
check('the engine reads the KOL pool (@/lib/kolDb), not nothing at all',
  onKol.length === ENGINE.length, `${onKol.length}/${ENGINE.length}`)

// The warehouse's abandoned copy of the table must stay abandoned.
const ghost = [...seen].filter(f =>
  existsSync(path.join(ROOT, f))
  && /(FROM|INTO|UPDATE|DELETE FROM)\s+public\.discover_brand_profiles/
    .test(stripComments(readFileSync(path.join(ROOT, f), 'utf8'))))
check('nothing queries the warehouse\'s discover_brand_profiles', ghost.length === 0,
  ghost.join(', '))

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n')
process.exit(failures ? 1 : 0)
