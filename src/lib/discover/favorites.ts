import pool from '@/lib/db'

/**
 * Discovery favourites — the creators a user has starred to come back to.
 *
 * See migrations/052. A favourite is personal, so it is keyed by
 * (organization, user) rather than by organization alone: five people sharing
 * one org would otherwise share one shortlist, and "my favourites" would mean
 * "everybody's favourites".
 *
 * Favourite is deliberately not Compare and not Cart. Compare is a working set
 * for one sitting and Cart is a purchase in progress — both stay in the browser
 * where they belong. This is the one that has to survive a new laptop, so it
 * lives here.
 *
 * ── Two id spaces ───────────────────────────────────────────────────────────
 * A Discovery card is either an account this org tracks in the warehouse or a
 * row from the commercial KOL roster, which is a different Postgres server
 * entirely (see `@/lib/kolDb`). Both ids are UUIDs, neither can be told from the
 * other by shape, and only one of them can carry a foreign key. So `source`
 * travels beside the id — the same `account` / `roster` split the client already
 * encodes as a `roster:` key prefix in `useDiscoverSelection`.
 */

export type FavoriteSource = 'account' | 'roster'

export interface FavoriteRef {
  source: FavoriteSource
  /** The creator's id in whichever database `source` names. */
  id: string
}

export const FAVORITE_SOURCES: FavoriteSource[] = ['account', 'roster']

/**
 * The client's storage key for a favourite: a bare id for a tracked account,
 * `roster:<id>` for a commercial-roster creator.
 *
 * Kept identical to `selectionKey` in `@/components/discover/useDiscoverSelection`
 * so a set read from this API drops straight into the same `Set<string>` the
 * cards already test against, and so favourites saved to localStorage before
 * this table existed can be migrated across without rewriting their keys.
 */
export const favoriteKey = (ref: FavoriteRef): string =>
  ref.source === 'roster' ? `roster:${ref.id}` : ref.id

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parses a client key back into a reference, or null when it is not one.
 *
 * The id is shape-checked because it goes into a `uuid` column: a malformed
 * value would abort the statement rather than simply match nothing, which turns
 * one bad localStorage entry into a failed migration of the whole set.
 */
export function parseFavoriteKey(key: string): FavoriteRef | null {
  if (typeof key !== 'string') return null
  const roster = key.startsWith('roster:')
  const id = roster ? key.slice('roster:'.length) : key
  if (!UUID.test(id)) return null
  return { source: roster ? 'roster' : 'account', id }
}

/** Every favourite this user holds in this org, newest first, as client keys. */
export async function listFavorites(orgId: string, userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ target_source: FavoriteSource; target_id: string }>(
    `SELECT target_source, target_id
       FROM public.discover_favorites
      WHERE organization_id = $1 AND user_id = $2
      ORDER BY created_at DESC`,
    [orgId, userId],
  )
  return rows.map(r => favoriteKey({ source: r.target_source, id: r.target_id }))
}

/** Idempotent — starring an already-starred creator is a no-op, not an error. */
export async function addFavorite(orgId: string, userId: string, ref: FavoriteRef): Promise<void> {
  await pool.query(
    `INSERT INTO public.discover_favorites (organization_id, user_id, target_source, target_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, user_id, target_source, target_id) DO NOTHING`,
    [orgId, userId, ref.source, ref.id],
  )
}

export async function removeFavorite(orgId: string, userId: string, ref: FavoriteRef): Promise<void> {
  await pool.query(
    `DELETE FROM public.discover_favorites
      WHERE organization_id = $1 AND user_id = $2 AND target_source = $3 AND target_id = $4`,
    [orgId, userId, ref.source, ref.id],
  )
}

/**
 * Toggle behind the heart button. Returns the resulting state so the card can
 * settle on the server's answer without refetching the whole set.
 */
export async function toggleFavorite(
  orgId: string, userId: string, ref: FavoriteRef,
): Promise<{ favorited: boolean }> {
  const { rowCount } = await pool.query(
    `DELETE FROM public.discover_favorites
      WHERE organization_id = $1 AND user_id = $2 AND target_source = $3 AND target_id = $4`,
    [orgId, userId, ref.source, ref.id],
  )
  if (rowCount && rowCount > 0) return { favorited: false }
  await addFavorite(orgId, userId, ref)
  return { favorited: true }
}

/**
 * Adopts a set of client keys that were only ever in localStorage.
 *
 * Called once per browser by the hook, on the first load after favourites moved
 * to the server. Additive on purpose: it never deletes, so a stale second
 * browser replaying its own old set cannot un-favourite what the user has since
 * starred somewhere else. Unparseable keys are skipped rather than failing the
 * batch — one corrupt entry should not cost the user the rest of their list.
 *
 * Returns how many rows were actually new, which is what the hook logs.
 */
export async function importFavorites(
  orgId: string, userId: string, keys: string[],
): Promise<{ imported: number }> {
  const refs = keys.map(parseFavoriteKey).filter((r): r is FavoriteRef => r !== null)
  if (!refs.length) return { imported: 0 }

  // One statement rather than a loop: this runs on page load and each row is a
  // round trip to a cloud database.
  const { rowCount } = await pool.query(
    `INSERT INTO public.discover_favorites (organization_id, user_id, target_source, target_id)
     SELECT $1, $2, s.source, s.id::uuid
       FROM UNNEST($3::text[], $4::text[]) AS s(source, id)
     ON CONFLICT (organization_id, user_id, target_source, target_id) DO NOTHING`,
    [orgId, userId, refs.map(r => r.source), refs.map(r => r.id)],
  )
  return { imported: rowCount ?? 0 }
}
