import pool from '@/lib/db'

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
  const { rows } = await pool.query<OrgMember>(
    `SELECT
       om.id,
       om.user_id,
       om.email,
       u.name,
       u.avatar_url,
       om.role,
       om.status,
       om.joined_at,
       om.invited_at
     FROM organization_members om
     LEFT JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1
       AND om.status IN ('ACTIVE', 'PENDING')
     ORDER BY
       CASE om.role WHEN 'ADMIN' THEN 1 ELSE 2 END,
       om.invited_at ASC`,
    [orgId]
  )
  return rows
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: 'ADMIN' | 'MEMBER',
  invitedBy: string
): Promise<{ ok: boolean; error?: string; member?: OrgMember }> {
  const { rows: existing } = await pool.query(
    `SELECT id FROM organization_members
     WHERE organization_id = $1 AND email = $2`,
    [orgId, email]
  )
  if (existing.length > 0) {
    return { ok: false, error: 'This email is already a member or has a pending invitation.' }
  }

  const { rows: users } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email]
  )
  const userId = users[0]?.id ?? null

  const { rows } = await pool.query<OrgMember>(
    `INSERT INTO organization_members
       (organization_id, user_id, email, role, status, invited_by, joined_at)
     VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
     RETURNING id, user_id, email, role, status, joined_at, invited_at`,
    [orgId, userId, email, role, invitedBy, userId ? new Date() : null]
  )

  const member: OrgMember = { ...rows[0], name: null, avatar_url: null }
  return { ok: true, member }
}

export async function removeMember(memberId: string, orgId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM organization_members
     WHERE id = $1 AND organization_id = $2`,
    [memberId, orgId]
  )
  return (rowCount ?? 0) > 0
}

export async function updateMemberRole(
  memberId: string,
  orgId: string,
  role: 'ADMIN' | 'MEMBER'
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE organization_members
     SET role = $1
     WHERE id = $2 AND organization_id = $3`,
    [role, memberId, orgId]
  )
  return (rowCount ?? 0) > 0
}
