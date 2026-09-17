import { auth } from '@/auth'
import kolDb from '@/lib/kolDb'
import { getMemberRole } from '@/lib/organizations/queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AgencyAccess =
  | { ok: true; agencyId: string; userId: string; role: 'ADMIN' | 'MEMBER' }
  | { ok: false; status: 400 | 401 | 403; error: string }

/**
 * "Add New KOL" writes into the shared Creator Database and links the creator
 * to an agency, so signing in is not enough: the caller has to be an active
 * member of the agency the creator is being added for.
 *
 * The agency is the workspace the request comes from (the `[id]` every other
 * tenant route uses), checked against `agency_members` on the KOL server —
 * never `user.agency_id`, which says nothing about whether that membership is
 * still active.
 */
export async function requireAgencyMember(agencyId: unknown): Promise<AgencyAccess> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  if (typeof agencyId !== 'string' || !UUID_RE.test(agencyId)) {
    return { ok: false, status: 400, error: 'orgId is required.' }
  }
  const role = await getMemberRole(agencyId, userId)
  if (!role) return { ok: false, status: 403, error: 'You are not a member of this organization.' }
  return { ok: true, agencyId, userId, role }
}

/** Whether a Creator Database row is linked to the agency (Add KOL creates that link). */
export async function isKolLinkedToAgency(kolDirectoryId: string, agencyId: string): Promise<boolean> {
  if (!UUID_RE.test(kolDirectoryId)) return false
  const { rows } = await kolDb().query(
    `SELECT 1 FROM public.agency_kol_accounts
      WHERE agency_id = $1 AND kol_account_id = $2
      LIMIT 1`,
    [agencyId, kolDirectoryId],
  )
  return rows.length > 0
}
