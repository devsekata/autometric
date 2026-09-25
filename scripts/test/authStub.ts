/**
 * Test stand-in for `@/auth` (mapped by scripts/test/tsconfig.json).
 *
 * Route handlers call `auth()` to read the session; outside Next there is no
 * request to read it from, so the test sets the session it wants here. Nothing
 * else from `@/auth` is used by the routes under test.
 */
type TestSession = { user: { id: string; email?: string | null; name?: string | null; role?: string } } | null

const g = globalThis as unknown as { __TEST_SESSION__?: TestSession }

export function setTestSession(session: TestSession) {
  g.__TEST_SESSION__ = session
}

export async function auth(): Promise<TestSession> {
  return g.__TEST_SESSION__ ?? null
}

export const signIn = async () => { throw new Error('signIn is not available in tests') }
export const signOut = async () => { throw new Error('signOut is not available in tests') }
export const handlers = {}
