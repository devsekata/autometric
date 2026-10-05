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
 *               pool, every route checks agency membership, the list comes
 *               from `/discover/links` (`listCreatorLinks(orgId)` after the
 *               membership check, agency-scoped active links only), the
 *               workspace reaches it through MyCreatorsView → LinkedCreatorList,
 *               the legacy warehouse creator routes are gone, and
 *               the workspace no longer mounts the warehouse roster.
 *   2. live   — `listKolDirectory({ agencyId })` returns exactly the creators
 *               an agency holds an active link to; an unknown agency sees
 *               nothing; `myCreatorIdsAmong` agrees with a direct SELECT;
 *               `listCreatorLinks` returns only the agency's own active links.
 */
import { existsSync, readFileSync } from 'node:fs'
import kolDb from '@/lib/kolDb'
import { listKolDirectory } from '@/lib/discover/kolDirectory'
import { myCreatorIdsAmong } from '@/lib/discover/myCreators'
import { listCreatorLinks } from '@/lib/discover/creatorLinks'

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
const LINKS_ROUTE = 'src/app/api/organizations/[id]/discover/links/route.ts'
const LINKS_CREATORS_ROUTE = 'src/app/api/organizations/[id]/discover/links/creators/route.ts'
const KOL_ONLY = [
  'src/lib/discover/myCreators.ts',
  'src/lib/discover/creatorLinks.ts',
  'src/app/api/organizations/[id]/discover/my-creators/route.ts',
  'src/app/api/organizations/[id]/discover/my-creators/[kolId]/route.ts',
  LINKS_ROUTE,
  LINKS_CREATORS_ROUTE,
  'src/app/api/organizations/[id]/discover/kol-directory/route.ts',
  'src/lib/discover/kolDirectory.ts',
]
for (const f of KOL_ONLY) ok(`${f} does not import @/lib/db`, !TSDB.test(read(f)))

for (const f of KOL_ONLY.filter(f => f.includes('/app/api/'))) {
  ok(`${f} checks agency membership`, read(f).includes('requireOrgMemberById('))
}
// The My Creators list is /discover/links: membership is checked first, then the
// links are read for that same org id — never for an id taken from the request.
for (const f of [LINKS_ROUTE, LINKS_CREATORS_ROUTE]) {
  const s = read(f)
  const guard = s.indexOf('if (!access)')
  const list = s.indexOf('listCreatorLinks(orgId)')
  ok(`${f} lists links for the authorised org only after the membership check`,
    s.includes('requireOrgMemberById(orgId)') && guard > -1 && list > guard)
}
const links = read('src/lib/discover/creatorLinks.ts')
ok('creator links are one agency\'s active links only',
  /WHERE a\.agency_id = \$1 AND a\.is_active IS TRUE/.test(links))
const listRoute = read('src/app/api/organizations/[id]/discover/kol-directory/route.ts')
ok('the directory route never takes an agency id from the request',
  !/agencyId:\s*(sp|req|body)\b/.test(listRoute))

const LEGACY = [
  'src/app/api/organizations/[id]/discover/creators/route.ts',
  'src/app/api/organizations/[id]/discover/creators/[creatorId]/route.ts',
  'src/app/api/organizations/[id]/discover/creators/[creatorId]/refresh/route.ts',
  'src/app/api/organizations/[id]/discover/creators/check/route.ts',
]
// The retired warehouse creator copy ("Added by us") is removed, not just
// switched off. `creators/similar` stays: it is live KOL code.
for (const f of LEGACY) ok(`${f} no longer exists`, !existsSync(f))

const ws = read('src/components/discover/DiscoverWorkspace.tsx')
ok('workspace mounts My Creators (MyCreatorsView)',
  ws.includes("import MyCreatorsView from './MyCreatorsView'") && ws.includes('<MyCreatorsView'))
const myView = read('src/components/discover/MyCreatorsView.tsx')
ok('My Creators lists the roster facet through LinkedCreatorList',
  myView.includes("import LinkedCreatorList from './LinkedCreatorList'")
  && myView.includes('<LinkedCreatorList') && myView.includes('facet="roster"'))
ok('My Creators state comes from useCreatorLinks',
  myView.includes("import { useCreatorLinks } from './useCreatorLinks'") && myView.includes('useCreatorLinks(orgId)'))
ok('useCreatorLinks reads /discover/links',
  read('src/components/discover/useCreatorLinks.ts').includes('/discover/links`'))
ok('LinkedCreatorList reads /discover/links/creators?facet=',
  read('src/components/discover/LinkedCreatorList.tsx').includes('/discover/links/creators?facet=${facet}`'))
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

    // /discover/links reads the same relation: only this agency's active links.
    const linkIds = (await listCreatorLinks(agency.id)).map(l => l.id)
    const { rows: notOwn } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM unnest($1::uuid[]) AS x(kid)
        WHERE NOT EXISTS (SELECT 1 FROM public.agency_kol_accounts a
                           WHERE a.kol_account_id = x.kid AND a.agency_id = $2 AND a.is_active IS TRUE)`,
      [linkIds, agency.id],
    )
    ok('listCreatorLinks returns only the agency\'s own active links',
      linkIds.length > 0 && notOwn[0].n === 0, `${linkIds.length} links, ${notOwn[0].n} foreign`)
  }

  const stranger = '00000000-0000-4000-8000-000000000000'
  ok('an agency with no links has no /discover/links rows', (await listCreatorLinks(stranger)).length === 0)
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
