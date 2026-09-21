/**
 * Create Organization only runs for a session that is a KOL user.
 *
 *   npm run verify:org-create-session
 *
 * Every database statement runs inside one transaction that is rolled back at
 * the end (scripts/test/kolRollback.ts), so the organization created by Test A
 * never persists. `@/auth` is the test stub for the route; the real
 * `src/auth.ts` is loaded separately, with `next-auth` stubbed only so its
 * config (the callbacks under test) can be read.
 *
 *   A  valid KOL session            → 201, agency + ADMIN member written
 *   B  session id not in "user"     → 401 "Sesi tidak valid…", createOrg never runs
 *   C  no session                   → 401 Unauthorized (unchanged)
 *   D  Google login, KOL user       → token.id is the KOL id, not Google's random id
 *   E  Google login, sync fails     → sign-in refused; no token with a random id
 */
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import * as rb from './test/kolRollback'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const rejects = async (p: Promise<unknown>) => { try { await p; return false } catch { return true } }

type Cb = Record<string, (...a: never[]) => Promise<unknown>>
type Provider = { id?: string; authorize?: (c: Record<string, unknown>) => Promise<unknown> }

/** Loads the real src/auth.ts with next-auth stubbed, returning the config it passes to NextAuth. */
function loadAuthConfig(overrides: Record<string, unknown> = {}) {
  let captured: { callbacks: Cb; providers: Provider[] } | null = null
  const stub = (file: string, exports: unknown) => {
    const key = require.resolve(file)
    require.cache[key] = { id: key, filename: key, loaded: true, exports } as NodeJS.Module
  }
  stub('next-auth', {
    __esModule: true,
    default: (cfg: typeof captured) => { captured = cfg; return { handlers: {}, signIn: null, signOut: null, auth: null } },
  })
  stub('next-auth/providers/google', { __esModule: true, default: (c: object) => ({ id: 'google', ...c }) })
  stub('next-auth/providers/credentials', { __esModule: true, default: (c: object) => ({ ...c }) })
  const helper = require.resolve('../src/lib/auth/handleGoogleSignIn')
  const authFile = require.resolve('../src/auth')
  delete require.cache[authFile]
  if (Object.keys(overrides).length) {
    require.cache[helper] = { id: helper, filename: helper, loaded: true,
      exports: { ...require(helper), ...overrides } } as NodeJS.Module
  }
  require(authFile)
  delete require.cache[helper]
  if (!captured) throw new Error('src/auth.ts did not call NextAuth')
  return captured as { callbacks: Cb; providers: Provider[] }
}

async function main() {
  process.env.GOOGLE_CLIENT_ID = 'test-client'
  await rb.start({
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
  })
  try {
    const { setTestSession } = await import('./test/authStub')
    const { NextRequest } = await import('next/server')
    const route = await import('../src/app/api/organizations/route')

    // createOrg is the only caller of kolDbWrite().connect() on this route.
    let connects = 0
    const proto = pg.Pool.prototype as unknown as { connect: (...a: unknown[]) => unknown }
    const realConnect = proto.connect
    proto.connect = function (...a: unknown[]) { connects++; return realConnect.apply(this, a) }

    const post = async (userId: string | null, name = 'medianaru') => {
      setTestSession(userId ? { user: { id: userId } } : null)
      const res = await route.POST(new NextRequest('http://kol.test/api/organizations', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
      }))
      return { status: res.status, json: await res.json() as { error?: string; data?: { id: string; slug: string; name: string; role: string } } }
    }
    const count = async () => Number((await rb.sql<{ n: string }>('SELECT count(*) n FROM public.agencies')).rows[0].n)

    const { rows: users } = await rb.sql<{ id: string; email: string }>(
      'SELECT id::text, email FROM public."user" WHERE email IS NOT NULL ORDER BY created_at LIMIT 1')
    const kolUser = users[0]
    ok('fixture: a KOL user exists to sign in as', !!kolUser)

    console.log('\nC  no session')
    connects = 0
    const c = await post(null)
    ok('401', c.status === 401, String(c.status))
    ok('existing "Unauthorized" message kept', c.json.error === 'Unauthorized')
    ok('createOrg not reached', connects === 0)

    console.log('\nB  session id that is not a KOL user')
    for (const [label, id] of [['a uuid from another database', randomUUID()], ['a non-uuid id', 'not-a-uuid']] as const) {
      const before = await count()
      connects = 0
      const b = await post(id)
      ok(`${label}: 401`, b.status === 401, String(b.status))
      ok(`${label}: "Sesi tidak valid, silakan login ulang."`, b.json.error === 'Sesi tidak valid, silakan login ulang.')
      ok(`${label}: createOrg not called (no write connection)`, connects === 0, `${connects} connect(s)`)
      ok(`${label}: no agency written`, (await count()) === before)
      ok(`${label}: no database detail leaked`, !JSON.stringify(b.json).match(/agencies|foreign key|constraint|uuid/i))
    }

    console.log('\nA  valid KOL session (rolled back)')
    const before = await count()
    const a = await post(kolUser.id)
    ok('201', a.status === 201, `${a.status} ${a.json.error ?? ''}`)
    ok('"medianaru" accepted, slug unchanged in shape', a.json.data?.name === 'medianaru' && /^medianaru-[a-z0-9]{1,6}$/.test(a.json.data?.slug ?? ''), a.json.data?.slug)
    ok('success response unchanged (role ADMIN)', a.json.data?.role === 'ADMIN')
    ok('one agency written with created_by = session user', (await count()) === before + 1
      && (await rb.sql('SELECT 1 FROM public.agencies WHERE id = $1 AND created_by::text = $2', [a.json.data?.id, kolUser.id])).rowCount === 1)
    ok('creator is an ACTIVE ADMIN member', (await rb.sql(
      `SELECT 1 FROM public.agency_members WHERE agency_id = $1 AND user_id::text = $2 AND role = 'ADMIN' AND status = 'ACTIVE'`,
      [a.json.data?.id, kolUser.id])).rowCount === 1)

    console.log('\nD  Google login for a KOL user')
    const real = loadAuthConfig()
    const googleRandomId = randomUUID()
    ok('signIn callback accepts it', (await real.callbacks.signIn({
      user: { email: kolUser.email, name: 'x', image: null }, account: { provider: 'google', providerAccountId: 'test-google-id' },
    } as never)) === true)
    const tok = await real.callbacks.jwt({ token: { email: kolUser.email }, user: { id: googleRandomId }, account: { provider: 'google' } } as never) as { id?: string }
    ok('token.id is the KOL user id', tok.id === kolUser.id, tok.id)
    ok("Google's random id is not kept", tok.id !== googleRandomId)
    const sess = await real.callbacks.session({ session: { user: {} }, token: tok } as never) as { user: { id?: string } }
    ok('session.user.id is a KOL public."user" id', (await rb.sql('SELECT 1 FROM public."user" WHERE id::text = $1', [sess.user.id])).rowCount === 1)

    console.log('\nE  Google login when the KOL sync fails')
    const down = loadAuthConfig({
      handleGoogleSignIn: async () => { throw new Error('simulated KOL outage') },
      getDbUserByEmail: async () => { throw new Error('simulated KOL outage') },
    })
    const quiet = console.error
    console.error = () => {}
    try {
      ok('signIn callback refuses the login', (await down.callbacks.signIn({
        user: { email: 'new@example.test', name: 'x', image: null }, account: { provider: 'google', providerAccountId: 'g' },
      } as never)) === false)
      ok('jwt does not swallow a failed lookup (no token issued)', await rejects(down.callbacks.jwt({
        token: { email: 'new@example.test' }, user: { id: randomUUID() }, account: { provider: 'google' } } as never)))
      const missing = loadAuthConfig({ getDbUserByEmail: async () => null })
      ok('jwt refuses a Google account with no KOL user row', await rejects(missing.callbacks.jwt({
        token: { email: 'nobody@example.test' }, user: { id: randomUUID() }, account: { provider: 'google' } } as never)))

      const realFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ aud: 'test-client', email: 'new@example.test', sub: 'g' }))) as typeof fetch
      try {
        const oneTap = down.providers.find(p => p.id === 'google-one-tap')
        ok('Google One Tap: failed sync fails the login', !!oneTap?.authorize && await rejects(oneTap.authorize({ idToken: 't' })))
      } finally { globalThis.fetch = realFetch }
    } finally { console.error = quiet }

    console.log('\nunrelated auth paths unchanged')
    ok('credentials login still skips the Google branch of signIn', (await real.callbacks.signIn({
      user: { id: kolUser.id }, account: { provider: 'credentials' } } as never)) === true)
    const credTok = await real.callbacks.jwt({ token: {}, user: { id: kolUser.id, role: 'ADMIN' }, account: { provider: 'credentials' } } as never) as { id?: string }
    ok('credentials jwt keeps the user id as before', credTok.id === kolUser.id)
    const later = await real.callbacks.jwt({ token: { id: kolUser.id, email: kolUser.email } } as never) as { id?: string }
    ok('later requests (no account) do no lookup and keep the token', later.id === kolUser.id)

    proto.connect = realConnect
  } finally {
    await rb.finish()
  }
  console.log(bad === 0 ? '\nall checks passed' : `\n${bad} check(s) failed`)
  if (bad) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
