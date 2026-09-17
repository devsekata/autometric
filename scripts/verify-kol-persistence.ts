/**
 * End-to-end check of the KOL product's persistent actions, through the real
 * API route handlers, against the KOL database — leaving nothing behind.
 *
 *   npm run verify:kol-persistence
 *
 * How it stays harmless:
 *   * every KOL query runs inside ONE transaction that is rolled back at the end
 *     (scripts/test/kolRollback.ts), including the two test agencies and users
 *     it creates, so no row is ever committed;
 *   * the warehouse is unreachable: DATABASE_URL points at an invalid host
 *     before any module loads, and the run fails if `src/lib/db.ts` was loaded;
 *   * the session comes from scripts/test/authStub.ts (mapped over `@/auth` by
 *     scripts/test/tsconfig.json), so membership is still checked for real
 *     against `agency_members`;
 *   * no path that scrapes or calls Apify is exercised (Add KOL is only checked
 *     up to its authorization answers).
 *
 * Covers: My Creators, Favorite, Saved Lists (add, duplicate, reload, remove,
 * re-add, agency and user isolation, unauthenticated), the unique constraints,
 * the add lock, Compare's metric sources, and Add KOL authorization.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

process.env.DATABASE_URL = 'postgres://tsdb-blocked.invalid:1/blocked'
for (const k of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT']) delete process.env[k]

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(a - b) < 1e-6

type Handler = (req: unknown, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function main() {
  const kolCfg = {
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
  }
  if (!kolCfg.host || !kolCfg.database) throw new Error('PG_*_KOL is not configured')

  const rb = await import('./test/kolRollback')
  await rb.start(kolCfg)
  const { setTestSession } = await import('./test/authStub')
  const { NextRequest } = await import('next/server')
  const myCreators = await import('../src/app/api/organizations/[id]/discover/my-creators/route')
  const myCreator = await import('../src/app/api/organizations/[id]/discover/my-creators/[kolId]/route')
  const favorites = await import('../src/app/api/organizations/[id]/discover/favorites/route')
  const favorite = await import('../src/app/api/organizations/[id]/discover/favorites/[kolId]/route')
  const savedFilters = await import('../src/app/api/organizations/[id]/discover/saved-filters/route')
  const savedFilter = await import('../src/app/api/organizations/[id]/discover/saved-filters/[filterId]/route')
  const directory = await import('../src/app/api/organizations/[id]/discover/kol-directory/route')
  const addCheck = await import('../src/app/api/kol-directory/add/check/route')
  const addStatus = await import('../src/app/api/kol-directory/add/[kolId]/status/route')
  const profileRoute = await import('../src/app/api/organizations/[id]/discover/kol-directory/[kolId]/route')
  const similar = await import('../src/app/api/organizations/[id]/discover/creators/similar/route')
  const offRates = await import('../src/app/api/organizations/[id]/discover/rates/route')
  const offDashboard = await import('../src/app/api/organizations/[id]/dashboard/overview/route')
  const offBrand = await import('../src/app/api/brands/[brandId]/route')

  const call = async (route: unknown, method: string, url: string, params: Record<string, string>, body?: unknown) => {
    const req = new NextRequest(`http://kol.test${url}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    })
    const res = await (route as Handler)(req, { params: Promise.resolve(params) })
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null }
  }
  const as = (userId: string | null) => setTestSession(userId ? { user: { id: userId } } : null)

  try {
    /* ── fixtures (rolled back) ────────────────────────────────────────── */
    const tag = `e2e-${Date.now()}`
    const user = async (n: string) => (await rb.sql<{ id: string }>(
      `INSERT INTO public."user" (email, name, email_verified, role, user_type, created_at, updated_at)
       VALUES ($1, $2, true, 'USER', 'staff', now(), now()) RETURNING id`,
      [`${tag}-${n}@kol-test.invalid`, `E2E ${n}`])).rows[0].id
    const agency = async (n: string, owner: string) => (await rb.sql<{ id: string }>(
      `INSERT INTO public.agencies (name, slug, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()) RETURNING id`, [`E2E ${n}`, `${tag}-${n}`, owner])).rows[0].id
    const member = (agencyId: string, userId: string, role: string) => rb.sql(
      `INSERT INTO public.agency_members (agency_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`, [agencyId, userId, role])

    const uA = await user('a'); const uB = await user('b'); const uC = await user('c')
    const A = await agency('a', uA); const B = await agency('b', uB)
    await member(A, uA, 'ADMIN'); await member(B, uB, 'ADMIN'); await member(A, uC, 'MEMBER')

    const { rows: kols } = await rb.sql<{ id: string }>(
      `SELECT kd.id FROM public.kol_directory kd
        WHERE kd.directory_status = 'active'
          AND EXISTS (SELECT 1 FROM public.kol_social_account ksa
                        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
                       WHERE ksa.kol_id = kd.id AND c.avg_views IS NOT NULL)
        ORDER BY kd.id LIMIT 3`)
    ok('three measured creators to test with', kols.length === 3)
    const [k1, k2, k3] = kols.map(r => r.id)
    const pa = { id: A }; const pb = { id: B }
    const base = (o: string) => `/api/organizations/${o}/discover`

    /* ── My Creators ───────────────────────────────────────────────────── */
    console.log('\nMy Creators')
    as(uA)
    let r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k1 })
    ok('add → 201', r.status === 201, `status ${r.status}`)
    r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k1 })
    ok('duplicate add → 200 created:false', r.status === 200 && r.json?.created === false, `status ${r.status}`)
    const [c1, c2] = await Promise.all([
      call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k2 }),
      call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k2 }),
    ])
    ok('two simultaneous adds → one created', [c1.status, c2.status].sort().join() === '200,201', `${c1.status}/${c2.status}`)
    let pairs = await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.agency_kol_accounts WHERE agency_id = $1 AND kol_account_id = ANY($2::uuid[])`, [A, [k1, k2]])
    ok('one link row per creator', pairs.rows[0].n === 2, `${pairs.rows[0].n} rows`)

    r = await call(directory.GET, 'GET', `${base(A)}/kol-directory?scope=mine&pageSize=50`, pa)
    const mineIds = ((r.json?.rows ?? []) as { id: string; inMyCreators: boolean }[]).map(x => x.id).sort()
    ok('list (scope=mine) = exactly the two added', JSON.stringify(mineIds) === JSON.stringify([k1, k2].sort()), `total ${r.json?.total}`)
    r = await call(directory.GET, 'GET', `${base(A)}/kol-directory?ids=${k1},${k3}`, pa)
    const flags = Object.fromEntries(((r.json?.rows ?? []) as { id: string; inMyCreators: boolean }[]).map(x => [x.id, x.inMyCreators]))
    ok('database rows carry inMyCreators', flags[k1] === true && flags[k3] === false)

    as(uB)
    r = await call(directory.GET, 'GET', `${base(B)}/kol-directory?scope=mine`, pb)
    ok('agency B sees none of agency A\'s creators', r.status === 200 && r.json?.total === 0, `total ${r.json?.total}`)
    r = await call(directory.GET, 'GET', `${base(A)}/kol-directory?scope=mine`, pa)
    ok('agency B user cannot list agency A', r.status === 401, `status ${r.status}`)
    r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k3 })
    ok('agency B user cannot add to agency A', r.status === 401, `status ${r.status}`)
    r = await call(myCreator.DELETE, 'DELETE', `${base(A)}/my-creators/${k1}`, { id: A, kolId: k1 })
    ok('agency B user cannot remove from agency A', r.status === 401, `status ${r.status}`)
    as(null)
    r = await call(myCreators.GET, 'GET', `${base(A)}/my-creators?ids=${k1}`, pa)
    ok('signed-out request → 401', r.status === 401, `status ${r.status}`)

    as(uA)
    r = await call(myCreator.DELETE, 'DELETE', `${base(A)}/my-creators/${k1}`, { id: A, kolId: k1 })
    ok('remove → 200', r.status === 200, `status ${r.status}`)
    const inactive = await rb.sql<{ is_active: boolean; status: string }>(
      `SELECT is_active, status FROM public.agency_kol_accounts WHERE agency_id = $1 AND kol_account_id = $2`, [A, k1])
    ok('remove deactivates, row kept', inactive.rows.length === 1 && inactive.rows[0].is_active === false && inactive.rows[0].status === 'inactive')
    r = await call(myCreator.DELETE, 'DELETE', `${base(A)}/my-creators/${k1}`, { id: A, kolId: k1 })
    ok('remove again → 404', r.status === 404, `status ${r.status}`)
    r = await call(directory.GET, 'GET', `${base(A)}/kol-directory?scope=mine`, pa)
    ok('inactive creator leaves the list', r.json?.total === 1, `total ${r.json?.total}`)
    r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k1 })
    ok('re-add → 201 (reactivated)', r.status === 201, `status ${r.status}`)
    pairs = await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.agency_kol_accounts WHERE agency_id = $1 AND kol_account_id = $2 AND is_active`, [A, k1])
    ok('re-add reuses the same single row', pairs.rows[0].n === 1)
    r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: '00000000-0000-4000-8000-000000000000' })
    ok('unknown creator → 404', r.status === 404, `status ${r.status}`)
    r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: 'nope' })
    ok('malformed id → 400', r.status === 400, `status ${r.status}`)

    /* ── Favorite ──────────────────────────────────────────────────────── */
    console.log('\nFavorite')
    as(uA)
    r = await call(favorites.POST, 'POST', `${base(A)}/favorites`, pa, { kolId: k1 })
    ok('favorite → 201', r.status === 201, `status ${r.status}`)
    r = await call(favorites.POST, 'POST', `${base(A)}/favorites`, pa, { kolId: k1 })
    ok('duplicate favorite → 200 created:false', r.status === 200 && r.json?.created === false)
    await call(favorites.POST, 'POST', `${base(A)}/favorites`, pa, { kolId: k2 })
    r = await call(favorites.GET, 'GET', `${base(A)}/favorites`, pa)
    ok('reload (GET) returns both', JSON.stringify(((r.json?.ids ?? []) as string[]).slice().sort()) === JSON.stringify([k1, k2].sort()))
    as(uC)
    r = await call(favorites.GET, 'GET', `${base(A)}/favorites`, pa)
    ok('another member of the same agency has their own (empty) list', r.status === 200 && (r.json?.ids as string[]).length === 0)
    r = await call(favorite.DELETE, 'DELETE', `${base(A)}/favorites/${k1}`, { id: A, kolId: k1 })
    ok('another member cannot remove it (404)', r.status === 404, `status ${r.status}`)
    as(uB)
    r = await call(favorites.GET, 'GET', `${base(A)}/favorites`, pa)
    ok('agency B user cannot read agency A favorites', r.status === 401, `status ${r.status}`)
    r = await call(favorites.POST, 'POST', `${base(A)}/favorites`, pa, { kolId: k3 })
    ok('agency B user cannot write agency A favorites', r.status === 401, `status ${r.status}`)
    r = await call(favorites.GET, 'GET', `${base(B)}/favorites`, pb)
    ok('agency B list is empty', r.status === 200 && (r.json?.ids as string[]).length === 0)
    as(null)
    r = await call(favorites.GET, 'GET', `${base(A)}/favorites`, pa)
    ok('signed-out → 401', r.status === 401)
    as(uA)
    r = await call(favorite.DELETE, 'DELETE', `${base(A)}/favorites/${k1}`, { id: A, kolId: k1 })
    ok('unfavorite → 200', r.status === 200, `status ${r.status}`)
    r = await call(favorites.GET, 'GET', `${base(A)}/favorites`, pa)
    ok('after unfavorite only k2 remains', JSON.stringify(r.json?.ids) === JSON.stringify([k2]))
    r = await call(favorites.POST, 'POST', `${base(A)}/favorites`, pa, { kolId: '00000000-0000-4000-8000-000000000000' })
    ok('unknown creator → 404', r.status === 404)
    let dup = ''
    try {
      await rb.sql(`INSERT INTO public.agency_kol_favorites (agency_id, user_id, kol_account_id) VALUES ($1, $2, $3)`, [A, uA, k2])
    } catch (e) { dup = (e as { code?: string }).code ?? '' }
    ok('DB rejects a duplicate favorite (unique)', dup === '23505', dup)

    /* ── Saved Lists ───────────────────────────────────────────────────── */
    console.log('\nSaved Lists')
    as(uA)
    r = await call(savedFilters.POST, 'POST', `${base(A)}/saved-filters`, pa,
      { name: 'Beauty Q3', filters: { platform: 'instagram', tier: '', minFollowers: 10000 } })
    ok('save → 201', r.status === 201, `status ${r.status}`)
    const listId = (r.json?.list as { id: string })?.id
    r = await call(savedFilters.POST, 'POST', `${base(A)}/saved-filters`, pa,
      { name: '  beauty q3 ', filters: { platform: 'tiktok' } })
    ok('same name (case/space) updates → 200', r.status === 200 && (r.json?.list as { id: string })?.id === listId)
    r = await call(savedFilters.GET, 'GET', `${base(A)}/saved-filters`, pa)
    const lists = (r.json?.lists ?? []) as { id: string; filters: Record<string, unknown> }[]
    ok('reload returns one list with the updated filters', lists.length === 1 && lists[0].filters.platform === 'tiktok')
    r = await call(savedFilters.POST, 'POST', `${base(A)}/saved-filters`, pa, { name: '', filters: {} })
    ok('empty name → 400', r.status === 400)
    r = await call(savedFilters.POST, 'POST', `${base(A)}/saved-filters`, pa, { name: 'x', filters: { nested: { a: 1 } } })
    ok('non-filter payload → 400', r.status === 400)
    r = await call(savedFilters.POST, 'POST', `${base(A)}/saved-filters`, pa, { name: 'x', filters: [1] })
    ok('array payload → 400', r.status === 400)
    as(uC)
    r = await call(savedFilters.GET, 'GET', `${base(A)}/saved-filters`, pa)
    ok('another member sees none of them', r.status === 200 && (r.json?.lists as unknown[]).length === 0)
    r = await call(savedFilter.DELETE, 'DELETE', `${base(A)}/saved-filters/${listId}`, { id: A, filterId: listId })
    ok('another member cannot delete it (404)', r.status === 404)
    as(uB)
    r = await call(savedFilter.DELETE, 'DELETE', `${base(B)}/saved-filters/${listId}`, { id: B, filterId: listId })
    ok('agency B cannot delete it through its own agency (404)', r.status === 404)
    r = await call(savedFilters.GET, 'GET', `${base(A)}/saved-filters`, pa)
    ok('agency B user cannot read agency A lists', r.status === 401)
    as(uA)
    r = await call(savedFilter.DELETE, 'DELETE', `${base(A)}/saved-filters/${listId}`, { id: A, filterId: listId })
    ok('delete → 200', r.status === 200)
    r = await call(savedFilters.GET, 'GET', `${base(A)}/saved-filters`, pa)
    ok('reload after delete → empty', (r.json?.lists as unknown[]).length === 0)

    /* ── constraints and the add lock ──────────────────────────────────── */
    console.log('\nConstraints')
    dup = ''
    try {
      await rb.sql(`INSERT INTO public.agency_kol_accounts (agency_id, kol_account_id, status, is_active, created_at, updated_at)
                    VALUES ($1, $2, 'active', true, now(), now())`, [A, k2])
    } catch (e) { dup = (e as { code?: string }).code ?? '' }
    ok('DB rejects a duplicate agency ↔ creator link (unique)', dup === '23505', dup)

    const lockKey = `my-creators:${A}:${k3}`
    const c = [new pg.Client(kolCfg), new pg.Client(kolCfg)]
    await Promise.all(c.map(x => x.connect()))
    try {
      await c[0].query('BEGIN'); await c[1].query('BEGIN')
      await c[0].query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
      const busy = await c[1].query<{ got: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got', [lockKey])
      ok('a second writer waits while the first holds the add lock', busy.rows[0].got === false)
      await c[0].query('ROLLBACK')
      const free = await c[1].query<{ got: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got', [lockKey])
      ok('…and gets it once the first finishes', free.rows[0].got === true)
      await c[1].query('ROLLBACK')
    } finally {
      await Promise.all(c.map(x => x.end()))
    }

    /* ── Compare metric sources ────────────────────────────────────────── */
    console.log('\nCompare metrics')
    r = await call(directory.GET, 'GET', `${base(A)}/kol-directory?ids=${k1},${k2},${k3}`, pa)
    const apiRows = (r.json?.rows ?? []) as Record<string, number | null | string>[]
    const { rows: truth } = await rb.sql<Record<string, number | null | string>>(
      `SELECT kd.id, kd.followers_count::float AS followers,
              COALESCE(fer.engagement_rate::float, kd.engagement_rate::float) AS er,
              c.avg_views::float AS avg_views, c.median_views::float AS median_views,
              c.views_analyzed_count AS views_n,
              c.view_to_follower_ratio::float AS v2f, c.like_to_view_ratio::float AS l2v,
              c.followers_growth::float AS growth, c.post_frequency_monthly::float AS ppm,
              c.audience_quality_score::float AS aq
         FROM public.kol_directory kd
         LEFT JOIN LATERAL (
           SELECT c.* FROM public.kol_social_account ksa
             JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
            WHERE ksa.kol_id = kd.id ORDER BY c.followers_count DESC NULLS LAST LIMIT 1) c ON TRUE
         LEFT JOIN LATERAL (
           SELECT fe.engagement_rate FROM public.kol_social_account ksa
             JOIN (SELECT social_account_id, engagement_rate FROM feature.ig_engagement_analysis
                   UNION ALL SELECT social_account_id, engagement_rate FROM feature.tt_engagement_analysis) fe
               ON fe.social_account_id = ksa.social_account_id
             LEFT JOIN l2_gold.kol_profile_card cc ON cc.social_account_id = ksa.social_account_id
            WHERE ksa.kol_id = kd.id AND fe.engagement_rate IS NOT NULL
            ORDER BY cc.followers_count DESC NULLS LAST LIMIT 1) fer ON TRUE
        WHERE kd.id = ANY($1::uuid[])`, [[k1, k2, k3]])
    for (const t of truth) {
      const a = apiRows.find(x => x.id === t.id)
      const pairsToCheck: [string, unknown, unknown][] = [
        ['followers', a?.followers, t.followers], ['ER', a?.erPct, t.er],
        ['avg views', a?.avgViews, t.avg_views], ['median views', a?.medianViews, t.median_views],
        ['V2F', a?.v2fPct, t.v2f], ['L2V', a?.l2vPct, t.l2v], ['growth', a?.growthPct, t.growth],
        ['posts/month', a?.postFrequencyMonthly, t.ppm], ['audience quality', a?.audienceQualityScore, t.aq],
        ['views basis', a?.viewsAnalyzedCount, t.views_n],
      ]
      const wrong = pairsToCheck.filter(([, x, y]) => !near(x as number | null, y as number | null))
      ok(`creator ${String(t.id).slice(0, 8)}: Compare fields = KOL columns`, !!a && wrong.length === 0,
        wrong.map(([k, x, y]) => `${k} api=${x} db=${y}`).join('; '))
    }

    /* ── profile, Similar, and switched-off endpoints ─────────────────── */
    console.log('\nProfile, Similar, switched-off endpoints')
    as(uA)
    r = await call(profileRoute.GET, 'GET', `${base(A)}/kol-directory/${k1}`, { id: A, kolId: k1 })
    ok('creator profile loads from KOL', r.status === 200 && (r.json?.creator as { id: string })?.id === k1, `status ${r.status}`)
    r = await call(similar.GET, 'GET', `${base(A)}/creators/similar?ref=${k1}&source=roster&limit=5`, pa)
    ok('Similar from a Creator Database reference → 200', r.status === 200, `status ${r.status}`)
    r = await call(similar.GET, 'GET', `${base(A)}/creators/similar?ref=${k1}&source=creator&limit=5`, pa)
    ok('Similar from a My Creators reference → 200', r.status === 200, `status ${r.status}`)
    r = await call(similar.GET, 'GET', `${base(A)}/creators/similar?ref=${k3}&source=creator`, pa)
    ok('a creator outside My Creators is not a My Creators reference → 404', r.status === 404, `status ${r.status}`)
    as(uB)
    r = await call(similar.GET, 'GET', `${base(A)}/creators/similar?ref=${k1}&source=roster`, pa)
    ok('Similar for another agency → 401', r.status === 401, `status ${r.status}`)
    as(uA)
    r = await call(offRates.GET, 'GET', `${base(A)}/rates`, pa)
    ok('Rate Card endpoint answers 503', r.status === 503 && r.json?.code === 'feature_unavailable', `status ${r.status}`)
    r = await call(offDashboard.GET, 'GET', `/api/organizations/${A}/dashboard/overview`, pa)
    ok('Dashboard endpoint answers 503', r.status === 503, `status ${r.status}`)
    r = await call(offBrand.GET, 'GET', `/api/brands/${k1}`, { brandId: k1 })
    ok('Brands endpoint answers 503', r.status === 503, `status ${r.status}`)
    as(null)
    r = await call(offBrand.GET, 'GET', `/api/brands/${k1}`, { brandId: k1 })
    ok('…and 401 when signed out', r.status === 401, `status ${r.status}`)

    /* ── Add KOL authorization ─────────────────────────────────────────── */
    console.log('\nAdd KOL authorization')
    as(uA)
    r = await call(addCheck.POST, 'POST', '/api/kol-directory/add/check', {}, { orgId: B, platform: 'instagram', input: 'x' })
    ok('check for an agency you are not in → 403', r.status === 403, `status ${r.status}`)
    r = await call(addCheck.POST, 'POST', '/api/kol-directory/add/check', {}, { platform: 'instagram', input: 'x' })
    ok('check without orgId → 400', r.status === 400, `status ${r.status}`)
    as(null)
    r = await call(addCheck.POST, 'POST', '/api/kol-directory/add/check', {}, { orgId: A, platform: 'instagram', input: 'x' })
    ok('check signed out → 401', r.status === 401, `status ${r.status}`)
    as(uA)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${k3}/status?orgId=${A}`, { kolId: k3 })
    ok('status of a creator not linked to your agency → 404', r.status === 404, `status ${r.status}`)
    as(uB)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${k1}/status?orgId=${A}`, { kolId: k1 })
    ok('status for another agency → 403', r.status === 403, `status ${r.status}`)

    /* ── the warehouse stayed out ──────────────────────────────────────── */
    const loaded = Object.keys(require.cache)
    const ours = loaded.filter(p => p.includes(`${path.sep}src${path.sep}`))
    ok('module cache is observable', ours.length > 10, `${ours.length} src modules loaded`)
    ok('src/lib/db.ts (warehouse pool) was never loaded',
      !loaded.some(p => /[\\/]src[\\/]lib[\\/]db\.ts$/.test(p)))
  } finally {
    await rb.finish()
  }

  // Nothing was committed: the fixtures are gone.
  const check = new pg.Client(kolCfg)
  await check.connect()
  const { rows } = await check.query(`SELECT count(*)::int n FROM public."user" WHERE email LIKE '%@kol-test.invalid'`)
  await check.end()
  ok('rolled back: no test user remains', rows[0].n === 0, `${rows[0].n} left`)

  // Static: the favorites/saved-lists UI no longer keeps them in the browser.
  const page = readFileSync('src/components/discover/KolDirectoryPage.tsx', 'utf8')
  ok('Creator Database favorites come from the API hook', page.includes('useKolFavorites(orgId'))
  ok('Saved Lists come from the API hook', page.includes('useSavedFilters<KolFilters>(orgId') && !page.includes('autometric.kolDirectory.lists.${orgId}`'))
  const profile = readFileSync('src/components/discover/KolCreatorWorkspace.tsx', 'utf8')
  ok('profile favorite comes from the API hook', profile.includes('useKolFavorites(orgId') && !profile.includes("useDiscoverSelection(orgId, 'fav')"))
}

main()
  .then(() => {
    console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
    process.exit(bad ? 1 : 0)
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
