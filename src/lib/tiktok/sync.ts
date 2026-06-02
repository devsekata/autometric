import { fetchTtProfile, fetchAllTtVideos } from './api'
import {
  saveTtProfileSnapshot, saveTtVideoSnapshots,
  TtProfileSnapshotPayload, TtVideoSnapshotItem,
} from './queries'

export async function initialTtSync(
  socialAccountId: string,
  accessToken:     string,
  brandId:         string,
): Promise<void> {
  console.log(`[initialTtSync] START brandId=${brandId} socialAccountId=${socialAccountId}`)

  const results = await Promise.allSettled([
    // 1. Profile snapshot
    (async () => {
      console.log('[initialTtSync] fetching profile...')
      const res  = await fetchTtProfile(accessToken)
      console.log('[initialTtSync] profile response:', JSON.stringify(res))
      const user = res?.data?.user as Record<string, unknown> | undefined
      if (!user) {
        throw new Error(`profile fetch failed: ${JSON.stringify(res)}`)
      }

      const payload: TtProfileSnapshotPayload = {
        socialAccountId,
        openId:         (user.open_id         as string)  ?? null,
        displayName:    (user.display_name    as string)  ?? null,
        bioDescription: (user.bio_description as string)  ?? null,
        avatarUrl:      (user.avatar_url      as string)  ?? null,
        isVerified:     (user.is_verified     as boolean) ?? null,
        followerCount:  (user.follower_count  as number)  ?? null,
        followingCount: (user.following_count as number)  ?? null,
        likesCount:     (user.likes_count     as number)  ?? null,
        videoCount:     (user.video_count     as number)  ?? null,
      }
      console.log('[initialTtSync] saving profile payload:', JSON.stringify(payload))
      await saveTtProfileSnapshot(payload)
      console.log('[initialTtSync] profile saved OK')
    })(),

    // 2. Videos snapshot
    (async () => {
      console.log('[initialTtSync] fetching videos...')
      const videos = await fetchAllTtVideos(accessToken)
      console.log(`[initialTtSync] fetched ${videos.length} videos`)
      const items: TtVideoSnapshotItem[] = videos.map((v) => ({
        socialAccountId,
        videoId:       v.id           as string,
        postedAt:      v.create_time ? new Date((v.create_time as number) * 1000).toISOString() : null,
        title:         (v.title             as string) ?? null,
        description:   (v.video_description as string) ?? null,
        duration:      (v.duration          as number) ?? null,
        coverImageUrl: (v.cover_image_url   as string) ?? null,
        shareUrl:      (v.share_url         as string) ?? null,
        likeCount:     (v.like_count        as number) ?? null,
        commentCount:  (v.comment_count     as number) ?? null,
        shareCount:    (v.share_count       as number) ?? null,
        viewCount:     (v.view_count        as number) ?? null,
      }))
      await saveTtVideoSnapshots(items)
      console.log(`[initialTtSync] videos saved OK (${items.length} items)`)
    })(),
  ])

  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      console.error(`[initialTtSync] task ${i} FAILED:`, r.reason)
    }
  }

  console.log(`[initialTtSync] DONE brandId=${brandId} socialAccountId=${socialAccountId}`)
}
