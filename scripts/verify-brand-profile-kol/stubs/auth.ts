/**
 * Stand-in for `@/auth`, used only by `scripts/verify-brand-profile-kol.ts`.
 *
 * The real `auth()` reads a signed session cookie, and there is no test login
 * to mint one with (`/api/auth/login` needs a real password). The verify script
 * sets the session it wants to test directly — no session, an agency admin, a
 * member — and the route's own authorisation (`requireOrgMemberById` →
 * `getMemberRole` against `agency_members`) runs unchanged on top of it.
 */
type Session = { user: { id: string; role?: string } } | null

let current: Session = null

export function setSession(userId: string | null) {
  current = userId ? { user: { id: userId } } : null
}

export async function auth(): Promise<Session> {
  return current
}
