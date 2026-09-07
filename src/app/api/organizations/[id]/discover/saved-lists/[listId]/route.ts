import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  deleteSavedList, getSavedList, normalizeName, setListMembership, updateSavedList,
} from '@/lib/discover/savedLists'

type Params = { params: Promise<{ id: string; listId: string }> }

/**
 * One saved list: read it, rename or re-filter it, change its membership, or
 * delete it.
 *
 * Every operation is scoped to (org, user) inside the query rather than checked
 * first, so another org's list id matches nothing instead of being briefly
 * readable — see `@/lib/discover/savedLists`.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, listId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const list = await getSavedList(orgId, access.userId, listId)
    if (!list) return NextResponse.json({ error: 'List not found.' }, { status: 404 })
    return NextResponse.json({ list })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/saved-lists/[listId]]', err)
    return NextResponse.json({ error: 'Unable to load list.' }, { status: 500 })
  }
}

/**
 * PATCH — rename, replace filters, or add/remove one creator.
 *
 *   { name?, description?, filters? }   update the list itself
 *   { key, member: boolean }            pin or unpin one creator
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, listId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)

    if (typeof body?.key === 'string' && typeof body?.member === 'boolean') {
      const list = await setListMembership(orgId, access.userId, listId, body.key, body.member)
      if (!list) return NextResponse.json({ error: 'List not found.' }, { status: 404 })
      return NextResponse.json({ list })
    }

    // `name` is only validated when it is being changed — an update that only
    // replaces filters must not be rejected for not resending the name.
    let name: string | undefined
    if (body?.name !== undefined) {
      const clean = normalizeName(body.name)
      if (!clean) return NextResponse.json({ error: 'A list name of 1–80 characters is required.' }, { status: 400 })
      name = clean
    }

    const list = await updateSavedList(orgId, access.userId, listId, {
      name,
      description: body?.description === undefined
        ? undefined
        : (typeof body.description === 'string' ? body.description.trim() || null : null),
      filters: body?.filters,
    })
    if (!list) return NextResponse.json({ error: 'List not found.' }, { status: 404 })
    return NextResponse.json({ list })
  } catch (err) {
    console.error('[PATCH /api/organizations/[id]/discover/saved-lists/[listId]]', err)
    return NextResponse.json({ error: 'Unable to update list.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, listId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const gone = await deleteSavedList(orgId, access.userId, listId)
    if (!gone) return NextResponse.json({ error: 'List not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/discover/saved-lists/[listId]]', err)
    return NextResponse.json({ error: 'Unable to delete list.' }, { status: 500 })
  }
}
