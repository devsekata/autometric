import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchIgMedia, fetchIgComments } from '@/lib/instagram/graph'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/instagram/comments/raw
// Fetches comments for all posts from the last 30 days
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
    type MediaItem = { id: string; timestamp?: string }
    const allMedia  = (mediaList as { data?: MediaItem[] }).data ?? []

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recent  = allMedia.filter(m => m.timestamp && new Date(m.timestamp).getTime() >= cutoff)

    if (recent.length === 0) {
      return NextResponse.json({ data: { fetched_at: new Date().toISOString(), posts: [] } })
    }

    const posts = await Promise.all(
      recent.map(async (media) => {
        const comments = await fetchIgComments(media.id, oauth_token)
        return { media_id: media.id, posted_at: media.timestamp, comments }
      })
    )

    return NextResponse.json({
      data: {
        fetched_at: new Date().toISOString(),
        post_count: posts.length,
        posts,
      }
    })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/instagram/comments/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
