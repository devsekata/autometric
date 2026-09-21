/**
 * Brand Profile → Brand Match automation, end to end, against the running
 * Dagster instance.
 *
 *   npm run verify:automation-e2e
 *
 * Needs the Dagster daemon + code server (scrapper-project scheduled tasks) and
 * the sensors `brand_profile_changed_sensor` / `brand_match_after_transform`
 * RUNNING. The job runs in another process, so the Brand Profile save here is
 * COMMITTED — then removed again at the end, and the run proves the database is
 * back to its starting counts.
 *
 *   1. PUT the Brand Profile through the real route (admin of agency A)
 *   2. wait: brand_profile_changed_sensor → brand_match_job →
 *      brand_match_state(A) = done FOR THIS profile version
 *   3. stored results = the on-demand calculation, creator by creator; the
 *      Directory route serves the stored result
 *   4. change What Matters → the next job recalculates with the new choice
 *   5. tenant: agency B gets nothing of A's
 *   6. cleanup: delete the profile → the job clears A's results → baseline
 */
import { NextRequest } from 'next/server'
import { setTestSession } from './test/authStub'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { PUT } from '@/app/api/organizations/[id]/discover/brand-profile/route'
import { GET as DIRECTORY } from '@/app/api/organizations/[id]/discover/kol-directory/route'
import { brandMatchForDirectory } from '@/lib/discover/whatMatters/brandMatch'
import { storedBrandMatchForDirectory } from '@/lib/discover/whatMatters/brandMatchStore'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) bad++
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const WAIT_MS = 8 * 60 * 1000

async function put(orgId: string, body: Record<string, unknown>) {
  const res = await PUT(new NextRequest(`http://localhost/api/organizations/${orgId}/discover/brand-profile`, {
    method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), params(orgId))
  return res.status
}
async function profileVersion(orgId: string): Promise<string | null> {
  const { rows } = await kolDb().query<{ v: string }>(
    `SELECT updated_at::text AS v FROM public.brand_profile WHERE organization_id = $1`, [orgId])
  return rows[0]?.v ?? null
}
type State = { status: string; trigger: string | null; pv: string | null; dv: string | null
  rows_written: number | null; started_at: string | null; finished_at: string | null; error: string | null }
async function state(orgId: string): Promise<State | null> {
  const { rows } = await kolDb().query<State>(`
    SELECT status, trigger, profile_updated_at::text AS pv, data_version AS dv, rows_written,
           started_at::text, finished_at::text, error
      FROM public.brand_match_state WHERE agency_id = $1`, [orgId])
  return rows[0] ?? null
}
async function waitFor(what: string, test: () => Promise<boolean>): Promise<number> {
  const t0 = Date.now()
  while (Date.now() - t0 < WAIT_MS) {
    if (await test()) return Date.now() - t0
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error(`timed out after ${WAIT_MS / 1000}s waiting for: ${what}`)
}
async function counts() {
  const { rows: [r] } = await kolDb().query<{ p: number; r: number; s: number }>(`
    SELECT (SELECT count(*) FROM public.brand_profile)::int p,
           (SELECT count(*) FROM public.brand_match_result)::int r,
           (SELECT count(*) FROM public.brand_match_state)::int s`)
  return r
}

;(async () => {
  const before = await counts()
  console.log(`baseline: brand_profile=${before.p} brand_match_result=${before.r} brand_match_state=${before.s}`)

  const { rows: admins } = await kolDb().query<{ agency_id: string; user_id: string }>(`
    SELECT am.agency_id::text, am.user_id::text FROM public.agency_members am
      JOIN public.agencies a ON a.id = am.agency_id AND a.deleted_at IS NULL
     WHERE am.role = 'ADMIN' AND am.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM public.brand_profile bp WHERE bp.organization_id = am.agency_id)
     ORDER BY am.agency_id`)
  const A = admins[0]
  const B = admins.find(x => x.agency_id !== A?.agency_id)
  if (!A || !B) { ok('two agencies without a profile exist', false); process.exit(1) }
  const { rows: [{ n: active }] } = await kolDb().query<{ n: number }>(
    `SELECT count(*)::int n FROM public.kol_directory WHERE directory_status = 'active'`)

  try {
    console.log(`\n1–3. Brand Profile save → Dagster job → stored Brand Match (agency ${A.agency_id.slice(0, 8)})`)
    setTestSession({ user: { id: A.user_id } } as never)
    const st1 = await put(A.agency_id, {
      brandName: 'verify-automation-e2e (removed at the end)', brandCategory: 'Beauty',
      whatMatters: ['strong_engagement', 'high_reach'],
    })
    const v1 = await profileVersion(A.agency_id)
    ok('PUT through the real route → 200, row committed', st1 === 200 && !!v1, `profile_updated_at=${v1}`)

    const waited1 = await waitFor('brand_match_state done for v1', async () => {
      const s = await state(A.agency_id); return s?.status === 'done' && s.pv === v1
    })
    const s1 = (await state(A.agency_id))!
    ok('background job finished FOR THIS profile version (no request involved)',
      s1.status === 'done' && s1.pv === v1 && s1.trigger === 'brand_profile',
      `trigger=${s1.trigger} started=${s1.started_at} finished=${s1.finished_at} rows=${s1.rows_written} (waited ${Math.round(waited1 / 1000)}s)`)
    ok('one stored row per active creator', s1.rows_written === active, `${s1.rows_written} of ${active}`)

    const { rows: sample } = await kolDb().query<{ id: string }>(`
      SELECT kol_directory_id::text AS id FROM public.brand_match_result
       WHERE agency_id = $1 ORDER BY match_pct DESC NULLS LAST, kol_directory_id LIMIT 40`, [A.agency_id])
    const ids = sample.map(r => r.id)
    const stored = await storedBrandMatchForDirectory(A.agency_id, ids, ['strong_engagement', 'high_reach'])
    const live = await brandMatchForDirectory(ids, ['strong_engagement', 'high_reach'])
    const same = ids.filter(id => stored?.rows[id]?.matchPct === live.rows[id]?.matchPct
      && JSON.stringify(stored?.rows[id]?.breakdown) === JSON.stringify(live.rows[id]?.breakdown))
    ok('stored result = the on-demand calculation (same engine, same versions)',
      !!stored && same.length === ids.length, `${same.length}/${ids.length}`)

    const res = await DIRECTORY(new NextRequest(
      `http://localhost/api/organizations/${A.agency_id}/discover/kol-directory?ids=${ids.slice(0, 10).join(',')}&match=1`),
      params(A.agency_id))
    const dir = (await res.json()).brandMatch
    ok('Directory ?match=1 serves the stored result',
      res.status === 200 && ids.slice(0, 10).every(id => dir?.rows?.[id]?.matchPct === stored?.rows[id]?.matchPct))

    console.log('\n4. Change What Matters → recalculated with the new choice')
    const st2 = await put(A.agency_id, { whatMatters: ['content_quality'] })
    const v2 = await profileVersion(A.agency_id)
    ok('second PUT → 200, new profile version', st2 === 200 && v2 !== v1, `${v1} → ${v2}`)
    const staleNow = await storedBrandMatchForDirectory(A.agency_id, ids, ['content_quality'])
    ok('until the job finishes, the old stored result is NOT served as current', staleNow === null
      || (await state(A.agency_id))?.pv === v2)
    const waited2 = await waitFor('brand_match_state done for v2', async () => {
      const s = await state(A.agency_id); return s?.status === 'done' && s.pv === v2
    })
    const { rows: keys } = await kolDb().query<{ k: string; n: number }>(`
      SELECT (SELECT string_agg(x->>'key', ',') FROM jsonb_array_elements(breakdown) x) k, count(*)::int n
        FROM public.brand_match_result WHERE agency_id = $1 GROUP BY 1`, [A.agency_id])
    const s2 = (await state(A.agency_id))!
    ok('every stored row now uses the new profile (content_quality only)',
      keys.length === 1 && keys[0].k === 'content_quality' && keys[0].n === active,
      `${JSON.stringify(keys)} finished=${s2.finished_at} (waited ${Math.round(waited2 / 1000)}s)`)

    console.log('\n5. Tenant isolation')
    const { rows: [{ n: foreign }] } = await kolDb().query<{ n: number }>(
      `SELECT count(*)::int n FROM public.brand_match_result WHERE agency_id <> $1`, [A.agency_id])
    ok(`no stored Brand Match for any other agency (e.g. ${B.agency_id.slice(0, 8)})`, foreign === before.r, `${foreign}`)
    ok('agency B reads no stored Brand Match (it has no profile)',
      (await storedBrandMatchForDirectory(B.agency_id, ids, ['content_quality'])) === null)
  } finally {
    console.log('\n6. Cleanup')
    await kolDbWrite().query(`DELETE FROM public.brand_profile WHERE organization_id = $1`, [A.agency_id])
    try {
      await waitFor('job cleared agency A results', async () => {
        const s = await state(A.agency_id)
        const { rows: [{ n }] } = await kolDb().query<{ n: number }>(
          `SELECT count(*)::int n FROM public.brand_match_result WHERE agency_id = $1`, [A.agency_id])
        return s?.status === 'no_selection' && n === 0
      })
      ok('deleting the profile → the job cleared its stored results', true)
    } catch (e) { ok('deleting the profile → the job cleared its stored results', false, String(e)) }
    await kolDbWrite().query(`DELETE FROM public.brand_match_state WHERE agency_id = $1`, [A.agency_id])
    const after = await counts()
    ok('database back to baseline (profile, results, state)',
      after.p === before.p && after.r === before.r && after.s === before.s, JSON.stringify({ before, after }))
  }
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => { console.error(err); process.exit(1) })
