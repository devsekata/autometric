import {
  fetchFbProfile, fetchFbPageInsightsDay,
  fetchAllFbPosts, fetchFbPostInsights, fetchAllFbComments,
} from './graph'
import {
  saveFbSnapshot, saveFbPostSnapshots, saveFbComments,
  extractPostInsights,
  FbPostSnapshotItem, FbCommentItem,
} from './queries'

type FbPostRaw = {
  id:              string
  message?:        string
  story?:          string
  full_picture?:   string
  permalink_url?:  string
  created_time?:   string
  attachments?:    { data?: Array<{ type?: string }> }
  reactions?:      { summary?: { total_count?: number } }
  likes?:          { summary?: { total_count?: number } }
  comments?:       { summary?: { total_count?: number } }
  shares?:         { count?: number }
}

export async function initialFbSync(
  socialAccountId: string,
  platformUserId:  string,   // page_id
  oauthToken:      string,
  brandId:         string,
): Promise<void> {
  const days = 30

  const results = await Promise.allSettled([
    // 1. Profile + page insights + demographics snapshot
    (async () => {
      const [profile, insightsDay] = await Promise.all([
        fetchFbProfile(platformUserId, oauthToken),
        fetchFbPageInsightsDay(platformUserId, oauthToken),
      ])
      await saveFbSnapshot({ socialAccountId, profile, insightsDay })
    })(),

    // 2. Posts + per-post insights + comments
    (async () => {
      const rawPosts = (await fetchAllFbPosts(platformUserId, oauthToken, days)) as FbPostRaw[]
      const snapshots: FbPostSnapshotItem[] = []
      const comments:  FbCommentItem[]      = []

      await Promise.all(
        rawPosts.map(async (post) => {
          const [insightsRaw, rawComments] = await Promise.all([
            fetchFbPostInsights(post.id, oauthToken),
            fetchAllFbComments(post.id, oauthToken),
          ])

          const ins = extractPostInsights(insightsRaw?.data ?? [])

          snapshots.push({
            socialAccountId,
            postId:          post.id,
            postedAt:        post.created_time ?? null,
            message:         post.message      ?? null,
            story:           post.story        ?? null,
            fullPicture:     post.full_picture ?? null,
            permalinkUrl:    post.permalink_url ?? null,
            postType:        post.attachments?.data?.[0]?.type ?? null,
            reactionsCount:  post.reactions?.summary?.total_count ?? null,
            likesCount:      post.likes?.summary?.total_count     ?? null,
            commentsCount:   post.comments?.summary?.total_count  ?? null,
            sharesCount:     post.shares?.count ?? 0,
            impressions:     typeof ins.post_media_view                === 'number' ? ins.post_media_view                : null,
            reach:           typeof ins.post_total_media_view_unique   === 'number' ? ins.post_total_media_view_unique   : null,
            clicks:          typeof ins.post_clicks             === 'number' ? ins.post_clicks             : null,
            reactionsByType: ins.post_reactions_by_type_total !== null && typeof ins.post_reactions_by_type_total === 'object'
              ? ins.post_reactions_by_type_total as Record<string, number>
              : null,
            videoViews:      typeof ins.post_video_views === 'number' ? ins.post_video_views : null,
          })

          for (const c of rawComments as Array<Record<string, unknown>>) {
            const from = c.from as { id?: string; name?: string } | undefined
            const reactions = c.reactions as { summary?: { total_count?: number } } | undefined
            comments.push({
              socialAccountId,
              postId:          post.id,
              commentId:       c.id as string,
              linkPost:        post.permalink_url              ?? null,
              linkComment:     (c.permalink_url as string)     ?? null,
              postDate:        post.created_time               ?? null,
              commentTime:     (c.created_time  as string)     ?? null,
              commentText:     (c.message       as string)     ?? null,
              commentUsername: from?.name                      ?? null,
              commentUserId:   from?.id                        ?? null,
              likesCount:      (c.like_count    as number)     ?? 0,
              repliesCount:    (c.comment_count as number)     ?? 0,
              reactionsCount:  reactions?.summary?.total_count ?? 0,
              hasAttachment:   c.attachment != null,
              parentId:        (c.parent as { id?: string })?.id ?? null,
            })
          }
        })
      )

      await Promise.all([saveFbPostSnapshots(snapshots), saveFbComments(comments)])
    })(),
  ])

  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      console.error(`[initialFbSync] task ${i} FAILED:`, r.reason)
    }
  }

  console.log(`[initialFbSync] brandId=${brandId} socialAccountId=${socialAccountId} done`)
}
