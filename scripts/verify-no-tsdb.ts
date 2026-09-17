/**
 * The app has no runtime dependency on the analytics warehouse (TSDB).
 *
 *   npm run verify:no-tsdb
 *
 * Static only; nothing connects to any database. It walks the import graph of
 * every runtime entry point — each route, page, layout and template under
 * src/app, plus src/instrumentation.ts, src/middleware.ts, src/proxy.ts and
 * src/auth.ts — following value imports and dynamic imports transitively, and
 * fails when any of them can reach a file that
 *
 *   * imports `@/lib/db` (the warehouse pool),
 *   * reads DATABASE_URL or the libpq PG* variables, or
 *   * builds its own `pg` Pool/Client outside `src/lib/kolDb.ts`.
 *
 * Comments are ignored, so a note that mentions DATABASE_URL is not a hit.
 * Type-only imports are ignored: they vanish at compile time.
 *
 * It also lists the files that still use the warehouse directly, so it is
 * visible that they are unreachable rather than deleted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')
const files = new Map(walk(SRC).map(p => [rel(p), readFileSync(p, 'utf8')]))

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function directUse(file: string): string[] {
  const s = stripComments(files.get(file)!)
  const hits: string[] = []
  if (/from\s+['"]@\/lib\/db['"]|require\(\s*['"]@\/lib\/db['"]\s*\)|import\(\s*['"]@\/lib\/db['"]\s*\)/.test(s)) hits.push('@/lib/db')
  if (/\bDATABASE_URL\b/.test(s)) hits.push('DATABASE_URL')
  if (/process\.env\.PG(HOST|DATABASE|USER|PASSWORD|PORT)\b/.test(s)) hits.push('PG* env')
  if (file !== 'src/lib/kolDb.ts' && file !== 'src/lib/db.ts'
      && /from\s+['"]pg['"]/.test(s) && /new\s+(Pool|Client)\s*\(/.test(s)) hits.push('own pg Pool/Client')
  return hits
}

function resolve(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  else return null
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) {
    if (files.has(base + ext)) return base + ext
  }
  return null
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const memo = new Map<string, string[] | null>()

function chain(file: string, stack: Set<string> = new Set()): string[] | null {
  if (memo.has(file)) return memo.get(file)!
  if (stack.has(file)) return null
  if (directUse(file).length) { memo.set(file, [file]); return [file] }
  stack.add(file)
  const s = files.get(file)!
  for (const m of s.matchAll(IMPORT)) {
    if (/^(import|export)\s+type\s/.test(m[0])) continue
    const target = resolve(m[1] ?? m[2], file)
    if (!target) continue
    const c = chain(target, stack)
    if (c) { const found = [file, ...c]; memo.set(file, found); stack.delete(file); return found }
  }
  stack.delete(file)
  memo.set(file, null)
  return null
}

const ENTRY = /^src\/app\/.*\/(route|page|layout|template|default|loading|error|not-found)\.(ts|tsx)$|^src\/app\/(page|layout|template|not-found)\.tsx$/
const entries = [...files.keys()].filter(f =>
  ENTRY.test(f) || ['src/instrumentation.ts', 'src/middleware.ts', 'src/proxy.ts', 'src/auth.ts'].includes(f))

let bad = 0
console.log(`runtime entry points: ${entries.length}`)
for (const e of entries.sort()) {
  const c = chain(e)
  if (c) {
    bad++
    console.error(`  FAIL  ${e}\n        via ${c.slice(1).join(' -> ') || '(itself)'} [${directUse(c[c.length - 1]).join(', ')}]`)
  }
}

const direct = [...files.keys()].filter(f => directUse(f).length).sort()
const reachable = new Set(entries.flatMap(e => chain(e) ?? []))
console.log(`\nfiles that still use the warehouse directly: ${direct.length} (unreachable from any entry point: ${direct.filter(f => !reachable.has(f)).length})`)
for (const f of direct) console.log(`  ${reachable.has(f) ? 'LIVE ' : 'dead '} ${f} [${directUse(f).join(', ')}]`)

console.log(bad ? `\n${bad} entry point(s) reach the warehouse` : '\nno entry point reaches the warehouse')
process.exit(bad ? 1 : 0)
