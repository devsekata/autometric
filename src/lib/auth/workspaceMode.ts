import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { listOrgsForUser } from '@/lib/organizations/queries'
import {
  VIEW_ROLE_COOKIE, VIEW_ROLE_MAX_AGE, parseViewRole, type OrgRole,
} from '@/lib/organizations/viewRole'

/**
 * The workspace mode a session is running in — chosen after login, changeable
 * from the sidebar's "Viewing as" switch.
 *
 * Mode is not the same thing as role, and keeping the two apart is the whole
 * point of this file. The **account** decides which modes are *available*; the
 * **mode** decides which navigation and which routes are active. A user who
 * administers one workspace and is a plain member of another may choose Admin
 * mode, and still gets Member access in the second — because `effectiveOrgRole`
 * intersects the mode with the membership for whichever org is being opened.
 *
 * So the cookie is a preference, never a credential. Nothing here grants
 * anything: `chooseWorkspaceMode` refuses Admin to an account that administers
 * no workspace, and every route re-checks against the real membership anyway.
 *
 * Plain server helpers rather than `'use server'` actions. A `'use server'` file
 * publishes every export as a callable POST endpoint, and only one of these is
 * ever invoked from the browser — `chooseWorkspaceMode`, and then only through
 * the action the mode screen declares. Writing the cookie still works from here
 * because that restriction is about the calling context, not the file. Nothing
 * outside a Server Component or Server Action may import this: `next/headers`
 * makes that a build error, which is the guard this would otherwise need.
 */

/** Which modes this account may use. Member is always one of them. */
export async function availableModes(): Promise<OrgRole[]> {
  const session = await auth()
  const userId = session?.user?.id ?? ''
  if (!userId) return ['MEMBER']

  let canAdmin = false
  try {
    const orgs = await listOrgsForUser(userId)
    canAdmin = orgs.some(o => o.role === 'ADMIN')
  } catch (err) {
    // A failed lookup must not hand out Admin. Falling back to Member-only is
    // the safe direction, and the switcher can restore Admin later.
    console.error('[workspaceMode] could not read memberships:', err)
  }

  return canAdmin ? ['ADMIN', 'MEMBER'] : ['MEMBER']
}

/** The mode this session chose, or null when it has not chosen yet. */
export async function currentWorkspaceMode(): Promise<OrgRole | null> {
  const store = await cookies()
  return parseViewRole(store.get(VIEW_ROLE_COOKIE)?.value)
}

/**
 * Record the chosen mode.
 *
 * Validated against the account's real memberships rather than trusted from the
 * form: the request body is the user's to write, so "Continue as Admin" from an
 * account that administers nothing is refused here and the session stays in
 * Member mode.
 */
export async function chooseWorkspaceMode(mode: OrgRole): Promise<OrgRole> {
  const allowed = await availableModes()
  const granted = allowed.includes(mode) ? mode : 'MEMBER'

  const store = await cookies()
  store.set(VIEW_ROLE_COOKIE, granted, {
    path: '/',
    maxAge: VIEW_ROLE_MAX_AGE,
    sameSite: 'lax',
  })
  return granted
}

/**
 * Forget the mode, so the next sign-in asks again.
 *
 * Called on logout. Without it the next person to log in on this browser would
 * silently inherit the last session's choice.
 */
export async function clearWorkspaceMode(): Promise<void> {
  const store = await cookies()
  store.delete(VIEW_ROLE_COOKIE)
}
