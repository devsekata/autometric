import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getBrandById, verifyBrandAccess, updateBrandName, deleteBrand } from '@/lib/brands/queries'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const brand = await getBrandById(brandId)
    if (!brand) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    return NextResponse.json({ data: brand })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// PATCH /api/brands/[brandId]
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Brand name is required.' }, { status: 400 })
    if (name.length > 255) return NextResponse.json({ error: 'Brand name is too long.' }, { status: 400 })

    await updateBrandName(brandId, name)
    return NextResponse.json({ data: { id: brandId, name } })
  } catch (err) {
    console.error('[PATCH /api/brands/[brandId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/brands/[brandId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    await deleteBrand(brandId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[DELETE /api/brands/[brandId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
