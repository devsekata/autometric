import { fetchTtProfile, fetchAllTtVideos } from './api'
import {
  saveTtProfileSnapshot, saveTtVideoSnapshots,
  TtProfileSnapshotPayload, TtVideoSnapshotItem,
} from './queries'

export type TtSyncResult = {
  tt_profile: { count: number; error: string | null }
  tt_videos:  { count: number; error: string | null }
}

export async function initialTtSync(
  socialAccountId: string,
  accessToken:     string,
  brandId:         string,
): Promise<TtSyncResult> {
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
      return 1
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
      return items.length
    })(),
  ])

  const [profileResult, videosResult] = results
  const errMsg = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null

  console.log(`[initialTtSync] DONE brandId=${brandId} socialAccountId=${socialAccountId}`)
  return {
    tt_profile: profileResult.status === 'fulfilled'
      ? { count: 1, error: null }
      : { count: 0, error: errMsg(profileResult) },
    tt_videos:  videosResult.status === 'fulfilled'
      ? { count: videosResult.value as number, error: null }
      : { count: 0, error: errMsg(videosResult) },
  }
}
