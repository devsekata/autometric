/**
 * Brand Match freshness: a stored result is served only while it is current,
 * and the Directory falls back to the live calculation otherwise.
 *
 *   npm run verify:brand-match-freshness
 *
 * READ-ONLY. The KOL session is opened with `default_transaction_read_only=on`
 * and checked before anything runs; the script writes nothing — no fixture, no
 * profile save, no pipeline table. An earlier version proved freshness by
 * UPDATE-ing whole feature/L2 tables inside a rolled-back transaction, which
 * held row locks on tables the transform chain writes. Freshness is proved here
 * from the version contract instead, against the data as it is.
 *
 * Brand Match is stored per agency (`brand_match_result` + `brand_match_state`,
 * migrations/kol/010) by `recalculateBrandMatch` (scripts/brand-match-recalc.ts),
 * and `GET …/kol-directory?match=1` serves those rows only while they are
 * current; otherwise it computes on demand.
 *
 *   A  static   the route serves `storedBrandMatchForDirectory(...)` first and
 *               falls back to `brandMatchForDirectory(...)`; a stored row is
 *               current only for status 'done' + the agency's current
 *               `brand_profile.updated_at` + the current data fingerprint; the
 *               job records the versions it read BEFORE computing, discards a
 *               result whose inputs moved, and replaces rows in one transaction;
 *               the fingerprint covers every table Brand Match reads — the
 *               tables the Dagster transform chain writes.
 *
 *   B  stored   for agencies that have a `brand_match_state` row: stored rows
 *               are returned exactly when the state is current, and then equal
 *               both `brand_match_result` and a live recomputation.
 *
 *   C  live     `brandMatchForDirectory` scores a saved profile's choice,
 *               answers `no_selection` when nothing is chosen, and reuses its
 *               population while the data fingerprint does not move.
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'

import { readFileSync } from 'node:fs'
import kolDb from '@/lib/kolDb'
import { storedBrandMatchForDirectory } from '@/lib/discover/whatMatters/brandMatchStore'
import { brandMatchForDirectory, currentDataVersion } from '@/lib/discover/whatMatters/brandMatch'
import { getBrandProfile } from '@/lib/discover/brandMatch/profile'
import { whatMattersPopulation } from '@/lib/discover/whatMatters/records'

let bad = 0
function ok(label: string, pass: boolean, detail?: string) {
  if (!pass) bad++
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}
const skip = (label: string, why: string) => console.log(`  skip  ${label} — ${why}`)
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(a - b) < 1e-6
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const inOrder = (s: string, parts: string[]) => {
  let at = -1
  for (const p of parts) {
    const i = s.indexOf(p, at + 1)
    if (i < 0) return false
    at = i
  }
  return true
}

/* ── A. static: the version contract ───────────────────────────────────────── */

function staticChecks() {
  console.log('\nA. static — stored first, live fallback, version contract')

  const route = read('src/app/api/organizations/[id]/discover/kol-directory/route.ts')
  ok('the directory serves stored Brand Match first, then falls back to the live engine',
    inOrder(route, [
      "sp.get('match') === '1'",
      'await storedBrandMatchForDirectory(access.orgId, ids, profile.whatMatters, profile)',
      '?? await brandMatchForDirectory(ids, profile.whatMatters, profile)',
    ]))
  ok('the Brand Profile choice comes from the authorised agency, not the request',
    route.includes('await getBrandProfile(access.orgId)'))

  const store = read('src/lib/discover/whatMatters/brandMatchStore.ts')
  const served = store.slice(store.indexOf('export async function storedBrandMatchForDirectory'))
  ok('a stored row is served only for status done + current profile version + current data version',
    served.includes("s.status = 'done'")
    && served.includes('s.profile_updated_at = bp.updated_at')
    && served.includes('s.data_version = $2')
    && served.includes('await currentDataVersion()'))
  ok('stale or missing state → null, so the caller computes on demand',
    served.includes('if (!fresh?.ok) return null'))

  const job = store.slice(store.indexOf('export async function recalculateBrandMatch'),
    store.indexOf('export async function agenciesToRecalculate'))
  ok('the job reads both versions before computing and again after',
    inOrder(job, [
      'const before = await profileVersion(agencyId)',
      'const dataBefore = await currentDataVersion()',
      'await brandMatchForDirectory(',
      'const after = await profileVersion(agencyId)',
      'const dataAfter = await currentDataVersion()',
    ]))
  ok('a result whose inputs moved is discarded, not written',
    job.includes('if (after.version !== before.version || dataAfter !== dataBefore) continue'))
  // The main write path starts after the "inputs moved?" guard.
  const write = job.slice(Math.max(0, job.indexOf('if (after.version !== before.version')))
  ok('rows are replaced in one transaction (BEGIN → DELETE → INSERT → COMMIT)',
    job.includes('if (after.version !== before.version') && inOrder(write, [
      'const client = await kolDbWrite().connect()',
      "await client.query('BEGIN')",
      'DELETE FROM public.brand_match_result WHERE agency_id = $1',
      'INSERT INTO public.brand_match_result',
      "await client.query('COMMIT')",
    ]))
  ok('the stored rows carry the versions read BEFORE computing',
    job.includes('[agencyId, before.version, dataBefore,'))
  ok('jobs for one agency are serialised',
    job.includes("pg_advisory_lock(hashtext('brand_match:' || $1))"))

  const engine = read('src/lib/discover/whatMatters/brandMatch.ts')
  const fpStart = engine.indexOf('const POPULATION_VERSION_SQL')
  const fp = fpStart < 0 ? '' : engine.slice(fpStart, engine.indexOf('`', engine.indexOf('`', fpStart) + 1))
  for (const table of [
    'public.kol_directory', 'l2_gold.kol_profile_card', 'l2_gold.post_metric',
    'feature.ig_engagement_analysis', 'feature.tt_engagement_analysis', 'public.kol_social_account',
    'l2_gold.audience_demographics_daily', 'l2_gold.audience_geo_daily', 'l2_gold.audience_interest_daily',
  ]) {
    ok(`the data fingerprint covers ${table}`, fp.includes(`FROM ${table}`))
  }

  const mig = read('migrations/kol/010_brand-match-result.sql')
  ok('migration 010 stores both versions on result and state',
    (mig.match(/profile_updated_at/g) ?? []).length >= 2 && (mig.match(/data_version/g) ?? []).length >= 2)
  ok("migration 010 allows the 'done' status the reader requires",
    /CHECK \(status IN \([^)]*'done'/.test(mig))
}

/* ── B. stored path, C. live fallback (read-only) ─────────────────────────── */

async function live() {
  const db = kolDb()
  const { rows: [ro] } = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  ok('KOL session is read-only', ro?.transaction_read_only === 'on')
  if (ro?.transaction_read_only !== 'on') return

  const version = await currentDataVersion()
  ok('the data fingerprint is stable between two reads', (await currentDataVersion()) === version)

  const { rows: sample } = await db.query<{ id: string }>(
    `SELECT id::text FROM public.kol_directory WHERE directory_status = 'active' ORDER BY id LIMIT 10`)

  console.log('\nB. stored path')
  let states: { agency: string; status: string; profile_current: boolean | null; data_current: boolean }[] = []
  try {
    ;({ rows: states } = await db.query(
      `SELECT s.agency_id::text AS agency, s.status,
              (s.profile_updated_at = bp.updated_at) AS profile_current,
              (s.data_version IS NOT DISTINCT FROM $1) AS data_current
         FROM public.brand_match_state s
         LEFT JOIN public.brand_profile bp ON bp.organization_id = s.agency_id
        ORDER BY s.agency_id LIMIT 5`, [version]))
    ok('brand_match_state is readable (migration 010 applied)', true)
  } catch (err) {
    ok('brand_match_state is readable (migration 010 applied)', false, (err as Error).message.slice(0, 160))
  }
  if (!states.length) skip('stored rows vs state', 'no brand_match_state row yet — the recalculation job has not run')

  for (const s of states) {
    const tag = s.agency.slice(0, 8)
    const profile = await getBrandProfile(s.agency)
    const { rows: stored } = await db.query<{ id: string; match_pct: string | null }>(
      `SELECT kol_directory_id::text AS id, match_pct::text FROM public.brand_match_result
        WHERE agency_id = $1 ORDER BY kol_directory_id LIMIT 10`, [s.agency])
    const ids = stored.length ? stored.map(r => r.id) : sample.map(r => r.id)

    const served = await storedBrandMatchForDirectory(s.agency, ids, profile.whatMatters, profile)
    const computed = await brandMatchForDirectory(ids, profile.whatMatters, profile)
    if ((await currentDataVersion()) !== version) {
      skip(`agency ${tag}`, 'the KOL data changed during the check; rerun')
      continue
    }
    const current = s.status === 'done' && s.profile_current === true && s.data_current && !computed.unavailable
    ok(`agency ${tag}: stored rows served exactly when the state is current`,
      (served !== null) === current,
      `status=${s.status} profile_current=${s.profile_current} data_current=${s.data_current} served=${served !== null}`)

    if (served) {
      const dbPct = Object.fromEntries(stored.map(r => [r.id, r.match_pct === null ? null : Number(r.match_pct)]))
      const wrongDb = ids.filter(id => !near(served.rows[id]?.matchPct, dbPct[id]))
      ok(`agency ${tag}: served rows = brand_match_result`, wrongDb.length === 0, wrongDb.slice(0, 3).join(','))
      const wrongLive = ids.filter(id => !near(served.rows[id]?.matchPct, computed.rows[id]?.matchPct))
      ok(`agency ${tag}: a current stored result equals a live recomputation`,
        wrongLive.length === 0, wrongLive.slice(0, 3).join(','))
    }
  }

  console.log('\nC. live fallback')
  const ids = sample.map(r => r.id)
  const none = await brandMatchForDirectory(ids, [], null)
  ok('nothing chosen → no_selection, nobody scored',
    none.unavailable === 'no_selection' && Object.keys(none.rows).length === 0)

  const { rows: [chooser] } = await db.query<{ org: string }>(
    `SELECT organization_id::text AS org FROM public.brand_profile
      WHERE cardinality(what_matters) > 0 ORDER BY organization_id LIMIT 1`)
  if (!chooser) {
    skip('live scoring of a saved choice', 'no Brand Profile with What Matters chosen')
  } else {
    const profile = await getBrandProfile(chooser.org)
    const liveMatch = await brandMatchForDirectory(ids, profile.whatMatters, profile)
    const allowed = new Set<string>([...liveMatch.whatMatters, ...(liveMatch.audienceCriteria ?? [])])
    ok('live Brand Match scores the saved What Matters',
      JSON.stringify(liveMatch.whatMatters) === JSON.stringify(profile.whatMatters),
      JSON.stringify(liveMatch.whatMatters))
    const rows = Object.values(liveMatch.rows)
    ok('every breakdown uses only the chosen criteria',
      rows.every(r => r.breakdown.every(b => allowed.has(b.key))))
    ok('Match % is null or within 0–100, never an invented zero for lack of data',
      rows.every(r => r.matchPct === null || (r.matchPct >= 0 && r.matchPct <= 100)))
  }

  const p0 = await whatMattersPopulation()
  const p1 = await whatMattersPopulation()
  if ((await currentDataVersion()) === version) {
    ok('the population is reused while the data fingerprint does not move', p0 === p1)
  } else {
    skip('population reuse', 'the KOL data changed during the check')
  }
}

;(async () => {
  staticChecks()
  try {
    await live()
  } catch (err) {
    ok('live checks ran', false, (err as Error).message.slice(0, 200))
  } finally {
    await kolDb().end().catch(() => {})
  }
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
