/**
 * Verifies My Creators runs on the KOL server only and stays inside one agency.
 *
 *   npm run verify:my-creators               # static + live (read-only, needs VPN)
 *   npm run verify:my-creators -- --offline  # static only
 *
 * Nothing here writes. The live layer only SELECTs, and the write statements
 * of `myCreators.ts` are checked with plain EXPLAIN (planned, never executed)
 * inside a READ ONLY transaction that is rolled back.
 *
 *   1. static — the My Creators modules and routes never import the warehouse
 *               pool, every route checks agency membership, the legacy
 *               warehouse creator routes answer "unavailable", and the
 *               workspace no longer mounts the warehouse roster.
 *   2. live   — `listKolDirectory({ agencyId })` returns exactly the creators
 *               an agency holds an active link to; an unknown agency sees
 *               nothing; `myCreatorIdsAmong` agrees with a direct SELECT.
 */
import { readFileSync } from 'node:fs'
import kolDb from '@/lib/kolDb'
import { listKolDirectory } from '@/lib/discover/kolDirectory'
import { myCreatorIdsAmong } from '@/lib/discover/myCreators'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const offline = process.argv.includes('--offline')
const read = (p: string) => readFileSync(p, 'utf8')
const TSDB = /from ['"]@\/lib\/db['"]/

/* ── 1. static ─────────────────────────────────────────────────────────────── */

console.log('\nstatic')
const KOL_ONLY = [
  'src/lib/discover/myCreators.ts',
  'src/app/api/organizations/[id]/discover/my-creators/route.ts',
  'src/app/api/organizations/[id]/discover/my-creators/[kolId]/route.ts',
  'src/app/api/organizations/[id]/discover/kol-directory/route.ts',
  'src/lib/discover/kolDirectory.ts',
]
for (const f of KOL_ONLY) ok(`${f} does not import @/lib/db`, !TSDB.test(read(f)))

for (const f of KOL_ONLY.filter(f => f.includes('/app/api/'))) {
  ok(`${f} checks agency membership`, read(f).includes('requireOrgMemberById('))
}
const listRoute = read('src/app/api/organizations/[id]/discover/kol-directory/route.ts')
ok('scope=mine uses the authorised org id, not a client value',
  /agencyId: sp\.get\('scope'\) === 'mine' \? access\.orgId : null/.test(listRoute))

const LEGACY = [
  'src/app/api/organizations/[id]/discover/creators/route.ts',
  'src/app/api/organizations/[id]/discover/creators/[creatorId]/route.ts',
  'src/app/api/organizations/[id]/discover/creators/[creatorId]/refresh/route.ts',
  'src/app/api/organizations/[id]/discover/creators/check/route.ts',
]
for (const f of LEGACY) {
  const s = read(f)
  ok(`${f} is switched off`, s.includes('featureUnavailable(') && !s.includes('creatorStore') && !TSDB.test(s))
}

const ws = read('src/components/discover/DiscoverWorkspace.tsx')
ok('workspace mounts My Creators from the KOL directory', /scope="mine"/.test(ws))
ok('workspace no longer mounts the warehouse roster or intake',
  !/from '\.\/(CreatorRoster|CreatorDetail|CreatorProfilingScreen|AddCreatorModal)'/.test(ws))

const store = read('src/lib/discover/myCreators.ts')
ok('remove deactivates rather than deletes', !/DELETE\s+FROM/i.test(store) && /is_active = false/.test(store))
ok('add is serialised per (agency, creator)', store.includes('pg_advisory_xact_lock'))
const addKol = read('src/lib/kolDirectory/addKolScrape.ts')
ok('Add KOL links under the same lock key as My Creators',
  store.includes('`my-creators:${agencyId}:${kolId}`')
  && addKol.includes('`my-creators:${input.agencyId}:${kolDirectoryId}`'))

/* ── 2. live ───────────────────────────────────────────────────────────────── */

async function live() {
  console.log('\nlive (read-only)')
  const db = kolDb()

  const { rows: agencies } = await db.query<{ id: string; links: number }>(
    `SELECT a.agency_id::text AS id, COUNT(DISTINCT a.kol_account_id)::int AS links
       FROM public.agency_kol_accounts a
       JOIN public.agencies ag ON ag.id = a.agency_id AND ag.deleted_at IS NULL
       JOIN public.kol_directory kd ON kd.id = a.kol_account_id AND kd.directory_status = 'active'
      WHERE a.is_active IS TRUE
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  )
  const agency = agencies[0]
  ok('an agency with active links exists to test against', !!agency, agency ? `${agency.links} active links` : '')
  if (agency) {
    const page = await listKolDirectory({ agencyId: agency.id, pageSize: 50 })
    ok('My Creators total = active links to active creators', page.total === agency.links,
      `list=${page.total} db=${agency.links}`)

    const ids = page.rows.map(r => r.id)
    const { rows: foreign } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM unnest($1::uuid[]) AS x(kid)
        WHERE NOT EXISTS (SELECT 1 FROM public.agency_kol_accounts a
                           WHERE a.kol_account_id = x.kid AND a.agency_id = $2 AND a.is_active IS TRUE)`,
      [ids, agency.id],
    )
    ok('every listed creator belongs to that agency', foreign[0].n === 0, `${foreign[0].n} foreign`)

    const mine = await myCreatorIdsAmong(agency.id, ids)
    ok('myCreatorIdsAmong marks every listed creator', mine.size === ids.length, `${mine.size}/${ids.length}`)
  }

  const stranger = '00000000-0000-4000-8000-000000000000'
  const none = await listKolDirectory({ agencyId: stranger, pageSize: 5 })
  ok('an agency with no links sees no creators', none.total === 0 && none.rows.length === 0, `total=${none.total}`)
  const anyIds = (await listKolDirectory({ pageSize: 5 })).rows.map(r => r.id)
  ok('an agency with no links owns none of the database', (await myCreatorIdsAmong(stranger, anyIds)).size === 0)

  // Write statements: planned only.
  const client = await db.connect()
  try {
    await client.query('BEGIN READ ONLY')
    const U = stranger
    const plans: [string, string, unknown[]][] = [
      ['advisory lock', `SELECT pg_advisory_xact_lock(hashtext($1))`, ['x']],
      ['creator lookup', `SELECT platform_id FROM public.kol_directory WHERE id = $1 AND directory_status = 'active'`, [U]],
      ['existing link', `SELECT id, is_active FROM public.agency_kol_accounts
         WHERE agency_id = $1 AND kol_account_id = $2
         ORDER BY is_active IS TRUE DESC, created_at ASC NULLS LAST LIMIT 1`, [U, U]],
      ['insert link', `INSERT INTO public.agency_kol_accounts
         (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', true, $4, now(), now())`, [U, U, U, U]],
      ['reactivate link', `UPDATE public.agency_kol_accounts SET is_active = true, status = 'active', updated_at = now() WHERE id = $1`, [U]],
      ['deactivate link', `UPDATE public.agency_kol_accounts SET is_active = false, status = 'inactive', updated_at = now()
         WHERE agency_id = $1 AND kol_account_id = $2 AND is_active IS TRUE`, [U, U]],
    ]
    for (const [label, sql, params] of plans) {
      await client.query('SAVEPOINT p')
      try {
        await client.query(`EXPLAIN ${sql}`, params)
        ok(`plans: ${label}`, true)
      } catch (err) {
        ok(`plans: ${label}`, false, err instanceof Error ? err.message : String(err))
      }
      await client.query('ROLLBACK TO SAVEPOINT p')
    }
    await client.query('ROLLBACK')
  } finally {
    client.release()
  }
}

;(async () => {
  if (!offline) await live()
  await kolDb().end().catch(() => {})
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
