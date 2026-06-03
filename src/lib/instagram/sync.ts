import {
  fetchIgProfile, fetchIgInsightsDay, fetchIgInsightsLifetime, fetchIgFollowsUnfollows,
  fetchAllIgMedia, fetchIgMediaInsights, fetchAllIgComments,
  fetchAllIgTaggedPosts, fetchIgStories, fetchIgStoryInsights,
} from './graph'
import {
  saveIgSnapshot,
  saveIgMediaSnapshots, saveIgComments, extractMediaInsights,
  saveIgTaggedPosts, saveIgStories,
  IgMediaSnapshotItem, IgCommentItem, IgTaggedPostItem, IgStoryItem,
} from './queries'

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

type MediaItem = {
  id: string
  caption?: string
  media_type: string
  media_product_type?: string
  permalink?: string
  timestamp?: string
  media_url?: string
  thumbnail_url?: string
  children?: { data: Array<{ id: string }> }
}

export type IgSyncResult = {
  ig_profile:  { count: number; error: string | null }
  ig_posts:    { count: number; error: string | null }
  ig_stories:  { count: number; error: string | null }
  ig_tagged:   { count: number; error: string | null }
  ig_comments: { count: number; error: string | null }
}

export async function initialIgSync(
  socialAccountId: string,
  platformUserId:  string,
  oauthToken:      string,
  brandId:         string,
): Promise<IgSyncResult> {
  const days = 30

  const [profileResult, mediaResult, taggedResult, storiesResult] = await Promise.allSettled([
    // 1. Profile snapshot (today)
    (async () => {
      const [profile, insightsDay, insightsLifetime, followsAndUnfollows] = await Promise.all([
        fetchIgProfile(platformUserId, oauthToken),
        fetchIgInsightsDay(platformUserId, oauthToken),
        fetchIgInsightsLifetime(platformUserId, oauthToken),
        fetchIgFollowsUnfollows(platformUserId, oauthToken),
      ])

      await saveIgSnapshot({ socialAccountId, profile, insightsDay, insightsLifetime, followsAndUnfollows })
      return 1
    })(),

    // 2. Media + comments snapshot
    (async () => {
      const items = (await fetchAllIgMedia(platformUserId, oauthToken, days)) as MediaItem[]
      const snapshots: IgMediaSnapshotItem[] = []
      const comments:  IgCommentItem[]       = []

      await Promise.all(
        items.map(async (media) => {
          const isReel        = media.media_type === 'REELS' || media.media_product_type === 'REELS'
          const effectiveType = isReel ? 'REELS' : media.media_type

          const [insightsRaw, rawComments] = await Promise.all([
            fetchIgMediaInsights(media.id, oauthToken, effectiveType),
            fetchAllIgComments(media.id, oauthToken),
          ])
          const m = extractMediaInsights(insightsRaw?.data ?? [])

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
            follows:                isReel ? null : (m.follows        ?? null),
            profileVisits:          isReel ? null : (m.profile_visits ?? null),
            views:                  m.views                ?? null,
            reposts:                m.reposts              ?? null,
            reelAvgWatchTime:       isReel ? (m.ig_reels_avg_watch_time        ?? null) : null,
            reelVideoViewTotalTime: isReel ? (m.ig_reels_video_view_total_time ?? null) : null,
            videoDuration:      parseDurationFromMediaUrl(media.media_url),
            carouselMediaCount: media.children?.data?.length ?? null,
            coverImage:         media.thumbnail_url ?? media.media_url ?? null,
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
              likesCount:      (c.like_count as number) ?? 0,
              repliesCount:    (c.replies as { data?: unknown[] })?.data?.length ?? 0,
              hidden:          (c.hidden as boolean)   ?? null,
              parentId:        (c.parent_id as string) ?? null,
            })
          }
        })
      )

      await Promise.all([saveIgMediaSnapshots(snapshots), saveIgComments(comments)])
      return { posts: snapshots.length, comments: comments.length }
    })(),

    // 3. Tagged posts snapshot
    (async () => {
      const raw = await fetchAllIgTaggedPosts(platformUserId, oauthToken, days)
      const items: IgTaggedPostItem[] = raw.map((p) => ({
        socialAccountId,
        mediaId:      p.id          as string,
        postedAt:     (p.timestamp  as string) ?? null,
        caption:      (p.caption    as string) ?? null,
        mediaType:    (p.media_type as string) ?? null,
        permalink:    (p.permalink  as string) ?? null,
        taggedBy:     (p.username   as string) ?? null,
        likeCount:    (p.like_count     as number) ?? null,
        commentCount: (p.comments_count as number) ?? null,
        coverImage:   (p.thumbnail_url  as string) ?? null,
      }))
      await saveIgTaggedPosts(items)
      return items.length
    })(),

    // 4. Stories snapshot
    (async () => {
      const storiesRes = await fetchIgStories(platformUserId, oauthToken)
      const stories    = (storiesRes as { data?: Array<{ id: string; username?: string; media_type?: string; permalink?: string; timestamp?: string; media_url?: string; thumbnail_url?: string }> }).data ?? []
      const items: IgStoryItem[] = []

      await Promise.all(
        stories.map(async (story) => {
          const insightsRaw = await fetchIgStoryInsights(story.id, oauthToken)
          const m = extractMediaInsights(insightsRaw?.data ?? [])
          const navRaw = insightsRaw?.data?.find((i: { name: string }) => i.name === 'navigation')
          const navigation = navRaw
            ? Object.fromEntries(
                (navRaw.total_value?.breakdowns?.[0]?.results ?? []).map(
                  (r: { dimension_values: string[]; value: number }) => [r.dimension_values[0], r.value]
                )
              )
            : null

          items.push({
            socialAccountId,
            mediaId:           story.id,
            username:          story.username      ?? null,
            postedAt:          story.timestamp     ?? null,
            mediaType:         story.media_type    ?? null,
            permalink:         story.permalink     ?? null,
            mediaUrl:          story.media_type === 'IMAGE' ? null : (story.media_url ?? null),
            thumbnailUrl:      story.thumbnail_url ?? (story.media_type === 'IMAGE' ? story.media_url : null) ?? null,
            videoDuration:     story.media_type === 'IMAGE' ? null : parseDurationFromMediaUrl(story.media_url),
            reach:             m.reach             ?? null,
            replies:           m.replies           ?? null,
            shares:            m.shares            ?? null,
            follows:           m.follows           ?? null,
            profileVisits:     m.profile_visits    ?? null,
            profileActivity:   m.profile_activity  ?? null,
            reposts:           m.reposts           ?? null,
            totalInteractions: m.total_interactions ?? null,
            totalViews:        m.total_views       ?? null,
            facebookViews:     m.facebook_views    ?? null,
            navigation,
          })
        })
      )

      await saveIgStories(items)
      return items.length
    })(),
  ])

  const errMsg = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null

  const result: IgSyncResult = {
    ig_profile:  profileResult.status === 'fulfilled'
      ? { count: 1, error: null }
      : { count: 0, error: errMsg(profileResult) },
    ig_posts:    mediaResult.status === 'fulfilled'
      ? { count: (mediaResult.value as { posts: number }).posts,       error: null }
      : { count: 0, error: errMsg(mediaResult) },
    ig_comments: mediaResult.status === 'fulfilled'
      ? { count: (mediaResult.value as { comments: number }).comments, error: null }
      : { count: 0, error: errMsg(mediaResult) },
    ig_tagged:   taggedResult.status === 'fulfilled'
      ? { count: taggedResult.value  as number, error: null }
      : { count: 0, error: errMsg(taggedResult) },
    ig_stories:  storiesResult.status === 'fulfilled'
      ? { count: storiesResult.value as number, error: null }
      : { count: 0, error: errMsg(storiesResult) },
  }

  console.log(`[initialIgSync] brandId=${brandId} socialAccountId=${socialAccountId} done`)
  return result
}
