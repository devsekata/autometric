import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getMemberRole } from '@/lib/organizations/queries'
import { listBrandsForOrg, createBrand } from '@/lib/brands/queries'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/brands
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = await getMemberRole(id, userId)
    if (!role) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const brands = await listBrandsForOrg(id)
    return NextResponse.json({ data: brands })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/brands]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/organizations/[id]/brands
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = await getMemberRole(id, userId)
    if (!role) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Brand name is required.' }, { status: 400 })
    if (name.length > 255) return NextResponse.json({ error: 'Brand name is too long.' }, { status: 400 })

    const brand = await createBrand(id, name)
    return NextResponse.json({ data: brand }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/brands]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
