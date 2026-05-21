import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchAllIgMedia, fetchIgMediaInsights, fetchAllIgComments } from '@/lib/instagram/graph'
import {
  extractMediaInsights,
  saveIgMediaSnapshots,
  saveIgComments,
  IgMediaSnapshotItem,
  IgCommentItem,
} from '@/lib/instagram/queries'

type Params = { params: Promise<{ brandId: string }> }

type MediaItem = {
  id:             string
  caption?:       string
  media_type:     string
  permalink?:     string
  timestamp?:     string
  video_duration?: number
  media_url?:     string
  thumbnail_url?: string
  children?:      { data: Array<{ id: string }> }
}

// POST /api/brands/[brandId]/instagram/media/snapshot
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

    const items = (await fetchAllIgMedia(platform_user_id, oauth_token, 30)) as MediaItem[]

    const snapshots: IgMediaSnapshotItem[] = []
    const comments:  IgCommentItem[]       = []

    await Promise.all(
      items.map(async (media) => {
        const [insightsRaw, rawComments] = await Promise.all([
          fetchIgMediaInsights(media.id, oauth_token, media.media_type),
          fetchAllIgComments(media.id, oauth_token),
        ])

        const m      = extractMediaInsights(insightsRaw?.data ?? [])
        const isReel = media.media_type === 'REELS'

        snapshots.push({
          socialAccountId,
          mediaId:                media.id,
          postedAt:               media.timestamp        ?? null,
          caption:                media.caption          ?? null,
          mediaType:              media.media_type       ?? null,
          permalink:              media.permalink        ?? null,
          reach:                  m.reach                ?? null,
          saved:                  m.saved                ?? null,
          comments:               m.comments             ?? null,
          shares:                 m.shares               ?? null,
          totalInteractions:      m.total_interactions   ?? null,
          likes:                  m.likes                ?? null,
          impressions:            isReel ? null : (m.impressions    ?? null),
          follows:                isReel ? null : (m.follows        ?? null),
          profileVisits:          isReel ? null : (m.profile_visits ?? null),
          videoViews:             m.video_views          ?? null,
          reelPlays:              isReel ? (m.plays ?? null) : null,
          reelAvgWatchTime:       isReel ? (m.ig_reels_avg_watch_time        ?? null) : null,
          reelVideoViewTotalTime: isReel ? (m.ig_reels_video_view_total_time ?? null) : null,
          videoDuration:          media.video_duration   ?? null,
          carouselMediaCount:     media.children?.data?.length ?? null,
          coverImage:             media.thumbnail_url    ?? media.media_url ?? null,
        })

        for (const c of rawComments as Array<Record<string, unknown>>) {
          comments.push({
            socialAccountId,
            mediaId:         media.id,
            commentId:       c.id as string,
            linkPost:        media.permalink ?? null,
            linkComment:     media.permalink ? `${media.permalink}?comment_id=${c.id}` : null,
            commentTime:     (c.timestamp as string) ?? null,
            commentText:     (c.text as string)      ?? null,
            commentUsername: (c.username as string)  ?? null,
            likesCount:      (c.like_count as number)    ?? 0,
            repliesCount:    (c.replies_count as number) ?? 0,
          })
        }
      })
    )

    await Promise.all([
      saveIgMediaSnapshots(snapshots),
      saveIgComments(comments),
    ])

    return NextResponse.json({
      success:        true,
      fetched_at:     new Date().toISOString(),
      posts_saved:    snapshots.length,
      comments_saved: comments.length,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/instagram/media/snapshot]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
