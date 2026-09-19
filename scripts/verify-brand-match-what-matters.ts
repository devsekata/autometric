/**
 * Verifies Brand Match from What Matters: the What Matters a Brand Profile
 * saved (`brand_profile.what_matters`), averaged over a KOL's What Matters
 * scores.
 *
 *   npm run verify:brand-match-wm               # in-memory + static + live (read-only)
 *   npm run verify:brand-match-wm -- --offline  # in-memory + static only
 *
 * The live check reads the KOL database only and never touches brand_profile:
 * it scores a page of creators through `brandMatchForDirectory` and confirms
 * every Match % is exactly the mean of that creator's own What Matters scores.
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import {
  WHAT_MATTERS_CRITERION, WHAT_MATTERS_KEYS, WHAT_MATTERS_OPTIONS,
  brandMatchForDirectory, brandMatchFromScores, cleanWhatMatters,
} from '@/lib/discover/whatMatters/brandMatch'
import { CRITERIA_LABELS, CRITERIA_ORDER, matchWhatMatters, whatMattersScore } from '@/lib/discover/whatMatters'
import type { CriterionScores } from '@/lib/discover/whatMatters/score'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const near = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9
const offline = process.argv.includes('--offline')

/** Scores keyed by What Matters criterion — all six. */
const FULL: CriterionScores = {
  engagement: 82, audience_quality: 90, consistency: 50,
  community: 71, reach: 40, content_quality: 63,
}

function inMemory() {
  console.log('\nVocabulary')
  check('six keys, as decided',
    WHAT_MATTERS_KEYS.join(',') === 'strong_engagement,high_audience_quality,consistent_performance,strong_community,high_reach,content_quality')
  check('each key maps to its What Matters criterion',
    Object.entries(WHAT_MATTERS_CRITERION).map(([k, c]) => `${k}>${c}`).join(',')
      === 'strong_engagement>engagement,high_audience_quality>audience_quality,consistent_performance>consistency,strong_community>community,high_reach>reach,content_quality>content_quality')
  check('brand_safety is not choosable', !(WHAT_MATTERS_KEYS as readonly string[]).includes('brand_safety'))
  check('What Matters itself has exactly the six criteria Brand Match maps to (no brand_safety)',
    CRITERIA_ORDER.join(',') === Object.values(WHAT_MATTERS_CRITERION).join(',')
    && !(CRITERIA_ORDER as readonly string[]).includes('brand_safety'), CRITERIA_ORDER.join(','))
  check('cleaning keeps known keys, canonical order, no duplicates, drops the rest',
    cleanWhatMatters(['high_reach', 'brand_safety', 'x', 'strong_engagement', 'high_reach', 7]).join(',')
      === 'strong_engagement,high_reach')
  check('cleaning a non-array gives nothing', cleanWhatMatters('high_reach').length === 0)
  check('option labels are the What Matters labels',
    WHAT_MATTERS_OPTIONS.every(o => o.label === CRITERIA_LABELS[WHAT_MATTERS_CRITERION[o.key]]))

  console.log('\nMatch %')
  check('1 chosen → that score (82)', near(brandMatchFromScores(FULL, ['strong_engagement']).matchPct, 82))
  const two = brandMatchFromScores(FULL, ['strong_engagement', 'high_audience_quality'])
  check('2 chosen → (82 + 90) / 2 = 86', near(two.matchPct, 86), String(two.matchPct))
  check('3 chosen → (82 + 90 + 40) / 3',
    near(brandMatchFromScores(FULL, ['strong_engagement', 'high_audience_quality', 'high_reach']).matchPct,
      (82 + 90 + 40) / 3))
  check('all 6 chosen → mean of the six',
    near(brandMatchFromScores(FULL, [...WHAT_MATTERS_KEYS]).matchPct, (82 + 90 + 50 + 71 + 40 + 63) / 6))

  console.log('\nNULL handling')
  const withNull = brandMatchFromScores({ ...FULL, reach: null }, ['strong_engagement', 'high_reach'])
  check('a NULL chosen score leaves the denominator (82, not 41)',
    near(withNull.matchPct, 82) && withNull.contributing === 1 && withNull.selected === 2)
  check('…and shows in the breakdown as not counted',
    withNull.breakdown.find(b => b.key === 'high_reach')?.counted === false)
  const allNull = brandMatchFromScores({ engagement: null, audience_quality: null, reach: 90 },
    ['strong_engagement', 'high_audience_quality'])
  check('every chosen score NULL → Match % null (no_scores), even with an unchosen score present',
    allNull.matchPct === null && allNull.unavailable === 'no_scores')
  const none = brandMatchFromScores(FULL, [])
  check('nothing chosen → Match % null (no_selection)',
    none.matchPct === null && none.unavailable === 'no_selection' && none.breakdown.length === 0)

  console.log('\nUnchosen criteria cannot move it')
  const chosen = ['strong_engagement', 'high_audience_quality']
  check('changing every unchosen score leaves Match % unchanged',
    near(brandMatchFromScores(FULL, chosen).matchPct, brandMatchFromScores({
      ...FULL, consistency: 0, community: 100, reach: null, content_quality: 1,
    }, chosen).matchPct))

  console.log('\nReuse, not a second formula')
  for (const c of [['strong_engagement'], ['high_reach', 'content_quality'], [...WHAT_MATTERS_KEYS]]) {
    const crit = cleanWhatMatters(c).map(k => WHAT_MATTERS_CRITERION[k])
    check(`Match % = whatMattersScore for [${c.join(',')}]`,
      near(brandMatchFromScores(FULL, c).matchPct, whatMattersScore(FULL, crit)))
  }
}

function staticChecks() {
  console.log('\nStatic')
  const lib = readFileSync('src/lib/discover/whatMatters/brandMatch.ts', 'utf8')
  const route = readFileSync('src/app/api/organizations/[id]/discover/kol-directory/route.ts', 'utf8')
  check('brandMatch.ts averages through whatMattersScore', lib.includes('whatMattersScore(scores, criteria)'))
  check('brandMatch.ts does not import the warehouse pool', !/from '@\/lib\/db'/.test(lib))
  check('Directory reads the choice from the authorised agency\'s Brand Profile on ?match=1',
    route.includes("sp.get('match') === '1'")
    && route.includes('getBrandProfile(access.orgId)')
    && route.includes('brandMatchForDirectory(data.rows.map(r => r.id), profile.whatMatters)'))
  check('Directory takes no criteria from the query string', !route.includes("sp.get('brandMatch')"))

  // Directory UI: renders the API's Match %, and never builds one of its own.
  const page = readFileSync('src/components/discover/KolDirectoryPage.tsx', 'utf8')
  const badge = page.slice(page.indexOf('function MatchBadge('), page.indexOf('function Stat('))
  check('UI fetches Brand Match in its own request (?ids=…&match=1), so the list never depends on it',
    page.includes('/discover/kol-directory?ids=${pageIds}&match=1')
    && !/params\.set\('match'/.test(page))
  check('UI shows nothing when no What Matters is chosen (no_selection)',
    page.includes('const matchOn = !!brandMatch && !brandMatch.unavailable'))
  check('MatchBadge displays m.matchPct and averages nothing itself',
    badge.includes('m.matchPct') && !/\.reduce\(/.test(badge) && !/\/\s*m\.(selected|contributing)/.test(badge))
  check('a null matchPct is shown as a dash, not a zero', badge.includes("'Match —'"))
  check('the UI imports Brand Match types only (no server code in the client bundle)',
    page.includes("import type { BrandMatchResult, DirectoryBrandMatch } from '@/lib/discover/whatMatters/brandMatch'"))

  // What Matters itself is the engkol_v2 port with ONLY Brand Safety taken out.
  // Compared declaration by declaration (comments ignored): every declaration
  // v2 has is still here and unchanged — the six formulas and Content Quality
  // included — except the Brand Safety ones, which must be gone, and the few
  // that listed Brand Safety, which must equal v2 with exactly that removed.
  const BS_REMOVED = ['W_BS_AUTHENTICITY', 'W_BS_FOLLOWER_QUALITY', 'W_BS_VERIFIED', 'W_BS_PAID', 'brandSafetyScore']
  const BS_EDITED: Record<string, (v2: string) => string> = {
    CRITERIA_ORDER: t => t.replace(" 'brand_safety',", ''),
    CRITERIA_LABELS: t => dropLines(t, /^\s*brand_safety:/),
    scoreRecord: t => dropLines(t, /brand_safety:|k\.followerQuality/),
    WhatMattersRecord: t => dropLines(t, /^\s*(followerQuality|isVerified|paidRatio):/),
    whatMattersRecordsFor: t => dropLines(t
      .replace('; fq: string | null', '')
      .replace(/\n\s*-- Follower quality lives ONLY[\s\S]*?AS fq,/, '')
      .replace(/AS cq_er_posts,\n\s*pc\.is_verified,\n\s*pc\.paid_ratio/, 'AS cq_er_posts')
      .replace(/\n\s*-- Both platforms carry the same four columns[\s\S]*?\) aa ON TRUE/, ''),
      /is_verified: boolean \| null; paid_ratio|followerQuality: num|isVerified: r\.is_verified|paidRatio: num/),
  }
  for (const f of ['model', 'score', 'records', 'index']) {
    const path = `src/lib/discover/whatMatters/${f}.ts`
    let ref: string | null = null
    try { ref = execSync(`git show 365829c:${path}`, { encoding: 'utf8' }) } catch { /* ref unavailable */ }
    if (ref === null) continue
    const v2 = declarations(ref)
    const now = declarations(readFileSync(path, 'utf8'))
    const differs: string[] = []
    for (const [name, text] of v2) {
      if (BS_REMOVED.includes(name)) {
        if (now.has(name)) differs.push(`${name} still present`)
        continue
      }
      const expected = BS_EDITED[name] ? BS_EDITED[name](text) : text
      if (now.get(name) !== expected) differs.push(name)
    }
    for (const name of now.keys()) if (!v2.has(name)) differs.push(`${name} is new`)
    check(`${path} = engkol_v2@365829c minus Brand Safety (${now.size} declarations)`,
      differs.length === 0, differs.join(', '))
  }
}

/** Removes every line matching `re`. */
function dropLines(text: string, re: RegExp): string {
  return text.split('\n').filter(l => !re.test(l)).join('\n')
}

/**
 * Top-level declarations of a TypeScript source, keyed by name, comments and
 * imports dropped. A declaration runs from its first line to the next top-level
 * declaration, comment or import; trailing blank lines are trimmed.
 */
function declarations(src: string): Map<string, string> {
  const out = new Map<string, string>()
  let name: string | null = null
  let buf: string[] = []
  const flush = () => { if (name) out.set(name, buf.join('\n').trimEnd()); name = null; buf = [] }
  for (const line of src.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m) { flush(); name = m[1]; buf = [line]; continue }
    if (/^(\/\*|\/\/|import\b|export\s*[{*])/.test(line)) { flush(); continue }
    if (name) buf.push(line)
  }
  flush()
  return out
}

async function live() {
  console.log('\nLive (read-only; brand_profile not touched)')
  const { default: kolDb } = await import('@/lib/kolDb')
  const { rows } = await kolDb().query<{ id: string }>(`
    SELECT kd.id::text FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
     WHERE EXISTS (SELECT 1 FROM l2_gold.post_metric pm WHERE pm.social_account_id = ksa.social_account_id)
     LIMIT 20`)
  const ids = rows.map(r => r.id)
  const choice = ['strong_engagement', 'high_reach', 'content_quality']
  const crit = cleanWhatMatters(choice).map(k => WHAT_MATTERS_CRITERION[k])
  const [bm, wm] = await Promise.all([brandMatchForDirectory(ids, choice), matchWhatMatters(ids, crit)])
  let same = 0
  for (const id of ids) {
    const s = wm.get(id)!.scores
    const vals = crit.map(c => s[c]).filter((v): v is number => typeof v === 'number')
    const expected = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    if (near(bm.rows[id]?.matchPct ?? null, expected)) same++
  }
  check(`Match % = mean of each creator's own What Matters scores (${same}/${ids.length})`,
    ids.length > 0 && same === ids.length)
  const empty = await brandMatchForDirectory(ids, [])
  check('an empty choice scores nobody', empty.unavailable === 'no_selection' && !Object.keys(empty.rows).length)
  await kolDb().end()
}

;(async () => {
  inMemory()
  staticChecks()
  if (!offline) await live()
  console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n')
  process.exit(failures ? 1 : 0)
})().catch(err => { console.error(err); process.exit(1) })
