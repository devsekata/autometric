import pool from '@/lib/db'
import { parseFavoriteKey, favoriteKey, type FavoriteRef } from './favorites'

/**
 * Saved Lists — a named filter configuration, and optionally the creators
 * pinned under it.
 *
 * See migrations/052. This replaces two independent `useSavedLists` hooks that
 * each kept their own array in `localStorage`: one in `DiscoverDirectoryView`
 * (Tracked Accounts) and one in `KolDirectoryPage` (Creator Database). Same
 * feature, two implementations, neither surviving a cleared cache.
 *
 * ── Why `scope` ─────────────────────────────────────────────────────────────
 * Those two directories filter different things with different field names. A
 * list saved over the Creator Database carries `{ categories, tiers, follMin,
 * … }`; one saved over Tracked Accounts carries the account filters. Applying
 * either to the other would silently do nothing, so the column keeps them in
 * separate namespaces — including for the unique name index, so "Q3" can exist
 * once on each side.
 *
 * `filters` stays JSONB. It is a snapshot of a UI shape that gains a field
 * whenever a filter is added, it is never queried by its contents, and the
 * reading component already tolerates missing keys — a list saved before a
 * filter existed simply does not mention it.
 */

export type SavedListScope = 'database' | 'tracked'

export const SAVED_LIST_SCOPES: SavedListScope[] = ['database', 'tracked']

export interface SavedListRow {
  id: string
  scope: SavedListScope
  name: string
  description: string | null
  /** Opaque here; shaped by whichever directory saved it. */
  filters: Record<string, unknown>
  /** Creators explicitly pinned into this list, as client keys. Empty is normal. */
  items: string[]
  createdAt: string
  updatedAt: string
}

const MAX_NAME = 80

/** Trimmed and length-checked, matching the CHECK constraint on the column. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  return name.length >= 1 && name.length <= MAX_NAME ? name : null
}

interface DbRow {
  id: string
  scope: SavedListScope
  name: string
  description: string | null
  filters: Record<string, unknown> | null
  created_at: Date | string
  updated_at: Date | string
  items: { s: string; i: string }[] | null
}

const toIso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString()

const shape = (r: DbRow): SavedListRow => ({
  id: r.id,
  scope: r.scope,
  name: r.name,
  description: r.description,
  filters: r.filters ?? {},
  items: (r.items ?? []).map(x => favoriteKey({ source: x.s as FavoriteRef['source'], id: x.i })),
  createdAt: toIso(r.created_at),
  updatedAt: toIso(r.updated_at),
})

/**
 * Members are folded in as JSON by the same query rather than fetched per list.
 * A user with twelve lists would otherwise cost thirteen round trips to a cloud
 * database on every page load.
 */
const SELECT = `
  SELECT l.id, l.scope, l.name, l.description, l.filters, l.created_at, l.updated_at,
         COALESCE(
           (SELECT json_agg(json_build_object('s', i.target_source, 'i', i.target_id)
                            ORDER BY i.created_at)
              FROM public.discover_saved_list_items i
             WHERE i.saved_list_id = l.id),
           '[]'::json
         ) AS items
    FROM public.discover_saved_lists l`

export async function listSavedLists(
  orgId: string, userId: string, scope: SavedListScope,
): Promise<SavedListRow[]> {
  const { rows } = await pool.query<DbRow>(
    `${SELECT}
      WHERE l.organization_id = $1 AND l.user_id = $2 AND l.scope = $3
      ORDER BY l.updated_at DESC`,
    [orgId, userId, scope],
  )
  return rows.map(shape)
}

/**
 * Creates the list, or overwrites the one already holding that name.
 *
 * Saving over a name is an update rather than a second list, because that is
 * what the reader means by it — the old localStorage hooks did the same thing by
 * replacing the array entry. `updated_at` moves so the menu re-sorts.
 */
export async function saveList(
  orgId: string,
  userId: string,
  input: { scope: SavedListScope; name: string; description?: string | null; filters: unknown },
): Promise<SavedListRow> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.discover_saved_lists
       (organization_id, user_id, scope, name, description, filters)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (organization_id, user_id, scope, LOWER(btrim(name)))
     DO UPDATE SET name        = EXCLUDED.name,
                   description = EXCLUDED.description,
                   filters     = EXCLUDED.filters,
                   updated_at  = now()
     RETURNING id`,
    [orgId, userId, input.scope, input.name, input.description ?? null,
     JSON.stringify(input.filters ?? {})],
  )
  const saved = await getSavedList(orgId, userId, rows[0].id)
  if (!saved) throw new Error('saved list vanished immediately after write')
  return saved
}

export async function getSavedList(
  orgId: string, userId: string, listId: string,
): Promise<SavedListRow | null> {
  const { rows } = await pool.query<DbRow>(
    `${SELECT} WHERE l.id = $1 AND l.organization_id = $2 AND l.user_id = $3`,
    [listId, orgId, userId],
  )
  return rows[0] ? shape(rows[0]) : null
}

/**
 * Renames a list and/or replaces its filters. Fields left undefined keep their
 * stored value — a rename must not wipe the filters it was saved with.
 *
 * Ownership is part of the WHERE rather than checked first, so another org's
 * list id simply matches nothing instead of being readable in the meantime.
 */
export async function updateSavedList(
  orgId: string,
  userId: string,
  listId: string,
  patch: { name?: string; description?: string | null; filters?: unknown },
): Promise<SavedListRow | null> {
  const { rowCount } = await pool.query(
    `UPDATE public.discover_saved_lists
        SET name        = COALESCE($4, name),
            description = CASE WHEN $5::boolean THEN $6 ELSE description END,
            filters     = COALESCE($7::jsonb, filters),
            updated_at  = now()
      WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [listId, orgId, userId,
     patch.name ?? null,
     patch.description !== undefined,
     patch.description ?? null,
     patch.filters === undefined ? null : JSON.stringify(patch.filters)],
  )
  if (!rowCount) return null
  return getSavedList(orgId, userId, listId)
}

export async function deleteSavedList(
  orgId: string, userId: string, listId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM public.discover_saved_lists
      WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [listId, orgId, userId],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Adds or removes one creator from a list.
 *
 * The ownership check is a subquery on the insert rather than a prior SELECT:
 * it keeps the write to a single statement, and a list id belonging to someone
 * else inserts nothing instead of erroring, which is the same answer the reader
 * would get from a list that does not exist.
 */
export async function setListMembership(
  orgId: string,
  userId: string,
  listId: string,
  key: string,
  member: boolean,
): Promise<SavedListRow | null> {
  const ref = parseFavoriteKey(key)
  if (!ref) return null

  if (member) {
    await pool.query(
      `INSERT INTO public.discover_saved_list_items (saved_list_id, target_source, target_id)
       SELECT l.id, $2, $3
         FROM public.discover_saved_lists l
        WHERE l.id = $1 AND l.organization_id = $4 AND l.user_id = $5
       ON CONFLICT (saved_list_id, target_source, target_id) DO NOTHING`,
      [listId, ref.source, ref.id, orgId, userId],
    )
  } else {
    await pool.query(
      `DELETE FROM public.discover_saved_list_items i
        USING public.discover_saved_lists l
       WHERE i.saved_list_id = l.id
         AND l.id = $1 AND l.organization_id = $4 AND l.user_id = $5
         AND i.target_source = $2 AND i.target_id = $3`,
      [listId, ref.source, ref.id, orgId, userId],
    )
  }
  return getSavedList(orgId, userId, listId)
}

/**
 * Adopts lists that only ever lived in `localStorage`.
 *
 * Runs once per browser, per scope, on the first load after the move. Names
 * already taken on the server win: the stored copy is the one the user has been
 * editing since, and a stale browser replaying an old array must not overwrite
 * it. Returns how many were genuinely new.
 */
export async function importSavedLists(
  orgId: string,
  userId: string,
  scope: SavedListScope,
  lists: { name: string; filters: unknown }[],
): Promise<{ imported: number }> {
  let imported = 0
  for (const raw of lists) {
    const name = normalizeName(raw?.name)
    if (!name) continue
    const { rowCount } = await pool.query(
      `INSERT INTO public.discover_saved_lists
         (organization_id, user_id, scope, name, filters)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (organization_id, user_id, scope, LOWER(btrim(name))) DO NOTHING`,
      [orgId, userId, scope, name, JSON.stringify(raw?.filters ?? {})],
    )
    imported += rowCount ?? 0
  }
  return { imported }
}
