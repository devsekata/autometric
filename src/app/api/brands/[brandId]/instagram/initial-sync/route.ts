import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { initialIgSync } from '@/lib/instagram/sync'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/instagram/initial-sync
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedIgAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected Instagram account found.' }, { status: 404 })
    }

    const { id: socialAccountId, platform_user_id, oauth_token } = account

    await initialIgSync(socialAccountId, platform_user_id, oauth_token, brandId)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/instagram/initial-sync]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
