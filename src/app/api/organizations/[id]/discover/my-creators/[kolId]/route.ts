import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { isUuid, removeMyCreator } from '@/lib/discover/myCreators'

type Params = { params: Promise<{ id: string; kolId: string }> }

/**
 * DELETE /api/organizations/[id]/discover/my-creators/[kolId]
 *
 * Takes the creator out of this agency's My Creators (the link is deactivated,
 * not deleted — see `myCreators.ts`). The creator stays in the Creator
 * Database. Any active member of the agency may remove.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, kolId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!isUuid(kolId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const removed = await removeMyCreator(access.orgId, kolId)
    if (!removed) return NextResponse.json({ error: 'This creator is not in My Creators.' }, { status: 404 })
    return NextResponse.json({ kolId, removed: true })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/discover/my-creators/[kolId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
