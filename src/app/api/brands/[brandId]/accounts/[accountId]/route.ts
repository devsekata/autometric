import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, disconnectSocialAccount } from '@/lib/brands/queries'

type Params = { params: Promise<{ brandId: string; accountId: string }> }

// DELETE /api/brands/[brandId]/accounts/[accountId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId, accountId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    await disconnectSocialAccount(brandId, accountId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[DELETE /api/brands/[brandId]/accounts/[accountId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
