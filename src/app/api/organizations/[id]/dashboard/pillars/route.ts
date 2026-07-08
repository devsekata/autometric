import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getPillarsData, upsertPillar, deletePillar } from '@/lib/dashboard/pillars'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/dashboard/pillars?brand=  → pillars + comparison
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const brandId = req.nextUrl.searchParams.get('brand') || null
    return NextResponse.json(await getPillarsData(orgId, brandId))
  } catch (err) {
    console.error('[GET /api/organizations/[id]/dashboard/pillars]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST  { brandId, name, color, hashtags }  → add / reactivate a pillar
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const brandId = typeof body?.brandId === 'string' ? body.brandId : ''
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const color = typeof body?.color === 'string' ? body.color : '#6c4cd6'
    const hashtags: string[] = Array.isArray(body?.hashtags) ? body.hashtags.filter((x: unknown) => typeof x === 'string') : []
    if (!brandId || !name) return NextResponse.json({ error: 'brandId and name are required.' }, { status: 400 })

    const ok = await upsertPillar(orgId, brandId, name, color, hashtags)
    if (!ok) return NextResponse.json({ error: 'Brand not in this organization.' }, { status: 403 })
    return NextResponse.json(await getPillarsData(orgId, brandId))
  } catch (err) {
    console.error('[POST /api/organizations/[id]/dashboard/pillars]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/organizations/[id]/dashboard/pillars?brand=&id=  → soft-delete a pillar
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const brandId = sp.get('brand') || ''
    const pid = sp.get('id') || ''
    if (!brandId || !pid) return NextResponse.json({ error: 'brand and id are required.' }, { status: 400 })

    await deletePillar(orgId, brandId, pid)
    return NextResponse.json(await getPillarsData(orgId, brandId))
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/dashboard/pillars]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
