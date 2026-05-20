import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, removeCompetitor } from '@/lib/brands/queries'

type Params = { params: Promise<{ brandId: string; socialAccountId: string }> }

// DELETE /api/brands/[brandId]/competitors/[socialAccountId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId, socialAccountId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    await removeCompetitor(brandId, socialAccountId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[DELETE /api/brands/[brandId]/competitors/[socialAccountId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
