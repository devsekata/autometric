import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { removeFavorite } from '@/lib/discover/favorites'
import { isUuid } from '@/lib/discover/myCreators'

type Params = { params: Promise<{ id: string; kolId: string }> }

/**
 * DELETE /api/organizations/[id]/discover/favorites/[kolId]
 *
 * Removes the creator from the signed-in user's favorites in this agency. Only
 * the user's own row can match: the query is keyed on the session user.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, kolId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!isUuid(kolId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const removed = await removeFavorite(access.orgId, access.userId, kolId)
    if (!removed) return NextResponse.json({ error: 'This creator is not a favorite.' }, { status: 404 })
    return NextResponse.json({ kolId, removed: true })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/discover/favorites/[kolId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
