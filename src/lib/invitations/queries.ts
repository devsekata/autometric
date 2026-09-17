import kolDb, { kolDbWrite } from '@/lib/kolDb'
import type { Invitation } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getPendingInvitationsForUser(userId: string): Promise<Invitation[]> {
  // Signed-out renders pass ''; the column is a uuid, so answer "none" instead of a query error.
  if (!UUID_RE.test(userId)) return []
  const { rows } = await kolDb().query<Invitation>(
    `SELECT
       am.id,
       o.id         AS org_id,
       o.slug       AS org_slug,
       o.name       AS org_name,
       u.name       AS invited_by,
       COALESCE(am.invited_at, am.created_at) AS invited_at,
       (
         SELECT COUNT(*)::int
         FROM public.agency_members
         WHERE agency_id = o.id AND status = 'ACTIVE'
       ) AS member_count
     FROM public.agency_members am
     JOIN public.agencies o ON o.id = am.agency_id AND o.deleted_at IS NULL
     LEFT JOIN public.user u ON u.id = am.invited_by
     WHERE am.user_id = $1 AND am.status = 'PENDING'
     ORDER BY COALESCE(am.invited_at, am.created_at) DESC`,
    [userId]
  )
  return rows
}

export async function acceptInvitation(
  memberId: string,
  userId: string
): Promise<{ ok: boolean; org_slug?: string }> {
  const { rows } = await kolDbWrite().query<{ org_slug: string }>(
    `UPDATE public.agency_members om
     SET status = 'ACTIVE', joined_at = NOW(), updated_at = NOW()
     FROM public.agencies o
     WHERE om.id = $1
       AND om.user_id = $2
       AND om.status = 'PENDING'
       AND o.id = om.agency_id
       AND o.deleted_at IS NULL
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
  const { rowCount } = await kolDbWrite().query(
    `UPDATE public.agency_members
     SET status = 'CANCELLED', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'PENDING'`,
    [memberId, userId]
  )
  return (rowCount ?? 0) > 0
}
