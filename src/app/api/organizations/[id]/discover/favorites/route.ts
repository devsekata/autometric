import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  FAVORITE_SOURCES, importFavorites, listFavorites, parseFavoriteKey, toggleFavorite,
  type FavoriteSource,
} from '@/lib/discover/favorites'

type Params = { params: Promise<{ id: string }> }

/**
 * Discovery favourites for the signed-in user in one org.
 *
 * Favourites used to live only in `localStorage`, so they died with a cleared
 * cache and never followed the user to a second device. They are personal
 * rather than org-wide — see the note on `@/lib/discover/favorites` — so every
 * handler here scopes by `access.userId` as well as by org.
 */

/** GET — every favourite as a client key (`<id>` or `roster:<id>`). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    return NextResponse.json({ keys: await listFavorites(orgId, access.userId) })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/favorites]', err)
    return NextResponse.json({ error: 'Unable to load favorites.' }, { status: 500 })
  }
}

/**
 * POST — toggle one creator, or adopt a browser's leftover set.
 *
 *   { source, id }        toggle that creator
 *   { import: string[] }  adopt localStorage keys (additive, never deletes)
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)

    if (Array.isArray(body?.import)) {
      // Capped: this is a one-shot migration of a browser's own list, not a
      // bulk-import endpoint, and the array arrives from client storage.
      const keys = body.import.filter((k: unknown): k is string => typeof k === 'string').slice(0, 500)
      const { imported } = await importFavorites(orgId, access.userId, keys)
      return NextResponse.json({ imported, keys: await listFavorites(orgId, access.userId) })
    }

    // Accepts either the split form or the client key the cards already hold,
    // so a caller does not have to take the prefix apart to send it.
    const ref = typeof body?.key === 'string'
      ? parseFavoriteKey(body.key)
      : (FAVORITE_SOURCES.includes(body?.source as FavoriteSource) && typeof body?.id === 'string'
          ? parseFavoriteKey(body.source === 'roster' ? `roster:${body.id}` : body.id)
          : null)

    if (!ref) {
      return NextResponse.json(
        { error: 'A creator key, or source (account|roster) and a UUID id, is required.' },
        { status: 400 },
      )
    }

    const result = await toggleFavorite(orgId, access.userId, ref)
    return NextResponse.json({ ...result, keys: await listFavorites(orgId, access.userId) })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/favorites]', err)
    return NextResponse.json({ error: 'Unable to update favorite.' }, { status: 500 })
  }
}
