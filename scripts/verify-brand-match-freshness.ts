/**
 * Brand Match reads the LATEST Brand Profile and the LATEST KOL data.
 *
 *   npm run verify:brand-match-freshness
 *
 * Brand Match is not stored: `GET …/kol-directory?match=1` computes it on every
 * request from `brand_profile.what_matters` and the KOL tables. So "the next
 * Brand Match uses the new data" holds exactly when nothing between the tables
 * and the answer serves an old copy. This checks both triggers end to end:
 *
 *   A  Brand Profile saved (PUT …/brand-profile)
 *      → the next GET …/kol-directory?match=1 uses the saved What Matters.
 *
 *   B  KOL data changed (what the Dagster transform chain and the roster
 *      ingest write: kol_directory, l2_gold.kol_profile_card, l2_gold.post_metric)
 *      → the next GET recomputes against the changed population, not a cached one.
 *
 * Runs the REAL route handlers under `scripts/verify-brand-profile-kol/tsconfig.json`,
 * whose stubs put every query into ONE transaction that is always rolled back
 * and let the script choose the session. No row survives the run.
 *
 * Inside one transaction now() is fixed, so the data changes below stamp
 * `updated_at = clock_timestamp()` — what a later pipeline run's now() would be.
 */
import { Pool } from 'pg'
import { NextRequest } from 'next/server'
import { setSession } from './verify-brand-profile-kol/stubs/auth'
import { bindClient } from './verify-brand-profile-kol/stubs/kolDb'
import { PUT } from '@/app/api/organizations/[id]/discover/brand-profile/route'
import { GET as DIRECTORY } from '@/app/api/organizations/[id]/discover/kol-directory/route'
import { whatMattersPopulation } from '@/lib/discover/whatMatters/records'

let bad = 0
function ok(label: string, pass: boolean, detail?: string) {
  if (!pass) bad++
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

type Json = Record<string, any>
const params = (orgId: string) => ({ params: Promise.resolve({ id: orgId }) })

async function saveWhatMatters(orgId: string, whatMatters: string[]) {
  const req = new NextRequest(`http://localhost/api/organizations/${orgId}/discover/brand-profile`, {
    method: 'PUT', body: JSON.stringify({ whatMatters }), headers: { 'content-type': 'application/json' },
  })
  const res = await PUT(req, params(orgId))
  return { status: res.status, body: await res.json() as Json }
}

async function brandMatch(orgId: string, ids: string[]) {
  const res = await DIRECTORY(
    new NextRequest(`http://localhost/api/organizations/${orgId}/discover/kol-directory?ids=${ids.join(',')}&match=1`),
    params(orgId))
  const body = await res.json() as Json
  return { status: res.status, match: body.brandMatch as Json | undefined }
}

async function live() {
  const missing = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL'].filter(k => !process.env[k])
  if (missing.length) { ok('KOL connection configured', false, `missing ${missing.join(', ')}`); return }

  const pool = new Pool({
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
    max: 2, connectionTimeoutMillis: 8_000,
  })
  const profiles = async (db: Pick<Pool, 'query'>) =>
    (await db.query(`SELECT count(*)::int AS n FROM public.brand_profile`)).rows[0].n as number

  try {
    const { rows: [who] } = await pool.query(`SELECT current_database() AS db`)
    ok('connected to the KOL database', who.db === process.env.PG_DB_KOL, who.db)
    const before = await profiles(pool)

    // An agency admin whose agency has no saved profile, so the first save is a create.
    const { rows: [A] } = await pool.query<{ agency_id: string; user_id: string }>(
      `SELECT am.agency_id::text, am.user_id::text
         FROM public.agency_members am
         JOIN public.agencies a ON a.id = am.agency_id AND a.deleted_at IS NULL
        WHERE am.role = 'ADMIN' AND am.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM public.brand_profile bp WHERE bp.organization_id = am.agency_id)
        ORDER BY am.agency_id LIMIT 1`)
    if (!A) { ok('an agency admin without a saved profile exists', false); return }

    // T: an active creator at the middle of the measured engagement rates, with
    // twenty creators below it — moving those above T must lower T's percentile.
    const { rows: [T] } = await pool.query<{ id: string; er: string }>(
      `SELECT id::text, engagement_rate::text AS er FROM (
         SELECT id, engagement_rate, ntile(2) OVER (ORDER BY engagement_rate) AS half
           FROM public.kol_directory
          WHERE directory_status = 'active' AND engagement_rate > 0 AND engagement_rate < 100
       ) x WHERE half = 2 ORDER BY engagement_rate LIMIT 1`)
    const { rows: below } = await pool.query<{ id: string }>(
      `SELECT id::text FROM public.kol_directory
        WHERE directory_status = 'active' AND engagement_rate > 0 AND engagement_rate < $1
        ORDER BY engagement_rate DESC LIMIT 20`, [T?.er])
    // R: a creator with measured median views, and the cards below it.
    const { rows: [R] } = await pool.query<{ id: string; views: string; card: string }>(
      `SELECT ksa.kol_id::text AS id, pc.median_views::text AS views, pc.social_account_id::text AS card
         FROM l2_gold.kol_profile_card pc
         JOIN public.kol_social_account ksa ON ksa.social_account_id = pc.social_account_id
         JOIN public.kol_directory kd ON kd.id = ksa.kol_id AND kd.directory_status = 'active'
        WHERE pc.median_views > 0
        ORDER BY pc.median_views DESC OFFSET 3 LIMIT 1`)
    if (!T || below.length < 20 || !R) { ok('test creators found (T with 20 below, R with median views)', false); return }

    const client = await pool.connect()
    bindClient(client)
    try {
      await client.query('BEGIN')
      setSession(A.user_id)

      console.log('\nTrigger A — Brand Profile saved → next Brand Match uses it')
      const none = await brandMatch(A.agency_id, [T.id])
      ok('before any save: no selection, nothing scored',
        none.status === 200 && none.match?.unavailable === 'no_selection', JSON.stringify(none.match?.unavailable))

      const s1 = await saveWhatMatters(A.agency_id, ['strong_engagement'])
      const m1 = await brandMatch(A.agency_id, [T.id])
      ok('save [strong_engagement] → 200', s1.status === 200)
      ok('next request scores exactly [strong_engagement]',
        JSON.stringify(m1.match?.whatMatters) === '["strong_engagement"]'
        && m1.match?.rows?.[T.id]?.breakdown?.map((b: Json) => b.key).join() === 'strong_engagement',
        JSON.stringify(m1.match?.whatMatters))

      await saveWhatMatters(A.agency_id, ['high_reach', 'content_quality'])
      const m2 = await brandMatch(A.agency_id, [T.id])
      ok('save [high_reach, content_quality] → next request uses the new choice, not the old one',
        JSON.stringify(m2.match?.whatMatters) === '["high_reach","content_quality"]'
        && m2.match?.rows?.[T.id]?.breakdown?.map((b: Json) => b.key).join() === 'high_reach,content_quality',
        JSON.stringify(m2.match?.whatMatters))

      await saveWhatMatters(A.agency_id, [])
      const m3 = await brandMatch(A.agency_id, [T.id])
      ok('save [] → next request is back to no selection', m3.match?.unavailable === 'no_selection')

      console.log('\nTrigger B — KOL data changed → next Brand Match recomputes against it')
      await saveWhatMatters(A.agency_id, ['strong_engagement'])
      await brandMatch(A.agency_id, [T.id])
      const p0 = await whatMattersPopulation()
      await brandMatch(A.agency_id, [T.id])
      ok('population is reused while the data is unchanged', (await whatMattersPopulation()) === p0)

      const e1 = (await brandMatch(A.agency_id, [T.id])).match?.rows?.[T.id]?.matchPct as number | null
      // The roster ingest writes kol_directory.engagement_rate: lift the twenty
      // creators below T to above it. T's own row is untouched.
      await client.query(
        `UPDATE public.kol_directory SET engagement_rate = $2::numeric + 1, updated_at = clock_timestamp()
          WHERE id = ANY($1::uuid[])`, [below.map(b => b.id), T.er])
      const e2 = (await brandMatch(A.agency_id, [T.id])).match?.rows?.[T.id]?.matchPct as number | null
      ok('kol_directory change → T\'s Strong Engagement recomputed against the new population',
        typeof e1 === 'number' && typeof e2 === 'number' && e2 < e1, `${e1} → ${e2}`)

      await saveWhatMatters(A.agency_id, ['high_reach'])
      const r1 = (await brandMatch(A.agency_id, [R.id])).match?.rows?.[R.id]?.matchPct as number | null
      // The transform chain writes l2_gold.kol_profile_card: every other card
      // gets more median views than R's card.
      await client.query(
        `UPDATE l2_gold.kol_profile_card SET median_views = $2::numeric * 2, updated_at = clock_timestamp()
          WHERE median_views IS NOT NULL AND social_account_id <> $1::uuid`, [R.card, R.views])
      const r2 = (await brandMatch(A.agency_id, [R.id])).match?.rows?.[R.id]?.matchPct as number | null
      ok('l2_gold.kol_profile_card change → R\'s High Reach recomputed against the new population',
        typeof r1 === 'number' && typeof r2 === 'number' && r2 < r1, `${r1} → ${r2}`)

      // The transform chain writes l2_gold.post_metric (Content Quality's population).
      const p1 = await whatMattersPopulation()
      await client.query(
        `UPDATE l2_gold.post_metric SET updated_at = clock_timestamp()
          WHERE id = (SELECT id FROM l2_gold.post_metric ORDER BY id LIMIT 1)`)
      await brandMatch(A.agency_id, [R.id])
      ok('l2_gold.post_metric change → next Brand Match rebuilt the population, not served from cache',
        (await whatMattersPopulation()) !== p1)
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      bindClient(null)
      client.release()
    }

    console.log('\nafter rollback')
    ok('rollback leaves public.brand_profile unchanged', (await profiles(pool)) === before)
  } finally {
    await pool.end().catch(() => {})
  }
}

;(async () => {
  await live()
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
