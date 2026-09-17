import kolDb, { kolDbWrite } from '@/lib/kolDb'

/**
 * Saved Lists — named Creator Database filter sets, in
 * `public.agency_kol_saved_filters` on the KOL server (migration
 * `migrations/kol/005`).
 *
 * A list belongs to one user inside one agency. Every function takes an agency
 * id and a user id the caller has already authorised (`requireOrgMemberById`).
 */

export interface SavedFilter {
  id: string
  name: string
  /** The page's `KolFilters` object as it was saved; merged over the defaults when applied. */
  filters: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export const SAVED_FILTER_NAME_MAX = 80
/** Guards against a client posting something that is not a filter set. */
const FILTERS_MAX_BYTES = 8_000
/** A user keeps this many lists per agency at most. */
export const SAVED_FILTERS_MAX = 100

type Row = { id: string; name: string; filters: Record<string, unknown>; created_at: Date; updated_at: Date }
const toSaved = (r: Row): SavedFilter => ({
  id: r.id,
  name: r.name,
  filters: r.filters,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
})

/**
 * The shape a filter set may have: a flat object whose values are strings,
 * finite numbers, booleans, null, or arrays of strings. That is every value
 * `KolFilters` holds; anything else is rejected rather than stored.
 */
export function validateFilters(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) return null
    const ok = v === null
      || typeof v === 'string' || typeof v === 'boolean'
      || (typeof v === 'number' && Number.isFinite(v))
      || (Array.isArray(v) && v.every(x => typeof x === 'string'))
    if (!ok) return null
    out[k] = v
  }
  return JSON.stringify(out).length <= FILTERS_MAX_BYTES ? out : null
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  return name.length >= 1 && name.length <= SAVED_FILTER_NAME_MAX ? name : null
}

export async function listSavedFilters(agencyId: string, userId: string): Promise<SavedFilter[]> {
  const { rows } = await kolDb().query<Row>(
    `SELECT id, name, filters, created_at, updated_at
       FROM public.agency_kol_saved_filters
      WHERE agency_id = $1 AND user_id = $2
      ORDER BY updated_at DESC`,
    [agencyId, userId],
  )
  return rows.map(toSaved)
}

export type SaveFilterResult =
  | { ok: true; list: SavedFilter; created: boolean }
  | { ok: false; reason: 'limit' }

/**
 * Saves under `name`. A list with the same name (case- and space-insensitive)
 * is updated in place rather than duplicated.
 */
export async function saveFilter(
  agencyId: string, userId: string, name: string, filters: Record<string, unknown>,
): Promise<SaveFilterResult> {
  const { rows } = await kolDbWrite().query<Row & { created: boolean }>(
    `INSERT INTO public.agency_kol_saved_filters (agency_id, user_id, name, filters)
     SELECT $1, $2, $3, $4::jsonb
      WHERE (SELECT count(*) FROM public.agency_kol_saved_filters
              WHERE agency_id = $1 AND user_id = $2) < $5
         OR EXISTS (SELECT 1 FROM public.agency_kol_saved_filters
                     WHERE agency_id = $1 AND user_id = $2
                       AND lower(btrim(name)) = lower(btrim($3)))
     ON CONFLICT (agency_id, user_id, (lower(btrim(name))))
     DO UPDATE SET name = EXCLUDED.name, filters = EXCLUDED.filters, updated_at = now()
     RETURNING id, name, filters, created_at, updated_at, (xmax = 0) AS created`,
    [agencyId, userId, name, JSON.stringify(filters), SAVED_FILTERS_MAX],
  )
  if (!rows[0]) return { ok: false, reason: 'limit' }
  return { ok: true, list: toSaved(rows[0]), created: rows[0].created }
}

/** Returns false when no such list belongs to this user in this agency. */
export async function deleteSavedFilter(agencyId: string, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await kolDbWrite().query(
    `DELETE FROM public.agency_kol_saved_filters
      WHERE id = $1 AND agency_id = $2 AND user_id = $3`,
    [id, agencyId, userId],
  )
  return (rowCount ?? 0) > 0
}
