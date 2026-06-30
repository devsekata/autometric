import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchAllIgMedia, fetchAllIgComments } from '@/lib/instagram/graph'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/instagram/comments/raw
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

    const snapshotDays = parseInt(process.env.IG_SNAPSHOT_DAYS ?? '60', 10)
    const mediaItems   = await fetchAllIgMedia(platform_user_id, oauth_token, snapshotDays)

    type MediaItem = { id: string; timestamp?: string; permalink?: string }
    const posts = await Promise.all(
      (mediaItems as MediaItem[]).map(async (media) => {
        const comments = await fetchAllIgComments(media.id, oauth_token)
        return {
          media_id:      media.id,
          posted_at:     media.timestamp ?? null,
          permalink:     media.permalink ?? null,
          comment_count: comments.length,
          comments,
        }
      })
    )

    return NextResponse.json({
      fetched_at:    new Date().toISOString(),
      snapshot_days: snapshotDays,
      post_count:    posts.length,
      posts,
    })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/instagram/comments/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
