import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { addMyCreator, isUuid, myCreatorIdsAmong } from '@/lib/discover/myCreators'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/my-creators?ids=a,b,c
 *
 * Which of these Creator Database ids are in this agency's My Creators — what a
 * page of cards needs to draw its add/remove toggle. The list itself is
 * `/discover/kol-directory?scope=mine`, which reuses the directory's filters.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const ids = (req.nextUrl.searchParams.get('ids') || '')
      .split(',').map(v => v.trim()).filter(isUuid).slice(0, 100)
    const inMine = await myCreatorIdsAmong(access.orgId, ids)
    return NextResponse.json({ ids: [...inMine] })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/my-creators]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * POST /api/organizations/[id]/discover/my-creators   { kolId }
 *
 * Adds a Creator Database row to this agency's My Creators. Any active member
 * of the agency may add. Adding one that is already there answers 200 with
 * `created: false`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({})) as { kolId?: unknown }
    if (!isUuid(body.kolId)) return NextResponse.json({ error: 'kolId is required.' }, { status: 400 })

    const result = await addMyCreator(access.orgId, body.kolId, access.userId)
    if (!result.ok) return NextResponse.json({ error: 'Creator not found.' }, { status: 404 })
    return NextResponse.json({ kolId: body.kolId, created: result.created }, { status: result.created ? 201 : 200 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/my-creators]', err)
    return NextResponse.json({ error: 'The creator could not be added.' }, { status: 500 })
  }
}
