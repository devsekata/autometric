import kolDb, { kolDbWrite } from '@/lib/kolDb'

export interface OrgMember {
  id: string
  user_id: string | null
  email: string
  name: string | null
  avatar_url: string | null
  role: 'ADMIN' | 'MEMBER'
  status: 'ACTIVE' | 'PENDING'
  joined_at: string | null
  invited_at: string
}

export async function getMembersByOrgId(orgId: string): Promise<OrgMember[]> {
  const { rows } = await kolDb().query<OrgMember>(
    `SELECT
       am.id,
       am.user_id,
       u.email,
       u.name,
       u.avatar_url,
       am.role,
       am.status,
       am.joined_at,
       COALESCE(am.invited_at, am.created_at) AS invited_at
     FROM public.agency_members am
     JOIN public.user u ON u.id = am.user_id
     WHERE am.agency_id = $1
       AND am.status IN ('ACTIVE', 'PENDING')
     ORDER BY
       CASE am.role WHEN 'ADMIN' THEN 1 ELSE 2 END,
       COALESCE(am.invited_at, am.created_at) ASC`,
    [orgId]
  )
  return rows
}

/**
 * Invitations are switched off until the owner decides how the KOL database
 * stores them (DEC-11 L1): `agency_members.user_id` is NOT NULL and the table
 * has no email column, so an invite to an address without an account has
 * nowhere to live. The old body wrote `organization_members` on the analytics
 * warehouse, which the KOL product must never write to.
 */
export async function inviteMember(
  _orgId: string,
  _email: string,
  _role: 'ADMIN' | 'MEMBER',
  _invitedBy: string
): Promise<{ ok: boolean; error?: string; member?: OrgMember }> {
  return { ok: false, error: 'Inviting members is not available yet.' }
}

export async function removeMember(memberId: string, orgId: string): Promise<boolean> {
  const { rowCount } = await kolDbWrite().query(
    `DELETE FROM public.agency_members
     WHERE id = $1 AND agency_id = $2`,
    [memberId, orgId]
  )
  return (rowCount ?? 0) > 0
}

export async function updateMemberRole(
  memberId: string,
  orgId: string,
  role: 'ADMIN' | 'MEMBER'
): Promise<boolean> {
  const { rowCount } = await kolDbWrite().query(
    `UPDATE public.agency_members
     SET role = $1, updated_at = NOW()
     WHERE id = $2 AND agency_id = $3`,
    [role, memberId, orgId]
  )
  return (rowCount ?? 0) > 0
}
