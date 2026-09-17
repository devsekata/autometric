import kolDb, { kolDbWrite } from '@/lib/kolDb'

/**
 * Favorite creators — `public.agency_kol_favorites` on the KOL server
 * (migration `migrations/kol/004`).
 *
 * A favorite belongs to one user inside one agency. Every function takes an
 * agency id and a user id the caller has already authorised
 * (`requireOrgMemberById`): the agency is the org in the URL, the user is the
 * session's, never values the browser supplies.
 */

/** Ids of the active Creator Database rows this user has favorited in this agency. */
export async function listFavoriteIds(agencyId: string, userId: string): Promise<string[]> {
  const { rows } = await kolDb().query<{ id: string }>(
    `SELECT f.kol_account_id::text AS id
       FROM public.agency_kol_favorites f
       JOIN public.kol_directory kd ON kd.id = f.kol_account_id AND kd.directory_status = 'active'
      WHERE f.agency_id = $1 AND f.user_id = $2
      ORDER BY f.created_at DESC`,
    [agencyId, userId],
  )
  return rows.map(r => r.id)
}

export type AddFavoriteResult = { ok: true; created: boolean } | { ok: false; reason: 'not_found' }

/** Idempotent: favoriting a creator twice answers `created: false`. */
export async function addFavorite(agencyId: string, userId: string, kolId: string): Promise<AddFavoriteResult> {
  const { rows } = await kolDbWrite().query<{ id: string }>(
    `INSERT INTO public.agency_kol_favorites (agency_id, user_id, kol_account_id)
     SELECT $1, $2, kd.id
       FROM public.kol_directory kd
      WHERE kd.id = $3 AND kd.directory_status = 'active'
     ON CONFLICT (agency_id, user_id, kol_account_id) DO NOTHING
     RETURNING id`,
    [agencyId, userId, kolId],
  )
  if (rows.length) return { ok: true, created: true }

  // Nothing inserted: either it was already a favorite, or the creator is not
  // an active Creator Database row.
  const { rows: exists } = await kolDb().query(
    `SELECT 1 FROM public.kol_directory WHERE id = $1 AND directory_status = 'active'`,
    [kolId],
  )
  return exists.length ? { ok: true, created: false } : { ok: false, reason: 'not_found' }
}

/** Returns false when the creator was not a favorite of this user in this agency. */
export async function removeFavorite(agencyId: string, userId: string, kolId: string): Promise<boolean> {
  const { rowCount } = await kolDbWrite().query(
    `DELETE FROM public.agency_kol_favorites
      WHERE agency_id = $1 AND user_id = $2 AND kol_account_id = $3`,
    [agencyId, userId, kolId],
  )
  return (rowCount ?? 0) > 0
}
