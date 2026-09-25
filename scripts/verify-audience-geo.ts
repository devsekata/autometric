/**
 * Verifies that every Autometric reader of `l2_gold.audience_geo_daily` sees the
 * audience the classifier sees (`src/lib/discover/audienceGeo.ts`).
 *
 *   npm run verify:audience-geo               # in-memory + live (read-only)
 *   npm run verify:audience-geo -- --offline  # in-memory only
 *
 * In-memory: the selection rule — inferred evidence from every date, measured
 * only from the newest snapshot, measured never summed with inferred, no row
 * counted twice when an account has several dates.
 *
 * Live (KOL database, session forced read-only; never writes): for every
 * creator with an Audience Analysis, the geo the app readers return
 * (`audienceRecordsFor` for Brand Match, `getKolGold` for the creator page) is
 * compared with an INDEPENDENT reference — the selection written in SQL and
 * judged by a port of the classifier's `_known_top` (scrapper-project
 * `audience_classification.py`: >= MIN_KNOWN known followers, `unknown`
 * excluded, a unique top value). Coverage and every creator's top country and
 * city must agree. It also checks the inferred totals against the L1 follower
 * batches, which is what makes summing dates safe.
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'

import kolDb from '@/lib/kolDb'
import { geoDistributions, selectGeoEvidence, type GeoRow } from '@/lib/discover/audienceGeo'
import { audienceRecordsFor } from '@/lib/discover/whatMatters/audienceMatch'
import { getKolGold } from '@/lib/discover/kolGold'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const offline = process.argv.includes('--offline')

/** Port of the classifier's `_known_top` (MIN_KNOWN = 5). */
const MIN_KNOWN = 5
function knownTop(counts: Record<string, number> | undefined): string | null {
  const e = Object.entries(counts ?? {}).filter(([k, v]) => k && k.toLowerCase() !== 'unknown' && v > 0)
  const known = e.reduce((a, [, v]) => a + v, 0)
  if (known < MIN_KNOWN) return null
  e.sort((a, b) => b[1] - a[1])
  if (e.length > 1 && e[0][1] === e[1][1]) return null
  return e[0][0]
}

const row = (o: Partial<GeoRow>): GeoRow => ({
  kolId: 'k1', accountId: 'a1', date: '2026-09-01', level: 'country', key: 'ID', n: 1, confidence: 'inferred_high', ...o,
})

function inMemory() {
  console.log('\nin-memory — selection rule')

  // Inferred on several dates: every date counts, not only the newest.
  const inferred = [
    row({ date: '2026-08-26', key: 'ID', n: 4 }),
    row({ date: '2026-08-26', key: 'unknown', n: 30 }),
    row({ date: '2026-09-22', key: 'ID', n: 3, confidence: 'inferred_low' }),
    row({ date: '2026-09-22', key: 'MY', n: 1, confidence: 'inferred_medium' }),
  ]
  const d1 = geoDistributions(inferred).get('k1')!
  check('inferred multi-date: every date kept', selectGeoEvidence(inferred).length === 4)
  check('inferred multi-date: ID = 4 + 3', d1.country.ID === 7, JSON.stringify(d1.country))
  check('inferred multi-date: newest date alone would be below MIN_KNOWN, all dates pass',
    knownTop({ ID: 3, MY: 1 }) === null && knownTop(d1.country) === 'ID')

  // Measured snapshots are re-counts of the same audience: newest only.
  const measured = [
    row({ date: '2026-08-01', key: 'ID', n: 900, confidence: 'measured' }),
    row({ date: '2026-08-01', key: 'MY', n: 100, confidence: 'measured' }),
    row({ date: '2026-09-01', key: 'ID', n: 950, confidence: 'measured' }),
    row({ date: '2026-09-01', key: 'SG', n: 50, confidence: 'measured' }),
  ]
  const d2 = geoDistributions(measured).get('k1')!
  check('measured: only the newest snapshot', JSON.stringify(d2.country) === JSON.stringify({ ID: 950, SG: 50 }),
    JSON.stringify(d2.country))
  check('measured: no double counting across snapshots', Object.values(d2.country).reduce((a, b) => a + b, 0) === 1000)

  // Measured wins over inferred for the same account + level; never summed.
  const mixed = [...measured, ...inferred]
  const d3 = geoDistributions(mixed).get('k1')!
  check('measured + inferred: measured only, inferred not added on top',
    JSON.stringify(d3.country) === JSON.stringify({ ID: 950, SG: 50 }), JSON.stringify(d3.country))

  // The rule is per level and per account.
  const perLevel = [
    ...measured,
    row({ level: 'city', date: '2026-08-26', key: 'Jakarta', n: 3 }),
    row({ level: 'city', date: '2026-09-22', key: 'Jakarta', n: 4 }),
    row({ accountId: 'a2', date: '2026-09-22', key: 'ID', n: 2 }),
  ]
  const d4 = geoDistributions(perLevel).get('k1')!
  check('per level: city stays inferred across dates while country is measured', d4.city.Jakarta === 7)
  check('per account: a second account of the same creator adds its own inferred batch',
    d4.country.ID === 950 + 2, JSON.stringify(d4.country))

  // Case and whitespace in confidence do not flip the kind.
  check('confidence " Measured " is measured',
    selectGeoEvidence([row({ confidence: ' Measured ', date: '2026-01-01' }), row({ confidence: 'measured', date: '2026-02-01' })]).length === 1)
  check('null confidence is treated as inferred evidence (kept on every date)',
    selectGeoEvidence([row({ confidence: null, date: '2026-01-01' }), row({ confidence: null, date: '2026-02-01' })]).length === 2)
}

async function live() {
  console.log('\nlive — KOL database (read-only)')
  const db = kolDb()
  const ro = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  check('session is read-only', ro.rows[0]?.transaction_read_only === 'on')
  if (ro.rows[0]?.transaction_read_only !== 'on') return

  const { rows: cohort } = await db.query<{ kol: string }>(`
    SELECT DISTINCT ksa.kol_id::text AS kol FROM public.kol_social_account ksa
     WHERE ksa.social_account_id IN (SELECT social_account_id FROM feature.ig_audience_analysis
                                     UNION SELECT social_account_id FROM feature.tt_audience_analysis)`)
  const ids = cohort.map(r => r.kol)
  console.log(`  cohort: ${ids.length} creators with an Audience Analysis`)

  // Independent reference, in SQL: inferred = all dates; measured = newest
  // measured date per (account, level), and it replaces inferred for that level.
  const { rows: ref } = await db.query<{ kol: string; level: string; key: string; n: number }>(`
    WITH g AS (
      SELECT ksa.kol_id::text AS kol, g.social_account_id, g.geo_level, g.geo_key, g.audience_date,
             g.audience_count, lower(trim(coalesce(g.confidence, ''))) = 'measured' AS measured
        FROM public.kol_social_account ksa
        JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
       WHERE ksa.kol_id = ANY ($1::uuid[]) AND g.geo_level IN ('country', 'city')),
    m AS (SELECT social_account_id, geo_level, max(audience_date) AS d FROM g WHERE measured GROUP BY 1, 2)
    SELECT g.kol, g.geo_level AS level, g.geo_key AS key, sum(g.audience_count)::float8 AS n
      FROM g LEFT JOIN m USING (social_account_id, geo_level)
     WHERE (m.d IS NULL AND NOT g.measured) OR (g.measured AND g.audience_date = m.d)
     GROUP BY 1, 2, 3`, [ids])
  const refDist = new Map<string, Record<string, Record<string, number>>>()
  for (const r of ref) {
    const d = refDist.get(r.kol) ?? {}
    ;(d[r.level] ??= {})[r.key] = Number(r.n)
    refDist.set(r.kol, d)
  }

  const recs = await audienceRecordsFor(ids)
  const cov = { ref: { country: 0, city: 0 }, match: { country: 0, city: 0 }, gold: { country: 0, city: 0 } }
  const mismatch: string[] = []
  for (const id of ids) {
    const gold = await getKolGold(id)
    const goldLevel = (s: { label: string; n: number }[] | undefined) => Object.fromEntries((s ?? []).map(x => [x.label, x.n]))
    for (const level of ['country', 'city'] as const) {
      const r = knownTop(refDist.get(id)?.[level])
      const m = knownTop(recs.get(id)?.[level])
      const g = knownTop(goldLevel(level === 'country' ? gold?.audience?.countries : gold?.audience?.cities))
      if (r) cov.ref[level]++
      if (m) cov.match[level]++
      if (g) cov.gold[level]++
      if (r !== m || r !== g) mismatch.push(`${id} ${level}: ref=${r} brandMatch=${m} creatorPage=${g}`)
    }
  }
  console.log(`  coverage (classifier rule, of ${ids.length}):`)
  console.log(`    reference   country ${cov.ref.country}  city ${cov.ref.city}`)
  console.log(`    Brand Match country ${cov.match.country}  city ${cov.match.city}`)
  console.log(`    creator pg  country ${cov.gold.country}  city ${cov.gold.city}`)
  check('Brand Match reader = reference coverage', JSON.stringify(cov.match) === JSON.stringify(cov.ref))
  check('creator page reader = reference coverage', JSON.stringify(cov.gold) === JSON.stringify(cov.ref))
  check('every creator: same top country and city in all three', mismatch.length === 0, mismatch.slice(0, 5).join('; '))

  // What makes summing dates safe: the inferred country total of each
  // (account, date) is exactly that L1 follower batch, and no follower sits on
  // two dates.
  const { rows: batch } = await db.query<{ pairs: string; equal: string; dup_followers: string }>(`
    WITH g AS (SELECT social_account_id sa, audience_date d, sum(audience_count) n
                 FROM l2_gold.audience_geo_daily
                WHERE geo_level = 'country' AND confidence LIKE 'inferred%' GROUP BY 1, 2),
         f AS (SELECT social_account_id sa, date d, count(*) n
                 FROM l1_silver.unified_follower WHERE social_account_id IS NOT NULL GROUP BY 1, 2)
    SELECT count(*) AS pairs,
           count(*) FILTER (WHERE g.n = f.n) AS equal,
           (SELECT count(*) FROM (SELECT social_account_id, lower(username)
                                    FROM l1_silver.unified_follower WHERE social_account_id IS NOT NULL
                                   GROUP BY 1, 2 HAVING count(DISTINCT date) > 1) x) AS dup_followers
      FROM g LEFT JOIN f USING (sa, d)`)
  const b = batch[0]
  console.log(`  L2 inferred (account, date) batches: ${b.pairs}; equal to the L1 batch: ${b.equal}; followers on 2+ dates: ${b.dup_followers}`)
  check('each inferred date equals its L1 follower batch', b.pairs === b.equal && Number(b.pairs) > 0)
  check('no follower appears on two dates (no double counting when dates are summed)', Number(b.dup_followers) === 0)
}

;(async () => {
  inMemory()
  if (!offline) await live()
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
})().catch(err => { console.error(err); process.exit(1) })
