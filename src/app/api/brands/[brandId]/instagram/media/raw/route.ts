import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchIgMedia, fetchIgMediaInsights } from '@/lib/instagram/graph'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/instagram/media/raw
export async function GET(_req: NextRequest, { params }: Params) {
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

    const { platform_user_id, oauth_token } = account

    const mediaList = await fetchIgMedia(platform_user_id, oauth_token)
    const items = (mediaList as { data?: Array<{ id: string; media_type: string; [key: string]: unknown }> }).data ?? []

    const mediaWithInsights = await Promise.all(
      items.map(async (media) => {
        const insights = await fetchIgMediaInsights(media.id, oauth_token, media.media_type)
        return { ...media, insights }
      })
    )

    return NextResponse.json({
      data: {
        fetched_at: new Date().toISOString(),
        count:      mediaWithInsights.length,
        media:      mediaWithInsights,
      }
    })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/instagram/media/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
