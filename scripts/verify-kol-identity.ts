/**
 * Identity, tenant and membership run on the KOL database only — checked
 * end-to-end through the real route handlers, leaving nothing behind.
 *
 *   npm run verify:kol-identity
 *
 * Same harness as verify:kol-persistence: one rolled-back KOL transaction for
 * every query (fixtures included), DATABASE_URL pointed at an invalid host,
 * `@/auth` replaced by a session stub, and a failure if `src/lib/db.ts` loads.
 * No email is sent: register and forgot-password are only driven down the
 * branches that answer before mailing (existing address, unknown address).
 *
 * Covers: password login, register (existing address), OTP verification
 * creating a KOL user, forgot/reset password, Google sign-in (create and link),
 * organization list/create/get/update/delete (including the KOL brand check),
 * members (list, role change, last-admin guard, search, leave, invite
 * disabled), and invitations (list, accept, decline).
 */
import path from 'node:path'
import pg from 'pg'
import bcrypt from 'bcryptjs'

process.env.DATABASE_URL = 'postgres://tsdb-blocked.invalid:1/blocked'
for (const k of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT']) delete process.env[k]

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
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
  const login = await import('../src/app/api/auth/login/route')
  const register = await import('../src/app/api/auth/register/route')
  const verifyOtpRoute = await import('../src/app/api/auth/verify-otp/route')
  const forgot = await import('../src/app/api/auth/forgot-password/route')
  const verifyReset = await import('../src/app/api/auth/verify-reset-otp/route')
  const reset = await import('../src/app/api/auth/reset-password/route')
  const google = await import('../src/lib/auth/handleGoogleSignIn')
  const orgs = await import('../src/app/api/organizations/route')
  const org = await import('../src/app/api/organizations/[id]/route')
  const members = await import('../src/app/api/organizations/[id]/members/route')
  const memberOne = await import('../src/app/api/organizations/[id]/members/[memberId]/route')
  const search = await import('../src/app/api/organizations/[id]/members/search/route')
  const invites = await import('../src/app/api/invitations/route')
  const invite = await import('../src/app/api/invitations/[memberId]/route')

  const call = async (route: unknown, method: string, url: string, params: Record<string, string> = {}, body?: unknown) => {
    const req = new NextRequest(`http://kol.test${url}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    })
    const res = await (route as Handler)(req, { params: Promise.resolve(params) })
    const text = await res.text()
    let json: Record<string, unknown> | null = null
    try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
    return { status: res.status, json, cookie: res.headers.get('set-cookie') ?? '' }
  }
  const as = (userId: string | null) => setTestSession(userId ? { user: { id: userId } } : null)

  try {
    const tag = `e2e-${Date.now()}`
    const email = (n: string) => `${tag}-${n}@kol-test.invalid`
    const pw = 'Correct-horse-9'
    const hash = await bcrypt.hash(pw, 10)
    const mkUser = async (n: string, withPassword = true) => (await rb.sql<{ id: string }>(
      `INSERT INTO public."user" (email, name, password_hash, email_verified, role, user_type, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'USER', 'staff', now(), now()) RETURNING id`,
      [email(n), `E2E ${n}`, withPassword ? hash : null])).rows[0].id
    const one = async <T extends pg.QueryResultRow>(q: string, v: unknown[]) => (await rb.sql<T>(q, v)).rows[0]

    /* ── password login ───────────────────────────────────────────────── */
    console.log('\nLogin')
    const uA = await mkUser('a')
    let r = await call(login.POST, 'POST', '/api/auth/login', {}, { email: email('a'), password: pw })
    ok('correct password → 200, KOL user id', r.status === 200 && r.json?.id === uA, `status ${r.status}`)
    ok('session cookie issued', r.cookie.includes('authjs.session-token='))
    r = await call(login.POST, 'POST', '/api/auth/login', {}, { email: email('a'), password: 'wrong-pass-1' })
    ok('wrong password → 401', r.status === 401)
    r = await call(login.POST, 'POST', '/api/auth/login', {}, { email: email('nobody'), password: pw })
    ok('unknown email → 401', r.status === 401)

    /* ── register / OTP ───────────────────────────────────────────────── */
    console.log('\nRegister / OTP')
    r = await call(register.POST, 'POST', '/api/auth/register', {}, { name: 'X', email: email('a'), password: pw, confirmPassword: pw })
    ok('registering an existing KOL address is refused', r.status >= 400 && /already/i.test(String(r.json?.error ?? '')), `status ${r.status}`)
    const otp = '482913'
    await rb.sql(
      `INSERT INTO public.otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at, created_at)
       VALUES ($1, $2, 'E2E new', $3, 'register', now() + interval '10 minutes', now())`,
      [email('new'), await bcrypt.hash(otp, 10), hash])
    r = await call(verifyOtpRoute.POST, 'POST', '/api/auth/verify-otp', {}, { email: email('new'), otp: '000000' })
    ok('wrong OTP → 400, nothing created', r.status === 400)
    r = await call(verifyOtpRoute.POST, 'POST', '/api/auth/verify-otp', {}, { email: email('new'), otp })
    ok('correct OTP → 200', r.status >= 200 && r.status < 300, `status ${r.status}`)
    const created = await one<{ id: string; created_at: Date | null; email_verified: boolean }>(
      `SELECT id, created_at, email_verified FROM public."user" WHERE email = $1`, [email('new')])
    ok('user created in KOL public."user" with timestamps', !!created?.id && !!created.created_at && created.email_verified)
    const leftover = await one<{ n: number }>(`SELECT count(*)::int n FROM public.otp_verifications WHERE email = $1`, [email('new')])
    ok('used OTP removed from KOL otp_verifications', leftover.n === 0)
    r = await call(login.POST, 'POST', '/api/auth/login', {}, { email: email('new'), password: pw })
    ok('the new user can log in', r.status === 200 && r.json?.id === created.id)

    /* ── forgot / reset ───────────────────────────────────────────────── */
    console.log('\nForgot / reset password')
    r = await call(forgot.POST, 'POST', '/api/auth/forgot-password', {}, { email: email('nobody') })
    ok('unknown address answers success without revealing anything', r.status === 200, `status ${r.status}`)
    const rotp = '173946'
    await rb.sql(
      `INSERT INTO public.otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at, created_at)
       VALUES ($1, $2, 'E2E a', '', 'reset_password', now() + interval '10 minutes', now())`,
      [email('a'), await bcrypt.hash(rotp, 10)])
    r = await call(verifyReset.POST, 'POST', '/api/auth/verify-reset-otp', {}, { email: email('a'), otp: rotp })
    ok('reset OTP verifies', r.status === 200, `status ${r.status}`)
    const newPw = 'Another-horse-7'
    r = await call(reset.POST, 'POST', '/api/auth/reset-password', {}, { email: email('a'), otp: rotp, newPassword: newPw, confirmPassword: newPw })
    ok('reset → 200', r.status === 200, `status ${r.status}`)
    r = await call(login.POST, 'POST', '/api/auth/login', {}, { email: email('a'), password: newPw })
    ok('login works with the new password', r.status === 200)
    r = await call(login.POST, 'POST', '/api/auth/login', {}, { email: email('a'), password: pw })
    ok('old password no longer works', r.status === 401)

    /* ── Google ───────────────────────────────────────────────────────── */
    console.log('\nGoogle sign-in')
    await google.handleGoogleSignIn({ email: email('g'), name: 'E2E g', googleId: `g-${tag}`, avatarUrl: null })
    const g = await one<{ id: string; google_id: string; created_at: Date | null }>(
      `SELECT id, google_id, created_at FROM public."user" WHERE email = $1`, [email('g')])
    ok('new Google user created in KOL', !!g?.id && g.google_id === `g-${tag}` && !!g.created_at)
    ok('getDbUserIdByEmail reads KOL', (await google.getDbUserIdByEmail(email('g'))) === g.id)
    await google.handleGoogleSignIn({ email: email('a'), name: 'E2E a', googleId: `ga-${tag}`, avatarUrl: null })
    const linked = await one<{ google_id: string }>(`SELECT google_id FROM public."user" WHERE id = $1`, [uA])
    ok('existing password user gets the Google id linked', linked.google_id === `ga-${tag}`)

    /* ── organizations ────────────────────────────────────────────────── */
    console.log('\nOrganizations')
    const uB = await mkUser('b'); const uC = await mkUser('c')
    as(uA)
    r = await call(orgs.POST, 'POST', '/api/organizations', {}, { name: `E2E Agency ${tag}` })
    ok('create → 201', r.status === 201, `status ${r.status}`)
    const A = (r.json?.data as { id: string })?.id
    const agencyRow = await one<{ created_at: Date | null; created_by: string }>(
      `SELECT created_at, created_by FROM public.agencies WHERE id = $1`, [A])
    ok('agency row in KOL, owner and timestamps set', agencyRow?.created_by === uA && !!agencyRow.created_at)
    const adminRow = await one<{ role: string; status: string }>(
      `SELECT role, status FROM public.agency_members WHERE agency_id = $1 AND user_id = $2`, [A, uA])
    ok('creator is ACTIVE ADMIN in agency_members', adminRow?.role === 'ADMIN' && adminRow.status === 'ACTIVE')
    r = await call(orgs.GET, 'GET', '/api/organizations')
    ok('list includes it', ((r.json?.data ?? []) as { id: string }[]).some(o => o.id === A))
    r = await call(org.GET, 'GET', `/api/organizations/${A}`, { id: A })
    ok('get → 200 with brand_count 0', r.status === 200 && (r.json?.data as { brand_count: number })?.brand_count === 0)
    r = await call(org.PATCH, 'PATCH', `/api/organizations/${A}`, { id: A }, { name: 'E2E Renamed' })
    ok('rename → 200', r.status === 200, `status ${r.status}`)
    as(uB)
    r = await call(org.GET, 'GET', `/api/organizations/${A}`, { id: A })
    ok('non-member cannot read it', r.status === 404, `status ${r.status}`)
    r = await call(org.DELETE, 'DELETE', `/api/organizations/${A}`, { id: A })
    ok('non-member cannot delete it', r.status === 404, `status ${r.status}`)

    /* ── members & invitations ────────────────────────────────────────── */
    console.log('\nMembers & invitations')
    const mB = await one<{ id: string }>(
      `INSERT INTO public.agency_members (agency_id, user_id, role, status, invited_by, invited_at)
       VALUES ($1, $2, 'MEMBER', 'PENDING', $3, now()) RETURNING id`, [A, uB, uA])
    const mC = await one<{ id: string }>(
      `INSERT INTO public.agency_members (agency_id, user_id, role, status, invited_by, invited_at)
       VALUES ($1, $2, 'MEMBER', 'PENDING', $3, now()) RETURNING id`, [A, uC, uA])
    as(uB)
    r = await call(invites.GET, 'GET', '/api/invitations')
    ok('invitee sees the pending invitation', ((r.json?.data ?? []) as { id: string }[]).some(i => i.id === mB.id))
    r = await call(invite.POST, 'POST', `/api/invitations/${mB.id}`, { memberId: mB.id })
    ok('accept → 200', r.status === 200, `status ${r.status}`)
    as(uC)
    r = await call(invite.POST, 'POST', `/api/invitations/${mB.id}`, { memberId: mB.id })
    ok('someone else\'s invitation cannot be accepted', r.status === 404, `status ${r.status}`)
    r = await call(invite.DELETE, 'DELETE', `/api/invitations/${mC.id}`, { memberId: mC.id })
    ok('decline → 204', r.status === 204, `status ${r.status}`)
    const states = await rb.sql<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM public.agency_members WHERE id = ANY($1::uuid[])`, [[mB.id, mC.id]])
    const st = Object.fromEntries(states.rows.map(x => [x.user_id, x.status]))
    ok('KOL rows: accepted ACTIVE, declined CANCELLED', st[uB] === 'ACTIVE' && st[uC] === 'CANCELLED')

    as(uB)
    r = await call(members.GET, 'GET', `/api/organizations/${A}/members`, { id: A })
    const list = (r.json?.data ?? []) as { user_id: string; email: string }[]
    ok('member list from KOL (2 active, emails from user)', list.length === 2 && list.some(m => m.email === email('a')))
    r = await call(members.POST, 'POST', `/api/organizations/${A}/members`, { id: A }, { email: email('c'), role: 'ADMIN' })
    ok('a MEMBER cannot invite an ADMIN', r.status === 403, `status ${r.status}`)
    r = await call(members.POST, 'POST', `/api/organizations/${A}/members`, { id: A }, { email: email('c'), role: 'MEMBER' })
    ok('inviting is switched off (no warehouse write)', r.status === 409 && /not available/i.test(String(r.json?.error)))
    r = await call(search.GET, 'GET', `/api/organizations/${A}/members/search?email=${encodeURIComponent('e2e')}`, { id: A })
    ok('partial search reveals nobody', r.status === 200 && (r.json?.data as unknown[]).length === 0)
    r = await call(search.GET, 'GET', `/api/organizations/${A}/members/search?email=${encodeURIComponent(email('c'))}`, { id: A })
    ok('exact address finds a non-member', ((r.json?.data ?? []) as { id: string }[]).length === 1)
    r = await call(memberOne.PATCH, 'PATCH', `/api/organizations/${A}/members/${mB.id}`, { id: A, memberId: mB.id }, { role: 'ADMIN' })
    ok('a MEMBER cannot change roles', r.status === 403, `status ${r.status}`)

    as(uA)
    const mA = await one<{ id: string }>(`SELECT id FROM public.agency_members WHERE agency_id = $1 AND user_id = $2`, [A, uA])
    r = await call(memberOne.PATCH, 'PATCH', `/api/organizations/${A}/members/${mA.id}`, { id: A, memberId: mA.id }, { role: 'MEMBER' })
    ok('the last admin cannot be demoted', r.status === 409, `status ${r.status}`)
    r = await call(memberOne.PATCH, 'PATCH', `/api/organizations/${A}/members/${mB.id}`, { id: A, memberId: mB.id }, { role: 'ADMIN' })
    ok('admin promotes a member → 200', r.status === 200, `status ${r.status}`)
    const promoted = await one<{ role: string; updated_at: Date }>(`SELECT role, updated_at FROM public.agency_members WHERE id = $1`, [mB.id])
    ok('role written to KOL', promoted.role === 'ADMIN')
    as(uB)
    r = await call(memberOne.DELETE, 'DELETE', `/api/organizations/${A}/members/${mB.id}`, { id: A, memberId: mB.id })
    ok('a member can leave → 204', r.status === 204, `status ${r.status}`)
    const gone = await one<{ n: number }>(`SELECT count(*)::int n FROM public.agency_members WHERE id = $1`, [mB.id])
    ok('membership removed from KOL', gone.n === 0)

    /* ── organization delete, gated on KOL brands ─────────────────────── */
    console.log('\nOrganization delete')
    const brand = await one<{ id: string }>(
      `INSERT INTO public.brand (agency_id, name, is_active, created_at, updated_at)
       VALUES ($1, 'E2E brand', true, now(), now()) RETURNING id`, [A])
    as(uA)
    r = await call(org.GET, 'GET', `/api/organizations/${A}`, { id: A })
    ok('brand_count reads KOL public.brand', (r.json?.data as { brand_count: number })?.brand_count === 1)
    r = await call(org.DELETE, 'DELETE', `/api/organizations/${A}`, { id: A })
    ok('delete blocked while a KOL brand is active → 409', r.status === 409 && r.json?.brand_count === 1, `status ${r.status}`)
    await rb.sql(`UPDATE public.brand SET is_active = false WHERE id = $1`, [brand.id])
    r = await call(org.DELETE, 'DELETE', `/api/organizations/${A}`, { id: A })
    ok('delete once no brand is active → 204', r.status === 204, `status ${r.status}`)
    const deleted = await one<{ deleted_at: Date | null }>(`SELECT deleted_at FROM public.agencies WHERE id = $1`, [A])
    ok('agency soft-deleted in KOL', !!deleted.deleted_at)
    r = await call(org.GET, 'GET', `/api/organizations/${A}`, { id: A })
    ok('deleted agency is no longer reachable', r.status === 404, `status ${r.status}`)
    as(null)
    r = await call(orgs.GET, 'GET', '/api/organizations')
    ok('signed-out list → 401', r.status === 401)

    const loaded = Object.keys(require.cache)
    ok('module cache is observable', loaded.filter(p => p.includes(`${path.sep}src${path.sep}`)).length > 10)
    ok('src/lib/db.ts (warehouse pool) was never loaded', !loaded.some(p => /[\\/]src[\\/]lib[\\/]db\.ts$/.test(p)))
  } finally {
    await rb.finish()
  }

  const check = new pg.Client(kolCfg)
  await check.connect()
  const { rows } = await check.query(`SELECT
      (SELECT count(*)::int FROM public."user" WHERE email LIKE '%@kol-test.invalid') AS users,
      (SELECT count(*)::int FROM public.agencies WHERE name LIKE 'E2E %') AS agencies,
      (SELECT count(*)::int FROM public.otp_verifications WHERE email LIKE '%@kol-test.invalid') AS otps`)
  await check.end()
  ok('rolled back: no test user, agency or OTP remains', rows[0].users === 0 && rows[0].agencies === 0 && rows[0].otps === 0,
    JSON.stringify(rows[0]))
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
