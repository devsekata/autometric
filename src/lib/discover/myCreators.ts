import kolDb, { kolDbWrite } from '@/lib/kolDb'

/**
 * My Creators — an agency's own creators, kept entirely on the KOL server.
 *
 * The creator record is `kol_directory`; membership is a row in
 * `agency_kol_accounts` linking the agency to it. Nothing about the creator is
 * copied: listing goes through `listKolDirectory({ agencyId })`, which reads the
 * same cards the Creator Database shows.
 *
 * Every function takes an agency id the caller has already authorised
 * (`requireOrgMemberById`), so one agency can never read or change another's
 * links from here.
 *
 * Removal deactivates the link (`is_active = false`) instead of deleting it:
 * Brand Fit, campaign and report rows hold foreign keys to
 * `agency_kol_accounts.id`, and a delete would either fail on them or erase
 * their history. Adding the creator again reactivates the same row.
 *
 * KOL SCHEMA GAP: `agency_kol_accounts` has no unique constraint on
 * `(agency_id, kol_account_id)`. Until one exists, `addMyCreator` serialises
 * concurrent adds of the same pair with a transaction-scoped advisory lock, so
 * two clicks cannot both insert.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** Which of `ids` this agency currently has in My Creators. */
export async function myCreatorIdsAmong(agencyId: string, ids: string[]): Promise<Set<string>> {
  const clean = ids.filter(isUuid)
  if (!clean.length) return new Set()
  const { rows } = await kolDb().query<{ id: string }>(
    `SELECT DISTINCT a.kol_account_id::text AS id
       FROM public.agency_kol_accounts a
      WHERE a.agency_id = $1
        AND a.kol_account_id = ANY ($2::uuid[])
        AND a.is_active IS TRUE`,
    [agencyId, clean],
  )
  return new Set(rows.map(r => r.id))
}

export type AddMyCreatorResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'not_found' }

/**
 * Link a Creator Database row to the agency. Idempotent: adding a creator the
 * agency already has answers `created: false` rather than inserting again.
 */
export async function addMyCreator(
  agencyId: string, kolId: string, userId: string,
): Promise<AddMyCreatorResult> {
  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    // Serialise every add of this pair; released at COMMIT/ROLLBACK.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`my-creators:${agencyId}:${kolId}`])

    const { rows: kd } = await client.query<{ platform_id: string | null }>(
      `SELECT platform_id FROM public.kol_directory
        WHERE id = $1 AND directory_status = 'active'`,
      [kolId],
    )
    if (!kd[0]) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'not_found' }
    }

    const { rows: links } = await client.query<{ id: string; is_active: boolean | null }>(
      `SELECT id, is_active FROM public.agency_kol_accounts
        WHERE agency_id = $1 AND kol_account_id = $2
        ORDER BY is_active IS TRUE DESC, created_at ASC NULLS LAST
        LIMIT 1`,
      [agencyId, kolId],
    )

    let created = false
    if (!links[0]) {
      await client.query(
        `INSERT INTO public.agency_kol_accounts
           (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', true, $4, now(), now())`,
        [agencyId, kolId, kd[0].platform_id, userId],
      )
      created = true
    } else if (links[0].is_active !== true) {
      await client.query(
        `UPDATE public.agency_kol_accounts
            SET is_active = true, status = 'active', updated_at = now()
          WHERE id = $1`,
        [links[0].id],
      )
      created = true
    }

    await client.query('COMMIT')
    return { ok: true, created }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Take a creator out of the agency's My Creators. Returns false when it was not in it. */
export async function removeMyCreator(agencyId: string, kolId: string): Promise<boolean> {
  const { rowCount } = await kolDbWrite().query(
    `UPDATE public.agency_kol_accounts
        SET is_active = false, status = 'inactive', updated_at = now()
      WHERE agency_id = $1 AND kol_account_id = $2 AND is_active IS TRUE`,
    [agencyId, kolId],
  )
  return (rowCount ?? 0) > 0
}
