import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchIgStories, fetchIgStoryInsights } from '@/lib/instagram/graph'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/instagram/stories/raw
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

    const storiesRes = await fetchIgStories(platform_user_id, oauth_token)
    const stories    = (storiesRes as { data?: Array<{ id: string; [key: string]: unknown }> }).data ?? []

    const storiesWithInsights = await Promise.all(
      stories.map(async (story) => {
        const insights = await fetchIgStoryInsights(story.id, oauth_token)
        return { ...story, insights }
      })
    )

    return NextResponse.json({
      fetched_at:    new Date().toISOString(),
      story_count:   storiesWithInsights.length,
      stories:       storiesWithInsights,
    })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/instagram/stories/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
