import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { addFavorite, listFavoriteIds } from '@/lib/discover/favorites'
import { isUuid } from '@/lib/discover/myCreators'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/favorites
 *
 * The signed-in user's favorite creators in this agency, newest first, as
 * Creator Database ids. The user comes from the session and the agency from
 * the URL; both are checked against `agency_members` before anything is read.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const ids = await listFavoriteIds(access.orgId, access.userId)
    return NextResponse.json({ ids })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/favorites]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * POST /api/organizations/[id]/discover/favorites   { kolId }
 *
 * Favorites a Creator Database row for the signed-in user. Favoriting one that
 * is already a favorite answers 200 with `created: false`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({})) as { kolId?: unknown }
    if (!isUuid(body.kolId)) return NextResponse.json({ error: 'kolId is required.' }, { status: 400 })

    const result = await addFavorite(access.orgId, access.userId, body.kolId)
    if (!result.ok) return NextResponse.json({ error: 'Creator not found.' }, { status: 404 })
    return NextResponse.json({ kolId: body.kolId, created: result.created }, { status: result.created ? 201 : 200 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/favorites]', err)
    return NextResponse.json({ error: 'The favorite could not be saved.' }, { status: 500 })
  }
}
