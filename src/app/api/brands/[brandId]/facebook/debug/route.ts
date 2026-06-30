import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedFbAccount } from '@/lib/brands/queries'
import {
  fetchFbProfile, fetchFbPageInsightsDay,
  fetchAllFbPosts, fetchFbPostInsights, fetchAllFbComments,
} from '@/lib/facebook/graph'
import { saveFbSnapshot, saveFbPostSnapshots, saveFbComments, extractPostInsights, FbPostSnapshotItem, FbCommentItem } from '@/lib/facebook/queries'
import pool from '@/lib/db'

type Params = { params: Promise<{ brandId: string }> }

type FbPostRaw = {
  id:             string
  message?:       string
  story?:         string
  full_picture?:  string
  permalink_url?: string
  created_time?:  string
  attachments?:   { data?: Array<{ type?: string }> }
  reactions?:     { summary?: { total_count?: number } }
  comments?:      { summary?: { total_count?: number } }
  shares?:        { count?: number }
}

// GET /api/brands/[brandId]/facebook/debug
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  const userId  = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { brandId } = await params
  const orgId = await verifyBrandAccess(brandId, userId)
  if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

  const account = await getConnectedFbAccount(brandId)
  if (!account) return NextResponse.json({ error: 'No Facebook account connected.', brandId }, { status: 404 })

  const { id: socialAccountId, platform_user_id: pageId, oauth_token: token } = account

  // ── Step 1: fetch all data ─────────────────────────────────────────
  const [profile, insightsDay] = await Promise.all([
    fetchFbProfile(pageId, token),
    fetchFbPageInsightsDay(pageId, token),
  ])

  const posts = await fetchAllFbPosts(pageId, token, 30)

  const snapshots: FbPostSnapshotItem[] = []
  const comments:  FbCommentItem[]      = []

  await Promise.all(
    (posts as FbPostRaw[]).map(async (post) => {
      const [insightsRaw, rawComments] = await Promise.all([
        fetchFbPostInsights(post.id, token),
        fetchAllFbComments(post.id, token),
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
        commentsCount:   post.comments?.summary?.total_count  ?? null,
        sharesCount:     post.shares?.count ?? 0,
        likesCount:      null,
        impressions:     typeof ins.post_media_view               === 'number' ? ins.post_media_view               : null,
        reach:           typeof ins.post_total_media_view_unique  === 'number' ? ins.post_total_media_view_unique  : null,
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
          linkPost:        post.permalink_url ?? null,
          linkComment:     null,
          postDate:        post.created_time ?? null,
          commentTime:     (c.created_time as string) ?? null,
          commentText:     (c.message       as string) ?? null,
          commentUsername: from?.name                  ?? null,
          commentUserId:   from?.id                    ?? null,
          likesCount:      (c.like_count    as number) ?? 0,
          repliesCount:    (c.comment_count as number) ?? 0,
          reactionsCount:  reactions?.summary?.total_count ?? 0,
          hasAttachment:   c.attachment != null,
          parentId:        (c.parent as { id?: string })?.id ?? null,
        })
      }
    })
  )

  // ── Step 2: save everything, capture errors ────────────────────────
  const errors: Record<string, string> = {}

  try {
    await saveFbSnapshot({ socialAccountId, profile, insightsDay })
  } catch (err) {
    errors.snapshot = String(err)
    console.error('[facebook/debug] saveFbSnapshot error:', err)
  }

  try {
    await saveFbPostSnapshots(snapshots)
  } catch (err) {
    errors.posts = String(err)
    console.error('[facebook/debug] saveFbPostSnapshots error:', err)
  }

  try {
    await saveFbComments(comments)
  } catch (err) {
    errors.comments = String(err)
    console.error('[facebook/debug] saveFbComments error:', err)
  }

  // ── Step 3: read back from DB to confirm ──────────────────────────
  const [dbSnapshots, dbPosts, dbComments] = await Promise.all([
    pool.query('SELECT id, fetched_at, name, fan_count FROM l0_raw.fb_profile_snapshots WHERE social_account_id = $1 ORDER BY fetched_at DESC LIMIT 5', [socialAccountId]),
    pool.query('SELECT id, post_id, posted_at, message FROM l0_raw.fb_post_snapshots WHERE social_account_id = $1 ORDER BY posted_at DESC LIMIT 10', [socialAccountId]),
    pool.query('SELECT COUNT(*) FROM l0_raw.fb_comments WHERE social_account_id = $1', [socialAccountId]),
  ])

  return NextResponse.json({
    social_account_id: socialAccountId,
    page_id:           pageId,
    save_errors:       Object.keys(errors).length > 0 ? errors : null,
    db: {
      snapshots_count:   dbSnapshots.rowCount,
      snapshots:         dbSnapshots.rows,
      posts_count:       dbPosts.rowCount,
      posts:             dbPosts.rows,
      comments_count:    Number(dbComments.rows[0].count),
    },
    api: {
      posts_fetched: posts.length,
      comments_fetched: comments.length,
    },
  })
}
