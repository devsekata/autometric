import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  SAVED_LIST_SCOPES, importSavedLists, listSavedLists, normalizeName, saveList,
  type SavedListScope,
} from '@/lib/discover/savedLists'

type Params = { params: Promise<{ id: string }> }

/**
 * Saved Lists for the signed-in user in one org.
 *
 * `?scope=database` is the Creator Database's lists, `?scope=tracked` is Tracked
 * Accounts'. The two directories filter different things with different field
 * names, so their lists are separate namespaces rather than one pile — see the
 * note on `@/lib/discover/savedLists`.
 */

function scopeOf(raw: string | null): SavedListScope | null {
  return SAVED_LIST_SCOPES.includes(raw as SavedListScope) ? (raw as SavedListScope) : null
}

/** GET ?scope=database|tracked */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    // Defaulted rather than rejected: `scope` was added with this endpoint, and
    // the Creator Database is where saved lists started.
    const scope = scopeOf(req.nextUrl.searchParams.get('scope')) ?? 'database'
    return NextResponse.json({ lists: await listSavedLists(orgId, access.userId, scope) })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/saved-lists]', err)
    return NextResponse.json({ error: 'Unable to load saved lists.' }, { status: 500 })
  }
}

/**
 * POST — save a list, or adopt a browser's leftover ones.
 *
 *   { scope, name, description?, filters }  create, or overwrite that name
 *   { scope, import: [{ name, filters }] }  adopt localStorage lists
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const scope = scopeOf(body?.scope) ?? 'database'

    if (Array.isArray(body?.import)) {
      const lists = body.import
        .filter((l: unknown): l is { name: string; filters: unknown } =>
          !!l && typeof l === 'object' && typeof (l as { name?: unknown }).name === 'string')
        .slice(0, 100)
      const { imported } = await importSavedLists(orgId, access.userId, scope, lists)
      return NextResponse.json({ imported, lists: await listSavedLists(orgId, access.userId, scope) })
    }

    const name = normalizeName(body?.name)
    if (!name) {
      return NextResponse.json({ error: 'A list name of 1–80 characters is required.' }, { status: 400 })
    }

    const saved = await saveList(orgId, access.userId, {
      scope,
      name,
      description: typeof body?.description === 'string' ? body.description.trim() || null : null,
      filters: body?.filters ?? {},
    })
    return NextResponse.json({ list: saved, lists: await listSavedLists(orgId, access.userId, scope) })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/saved-lists]', err)
    return NextResponse.json({ error: 'Unable to save list.' }, { status: 500 })
  }
}
