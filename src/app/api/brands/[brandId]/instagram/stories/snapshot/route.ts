import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchIgStories, fetchIgStoryInsights } from '@/lib/instagram/graph'
import { saveIgStories, IgStoryItem, extractMediaInsights } from '@/lib/instagram/queries'

function parseDurationFromMediaUrl(mediaUrl?: string): number | null {
  if (!mediaUrl) return null
  try {
    const efg = new URL(mediaUrl).searchParams.get('efg')
    if (!efg) return null
    const decoded = JSON.parse(atob(efg))
    return typeof decoded.duration_s === 'number' ? decoded.duration_s : null
  } catch {
    return null
  }
}

type Params = { params: Promise<{ brandId: string }> }

type StoryMedia = {
  id:             string
  username?:      string
  media_type?:    string
  permalink?:     string
  timestamp?:     string
  media_url?:     string
  thumbnail_url?: string
}

// POST /api/brands/[brandId]/instagram/stories/snapshot
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

    const storiesRes = await fetchIgStories(platform_user_id, oauth_token)
    const stories    = (storiesRes as { data?: StoryMedia[] }).data ?? []

    const items: IgStoryItem[] = []

    await Promise.all(
      stories.map(async (story) => {
        const insightsRaw = await fetchIgStoryInsights(story.id, oauth_token)
        const m = extractMediaInsights(insightsRaw?.data ?? [])

        const navRaw = insightsRaw?.data?.find(
          (i: { name: string }) => i.name === 'navigation'
        )
        const navigation: Record<string, number> | null = navRaw
          ? Object.fromEntries(
              (navRaw.total_value?.breakdowns?.[0]?.results ?? []).map(
                (r: { dimension_values: string[]; value: number }) => [r.dimension_values[0], r.value]
              )
            )
          : null

        items.push({
          socialAccountId,
          mediaId:           story.id,
          username:          story.username       ?? null,
          postedAt:          story.timestamp      ?? null,
          mediaType:         story.media_type     ?? null,
          permalink:         story.permalink      ?? null,
          mediaUrl:          story.media_type === 'IMAGE' ? null : (story.media_url ?? null),
          thumbnailUrl:      story.thumbnail_url ?? (story.media_type === 'IMAGE' ? story.media_url : null) ?? null,
          videoDuration:     story.media_type === 'IMAGE' ? null : parseDurationFromMediaUrl(story.media_url),
          reach:             m.reach              ?? null,
          replies:           m.replies            ?? null,
          shares:            m.shares             ?? null,
          follows:           m.follows            ?? null,
          profileVisits:     m.profile_visits     ?? null,
          profileActivity:   m.profile_activity   ?? null,
          reposts:           m.reposts            ?? null,
          totalInteractions: m.total_interactions ?? null,
          totalViews:        m.total_views        ?? null,
          facebookViews:     m.facebook_views     ?? null,
          navigation,
        })
      })
    )

    await saveIgStories(items)

    return NextResponse.json({
      success:       true,
      fetched_at:    new Date().toISOString(),
      stories_saved: items.length,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/instagram/stories/snapshot]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
