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
 *   * no path that scrapes or calls Apify is exercised: Add KOL is checked up
 *     to its authorization answers, its identity step (`prepareKolIdentity`,
 *     which returns before any scrape) and the route answers that stop before
 *     the scrape (400 / 409); the retry route likewise only for answers that
 *     start nothing, with its accepted path checked through `prepareRetry`.
 *
 * Covers: My Creators, Favorite, Saved Lists (add, duplicate, reload, remove,
 * re-add, agency and user isolation, unauthenticated), the unique constraints,
 * the add lock, Compare's metric sources, Add KOL authorization, and D010:
 * reusing an existing roster row links it to the requesting agency, and D013:
 * retrying a failed run (run status rules, authorization, no new identity/link).
 */
import { readFileSync, readdirSync } from 'node:fs'
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
  const addPost = await import('../src/app/api/kol-directory/add/route')
  const addScrape = await import('../src/lib/kolDirectory/addKolScrape')
  const addRetry = await import('../src/app/api/kol-directory/add/[kolId]/retry/route')
  const runStatusLib = await import('../src/lib/kolDirectory/addKolRunStatus')
  const stepLogLib = await import('../src/lib/kolDirectory/stepLog')
  const addDirLib = await import('../src/lib/discover/kolDirectory')
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

    /* ── D010: Add KOL reusing an existing roster row ──────────────────── */
    // Only the identity step (`prepareKolIdentity`) is called directly: it
    // commits the links and returns before any scrape. The route is called only
    // for answers that stop before the scrape (400 / 409).
    console.log('\nD010 Add KOL reuse → agency link')
    const { rows: reuse } = await rb.sql<{ id: string; platform: 'instagram' | 'tiktok'; sa: string; pf: string }>(
      `SELECT kd.id, pl.key AS platform, ksa.social_account_id AS sa, pl.id AS pf
         FROM public.kol_directory kd
         JOIN public.platforms pl ON pl.id = kd.platform_id
         JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
        WHERE kd.directory_status = 'active' AND pl.key IN ('instagram', 'tiktok')
          AND kd.id <> ALL ($1::uuid[])
        ORDER BY kd.id LIMIT 2`, [[k1, k2, k3]])
    ok('two roster rows with a social link to test with', reuse.length === 2)
    const [kr, other] = reuse
    const input = (o: Partial<Parameters<typeof addScrape.prepareKolIdentity>[0]> = {}) => ({
      platform: kr.platform, username: `${tag}-reuse`, profileUrl: `https://example.invalid/${tag}`,
      triggeredBy: null, agencyId: B, createdByUserId: uB,
      existingKolDirectoryId: kr.id, existingSocialAccountId: kr.sa, ...o,
    })
    const linksOf = async (agencyId: string, kolId: string) => (await rb.sql<{ n: number; active: number }>(
      `SELECT count(*)::int n, count(*) FILTER (WHERE is_active)::int active
         FROM public.agency_kol_accounts WHERE agency_id = $1 AND kol_account_id = $2`, [agencyId, kolId])).rows[0]
    const identityCounts = async () => (await rb.sql<{ kd: number; sa: number; ksa: number }>(
      `SELECT (SELECT count(*) FROM public.kol_directory)::int kd,
              (SELECT count(*) FROM public.social_account)::int sa,
              (SELECT count(*) FROM public.kol_social_account)::int ksa`)).rows[0]
    const aLinkBefore = await linksOf(A, kr.id)
    const idsBefore = await identityCounts()

    as(uB)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${kr.id}/status?orgId=${B}`, { kolId: kr.id })
    ok('before: status for the reused row → 404 (no link for this agency)', r.status === 404, `status ${r.status}`)
    const got = await addScrape.prepareKolIdentity(input())
    ok('reuse returns the existing ids', got.kolDirectoryId === kr.id && got.socialAccountId === kr.sa)
    let l = await linksOf(B, kr.id)
    ok('reuse creates one active link for the agency', l.n === 1 && l.active === 1, `${l.n} rows / ${l.active} active`)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${kr.id}/status?orgId=${B}`, { kolId: kr.id })
    ok('after: status for the reused row → 200', r.status === 200, `status ${r.status}`)
    const idsAfter = await identityCounts()
    ok('reuse inserts no kol_directory / social_account / kol_social_account row',
      JSON.stringify(idsAfter) === JSON.stringify(idsBefore), JSON.stringify(idsAfter))

    await addScrape.prepareKolIdentity(input())
    l = await linksOf(B, kr.id)
    ok('reuse again → still one link', l.n === 1 && l.active === 1, `${l.n} rows`)

    await rb.sql(`UPDATE public.agency_kol_accounts SET is_active = false, status = 'inactive'
                   WHERE agency_id = $1 AND kol_account_id = $2`, [B, kr.id])
    await addScrape.prepareKolIdentity(input())
    const re = (await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.agency_kol_accounts
        WHERE agency_id = $1 AND kol_account_id = $2 AND is_active AND status = 'active'`, [B, kr.id])).rows[0]
    l = await linksOf(B, kr.id)
    ok('an inactive link is reactivated, not duplicated', re.n === 1 && l.n === 1, `${l.n} rows`)

    const rejects = async (label: string, o: Partial<Parameters<typeof addScrape.prepareKolIdentity>[0]>, agencyId: string) => {
      const before = await linksOf(agencyId, (o.existingKolDirectoryId ?? kr.id) as string)
      let err: unknown = null
      try { await addScrape.prepareKolIdentity(input({ agencyId, ...o })) } catch (e) { err = e }
      const after = await linksOf(agencyId, (o.existingKolDirectoryId ?? kr.id) as string)
      ok(label, err instanceof addScrape.IdentityMismatchError && after.n === before.n,
        `${(err as Error | null)?.name ?? 'no error'}, links ${before.n}→${after.n}`)
    }
    await rejects('social account of another creator → IdentityMismatchError, no link', { existingSocialAccountId: other.sa }, A)
    const otherPlatform = kr.platform === 'instagram' ? 'tiktok' : 'instagram'
    await rejects('platform differs from the row → IdentityMismatchError, no link', { platform: otherPlatform }, A)
    const { rows: [archived] } = await rb.sql<{ id: string; sa: string }>(
      `WITH kd AS (
         INSERT INTO public.kol_directory (platform_id, username, username_normalized, source, directory_status, created_at, updated_at)
         VALUES ($1, $2, $2, 'manual_add', 'archived', now(), now()) RETURNING id),
       sa AS (
         INSERT INTO public.social_account (platform_id, username, connected, data_source, created_at)
         VALUES ($1, $2, false, 'apify', now()) RETURNING id),
       link AS (
         INSERT INTO public.kol_social_account (kol_id, social_account_id, platform_id, created_at)
         SELECT kd.id, sa.id, $1, now() FROM kd, sa RETURNING kol_id, social_account_id)
       SELECT kol_id AS id, social_account_id AS sa FROM link`, [kr.pf, `${tag}-archived`])
    await rejects('inactive roster row → IdentityMismatchError, no link',
      { existingKolDirectoryId: archived.id, existingSocialAccountId: archived.sa }, A)
    await rejects('inactive roster row without social id → IdentityMismatchError, no link',
      { existingKolDirectoryId: archived.id, existingSocialAccountId: null }, A)
    ok('agency A link on the reused row unchanged', JSON.stringify(await linksOf(A, kr.id)) === JSON.stringify(aLinkBefore))

    as(uC)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${kr.id}/status?orgId=${A}`, { kolId: kr.id })
    ok('other agency (no link) still gets 404 for the reused row', aLinkBefore.n === 0 && r.status === 404, `links ${aLinkBefore.n}, status ${r.status}`)
    as(uB)
    const post = (body: Record<string, unknown>) => call(addPost.POST, 'POST', '/api/kol-directory/add', {}, {
      orgId: B, platform: kr.platform, username: `${tag}-reuse`, profileUrl: `https://example.invalid/${tag}`, ...body,
    })
    r = await post({ existingKolDirectoryId: 'not-a-uuid', existingSocialAccountId: kr.sa })
    ok('add with a malformed kolDirectoryId → 400', r.status === 400, `status ${r.status}`)
    r = await post({ existingKolDirectoryId: kr.id, existingSocialAccountId: 'x' })
    ok('add with a malformed socialAccountId → 400', r.status === 400, `status ${r.status}`)
    r = await post({ existingKolDirectoryId: null, existingSocialAccountId: kr.sa })
    ok('add with a socialAccountId but no kolDirectoryId → 400', r.status === 400, `status ${r.status}`)
    const logsBefore = (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.add_kol_scrape_log`)).rows[0].n
    r = await post({ existingKolDirectoryId: kr.id, existingSocialAccountId: other.sa })
    ok('add with a mismatched pair → 409', r.status === 409, `status ${r.status}`)
    const logsAfter = (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.add_kol_scrape_log`)).rows[0].n
    ok('409 starts no scrape (no scrape log row)', logsAfter === logsBefore, `${logsBefore}→${logsAfter}`)
    as(uA)
    r = await call(addPost.POST, 'POST', '/api/kol-directory/add', {}, {
      orgId: B, platform: kr.platform, username: 'x', profileUrl: 'https://example.invalid/x',
      existingKolDirectoryId: kr.id, existingSocialAccountId: kr.sa,
    })
    ok('add for an agency you are not in → 403', r.status === 403, `status ${r.status}`)

    // Regression: a brand-new handle still gets identity rows and the link.
    const fresh = await addScrape.prepareKolIdentity(input({
      username: `${tag}-new`, existingKolDirectoryId: null, existingSocialAccountId: null,
    }))
    l = await linksOf(B, fresh.kolDirectoryId)
    const freshRow = (await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.kol_directory kd
         JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id AND ksa.social_account_id = $2
        WHERE kd.id = $1 AND kd.source = 'manual_add'`, [fresh.kolDirectoryId, fresh.socialAccountId])).rows[0]
    ok('new handle → identity rows + one active link', freshRow.n === 1 && l.n === 1 && l.active === 1)

    /* ── D013: Add KOL retry ───────────────────────────────────────────── */
    // Run history is written as fixture log rows (rolled back). The retry
    // route is only called for answers that start nothing (401/400/403/404/
    // 409); the accepted path is covered through `prepareRetry`, which decides
    // everything a retry does before the scrape would start.
    console.log('\nD013 Add KOL retry')
    const subject = fresh.kolDirectoryId
    const subjectSa = fresh.socialAccountId
    const plat = kr.platform
    const stepsOf = plat === 'tiktok'
      ? { scrape: ['profile_and_posts', 'followers'] }
      : { scrape: ['profile', 'posts', 'followers'] }
    const pipelineSteps = ['sync_profile', 'sync_post', 'sync_follower', 'build_unified_profile', 'build_unified_post', 'build_unified_follower']
    // Runs are ordered by started_at; every fixture row is one second newer than
    // the last, starting two minutes ago so a 'running' row stays under the stall limit.
    let clock = Date.now() - 120_000
    const at = () => new Date((clock += 1000))
    const scrapeRow = (run: string, kolId: string, step: string, status: string, startedAt: Date, error: string | null = null) => rb.sql(
      `INSERT INTO public.add_kol_scrape_log (run_id, kol_directory_id, social_account_id, platform, username, step, actor, status, error_message, started_at)
       VALUES ($1, $2, NULL, $3, $4, $5, 'fixture', $6, $7, $8)`, [run, kolId, plat, `${tag}-new`, step, status, error, startedAt])
    const pipelineRow = (run: string, kolId: string, step: string, status: string, startedAt: Date, error: string | null = null) => rb.sql(
      `INSERT INTO public.add_kol_pipeline_log (run_id, kol_directory_id, platform, step, status, error_message, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, [run, kolId, plat, step, status, error, startedAt])
    const uuid = () => crypto.randomUUID()
    const runStatus = async (kolId: string, runId: string | null = null) => {
      const s = await runStatusLib.getAddKolRunStatus(kolId, runId)
      return typeof s === 'string' ? s : s.overallStatus
    }
    const identityAndLinks = async () => (await rb.sql<{ kd: number; sa: number; ksa: number; aka: number; aka_active: number }>(
      `SELECT (SELECT count(*) FROM public.kol_directory)::int kd,
              (SELECT count(*) FROM public.social_account)::int sa,
              (SELECT count(*) FROM public.kol_social_account)::int ksa,
              (SELECT count(*) FROM public.agency_kol_accounts)::int aka,
              (SELECT count(*) FROM public.agency_kol_accounts WHERE is_active)::int aka_active`)).rows[0]
    const retryUrl = (kolId: string) => `/api/kol-directory/add/${kolId}/retry`
    const retryAs = (kolId: string, orgId: string | undefined) =>
      call(addRetry.POST, 'POST', retryUrl(kolId), { kolId }, orgId === undefined ? {} : { orgId })
    const before13 = await identityAndLinks()

    ok('no run yet → pending', await runStatus(subject) === 'pending')
    let plan = await addScrape.prepareRetry(subject, B, uB)
    ok('no run → retry refused (not_failed)', !plan.ok && plan.reason === 'not_failed', JSON.stringify(plan))
    as(uB)
    r = await retryAs(subject, B)
    ok('retry route with no run → 409', r.status === 409 && r.json?.code === 'not_failed', `status ${r.status}`)

    const runRunning = uuid()
    await scrapeRow(runRunning, subject, stepsOf.scrape[0], 'success', at())
    await scrapeRow(runRunning, subject, stepsOf.scrape[1], 'running', at())
    ok('a step running (under 3 min) → running', await runStatus(subject) === 'running')
    r = await retryAs(subject, B)
    ok('retry while running → 409', r.status === 409 && r.json?.status === 'running', `status ${r.status} ${r.json?.status}`)

    const runStalled = uuid()
    await scrapeRow(runStalled, subject, stepsOf.scrape[0], 'running', new Date(Date.now() - 4 * 60_000))
    ok('a step running past 3 min → failed (existing stall rule)', await runStatus(subject, runStalled) === 'failed')

    const runStepFailed = uuid()
    await scrapeRow(runStepFailed, subject, stepsOf.scrape[0], 'failed', at(), 'apify said no')
    const st = await runStatusLib.getAddKolRunStatus(subject)
    ok('newest run with a failed step → failed, error shown',
      typeof st !== 'string' && st.runId === runStepFailed && st.overallStatus === 'failed'
      && st.steps[0].detail === 'apify said no')
    plan = await addScrape.prepareRetry(subject, B, uB)
    ok('failed run → retry plan uses the creator from KOL DB',
      plan.ok && plan.kolDirectoryId === subject && plan.socialAccountId === subjectSa
      && plan.input.username === `${tag}-new` && plan.input.platform === plat && plan.input.agencyId === B,
      JSON.stringify(plan.ok ? { ...plan.input } : plan))

    const runRunFailed = uuid()
    for (const s of stepsOf.scrape) await scrapeRow(runRunFailed, subject, s, 'success', at())
    await pipelineRow(runRunFailed, subject, 'run', 'failed', at(), 'profile payload carried an error')
    const rf = await runStatusLib.getAddKolRunStatus(subject)
    ok('failure outside any step (run row) → failed, first unfinished step carries the error',
      typeof rf !== 'string' && rf.overallStatus === 'failed'
      && rf.steps.find(s => s.status === 'failed')?.detail === 'profile payload carried an error'
      && rf.steps.filter(s => s.kind === 'scrape').every(s => s.status === 'success'))

    const runAllOkThenFail = uuid()
    for (const s of stepsOf.scrape) await scrapeRow(runAllOkThenFail, subject, s, 'success', at())
    for (const s of pipelineSteps) await pipelineRow(runAllOkThenFail, subject, s, 'success', at())
    await pipelineRow(runAllOkThenFail, subject, 'run', 'failed', at(), 'roster update failed')
    const rl = await runStatusLib.getAddKolRunStatus(subject)
    ok('all steps succeeded but the run failed → failed on the last step',
      typeof rl !== 'string' && rl.overallStatus === 'failed' && rl.steps[rl.steps.length - 1].detail === 'roster update failed')

    const runOk = uuid()
    for (const s of stepsOf.scrape) await scrapeRow(runOk, subject, s, 'success', at())
    for (const s of pipelineSteps) await pipelineRow(runOk, subject, s, 'success', at())
    ok('a fully successful run → success', await runStatus(subject) === 'success')
    r = await retryAs(subject, B)
    ok('retry after success → 409', r.status === 409 && r.json?.status === 'success', `status ${r.status}`)

    const pinned = uuid()
    ok('pinned run with no rows yet → pending', await runStatus(subject, pinned) === 'pending')
    ok('pinned run of another creator → foreign_run', await runStatus(kr.id, runOk) === 'foreign_run')
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${subject}/status?orgId=${B}&runId=${pinned}`, { kolId: subject })
    ok('status route with a new runId → 200 pending', r.status === 200 && r.json?.overallStatus === 'pending' && r.json?.runId === pinned, `status ${r.status}`)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${kr.id}/status?orgId=${B}&runId=${runOk}`, { kolId: kr.id })
    ok('status route with another creator\'s runId → 404', r.status === 404, `status ${r.status}`)
    r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${subject}/status?orgId=${B}&runId=nope`, { kolId: subject })
    ok('status route with a malformed runId → 400', r.status === 400, `status ${r.status}`)

    // make the newest run a failed one again for the authorization checks
    const runLatestFailed = uuid()
    await scrapeRow(runLatestFailed, subject, stepsOf.scrape[0], 'failed', at(), 'again')
    ok('retry is allowed for the owning agency (plan ok)', (await addScrape.prepareRetry(subject, B, uB)).ok)
    as(null)
    r = await retryAs(subject, B)
    ok('retry signed out → 401', r.status === 401, `status ${r.status}`)
    as(uB)
    r = await retryAs(subject, undefined)
    ok('retry without orgId → 400', r.status === 400, `status ${r.status}`)
    r = await retryAs(subject, A)
    ok('retry for an agency you are not in → 403', r.status === 403, `status ${r.status}`)
    r = await retryAs('not-a-uuid', B)
    ok('retry with a malformed kolId → 404', r.status === 404, `status ${r.status}`)
    as(uA)
    r = await retryAs(subject, A)
    ok('retry by an agency with no link → 404', r.status === 404, `status ${r.status}`)
    await rb.sql(`UPDATE public.agency_kol_accounts SET is_active = false WHERE agency_id = $1 AND kol_account_id = $2`, [B, subject])
    plan = await addScrape.prepareRetry(subject, B, uB)
    as(uB)
    r = await retryAs(subject, B)
    ok('retry with an inactive link → 404', !plan.ok && plan.reason === 'not_linked' && r.status === 404, `status ${r.status}`)
    await rb.sql(`UPDATE public.agency_kol_accounts SET is_active = true WHERE agency_id = $1 AND kol_account_id = $2`, [B, subject])

    await rb.sql(`INSERT INTO public.agency_kol_accounts (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
                  VALUES ($1, $2, $3, 'active', true, $4, now(), now())`, [B, archived.id, kr.pf, uB])
    await scrapeRow(uuid(), archived.id, stepsOf.scrape[0], 'failed', at(), 'x')
    r = await retryAs(archived.id, B)
    ok('retry for an inactive roster row → 409 invalid_identity', r.status === 409 && r.json?.code === 'invalid_identity', `status ${r.status}`)

    const logBefore = (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.add_kol_pipeline_log WHERE step = 'run'`)).rows[0].n
    await stepLogLib.logRunFailure({ runId: uuid(), kolDirectoryId: subject, platform: plat, errorMessage: 'logged' })
    const runRow = (await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.add_kol_pipeline_log
        WHERE step = 'run' AND status = 'failed' AND error_message = 'logged' AND kol_directory_id = $1`, [subject])).rows[0].n
    ok('logRunFailure writes one run/failed row', runRow === 1 && logBefore + 1 === (await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.add_kol_pipeline_log WHERE step = 'run'`)).rows[0].n)

    const after13 = await identityAndLinks()
    ok('retry checks created no kol_directory / social_account / kol_social_account row',
      after13.kd === before13.kd && after13.sa === before13.sa && after13.ksa === before13.ksa,
      JSON.stringify(after13))
    ok('retry created no agency link (only the fixture link for the archived row)',
      after13.aka === before13.aka + 1 && after13.aka_active === before13.aka_active + 1, JSON.stringify(after13))
    ok('the owning agency still has exactly one active link', JSON.stringify(await linksOf(B, subject)) === JSON.stringify({ n: 1, active: 1 }))

    /* ── D092: My Creators profiling status filter ─────────────────────── */
    // Real roster rows are linked to a fresh test agency; Add KOL run history is
    // fixture log rows. Everything is rolled back. Log timestamps are written
    // relative to the database's now(), which the status SQL also reads (inside
    // this test transaction now() is the transaction start).
    console.log('\nD092 My Creators profiling status')
    const uD = await user('d'); const D = await agency('d', uD); await member(D, uD, 'ADMIN')
    const pd = { id: D }
    /**
     * The eleven creators are BUILT here, not searched for in the roster.
     *
     * They used to be picked from real rows. That stopped working once the
     * roster was pruned to 1.980 creators that all carry an L2 card: four of
     * the five shapes this block needs — "no card + scrape_status failed",
     * "no card, scrape_status null", "no platform" — no longer exist anywhere
     * in `kol_directory`, so the picks returned 0 rows and the suite aborted
     * here. Building them changes nothing about what is asserted below; it only
     * stops the assertions depending on which creators happen to be in the
     * database today, and it makes each state exact rather than approximate.
     *
     * Every row (creator, social account, L2 card, log row, link) is written
     * inside the same rolled-back transaction as the rest of this file. Follower
     * counts are spread deliberately: the "another filter + profiling filter"
     * assertion below needs the failed set to split around its median.
     */
    const fxPrefix = `${tag}-d092`
    const igPlatform = (await rb.sql<{ id: string }>(
      `SELECT id FROM public.platforms WHERE key = 'instagram'`)).rows[0].id
    // Two real taxonomy keys, so the D087 facet assertions further down still
    // have an agency-scoped category set to compare — the picked roster rows
    // used to bring their own.
    const { rows: cats } = await rb.sql<{ id: string }>(
      `SELECT DISTINCT ON (COALESCE(taxonomy_key, name)) id, COALESCE(taxonomy_key, name) AS k
         FROM public.kol_categories ORDER BY COALESCE(taxonomy_key, name), id LIMIT 2`)
    const [cat1, cat2] = cats.map(c => c.id)
    const makeKol = async (
      role: string,
      o: { platform?: 'instagram' | null; card?: boolean; scrapeStatus?: string | null; followers: number; category?: string; username?: string },
    ) => {
      const username = o.username ?? `${fxPrefix}-${role}`
      const platformId = o.platform === null ? null : igPlatform
      const id = (await rb.sql<{ id: string }>(
        `INSERT INTO public.kol_directory
           (platform_id, username, username_normalized, followers_count, category_id,
            directory_status, scrape_status, source, created_at, updated_at)
         VALUES ($1, $2, $2, $3, $5, 'active', $4, 'manual_add', now(), now())
         RETURNING id`,
        [platformId, username, o.followers, o.scrapeStatus ?? null, o.category ?? cat1])).rows[0].id
      if (platformId) {
        const sa = (await rb.sql<{ id: string }>(
          `INSERT INTO public.social_account (platform_id, username, created_at)
           VALUES ($1, $2, now()) RETURNING id`, [platformId, username])).rows[0].id
        await rb.sql(
          `INSERT INTO public.kol_social_account (kol_id, social_account_id, platform_id, created_at)
           VALUES ($1, $2, $3, now())`, [id, sa, platformId])
        // Only where the state under test is "has an L2 card". The profiling /
        // failed / no-status fixtures deliberately get none.
        if (o.card) {
          await rb.sql(
            `INSERT INTO l2_gold.kol_profile_card
               (social_account_id, platform, username, display_name, followers_count, created_at, updated_at)
             VALUES ($1, 'instagram', $2, $2, $3, now(), now())`, [sa, username, o.followers])
        }
      }
      return { id, platform: o.platform === null ? null : 'instagram', username }
    }
    /** What the row actually looks like, read back the way PROFILING_STATUS reads it. */
    const shapeOf = async (k: { id: string }) => (await rb.sql<{ platform: string | null; scrape: string | null; card: boolean }>(
      `SELECT pl.key AS platform, kd.scrape_status AS scrape,
              EXISTS (SELECT 1 FROM public.kol_social_account ksa
                        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
                       WHERE ksa.kol_id = kd.id) AS card
         FROM public.kol_directory kd
         LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
        WHERE kd.id = $1`, [k.id])).rows[0]

    const readyPlain = await makeKol('ready-plain', { card: true, followers: 5_000 })
    const cardLatestFailed = await makeKol('card-latest-failed', { card: true, followers: 4_000 })
    const cardRunning = await makeKol('card-running', { card: true, followers: 6_000 })
    const completeRun = await makeKol('complete-run', { card: true, followers: 7_000 })
    const readyFailedScrape = await makeKol('card-scrape-failed', { card: true, scrapeStatus: 'failed', followers: 8_000 })
    const failedScrape = await makeKol('nocard-scrape-failed', { scrapeStatus: 'failed', followers: 1_000 })
    const failedScrapeRunning = await makeKol('nocard-scrape-failed-running', { scrapeStatus: 'failed', followers: 2_000 })
    const stalled = await makeKol('nocard-stalled', { followers: 3_000 })
    // The last four carry the second category, so the agency's facet has two
    // chips with different counts — what D087 asserts the ordering on.
    const profilingNoCard = await makeKol('nocard-profiling', { followers: 9_000, category: cat2 })
    const noneRow = await makeKol('nocard-none', { followers: 10_000, category: cat2 })
    const noPlatform = await makeKol('no-platform', { platform: null, followers: 11_000, category: cat2 })

    const shapes = await Promise.all([readyPlain, cardLatestFailed, cardRunning, completeRun, readyFailedScrape,
      failedScrape, failedScrapeRunning, stalled, profilingNoCard, noneRow, noPlatform].map(shapeOf))
    ok('fixture: 4 IG creators with an L2 card, scrape not failed',
      shapes.slice(0, 4).every(s => s.platform === 'instagram' && s.card && s.scrape !== 'failed'), '4/4')
    ok('fixture: card + scrape_status failed',
      shapes[4].card && shapes[4].scrape === 'failed', '1/1')
    ok('fixture: 2 IG, no card + scrape_status failed',
      shapes.slice(5, 7).every(s => s.platform === 'instagram' && !s.card && s.scrape === 'failed'), '2/2')
    ok('fixture: 3 IG, no card, scrape_status null',
      shapes.slice(7, 10).every(s => s.platform === 'instagram' && !s.card && s.scrape === null), '3/3')
    ok('fixture: no platform', shapes[10].platform === null && !shapes[10].card, '1/1')

    /* Proof that this is a fixture repair and nothing more. */
    const selfSrc = readFileSync('scripts/verify-kol-persistence.ts', 'utf8')
    ok('the D092 assertions themselves are unchanged',
      selfSrc.includes("ok('Any: every linked creator, statuses or not'")
      && selfSrc.includes("ok('Ready = card, no failing/running newest run (incl. scrape_status failed with a card, and a completed run)'")
      && selfSrc.includes("ok('Profiling = newest run started, not failed, not finished, under 3 min (with or without a card)'")
      && selfSrc.includes("ok('Failed = newest run failed (beats a card) / stalled past 3 min / scrape_status failed without a card'")
      && selfSrc.includes("ok('no status: in Any, in none of the three'")
      && selfSrc.includes("ok('library answers the same as the route'")
      && selfSrc.includes("ok('an unknown status value is ignored'"))
    ok('every fixture creator is unmistakably synthetic',
      (await rb.sql<{ n: number }>(
        `SELECT count(*)::int n FROM public.kol_directory
          WHERE id = ANY ($1::uuid[]) AND username LIKE $2 AND source = 'manual_add'`,
        [[readyPlain, cardLatestFailed, cardRunning, completeRun, readyFailedScrape, failedScrape,
          failedScrapeRunning, stalled, profilingNoCard, noneRow, noPlatform].map(k => k.id), `${fxPrefix}-%`],
      )).rows[0].n === 11, fxPrefix)
    ok('the fixture transaction is the rolled-back one',
      selfSrc.includes('await rb.start(kolCfg)') && selfSrc.includes('await rb.finish()')
      && selfSrc.includes('} finally {'))
    // Rollback proof that does not depend on reading this file: a connection
    // outside the test transaction cannot see one fixture row.
    {
      const outside = new pg.Client({ ...kolCfg, connectionTimeoutMillis: 10_000 })
      await outside.connect()
      try {
        const seen = await outside.query<{ n: string }>(
          `SELECT count(*) AS n FROM public.kol_directory WHERE username LIKE $1`, [`${fxPrefix}-%`])
        ok('the fixtures are invisible outside the transaction (nothing is committed)',
          Number(seen.rows[0].n) === 0, `${seen.rows[0].n} visible`)
      } finally { await outside.end() }
    }
    ok('the warehouse pool has not been loaded by this run',
      !Object.keys(require.cache).some(p => /[\\/]src[\\/]lib[\\/]db\.ts$/.test(p)))
    ok('no fixture writes a rate-card row',
      !/(INSERT INTO|UPDATE|DELETE FROM)[^;]*rate_card/i.test(selfSrc))
    const all92 = [readyPlain, cardLatestFailed, cardRunning, completeRun, readyFailedScrape, failedScrape,
      failedScrapeRunning, stalled, profilingNoCard, noneRow, noPlatform]
    for (const k of all92) {
      await rb.sql(`INSERT INTO public.agency_kol_accounts (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
                    SELECT $1, kd.id, kd.platform_id, 'active', true, $2, now(), now() FROM public.kol_directory kd WHERE kd.id = $3`, [D, uD, k.id])
    }
    const igSteps = runStatusLib.ADD_KOL_STEP_KEYS.instagram
    const scrapeKeys = new Set(['profile', 'posts', 'followers', 'profile_and_posts'])
    const logAt = async (kolId: string, run: string, step: string, status: string, ago: string) => {
      const table = scrapeKeys.has(step) ? 'add_kol_scrape_log' : 'add_kol_pipeline_log'
      if (table === 'add_kol_scrape_log') {
        await rb.sql(`INSERT INTO public.add_kol_scrape_log (run_id, kol_directory_id, platform, username, step, actor, status, started_at)
                      VALUES ($1, $2, 'instagram', 'fixture', $3, 'fixture', $4, now() - $5::interval)`, [run, kolId, step, status, ago])
      } else {
        await rb.sql(`INSERT INTO public.add_kol_pipeline_log (run_id, kol_directory_id, platform, step, status, started_at)
                      VALUES ($1, $2, 'instagram', $3, $4, now() - $5::interval)`, [run, kolId, step, status, ago])
      }
    }
    // L2 card, but the newest Add KOL run failed → failed (an older success does not win).
    const oldOk = uuid()
    for (const s of igSteps) await logAt(cardLatestFailed.id, oldOk, s, 'success', '2 hours')
    await logAt(cardLatestFailed.id, uuid(), 'profile', 'failed', '10 minutes')
    // L2 card + a run running for 30s → profiling.
    await logAt(cardRunning.id, uuid(), 'profile', 'running', '30 seconds')
    // L2 card + a fully successful run → ready.
    const okRun = uuid()
    for (const s of igSteps) await logAt(completeRun.id, okRun, s, 'success', '20 minutes')
    // Running for 10 minutes → past the D013 stall threshold → failed, not profiling.
    await logAt(stalled.id, uuid(), 'profile', 'running', '10 minutes')
    // No card, a run in progress with its scrape done → profiling.
    const prog = uuid()
    await logAt(profilingNoCard.id, prog, 'profile', 'success', '40 seconds')
    await logAt(profilingNoCard.id, prog, 'posts', 'running', '40 seconds')
    // scrape_status failed + no card + a newer run in progress → failed (the approved precedence).
    await logAt(failedScrapeRunning.id, uuid(), 'profile', 'running', '20 seconds')

    const READY = [readyPlain, completeRun, readyFailedScrape].map(k => k.id).sort()
    const PROFILING = [cardRunning, profilingNoCard].map(k => k.id).sort()
    const FAILED = [cardLatestFailed, failedScrape, failedScrapeRunning, stalled].map(k => k.id).sort()
    const NONE = [noneRow, noPlatform].map(k => k.id).sort()
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    const mineList = async (qs: string, orgId = D) => {
      const res = await call(directory.GET, 'GET', `${base(orgId)}/kol-directory?scope=mine&pageSize=60&${qs}`, { id: orgId })
      return { status: res.status, total: res.json?.total as number, ids: ((res.json?.rows ?? []) as { id: string }[]).map(x => x.id) }
    }

    as(uD)
    let m = await mineList('')
    ok('Any: every linked creator, statuses or not', m.status === 200 && m.total === 11 && same(m.ids, all92.map(k => k.id)), `total ${m.total}`)
    m = await mineList('profiling=ready')
    ok('Ready = card, no failing/running newest run (incl. scrape_status failed with a card, and a completed run)', same(m.ids, READY) && m.total === READY.length, `${m.total}`)
    m = await mineList('profiling=profiling')
    ok('Profiling = newest run started, not failed, not finished, under 3 min (with or without a card)', same(m.ids, PROFILING) && m.total === PROFILING.length, `${m.total}`)
    m = await mineList('profiling=failed')
    ok('Failed = newest run failed (beats a card) / stalled past 3 min / scrape_status failed without a card', same(m.ids, FAILED) && m.total === FAILED.length, `${m.total}`)
    const union = [...READY, ...PROFILING, ...FAILED]
    ok('no status: in Any, in none of the three', NONE.every(id => !union.includes(id)) && new Set(union).size === union.length)

    const lib = async (s: 'ready' | 'profiling' | 'failed') =>
      (await addDirLib.listKolDirectory({ agencyId: D, profilingStatus: s, pageSize: 60 })).rows.map(x => x.id)
    ok('library answers the same as the route', same(await lib('ready'), READY) && same(await lib('profiling'), PROFILING) && same(await lib('failed'), FAILED))

    const page = async (n: number) => {
      const res = await call(directory.GET, 'GET', `${base(D)}/kol-directory?scope=mine&profiling=failed&pageSize=2&page=${n}`, pd)
      return { total: res.json?.total as number, ids: ((res.json?.rows ?? []) as { id: string }[]).map(x => x.id) }
    }
    const p1 = await page(1); const p2 = await page(2)
    ok('pagination: total counts every match, pages split them without overlap',
      p1.total === FAILED.length && p2.total === FAILED.length && p1.ids.length === 2 && p2.ids.length === 2
      && same([...p1.ids, ...p2.ids], FAILED), `${p1.total}/${p2.total} ${p1.ids.length}+${p2.ids.length}`)

    const q = (readyPlain.username ?? '').slice(0, 6)
    m = await mineList(`profiling=ready&q=${encodeURIComponent(q)}`)
    const expectQ = all92.filter(k => READY.includes(k.id) && (k.username ?? '').toLowerCase().includes(q.toLowerCase())).map(k => k.id)
    ok('search + profiling filter narrow together', m.ids.includes(readyPlain.id) && same(m.ids, expectQ), `q=${q} ${m.total}`)
    // A follower floor that splits the failed set: the median failed creator's count.
    const { rows: fol } = await rb.sql<{ id: string; f: number | null }>(
      `SELECT id, followers_count AS f FROM public.kol_directory WHERE id = ANY ($1::uuid[]) ORDER BY followers_count NULLS FIRST`, [FAILED])
    const floor = fol[Math.floor(fol.length / 2)].f ?? 0
    m = await mineList(`profiling=failed&follMin=${floor}`)
    const expectFloor = fol.filter(x => x.f !== null && x.f >= floor).map(x => x.id)
    ok('another filter + profiling filter narrow together',
      floor > 0 && same(m.ids, expectFloor) && expectFloor.length > 0 && expectFloor.length < FAILED.length,
      `follMin ${floor}: ${m.total} of ${FAILED.length}`)
    m = await mineList('profiling=failed&sort=name&dir=asc')
    ok('sorting keeps the filtered set', same(m.ids, FAILED))

    m = await mineList('profiling=bogus')
    ok('an unknown status value is ignored', m.total === 11)
    const dbAll = await call(directory.GET, 'GET', `${base(D)}/kol-directory?pageSize=1`, pd)
    const dbFiltered = await call(directory.GET, 'GET', `${base(D)}/kol-directory?pageSize=1&profiling=failed`, pd)
    ok('Creator Database ignores the profiling param', dbAll.json?.total === dbFiltered.json?.total, `${dbAll.json?.total} / ${dbFiltered.json?.total}`)

    // D124: an empty result names the filter to release, and releasing it
    // brings the list back through the same request the page makes.
    {
      const { KOL_FILTERS_DEFAULT: DF, filtersToParams: toParams, relaxSuggestions: relax } =
        await import('../src/components/discover/KolDirectoryFilters')
      const strict = { ...DF, maxRate: 5_000_000, follMin: 1_000 }
      const qs = (x: typeof strict) => new URLSearchParams(toParams(x)).toString()
      const empty = await mineList(qs(strict))
      const hint = relax(strict, '')
      ok('D124: rate-card ceiling empties My Creators (no rate card rows)', empty.status === 200 && empty.total === 0, `total ${empty.total}`)
      ok('D124: the first hint releases the rate card', hint[0]?.id === 'maxRate' && hint.length === 2, hint.map(h => h.id).join(','))
      const first = hint[0]
      const relaxed = first && 'patch' in first ? { ...strict, ...first.patch } : strict
      const back = await mineList(qs(relaxed))
      ok('D124: releasing it brings creators back', back.total > 0, `total ${back.total}`)
    }

    // D065: a Smart Discovery recommendation is shortlisted through the same
    // favorites API the row's hook calls, keyed by the candidate's own id.
    {
      as(uA)
      const favBase = `${base(A)}/favorites`
      const favIds = async () => ((await call(favorites.GET, 'GET', favBase, pa)).json?.ids ?? []) as string[]
      const rec = await call(similar.GET, 'GET', `${base(A)}/creators/similar?ref=${k1}&source=roster&limit=6`, pa)
      const cands = ((rec.json?.candidates ?? []) as { id: string }[]).map(x => x.id)
      const cand = cands.find(id => id !== k1)
      ok('D065: Smart Discovery returns a candidate to shortlist', rec.status === 200 && !!cand, `${cands.length} candidates`)
      if (cand) {
        const listed = await call(directory.GET, 'GET', `${base(A)}/kol-directory?ids=${cand}`, pa)
        ok('D065: the candidate id is a Creator Database row', ((listed.json?.rows ?? []) as { id: string }[])[0]?.id === cand)
        const before = (await favIds()).includes(cand)
        if (before) await call(favorite.DELETE, 'DELETE', `${favBase}/${cand}`, { id: A, kolId: cand })
        r = await call(favorites.POST, 'POST', favBase, pa, { kolId: cand })
        ok('D065: Shortlist adds the candidate to favorites', r.status === 201 && (await favIds()).includes(cand), `status ${r.status}`)
        r = await call(favorite.DELETE, 'DELETE', `${favBase}/${cand}`, { id: A, kolId: cand })
        ok('D065: Shortlist again removes it', r.status === 200 && !(await favIds()).includes(cand), `status ${r.status}`)
        as(uB)
        r = await call(favorites.POST, 'POST', favBase, pa, { kolId: cand })
        ok('D065: another agency cannot shortlist into this one → 401', r.status === 401, `status ${r.status}`)
        as(uA)
      }
    }

    // D087: My Creators category chips come from the agency's active links
    // only; the Creator Database keeps the global facets.
    {
      type Facet = { name: string; count: number }
      type Facets = { categories: Facet[]; platforms: unknown; tiers: unknown; rosterTotal: number; agencies: unknown }
      const expectedFor = async (agencyId: string) => (await rb.sql<Facet>(
        `SELECT COALESCE(kc.taxonomy_key, kc.name) AS name, count(DISTINCT kd.id)::int AS count
           FROM public.agency_kol_accounts a
           JOIN public.kol_directory kd ON kd.id = a.kol_account_id AND kd.directory_status = 'active'
           JOIN public.kol_categories kc ON kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))
          WHERE a.agency_id = $1 AND a.is_active IS TRUE
          GROUP BY 1`, [agencyId])).rows
      const key = (fs: Facet[]) => JSON.stringify([...fs].sort((x, y) => x.name.localeCompare(y.name)))
      const ordered = (fs: Facet[]) => fs.every((x, i) => i === 0 || fs[i - 1].count >= x.count)
      const unique = (fs: Facet[]) => new Set(fs.map(x => x.name)).size === fs.length
      const facetsOf = async (orgId: string, scope: 'mine' | 'database') => {
        const res = await call(directory.GET, 'GET',
          `${base(orgId)}/kol-directory?facets=1&pageSize=1${scope === 'mine' ? '&scope=mine' : ''}`, { id: orgId })
        return { status: res.status, facets: res.json?.facets as Facets | undefined }
      }

      const global = await addDirLib.listKolFacets()
      as(uD)
      const dbD = await facetsOf(D, 'database')
      ok('D087: Creator Database keeps the global category facet',
        dbD.status === 200 && key(dbD.facets!.categories) === key(global.categories) && dbD.facets!.categories.length > 4,
        `${dbD.facets?.categories.length} categories`)

      const mineD = await facetsOf(D, 'mine')
      const expD = await expectedFor(D)
      ok('D087: My Creators categories = the agency\'s active creators only',
        mineD.status === 200 && key(mineD.facets!.categories) === key(expD) && expD.length > 0
        && mineD.facets!.categories.length < global.categories.length,
        `${mineD.facets?.categories.length} of ${global.categories.length}`)
      ok('D087: sorted by count, no duplicate chip', ordered(mineD.facets!.categories) && unique(mineD.facets!.categories))
      ok('D087: only the category facet is scoped (platform, tier, roster total unchanged)',
        JSON.stringify(mineD.facets!.platforms) === JSON.stringify(dbD.facets!.platforms)
        && JSON.stringify(mineD.facets!.tiers) === JSON.stringify(dbD.facets!.tiers)
        && mineD.facets!.rosterTotal === dbD.facets!.rosterTotal)

      as(uA)
      const mineA = await facetsOf(A, 'mine')
      const expA = await expectedFor(A)
      ok('D087: agency A sees its own categories, not agency D\'s',
        key(mineA.facets!.categories) === key(expA) && key(expA) !== key(expD), `A ${expA.length} · D ${expD.length}`)

      // Category filter on My Creators agrees with the chip.
      as(uD)
      const pickCat = mineD.facets!.categories[0]
      const catList = await mineList(`category=${encodeURIComponent(pickCat.name)}`)
      const catOneRes = await call(directory.GET, 'GET',
        `${base(D)}/kol-directory?scope=mine&pageSize=1&category=${encodeURIComponent(pickCat.name)}`, pd)
      const catOne = { total: catOneRes.json?.total as number, n: ((catOneRes.json?.rows ?? []) as unknown[]).length }
      const dLinks = new Set((await rb.sql<{ id: string }>(
        `SELECT kol_account_id::text AS id FROM public.agency_kol_accounts WHERE agency_id = $1 AND is_active IS TRUE`, [D])).rows.map(x => x.id))
      ok('D087: choosing a category lists exactly its count of My Creators',
        catList.total === pickCat.count && catList.ids.every(id => dLinks.has(id)), `${pickCat.name}: ${catList.total}/${pickCat.count}`)
      ok('D087: paging does not change the total', catOne.total === catList.total && catOne.n === Math.min(1, catList.total),
        `${catOne.total} (page of ${catOne.n})`)

      // Empty and inactive memberships.
      const uE = await user('e'); const E = await agency('e', uE); await member(E, uE, 'ADMIN')
      as(uE)
      let mineE = await facetsOf(E, 'mine')
      ok('D087: an agency with no My Creators has no category chips', mineE.status === 200 && mineE.facets!.categories.length === 0)
      const withCat = (await rb.sql<{ id: string }>(
        `SELECT kd.id FROM public.kol_directory kd
          WHERE kd.directory_status = 'active' AND kd.category_id IS NOT NULL ORDER BY kd.id LIMIT 1`)).rows[0]
      await rb.sql(`INSERT INTO public.agency_kol_accounts (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
                    SELECT $1, kd.id, kd.platform_id, 'inactive', false, $2, now(), now() FROM public.kol_directory kd WHERE kd.id = $3`,
        [E, uE, withCat.id])
      mineE = await facetsOf(E, 'mine')
      ok('D087: an inactive link adds no category chip', mineE.facets!.categories.length === 0)
      const listE = await mineList('', E)
      ok('D087: …and no creator in the list', listE.status === 200 && listE.total === 0 && listE.ids.length === 0, `total ${listE.total}`)
    }

    // D008: checking a handle already in the directory answers with that
    // kol_directory row — before any Apify call (APIFY_API_TOKEN is unset
    // here, so reaching it would answer "unverified") — writes nothing, and
    // the id opens that creator's profile.
    {
      const { rows: [dup] } = await rb.sql<{ id: string; platform: 'instagram' | 'tiktok'; username: string }>(
        `SELECT kd.id, pl.key AS platform, kd.username_normalized AS username
           FROM public.kol_directory kd
           JOIN public.platforms pl ON pl.id = kd.platform_id
           JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
          WHERE kd.directory_status = 'active'
            AND kd.username_normalized ~ '^[a-z0-9._]{2,24}$'
            AND ((pl.key = 'instagram' AND EXISTS (SELECT 1 FROM l0_raw.ig_followers_apify f WHERE f.social_account_id = ksa.social_account_id))
              OR (pl.key = 'tiktok' AND EXISTS (SELECT 1 FROM l0_raw.tt_followers_apify f WHERE f.social_account_id = ksa.social_account_id)))
          ORDER BY kd.id LIMIT 1`)
      ok('D008: a creator already scraped through to followers exists to check', !!dup)
      if (dup) {
        const before = await identityAndLinks()
        const logs = async () => (await rb.sql<{ n: number }>(
          `SELECT (SELECT count(*) FROM public.add_kol_scrape_log) + (SELECT count(*) FROM public.add_kol_pipeline_log) AS n`)).rows[0].n
        const logsBefore = await logs()
        as(uA)
        const chk = await call(addCheck.POST, 'POST', '/api/kol-directory/add/check', {},
          { orgId: A, platform: dup.platform, input: `@${dup.username}` })
        const kol = (chk.json?.kol ?? {}) as { id?: string }
        ok('D008: the check reports the existing creator', chk.status === 200 && chk.json?.state === 'already_in_directory',
          `status ${chk.status} ${String(chk.json?.state)}`)
        ok('D008: result.kol.id is that kol_directory row', kol.id === dup.id)
        const prof = await call(profileRoute.GET, 'GET', `${base(A)}/kol-directory/${kol.id}`, { id: A, kolId: String(kol.id) })
        ok('D008: that id opens the creator profile', prof.status === 200 && (prof.json?.creator as { id?: string })?.id === dup.id,
          `status ${prof.status}`)
        const after = await identityAndLinks()
        ok('D008: the duplicate check created no kol_directory / social_account / kol_social_account / link',
          JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after))
        ok('D008: …and started no run', (await logs()) === logsBefore)
      }
    }

    // D085: My Creators search matches the creator's profile-card name as well
    // as the handle. The Creator Database (and every other caller of this
    // endpoint) stays username-only, and neither ever reads the agency label.
    {
      // A word that appears in at least two creators' card names and in no
      // handle anywhere: searching it answers nothing today, so whatever the
      // name search returns is the name match and nothing else.
      const { rows: [term] } = await rb.sql<{ term: string; n: number }>(
        `WITH names AS (
           SELECT DISTINCT kd.id, lower(substring(c.display_name from '[A-Za-z]{6,}')) AS term
             FROM public.kol_directory kd
             JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
             JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
            WHERE kd.directory_status = 'active' AND c.display_name IS NOT NULL
         )
         SELECT term, count(DISTINCT id)::int AS n
           FROM names
          WHERE term IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.kol_directory k
                             WHERE k.directory_status = 'active' AND k.username ILIKE '%' || term || '%')
          GROUP BY 1 HAVING count(DISTINCT id) >= 2
          ORDER BY 2, 1 LIMIT 1`)
      ok('D085: fixture: a card name shared by 2+ creators and held by no handle', !!term, term ? `${term.n} creators` : '')
      if (term) {
        const matchers = (await rb.sql<{ id: string; username: string }>(
          `SELECT DISTINCT kd.id, kd.username
             FROM public.kol_directory kd
             JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
             JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
            WHERE kd.directory_status = 'active' AND c.display_name ILIKE '%' || $1 || '%'
            ORDER BY kd.id`, [term.term])).rows
        // Built, not picked, for the same reason the D092 fixtures are: every
        // creator left in the roster carries an L2 card. The handle is letters
        // and digits only, the shape this search case needs.
        const noCard = await makeKol('d085-nocard', {
          followers: 12_000, username: `e2efixture${tag.replace(/\D/g, '')}nocard`,
        })
        ok('fixture: D085: a creator with no L2 card',
          (await shapeOf(noCard)).card === false, noCard.username)
        const uF = await user('f'); const F = await agency('f', uF); await member(F, uF, 'ADMIN')
        const link = (agencyId: string, owner: string, kolId: string, active: boolean) => rb.sql(
          `INSERT INTO public.agency_kol_accounts (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
           SELECT $1, kd.id, kd.platform_id, $4, $5, $2, now(), now() FROM public.kol_directory kd WHERE kd.id = $3`,
          [agencyId, owner, kolId, active ? 'active' : 'inactive', active])
        // Linked: the first name matcher and a creator with no card at all.
        // Not linked: the second matcher, which must never appear.
        await link(F, uF, matchers[0].id, true)
        await link(F, uF, noCard.id, true)
        if (matchers[2]) await link(F, uF, matchers[2].id, false)

        const before = await identityAndLinks()
        as(uF)
        const byName = await mineList(`q=${encodeURIComponent(term.term)}`, F)
        ok('D085: My Creators finds the creator by card name',
          byName.status === 200 && byName.ids.includes(matchers[0].id), `total ${byName.total}`)
        ok('D085: …and returns only this agency\'s active creators',
          byName.total === 1 && byName.ids.length === 1,
          `${byName.total}, of ${matchers.length} creators with that name`)
        ok('D085: a creator with the same name outside My Creators does not leak',
          !byName.ids.includes(matchers[1].id))
        if (matchers[2]) ok('D085: an inactive link does not match the name either', !byName.ids.includes(matchers[2].id))
        // The same creator, linked but not active: still not a My Creator.
        ok('D085: searching wrote nothing before this fixture link',
          JSON.stringify(await identityAndLinks()) === JSON.stringify(before))
        await link(F, uF, matchers[1].id, false)
        const linked = await identityAndLinks()
        const withInactive = await mineList(`q=${encodeURIComponent(term.term)}`, F)
        ok('D085: deactivating is enough to drop a name match',
          withInactive.total === 1 && !withInactive.ids.includes(matchers[1].id), `total ${withInactive.total}`)

        const byHandle = await mineList(`q=${encodeURIComponent(matchers[0].username)}`, F)
        ok('D085: username search still finds the same creator',
          byHandle.status === 200 && byHandle.ids.includes(matchers[0].id), `total ${byHandle.total}`)
        const cardless = await mineList(`q=${encodeURIComponent(noCard.username ?? '')}`, F)
        ok('D085: a creator with no profile card is still found by username',
          cardless.status === 200 && cardless.ids.includes(noCard.id), `total ${cardless.total}`)
        ok('D085: …and the name search neither errors nor returns it',
          byName.status === 200 && !byName.ids.includes(noCard.id))

        // Paging and sorting are untouched: the same query, one row at a time.
        const paged = await call(directory.GET, 'GET',
          `${base(F)}/kol-directory?scope=mine&pageSize=1&q=${encodeURIComponent(term.term)}`, { id: F })
        ok('D085: paging over a name search keeps the total',
          paged.status === 200 && paged.json?.total === byName.total
          && ((paged.json?.rows ?? []) as unknown[]).length === Math.min(1, byName.total))

        // The Creator Database is username-only, so the name matches nothing.
        const dbRes = await call(directory.GET, 'GET',
          `${base(F)}/kol-directory?pageSize=60&q=${encodeURIComponent(term.term)}`, { id: F })
        ok('D085: the Creator Database stays username-only',
          dbRes.status === 200 && dbRes.json?.total === 0, `total ${String(dbRes.json?.total)}`)
        // Smart Discovery and the hub search call the same endpoint without
        // `scope`, which is the request just made.
        const smart = await addDirLib.listKolDirectory({ q: term.term, pageSize: 12 })
        ok('D085: Smart Discovery\'s search semantics are unchanged', smart.total === 0, `total ${smart.total}`)
        const scoped = await addDirLib.listKolDirectory({ q: term.term, agencyId: F, pageSize: 12 })
        ok('D085: the name arm is off unless the caller asks for it',
          scoped.total === 0 && (await addDirLib.listKolDirectory(
            { q: term.term, agencyId: F, searchDisplayName: true, pageSize: 12 })).total === 1)

        // D087 and D092 still answer for this agency while a search is on.
        const facetRes = await call(directory.GET, 'GET',
          `${base(F)}/kol-directory?scope=mine&pageSize=1&facets=1`, { id: F })
        const fFacets = facetRes.json?.facets as { categories: { name: string; count: number }[] } | undefined
        const expF = (await rb.sql<{ n: number }>(
          `SELECT count(DISTINCT kd.id)::int AS n
             FROM public.agency_kol_accounts a
             JOIN public.kol_directory kd ON kd.id = a.kol_account_id AND kd.directory_status = 'active'
             JOIN public.kol_categories kc ON kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))
            WHERE a.agency_id = $1 AND a.is_active IS TRUE`, [F])).rows[0].n
        ok('D087 still holds: My Creators category chips stay agency-scoped',
          facetRes.status === 200 && (fFacets?.categories.reduce((s, c) => Math.max(s, c.count), 0) ?? 0) <= expF)
        const profiled = await mineList(`q=${encodeURIComponent(term.term)}&profiling=ready`, F)
        const profiledAll = await mineList('profiling=ready', F)
        ok('D092 still holds: profiling filters the search result, not around it',
          profiled.status === 200 && profiled.ids.every(id => profiledAll.ids.includes(id))
          && profiled.ids.every(id => byName.ids.includes(id)))

        ok('D085: searching created no creator, account or link',
          JSON.stringify(await identityAndLinks()) === JSON.stringify(linked)
          && linked.aka === before.aka + 1 && linked.aka_active === before.aka_active
          && linked.kd === before.kd && linked.sa === before.sa && linked.ksa === before.ksa,
          JSON.stringify(linked))
        as(uA)
      }
    }

    // D012: a run whose every step succeeded answers `success`, which is what
    // puts the modal on its success screen. Fixture log rows only — nothing is
    // scraped, and the whole block is rolled back with the rest.
    {
      // Built rather than picked, like the D092 fixtures above: this needs a
      // creator with a card and no run history of its own, and building it
      // keeps the block independent of what the roster happens to hold.
      const subject = await makeKol('d012-subject', { card: true, followers: 13_000 })
      ok('fixture: D012: a creator with no run history',
        (await shapeOf(subject)).card === true
        && (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.add_kol_scrape_log WHERE kol_directory_id = $1`,
          [subject.id])).rows[0].n === 0, subject.username)
      const uG = await user('g'); const G = await agency('g', uG); await member(G, uG, 'ADMIN')
      await rb.sql(`INSERT INTO public.agency_kol_accounts (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
                    SELECT $1, kd.id, kd.platform_id, 'active', true, $2, now(), now() FROM public.kol_directory kd WHERE kd.id = $3`,
        [G, uG, subject.id])
      const run = uuid()
      for (const s of runStatusLib.ADD_KOL_STEP_KEYS.instagram) await logAt(subject.id, run, s, 'success', '5 minutes')
      as(uG)
      const res = await call(addStatus.GET, 'GET',
        `/api/kol-directory/add/${subject.id}/status?orgId=${G}&runId=${run}`, { kolId: subject.id })
      const steps = (res.json?.steps ?? []) as { status: string; label: string }[]
      ok('D012: a run with every step successful answers overallStatus success',
        res.status === 200 && res.json?.overallStatus === 'success', `status ${res.status} ${String(res.json?.overallStatus)}`)
      ok('D012: …with the finished steps the success screen summarises',
        steps.length > 0 && steps.every(s => s.status === 'success') && steps.every(s => !!s.label),
        `${steps.length} steps`)
      ok('D012: the creator carries the username the screen names',
        (res.json?.kolDirectory as { username?: string } | undefined)?.username === subject.username)
      as(uA)
    }

    // D067: Compare reads the creator's authenticity from the profile card,
    // which carries what feature.{ig,tt}_audience_analysis measured. Nothing is
    // modelled, and a creator nobody analysed stays null — never 0.
    {
      const FEATURE = `(SELECT a.social_account_id, a.authenticity_score, 'instagram' AS platform FROM feature.ig_audience_analysis a
                        UNION ALL
                        SELECT a.social_account_id, a.authenticity_score, 'tiktok' FROM feature.tt_audience_analysis a)`
      const { rows: [drift] } = await rb.sql<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM l2_gold.kol_profile_card c
           JOIN ${FEATURE} f ON f.social_account_id = c.social_account_id AND f.platform = c.platform
          WHERE c.authenticity_score IS DISTINCT FROM f.authenticity_score`)
      ok('D067: the card repeats the feature score exactly (no second definition)', drift.n === 0, `${drift.n} rows differ`)

      const { rows: [scored] } = await rb.sql<{ id: string; score: number; platform: string }>(
        `SELECT kd.id, f.authenticity_score::float AS score, f.platform
           FROM public.kol_directory kd
           JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
           JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
           JOIN ${FEATURE} f ON f.social_account_id = c.social_account_id AND f.platform = c.platform
          WHERE kd.directory_status = 'active' AND c.authenticity_score IS NOT NULL
          ORDER BY kd.id LIMIT 1`)
      const { rows: [unscored] } = await rb.sql<{ id: string }>(
        `SELECT kd.id
           FROM public.kol_directory kd
          WHERE kd.directory_status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM public.kol_social_account ksa
                JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
               WHERE ksa.kol_id = kd.id AND c.authenticity_score IS NOT NULL)
          ORDER BY kd.id LIMIT 1`)
      ok('D067: fixture: one creator with a measured authenticity and one without', !!scored && !!unscored,
        scored ? `${scored.platform} ${scored.score}` : '')
      if (scored && unscored) {
        const before = await identityAndLinks()
        as(uA)
        // The request Compare makes: the selected ids, in one call.
        const res = await call(directory.GET, 'GET', `${base(A)}/kol-directory?ids=${scored.id},${unscored.id}`, pa)
        const rows = (res.json?.rows ?? []) as { id: string; authenticityScore: number | null; audienceQualityScore: number | null }[]
        const hit = rows.find(x => x.id === scored.id)
        const miss = rows.find(x => x.id === unscored.id)
        ok('D067: Compare\'s request carries both creators', res.status === 200 && !!hit && !!miss, `${rows.length} rows`)
        ok('D067: the creator\'s authenticity is the feature score, unchanged',
          hit?.authenticityScore === scored.score, `${String(hit?.authenticityScore)} vs ${scored.score}`)
        ok('D067: a creator with no measurement is null, not 0',
          miss?.authenticityScore === null, String(miss?.authenticityScore))
        ok('D067: the existing audience-quality metric is untouched',
          hit?.audienceQualityScore !== undefined && miss?.audienceQualityScore === null)
        ok('D067: reading authenticity wrote nothing',
          JSON.stringify(await identityAndLinks()) === JSON.stringify(before))
      }
    }

    // D078: the Format chips send the `format` param that already existed, and
    // it answers with exactly the creators whose profile card names that format.
    {
      // Expected counts come from the database, not from the audit's numbers:
      // the roster moves, and a test that hardcodes 21 would be testing 2026.
      const expected = await rb.sql<{ format: string; n: number }>(
        `SELECT g.format_dominant AS format, count(*)::int AS n
           FROM public.kol_directory kd
           LEFT JOIN LATERAL (
             SELECT c.format_dominant
               FROM public.kol_social_account ksa
               JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
              WHERE ksa.kol_id = kd.id
              ORDER BY c.followers_count DESC NULLS LAST LIMIT 1) g ON TRUE
          WHERE kd.directory_status = 'active' AND g.format_dominant IS NOT NULL
          GROUP BY 1 ORDER BY 1`)
      ok('D078: the roster names exactly the three chip formats',
        JSON.stringify(expected.rows.map(r => r.format)) === JSON.stringify(['Carousel', 'Image', 'Video']),
        expected.rows.map(r => `${r.format} ${r.n}`).join(' · '))
      as(uA)
      const listFormat = async (format: string) => {
        const res = await call(directory.GET, 'GET',
          `${base(A)}/kol-directory?pageSize=60${format ? `&format=${encodeURIComponent(format)}` : ''}`, pa)
        return { status: res.status, total: res.json?.total as number, ids: ((res.json?.rows ?? []) as { id: string }[]).map(x => x.id) }
      }
      const unfiltered = await listFormat('')
      for (const row of expected.rows) {
        const got = await listFormat(row.format)
        ok(`D078: format=${row.format} lists exactly those creators`,
          got.status === 200 && got.total === row.n, `${got.total} of ${row.n}`)
      }
      const measured = expected.rows.reduce((s, r) => s + r.n, 0)
      ok('D078: a creator with no measured format is not in any format result',
        measured < unfiltered.total, `${measured} measured of ${unfiltered.total} active`)
      const cleared = await listFormat('')
      ok('D078: clearing the chip brings the whole roster back',
        cleared.total === unfiltered.total && cleared.total > measured, `${cleared.total}`)
      const unknown = await listFormat('Reels')
      ok('D078: a format the roster does not record matches nobody', unknown.total === 0, `${unknown.total}`)
    }

    as(uA)
    m = await mineList('profiling=failed', A)
    ok('scope stays the agency: agency A sees none of agency D\'s creators', m.status === 200 && !m.ids.some(id => all92.some(k => k.id === id)), `A total ${m.total}`)
    m = await mineList('profiling=failed', D)
    ok('agency A cannot list agency D → 401', m.status === 401, `status ${m.status}`)

    // Performance on the largest real My Creators (read-only SELECTs).
    const { rows: [big] } = await rb.sql<{ agency_id: string; n: number }>(
      `SELECT agency_id, count(*)::int n FROM public.agency_kol_accounts WHERE is_active GROUP BY 1 ORDER BY 2 DESC LIMIT 1`)
    const timed = async (s: 'ready' | 'profiling' | 'failed' | null) => {
      const t = Date.now()
      const res = await addDirLib.listKolDirectory({ agencyId: big.agency_id, profilingStatus: s, pageSize: 12 })
      return { ms: Date.now() - t, total: res.total }
    }
    const tNone = await timed(null)
    const tReady = await timed('ready'); const tProf = await timed('profiling'); const tFail = await timed('failed')
    console.log(`  info  largest My Creators (${big.n} links): any ${tNone.total} in ${tNone.ms}ms · ready ${tReady.total} in ${tReady.ms}ms · profiling ${tProf.total} in ${tProf.ms}ms · failed ${tFail.total} in ${tFail.ms}ms`)
    ok('statuses never overlap on real data', tReady.total + tProf.total + tFail.total <= tNone.total)

    // EXPLAIN ANALYZE of the real statement, with and without the filter.
    const proto = pg.Pool.prototype as unknown as { query: (a: unknown, b?: unknown) => unknown }
    const orig = proto.query
    let captured: { text: string; values: unknown[] } | null = null
    proto.query = function (a: unknown, b?: unknown) {
      const text = typeof a === 'string' ? a : (a as { text: string }).text
      const values = (typeof a === 'string' ? b : (a as { values?: unknown[] }).values) as unknown[]
      if (text.includes('WITH base AS') && text.includes('filtered AS')) captured = { text, values }
      return orig.call(this, a, b)
    }
    const explain = async (s: 'failed' | null) => {
      captured = null
      await addDirLib.listKolDirectory({ agencyId: big.agency_id, profilingStatus: s, pageSize: 12 })
      const c = captured as { text: string; values: unknown[] } | null
      if (!c) return null
      const { rows } = await rb.sql<{ 'QUERY PLAN': unknown }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${c.text}`, c.values)
      const plan = (rows[0]['QUERY PLAN'] as { 'Execution Time': number }[])[0]
      return { ms: plan['Execution Time'], touchesLogs: JSON.stringify(plan).includes('add_kol_scrape_log') }
    }
    const eNone = await explain(null)
    const eFail = await explain('failed')
    proto.query = orig
    console.log(`  info  EXPLAIN ANALYZE execution: no filter ${eNone?.ms.toFixed(1)}ms · profiling=failed ${eFail?.ms.toFixed(1)}ms`)
    ok('without the filter the plan never reads the Add KOL logs', eNone !== null && !eNone.touchesLogs)
    ok('with the filter the plan reads them', eFail !== null && eFail.touchesLogs)

    /* ── D015 / D051: My Creators monitoring ───────────────────────────── */
    // agency_kol_accounts.monitoring_enabled (migrations/kol/006). All writes
    // below are inside the rolled-back transaction.
    console.log('\nD015/D051 My Creators monitoring')
    const monOf = async (agencyId: string, kolId: string) => (await rb.sql<{ n: number; on: boolean | null; active: boolean | null; upd: string | null }>(
      `SELECT count(*)::int n, bool_or(monitoring_enabled) AS on, bool_or(is_active) AS active, max(updated_at)::text AS upd
         FROM public.agency_kol_accounts WHERE agency_id = $1 AND kol_account_id = $2`, [agencyId, kolId])).rows[0]
    const patch = (orgId: string, kolId: string, body: unknown) =>
      call(myCreator.PATCH, 'PATCH', `${base(orgId)}/my-creators/${kolId}`, { id: orgId, kolId }, body)
    const before51 = await identityAndLinks()

    const { rows: [prodLink] } = await rb.sql<{ on: boolean; n: number }>(
      `SELECT bool_and(monitoring_enabled) AS on, count(*)::int n FROM public.agency_kol_accounts
        WHERE agency_id NOT IN ($1, $2, $3)`, [A, B, D])
    ok('D015: every existing link reads Monitored (column default)', prodLink.on === true, `${prodLink.n} links`)
    ok('D015: a link added through My Creators starts Monitored', (await monOf(A, k1)).on === true)
    ok('D015: a link made by Add KOL (new handle) starts Monitored', (await monOf(B, fresh.kolDirectoryId)).on === true)
    ok('D015: a link made by Add KOL (reused roster row) starts Monitored', (await monOf(B, kr.id)).on === true)

    as(uA)
    r = await patch(A, k1, { monitoringEnabled: false })
    let row51 = await monOf(A, k1)
    ok('toggle true → false', r.status === 200 && r.json?.monitoringEnabled === false && row51.on === false, `status ${r.status}`)
    const updOff = row51.upd
    r = await patch(A, k1, { monitoringEnabled: false })
    row51 = await monOf(A, k1)
    ok('repeat false → false (idempotent, updated_at untouched)', r.status === 200 && r.json?.monitoringEnabled === false && row51.on === false && row51.upd === updOff)
    let lst = await call(directory.GET, 'GET', `${base(A)}/kol-directory?scope=mine&pageSize=60`, pa)
    let card = ((lst.json?.rows ?? []) as { id: string; monitoringEnabled?: boolean | null }[]).find(x => x.id === k1)
    ok('read API returns the persisted Paused', card?.monitoringEnabled === false, JSON.stringify(card?.monitoringEnabled))
    r = await patch(A, k1, { monitoringEnabled: true })
    ok('toggle false → true', r.status === 200 && r.json?.monitoringEnabled === true && (await monOf(A, k1)).on === true)
    r = await patch(A, k1, { monitoringEnabled: true })
    ok('repeat true → true', r.status === 200 && r.json?.monitoringEnabled === true && (await monOf(A, k1)).on === true)
    lst = await call(directory.GET, 'GET', `${base(A)}/kol-directory?scope=mine&pageSize=60`, pa)
    card = ((lst.json?.rows ?? []) as { id: string; monitoringEnabled?: boolean | null }[]).find(x => x.id === k1)
    ok('read API returns the persisted Monitored', card?.monitoringEnabled === true)
    const dbRows = await call(directory.GET, 'GET', `${base(A)}/kol-directory?ids=${k1}`, pa)
    ok('Creator Database rows carry no monitoring value', ((dbRows.json?.rows ?? []) as Record<string, unknown>[]).every(x => !('monitoringEnabled' in x)))

    // Agency isolation: the same creator, two agencies, two states.
    as(uB)
    r = await call(myCreators.POST, 'POST', `${base(B)}/my-creators`, pb, { kolId: k1 })
    ok('agency B adds the same creator', r.status === 201, `status ${r.status}`)
    r = await patch(B, k1, { monitoringEnabled: false })
    ok('agency B pauses it', r.status === 200 && (await monOf(B, k1)).on === false)
    ok('agency A keeps its own Monitored', (await monOf(A, k1)).on === true)
    as(uA)
    await patch(A, k1, { monitoringEnabled: false }); await patch(A, k1, { monitoringEnabled: true })
    ok('changing A leaves B untouched', (await monOf(B, k1)).on === false)

    // Ownership / auth.
    as(null)
    r = await patch(A, k1, { monitoringEnabled: false })
    ok('signed out → 401, nothing changed', r.status === 401 && (await monOf(A, k1)).on === true, `status ${r.status}`)
    as(uB)
    r = await patch(A, k1, { monitoringEnabled: false })
    ok('another agency\'s org → 401, nothing changed', r.status === 401 && (await monOf(A, k1)).on === true, `status ${r.status}`)
    as(uA)
    r = await patch(A, k3, { monitoringEnabled: false })
    ok('creator not in My Creators → 404, no row created', r.status === 404 && (await monOf(A, k3)).n === 0, `status ${r.status}`)
    r = await patch(A, 'not-a-uuid', { monitoringEnabled: false })
    ok('malformed kolId → 404', r.status === 404, `status ${r.status}`)
    r = await patch(A, k1, { monitoringEnabled: 'false' })
    ok('non-boolean body → 400', r.status === 400, `status ${r.status}`)
    r = await patch(A, k1, {})
    ok('missing value → 400', r.status === 400, `status ${r.status}`)
    as(uB)
    r = await patch(B, archived.id, { monitoringEnabled: false })
    ok('active link to an inactive creator → 404', r.status === 404 && (await monOf(B, archived.id)).on === true, `status ${r.status}`)

    // Reactivation keeps the last choice (My Creators remove/add).
    as(uA)
    await patch(A, k2, { monitoringEnabled: false })
    r = await call(myCreator.DELETE, 'DELETE', `${base(A)}/my-creators/${k2}`, { id: A, kolId: k2 })
    let k2row = await monOf(A, k2)
    ok('removed link keeps Paused while inactive', r.status === 200 && k2row.active === false && k2row.on === false)
    r = await patch(A, k2, { monitoringEnabled: true })
    ok('inactive link → 404, value unchanged', r.status === 404 && (await monOf(A, k2)).on === false, `status ${r.status}`)
    r = await call(myCreators.POST, 'POST', `${base(A)}/my-creators`, pa, { kolId: k2 })
    k2row = await monOf(A, k2)
    ok('re-added through My Creators: active again, still Paused, one row', r.status === 201 && k2row.active === true && k2row.on === false && k2row.n === 1)

    // Reactivation through Add KOL's link (D010 path) keeps it too.
    as(uB)
    await patch(B, kr.id, { monitoringEnabled: false })
    await rb.sql(`UPDATE public.agency_kol_accounts SET is_active = false, status = 'inactive' WHERE agency_id = $1 AND kol_account_id = $2`, [B, kr.id])
    await addScrape.prepareKolIdentity(input())
    const krRow = await monOf(B, kr.id)
    ok('re-linked through Add KOL: active again, still Paused, one row', krRow.active === true && krRow.on === false && krRow.n === 1)

    const after51 = await identityAndLinks()
    ok('monitoring created no creator / social account / identity link',
      after51.kd === before51.kd && after51.sa === before51.sa && after51.ksa === before51.ksa, JSON.stringify(after51))
    ok('only agency B\'s explicit add of k1 created a link', after51.aka === before51.aka + 1, `${before51.aka} → ${after51.aka}`)
    const dups51 = (await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM (SELECT agency_id, kol_account_id FROM public.agency_kol_accounts GROUP BY 1,2 HAVING count(*) > 1) x`)).rows[0].n
    ok('no duplicate agency–creator links', dups51 === 0)

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
  // Static (D013): the retried pipeline writes no identity or agency row, and the dialog offers Retry.
  const scrapeSrc = readFileSync('src/lib/kolDirectory/addKolScrape.ts', 'utf8')
  const pipelineStart = scrapeSrc.indexOf('async function runRestOfPipeline')
  // The function ends at the first closing brace in column 0 after it.
  const pipelineBody = scrapeSrc.slice(pipelineStart, scrapeSrc.indexOf('\n}', pipelineStart) + 2)
  ok('runRestOfPipeline writes no identity / agency link',
    pipelineBody.length > 500 && !/insertIdentity|insertSocialAccountLink|ensureAgencyLink|reuseIdentity|linkSocialAccount|agency_kol_accounts|INSERT INTO public\.(kol_directory|social_account|kol_social_account)/.test(pipelineBody))
  const modal = readFileSync('src/components/discover/AddKolDirectoryModal.tsx', 'utf8')
  ok('progress dialog offers Retry and polls the new run', modal.includes('onRetry={retry}') && modal.includes("qs.set('runId', runId)") && modal.includes('/retry`'))
  // Static (D015/D051): the toggle is on My Creators cards only, and the write
  // touches nothing but the monitoring value of an active link.
  const mc = readFileSync('src/lib/discover/myCreators.ts', 'utf8')
  const setBody = mc.slice(mc.indexOf('export async function setMyCreatorMonitoring'), mc.indexOf('export async function removeMyCreator'))
  ok('monitoring write sets only monitoring_enabled (+updated_at) on an active link',
    /SET monitoring_enabled = \$3/.test(setBody) && /is_active IS TRUE/.test(setBody)
    && !/SET[\s\S]*\b(status|is_active)\s*=/.test(setBody) && !/INSERT/.test(setBody))
  const dirPage = readFileSync('src/components/discover/KolDirectoryPage.tsx', 'utf8')
  ok('My Creators card toggles monitoring through PATCH, only for scope mine',
    dirPage.includes("method: 'PATCH'") && dirPage.includes("scope !== 'mine' || !isMine(r) ? null")
    && dirPage.includes("'Monitored'") && dirPage.includes("'Paused'"))
  // The profile shows the same Monitored/Paused the card does (D054), through
  // the PATCH that already exists and only for a creator this agency holds.
  // Add KOL still knows nothing about monitoring: adding a creator must not
  // decide how they are watched.
  const workspace = readFileSync('src/components/discover/KolCreatorWorkspace.tsx', 'utf8')
  ok('monitoring on the profile, through PATCH and only for a My Creator; never in Add KOL',
    /method: 'PATCH'/.test(workspace)
    && /monitoringEnabled: !monitoring/.test(workspace)
    && /monitoring !== null &&/.test(workspace)
    && /scope=mine/.test(workspace)
    && /'Monitored'/.test(workspace) && /'Paused'/.test(workspace)
    && !/monitoring/i.test(modal))
  // Static (D065): Smart Discovery rows shortlist through the favorites hook,
  // keyed by the candidate id, and keep their other actions.
  const sd = readFileSync('src/components/discover/SmartDiscovery.tsx', 'utf8')
  const rowStart = sd.indexOf('function RecommendationRow')
  const row = sd.slice(rowStart)
  ok('D065: Smart Discovery uses the existing favorites hook',
    sd.includes("import { useKolFavorites } from './useKolFavorites'") && sd.includes('useKolFavorites(orgId'))
  ok('D065: each recommendation row toggles Shortlist by its candidate id',
    sd.includes('shortlisted={favorites.has(c.id)}') && sd.includes('void favorites.toggle(c.id)')
    && row.includes('onClick={onShortlist}') && row.includes("'Shortlisted' : 'Shortlist'"))
  ok('D065: Compare, Open profile and Open Compare are still there',
    sd.includes("onCompare={() => compare.toggle(selectionKey('roster', c.id))}") && row.includes('Open profile')
    && sd.includes('onClick={onGoToCompare}') && sd.includes('Open Compare'))
  ok('D065: no new endpoint in Smart Discovery',
    (sd.match(/fetch\(/g) ?? []).length === 4 && !/discover\/favorites/.test(sd))
  // Static (D008): the duplicate outcome offers "Lihat creator" exactly once and
  // opens the id the check found; both callers route it to the profile.
  //
  // Counted inside the duplicate block, not across the file: the success screen
  // (D012) carries a "Lihat creator" of its own, for `added.id`. Two outcomes
  // offering the same action is the point — what matters is that each one opens
  // the creator it is actually about.
  const dupStart = modal.indexOf("result.state === 'already_in_directory'")
  const dupEnd = modal.indexOf("result.state === 'new'", dupStart)
  const dupBlock = modal.slice(dupStart, dupEnd)
  ok('D008: "Lihat creator" appears once in the duplicate outcome, on the found id',
    dupStart > 0 && dupEnd > dupStart && (dupBlock.match(/Lihat creator/g) ?? []).length === 1
    && dupBlock.includes('onViewExisting(result.kol.id)')
    && !/onViewExisting\(added\.id\)/.test(dupBlock))
  const profileRouteOf = /onViewExisting=\{id => (?:\{\s*setAddOpen\(false\)\s*)?router\.push\(`\/organizations\/\$\{orgSlug\}\/discover\/kol-directory\/\$\{id\}`\)/
  ok('D008: both callers open /discover/kol-directory/[kolId]',
    profileRouteOf.test(readFileSync('src/components/discover/DiscoverWorkspace.tsx', 'utf8'))
    && profileRouteOf.test(dirPage))
  ok('D008: the duplicate outcome adds no request of its own',
    !/fetch\(/.test(dupBlock))
  // Static (D012): a finished run lands on a success screen the user can act
  // on, instead of the dialog vanishing.
  const successStart = modal.indexOf('function SuccessPhase')
  const successBlock = modal.slice(successStart, modal.indexOf('\n}', modal.indexOf('return (', successStart)) + 2)
  ok('D012: the poller stops at the success phase and hands off nothing by itself',
    /overallStatus === 'success'\)? \{[\s\S]{0,200}setPhase\('success'\)/.test(modal)
    && !/overallStatus === 'success'[\s\S]{0,200}onKolAdded/.test(modal)
    && (modal.match(/onKolAdded\(/g) ?? []).length === 1)
  ok('D012: the success screen renders only for the success phase, and names the creator',
    (modal.match(/phase === 'success' && added && \(/g) ?? []).length === 1
    && successStart > 0 && /@\{username\} sudah masuk directory/.test(successBlock))
  ok('D012: it summarises the steps that finished, from the progress already loaded',
    /progress\?\.steps \?\? \[\]/.test(successBlock)
    && /filter\(s => s\.status === 'success'\)/.test(successBlock)
    && /\{done\.length\} dari \{steps\.length\} langkah selesai/.test(successBlock))
  ok('D012: the L2 note promises no time and no completion',
    /Metrik L2 seperti growth dan views dibangun oleh batch pipeline/.test(successBlock)
    && !/(segera|beberapa menit|dalam \d|akan selesai|dijamin)/i.test(successBlock))
  ok('D012: exactly two actions — the id opens the creator, Selesai hands off once',
    /onViewExisting\(added\.id\)/.test(modal) && /onKolAdded\(added\.id\)/.test(modal)
    && (successBlock.match(/<Action /g) ?? []).length === 2
    && /Lihat creator<\/Action>/.test(successBlock) && /Selesai<\/Action>/.test(successBlock))
  ok('D012: the success screen asks the server for nothing', !/fetch\(/.test(successBlock))

  // Static (D085): the name arm belongs to scope=mine, the debounce is 300ms
  // there and unchanged elsewhere, and no search reads the agency label.
  const dirSrc = readFileSync('src/lib/discover/kolDirectory.ts', 'utf8')
  const route = readFileSync('src/app/api/organizations/[id]/discover/kol-directory/route.ts', 'utf8')
  const whereQ = dirSrc.slice(dirSrc.indexOf('WHERE ($1::text'), dirSrc.indexOf('AND ($2::text'))
  ok('D085: q matches the handle, or the profile-card name behind $41',
    /b\.username ILIKE '%' \|\| \$1 \|\| '%'/.test(whereQ)
    && /\$41::boolean IS TRUE AND EXISTS/.test(whereQ)
    && /l2_gold\.kol_profile_card c/.test(whereQ)
    && /c\.display_name ILIKE '%' \|\| \$1 \|\| '%'/.test(whereQ))
  ok('D085: no search arm reads the agency label',
    !/agency_kol_accounts[\s\S]{0,200}label[\s\S]{0,80}ILIKE/.test(dirSrc) && !/a\.label ILIKE/.test(dirSrc))
  ok('D085: only scope=mine turns the name arm on',
    /searchDisplayName: sp\.get\('scope'\) === 'mine'/.test(route)
    && (route.match(/searchDisplayName/g) ?? []).length === 1
    && /query\.searchDisplayName === true/.test(dirSrc))
  ok('D085: My Creators debounces at 300ms, the Creator Database at 350ms',
    /SEARCH_DEBOUNCE_MS = \{ mine: 300, database: 350 \}/.test(dirPage)
    && /setSearch\(query\.trim\(\)\); setPage\(1\) \}, SEARCH_DEBOUNCE_MS\[scope\]\)/.test(dirPage))
  ok('D085: Smart Discovery keeps its own 350ms debounce and global search',
    /\}, 350\)/.test(sd) && !/scope=mine[^`]*q=/.test(sd))
  ok('D085: the placeholder names both fields on My Creators only',
    /scope === 'mine'\s*\?\s*'Search creators by name or username…'\s*:\s*'Search creators by username…'/.test(dirPage))
  ok('D085: no migration was added for the search',
    readdirSync('migrations/kol').filter(f => f.endsWith('.sql')).length === 4)
  // Static (D067): Compare shows authenticity from the card lateral it already
  // has, formats a missing value as an em dash, and gained no brand-fit row.
  const cmp = readFileSync('src/components/discover/DiscoverCompare.tsx', 'utf8')
  ok('D067: Compare has one Authenticity row, next to Audience quality',
    (cmp.match(/label: 'Authenticity'/g) ?? []).length === 1
    && cmp.indexOf("label: 'Authenticity'") > cmp.indexOf("label: 'Audience quality'")
    && /fmt: c => num\(c\.authenticity, n => String\(Math\.round\(n\)\)\)/.test(cmp))
  ok('D067: a missing score renders as an em dash, with no zero fallback',
    /const num = \(v: number \| null, f: \(n: number\) => string\) => \(v === null \? '—' : f\(v\)\)/.test(cmp)
    && !/authenticity\s*(\?\?|\|\|)\s*0/.test(cmp))
  ok('D067: Compare has no brand-fit row and no proxy for one',
    !/brandFit|brand_fit|Brand fit|Brand Fit/.test(cmp)
    && !/@\/lib\/discover\/profile/.test(cmp))
  const baseSql = dirSrc.slice(dirSrc.indexOf('const BASE = `'), dirSrc.indexOf('WHERE ${ACTIVE}`'))
  ok('D067: authenticity rides the card lateral the row already joins',
    (baseSql.match(/JOIN l2_gold\.kol_profile_card/g) ?? []).length === 1
    && /g\.authenticity_score::float\s+AS authenticity_score/.test(baseSql)
    && /authenticityScore: r\.authenticity_score/.test(dirSrc))
  ok('D067: the roster never reads a brand table',
    !/brand_fit_analysis|public\.brand\b|brand_profile/.test(dirSrc))
  // Static (D078): the Format section filters for real, on the card's own
  // vocabulary, and no longer claims the roster has no format data.
  const filt = readFileSync('src/components/discover/KolDirectoryFilters.tsx', 'utf8')
  const fmtStart = filt.indexOf("<Section id=\"format\"")
  const fmtBlock = filt.slice(fmtStart, filt.indexOf('</Section>', fmtStart))
  ok('D078: the Format chips are live and carry the card\'s three values',
    fmtStart > 0 && /FORMAT_VALUES\.map/.test(fmtBlock)
    && /export const FORMAT_VALUES = FORMAT_OPTIONS\.filter\(Boolean\)/.test(filt)
    && /FORMAT_OPTIONS = \['', 'Video', 'Carousel', 'Image'\]/.test(filt))
  ok('D078: clicking a chip sets the existing formatDominant filter, and clicking it again clears it',
    /onChange\(\{ formatDominant: filters\.formatDominant === f \? '' : f \}\)/.test(fmtBlock)
    && /onChange\(\{ formatDominant: '' \}\)/.test(fmtBlock)
    && /if \(f\.formatDominant\) p\.format = f\.formatDominant/.test(filt))
  // The platform vocabulary may still be named in a comment explaining why it
  // is gone; what must not survive is a control or a label offering it.
  const filtCode = filt.split(/\r?\n/).filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  ok('D078: no disabled chip, no stale copy, and no format the roster cannot answer',
    !/disabled/.test(fmtBlock) && !/belum ada datanya/i.test(filt)
    && !/Reels|Story|Feed Post|'Photo'/.test(filtCode)
    && !/FORMATS\b/.test(filt))
  ok('D078: the chips add no request or parameter of their own',
    !/fetch\(/.test(filt) && (filt.match(/p\.format = /g) ?? []).length === 1)
  ok('D080 stays parked: the gender sliders are untouched',
    /label="Min\. female %"[\s\S]{0,200}onChange=\{v => onChange\(\{ femaleMin: v \}\)\}/.test(filt)
    && /label="Min\. male %"[\s\S]{0,200}onChange=\{v => onChange\(\{ maleMin: v \}\)\}/.test(filt)
    && /Major Female \(%\)[\s\S]{0,120}disabled/.test(filt)
    && /if \(f\.femaleMin > 0\) p\.femaleMin = String\(f\.femaleMin\)/.test(filt))
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
