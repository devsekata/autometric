import { cookies } from 'next/headers'
import { VIEW_ROLE_COOKIE, parseViewRole, type OrgRole } from './viewRole'

/**
 * The role a request should be served as: the "Viewing as" override when one is
 * set, and the real membership otherwise.
 *
 * Server-side, and the reason the override is a cookie rather than client state.
 * Hiding a nav entry stops nobody typing the URL, so the routes an Admin-only
 * module lives on ask this and redirect — which also means an Admin previewing
 * as Member gets a truthful preview: the pages refuse them too, not just the
 * sidebar.
 *
 * It can only ever *narrow* access. The override is read from a cookie the
 * browser owns, so it is not a credential and is never trusted to grant
 * anything: a real Member with `ADMIN` in that cookie still resolves to MEMBER.
 */
export async function effectiveOrgRole(actualRole: OrgRole): Promise<OrgRole> {
  if (actualRole === 'MEMBER') return 'MEMBER'
  const store = await cookies()
  return parseViewRole(store.get(VIEW_ROLE_COOKIE)?.value) ?? actualRole
}
