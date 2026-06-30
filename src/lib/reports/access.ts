import { auth } from '@/auth'
import { getMemberRole } from '@/lib/organizations/queries'

export interface OrgAccess {
  orgId: string
  userId: string
  role: 'ADMIN' | 'MEMBER'
}

/**
 * Verifies the current session user is an active member of the org (by id).
 * Returns null when not signed in or not a member.
 */
export async function requireOrgMemberById(orgId: string): Promise<OrgAccess | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const role = await getMemberRole(orgId, userId)
  if (!role) return null

  return { orgId, userId, role }
}
