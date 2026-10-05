/**
 * Cross-agency isolation, through the real route handlers — READ-ONLY.
 *
 *   npm run verify:kol-tenant
 *
 * Authorization must always be: signed-in user → active membership in
 * `public.agency_members` on the KOL server → target record of THAT agency.
 * This drives the real handlers with a stubbed session (`@/auth` →
 * scripts/test/authStub.ts, via scripts/test/tsconfig.json) for users and
 * agencies that exist on the KOL database, and checks that every cross-agency
 * request is refused:
 *
 *   * Brand Profile   another agency's profile cannot be read
 *   * Brand Match     another agency's stored results cannot be read; the
 *                     owning agency reads exactly the stored rows
 *   * Add KOL         adding for an agency you are not in is refused; a
 *                     client-supplied roster id that does not match the handle
 *                     is refused before anything is written
 *   * Scrape log      another agency's creator's progress cannot be read
 *   * Brand Fit       a brand id that is not the agency's own answers 404
 *   * Persistence     another agency's favourites / My Creators / links refused
 *
 * Nothing is written. Every KOL session is forced read-only
 * (`default_transaction_read_only=on`), so a regression that tried to write
 * would fail here with an error instead of changing data. The warehouse is
 * pointed at an unreachable host, so any path that still needed TSDB would fail.
 */
process.env.DATABASE_URL = 'postgres://tsdb-blocked.invalid:1/blocked'
for (const k of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT']) delete process.env[k]
process.env.PGOPTIONS = '-c default_transaction_read_only=on'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(a - b) < 1e-9

type Handler = (req: unknown, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function main() {
  const { default: kolDb } = await import('../src/lib/kolDb')
  const db = kolDb()
  const ro = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  ok('KOL session is read-only', ro.rows[0]?.transaction_read_only === 'on')
  if (ro.rows[0]?.transaction_read_only !== 'on') return

  const { setTestSession } = await import('./test/authStub')
  const { NextRequest } = await import('next/server')
  const brandProfile = await import('../src/app/api/organizations/[id]/discover/brand-profile/route')
  const directory = await import('../src/app/api/organizations/[id]/discover/kol-directory/route')
  const add = await import('../src/app/api/kol-directory/add/route')
  const addCheck = await import('../src/app/api/kol-directory/add/check/route')
  const addStatus = await import('../src/app/api/kol-directory/add/[kolId]/status/route')
  const brandFit = await import('../src/app/api/organizations/[id]/discover/brand-fit/route')
  const favorites = await import('../src/app/api/organizations/[id]/discover/favorites/route')
  const myCreators = await import('../src/app/api/organizations/[id]/discover/my-creators/route')
  const links = await import('../src/app/api/organizations/[id]/discover/links/route')

  const call = async (route: unknown, method: string, url: string, params: Record<string, string>, body?: unknown) => {
    const req = new NextRequest(`http://kol.test${url}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    })
    const res = await (route as Handler)(req, { params: Promise.resolve(params) })
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null }
  }
  const as = (userId: string) => setTestSession({ user: { id: userId } })

  /* ── fixtures: real agencies, read only ─────────────────────────────────── */
  // A = the agency holding a Brand Profile and a finished Brand Match run.
  // B = another live agency, with at least one creator link A does not share.
  const { rows: [A] } = await db.query<{ agency: string; user: string }>(`
    SELECT s.agency_id::text AS agency, m.user_id::text AS "user"
      FROM public.brand_match_state s
      JOIN public.brand_profile p ON p.organization_id = s.agency_id
      JOIN public.agency_members m ON m.agency_id = s.agency_id AND m.status = 'ACTIVE'
      JOIN public.agencies ag ON ag.id = s.agency_id AND ag.deleted_at IS NULL
     WHERE s.status = 'done'
     ORDER BY s.agency_id LIMIT 1`)
  if (!A) { ok('an agency with a Brand Profile and a finished Brand Match run exists', false); return }
  const { rows: [B] } = await db.query<{ agency: string; user: string; kol: string }>(`
    SELECT k.agency_id::text AS agency, m.user_id::text AS "user", k.kol_account_id::text AS kol
      FROM public.agency_kol_accounts k
      JOIN public.agency_members m ON m.agency_id = k.agency_id AND m.status = 'ACTIVE'
      JOIN public.agencies ag ON ag.id = k.agency_id AND ag.deleted_at IS NULL
     WHERE k.is_active IS TRUE AND k.agency_id <> $1
       AND NOT EXISTS (SELECT 1 FROM public.agency_members x
                        WHERE x.agency_id = k.agency_id AND x.user_id = $2)
       AND NOT EXISTS (SELECT 1 FROM public.agency_kol_accounts y
                        WHERE y.agency_id = $1 AND y.kol_account_id = k.kol_account_id AND y.is_active)
     ORDER BY k.agency_id, k.kol_account_id LIMIT 1`, [A.agency, A.user])
  if (!B) { ok('a second agency with its own creator exists', false); return }
  console.log(`  agency A ${A.agency} (user ${A.user}) · agency B ${B.agency} (user ${B.user}) · B's creator ${B.kol}`)
  const base = (o: string) => `/api/organizations/${o}/discover`

  /* ── Brand Profile ──────────────────────────────────────────────────────── */
  console.log('\nBrand Profile')
  as(A.user)
  let r = await call(brandProfile.GET, 'GET', `${base(A.agency)}/brand-profile`, { id: A.agency })
  const profile = (r.json?.profile ?? null) as { whatMatters?: string[] } | null
  ok('A reads its own profile', r.status === 200 && !!profile && (profile.whatMatters?.length ?? 0) > 0,
    `status ${r.status}`)
  as(B.user)
  r = await call(brandProfile.GET, 'GET', `${base(A.agency)}/brand-profile`, { id: A.agency })
  ok("B cannot read A's profile", r.status === 401 || r.status === 403, `status ${r.status}`)
  r = await call(brandProfile.PUT, 'PUT', `${base(A.agency)}/brand-profile`, { id: A.agency }, { brandName: 'x' })
  ok("B cannot write A's profile (refused before any write)", r.status === 401 || r.status === 403, `status ${r.status}`)

  /* ── Brand Match ────────────────────────────────────────────────────────── */
  console.log('\nBrand Match')
  const { rows: stored } = await db.query<{ id: string; match_pct: number | null }>(`
    SELECT kol_directory_id::text AS id, match_pct::float8 AS match_pct
      FROM public.brand_match_result WHERE agency_id = $1 AND match_pct IS NOT NULL
     ORDER BY kol_directory_id LIMIT 5`, [A.agency])
  ok('A has stored Brand Match rows to read', stored.length > 0, `${stored.length}`)
  const ids = stored.map(s => s.id).join(',')
  as(A.user)
  r = await call(directory.GET, 'GET', `${base(A.agency)}/kol-directory?ids=${ids}&match=1`, { id: A.agency })
  const match = (r.json?.brandMatch ?? null) as { rows?: Record<string, { matchPct: number | null }> } | null
  const got = match?.rows ?? {}
  ok('A reads Brand Match for its creators', r.status === 200 && Object.keys(got).length > 0,
    `status ${r.status}, ${Object.keys(got).length} rows`)
  ok("A's Match % equals the stored brand_match_result rows",
    stored.every(s => near(got[s.id]?.matchPct ?? null, s.match_pct)),
    stored.map(s => `${s.match_pct?.toFixed(2)}/${got[s.id]?.matchPct?.toFixed?.(2)}`).join(' '))
  as(B.user)
  r = await call(directory.GET, 'GET', `${base(A.agency)}/kol-directory?ids=${ids}&match=1`, { id: A.agency })
  ok("B cannot read A's Brand Match", r.status === 401 || r.status === 403, `status ${r.status}`)

  /* ── Add KOL ────────────────────────────────────────────────────────────── */
  console.log('\nAdd KOL')
  as(A.user)
  r = await call(add.POST, 'POST', '/api/kol-directory/add', {}, {
    orgId: B.agency, platform: 'instagram', username: 'kol_tenant_probe_zz', profileUrl: 'https://www.instagram.com/kol_tenant_probe_zz/',
  })
  ok('adding for an agency you are not in is refused', r.status === 403, `status ${r.status}`)
  r = await call(addCheck.POST, 'POST', '/api/kol-directory/add/check', {}, {
    orgId: B.agency, platform: 'instagram', input: 'kol_tenant_probe_zz',
  })
  ok('checking for an agency you are not in is refused', r.status === 403, `status ${r.status}`)
  // A forged roster id: the handle has no roster row, but the body names B's
  // creator. The server must derive the ids itself and refuse the mismatch.
  r = await call(add.POST, 'POST', '/api/kol-directory/add', {}, {
    orgId: A.agency, platform: 'instagram', username: 'kol_tenant_probe_zz',
    profileUrl: 'https://www.instagram.com/kol_tenant_probe_zz/',
    existingKolDirectoryId: B.kol, existingSocialAccountId: null,
  })
  ok('a client-supplied roster id that does not match the handle is refused', r.status === 409,
    `status ${r.status} ${String(r.json?.error ?? '')}`)

  /* ── Scrape log ─────────────────────────────────────────────────────────── */
  console.log('\nScrape log')
  as(A.user)
  r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${B.kol}/status?orgId=${A.agency}`, { kolId: B.kol })
  ok("A cannot read the scrape log of B's creator through its own agency", r.status === 404, `status ${r.status}`)
  r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${B.kol}/status?orgId=${B.agency}`, { kolId: B.kol })
  ok("A cannot read it by naming B's agency", r.status === 403, `status ${r.status}`)
  as(B.user)
  r = await call(addStatus.GET, 'GET', `/api/kol-directory/add/${B.kol}/status?orgId=${B.agency}`, { kolId: B.kol })
  ok('B reads its own creator\'s scrape status', r.status === 200, `status ${r.status}`)

  /* ── Brand Fit ──────────────────────────────────────────────────────────── */
  console.log('\nBrand Fit')
  const { rows: [foreignBrand] } = await db.query<{ id: string }>(
    `SELECT id::text FROM public.brand WHERE agency_id IS DISTINCT FROM $1 LIMIT 1`, [A.agency])
  const probeBrand = foreignBrand?.id ?? '00000000-0000-4000-8000-000000000000'
  as(A.user)
  r = await call(brandFit.GET, 'GET', `${base(A.agency)}/brand-fit?brandId=${probeBrand}`, { id: A.agency })
  ok('a brand that is not the agency\'s own answers 404', r.status === 404, `status ${r.status}`)
  r = await call(brandFit.POST, 'POST', `${base(A.agency)}/brand-fit`, { id: A.agency }, { brandId: probeBrand, persist: false })
  ok('recomputing a brand that is not the agency\'s own answers 404', r.status === 404, `status ${r.status}`)
  as(B.user)
  r = await call(brandFit.GET, 'GET', `${base(A.agency)}/brand-fit?brandId=${probeBrand}`, { id: A.agency })
  ok("B cannot use A's Brand Fit route", r.status === 401 || r.status === 403, `status ${r.status}`)

  /* ── Persistence ────────────────────────────────────────────────────────── */
  console.log('\nFavorites / My Creators / links')
  as(A.user)
  for (const [label, route, path] of [
    ['favorites', favorites.GET, 'favorites'],
    ['My Creators', myCreators.GET, 'my-creators'],
    ['links', links.GET, 'links'],
  ] as const) {
    r = await call(route, 'GET', `${base(B.agency)}/${path}`, { id: B.agency })
    ok(`A cannot read B's ${label}`, r.status === 401 || r.status === 403, `status ${r.status}`)
  }
  as(B.user)
  r = await call(links.GET, 'GET', `${base(B.agency)}/links`, { id: B.agency })
  const linkIds = ((r.json?.links ?? []) as { id: string }[]).map(l => l.id)
  ok('B reads its own links from agency_kol_accounts', r.status === 200 && linkIds.includes(B.kol),
    `status ${r.status}, ${linkIds.length} links`)
}

main()
  .then(() => {
    console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
    process.exit(bad ? 1 : 0)
  })
  .catch(err => { console.error('\nverification could not run:', err); process.exit(1) })
