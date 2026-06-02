import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedTtAccount } from '@/lib/brands/queries'
import { initialTtSync } from '@/lib/tiktok/sync'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/tiktok/initial-sync
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedTtAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected TikTok account found.' }, { status: 404 })
    }

    const { id: socialAccountId, oauth_token } = account

    try {
      await initialTtSync(socialAccountId, oauth_token, brandId)
      return NextResponse.json({ success: true, socialAccountId })
    } catch (syncErr) {
      console.error('[initialTtSync] threw:', syncErr)
      return NextResponse.json({
        error: 'Sync failed',
        detail: syncErr instanceof Error ? syncErr.message : String(syncErr),
      }, { status: 500 })
    }
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/tiktok/initial-sync]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
