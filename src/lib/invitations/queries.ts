import pool from '@/lib/db'
import type { Invitation } from './types'

export async function getPendingInvitationsForUser(userId: string): Promise<Invitation[]> {
  const { rows } = await pool.query<Invitation>(
    `SELECT
       om.id,
       o.id         AS org_id,
       o.slug       AS org_slug,
       o.name       AS org_name,
       u.name       AS invited_by,
       om.invited_at,
       (
         SELECT COUNT(*)::int
         FROM organization_members
         WHERE organization_id = o.id AND status = 'ACTIVE'
       ) AS member_count
     FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id
     LEFT JOIN users u ON u.id = om.invited_by
     WHERE om.user_id = $1 AND om.status = 'PENDING'
     ORDER BY om.invited_at DESC`,
    [userId]
  )
  return rows
}

export async function acceptInvitation(
  memberId: string,
  userId: string
): Promise<{ ok: boolean; org_slug?: string }> {
  const { rows } = await pool.query<{ org_slug: string }>(
    `UPDATE organization_members om
     SET status = 'ACTIVE', joined_at = NOW()
     FROM organizations o
     WHERE om.id = $1
       AND om.user_id = $2
       AND om.status = 'PENDING'
       AND o.id = om.organization_id
     RETURNING o.slug AS org_slug`,
    [memberId, userId]
  )
  if (!rows[0]) return { ok: false }
  return { ok: true, org_slug: rows[0].org_slug }
}

export async function declineInvitation(
  memberId: string,
  userId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE organization_members
     SET status = 'CANCELLED'
     WHERE id = $1 AND user_id = $2 AND status = 'PENDING'`,
    [memberId, userId]
  )
  return (rowCount ?? 0) > 0
}
