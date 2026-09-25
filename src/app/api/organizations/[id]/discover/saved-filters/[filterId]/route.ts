import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { deleteSavedFilter } from '@/lib/discover/savedFilters'
import { isUuid } from '@/lib/discover/myCreators'

type Params = { params: Promise<{ id: string; filterId: string }> }

/**
 * DELETE /api/organizations/[id]/discover/saved-filters/[filterId]
 *
 * Deletes one of the signed-in user's Saved Lists in this agency. A list that
 * belongs to someone else, or to another agency, answers 404.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, filterId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!isUuid(filterId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const removed = await deleteSavedFilter(access.orgId, access.userId, filterId)
    if (!removed) return NextResponse.json({ error: 'Saved list not found.' }, { status: 404 })
    return NextResponse.json({ id: filterId, removed: true })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/discover/saved-filters/[filterId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
