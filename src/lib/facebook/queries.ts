import pool from '@/lib/db'
import { PoolClient } from 'pg'

// ─── Page Insights helpers ────────────────────────────────────────────────────

type FbInsightValue = number | Record<string, number>

type FbInsightItem = {
  name: string
  values?: Array<{ value: FbInsightValue; end_time: string }>
}

function extractPageInsight(data: unknown[], metricName: string): number | null {
  const item = (data as FbInsightItem[]).find(i => i.name === metricName)
  if (!item?.values?.length) return null
  const val = item.values[item.values.length - 1]?.value
  return typeof val === 'number' ? val : null
}

// ─── Post Insights helpers ────────────────────────────────────────────────────

type FbPostInsightItem = {
  name: string
  values?: Array<{ value: FbInsightValue }>
}

export function extractPostInsights(data: unknown[]): Record<string, FbInsightValue | null> {
  const map: Record<string, FbInsightValue | null> = {}
  for (const raw of data ?? []) {
    const item = raw as FbPostInsightItem
    map[item.name] = item.values?.[0]?.value ?? null
  }
  return map
}

// ─── Profile Snapshot ─────────────────────────────────────────────────────────

interface FbSnapshotPayload {
  socialAccountId: string
  profile:         Record<string, unknown>
  insightsDay:     { data?: unknown[] }
}

export async function saveFbSnapshot(payload: FbSnapshotPayload): Promise<void> {
  const dayData = payload.insightsDay?.data ?? []
  const p       = payload.profile

  await pool.query(
    `INSERT INTO l0_raw.fb_profile_snapshots (
      social_account_id,
      page_id, name, about, category, website,
      fan_count, followers_count, cover_url, avatar_url, page_link,
      page_follows, page_daily_follows_unique,
      page_media_view, page_total_media_view_unique,
      page_video_views, page_views_total,
      content_interactions, link_clicks, profile_reach
    ) VALUES (
      $1,
      $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13,
      $14, $15,
      $16, $17,
      $18, $19, $20
    )
    ON CONFLICT (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
    DO NOTHING`,
    [
      payload.socialAccountId,                                                    // $1
      p.id          ?? null,                                                       // $2
      p.name        ?? null,                                                       // $3
      p.about       ?? null,                                                       // $4
      p.category    ?? null,                                                       // $5
      p.website     ?? null,                                                       // $6
      p.fan_count       ?? null,                                                   // $7
      p.followers_count ?? null,                                                   // $8
      (p.cover   as { source?: string })?.source           ?? null,               // $9
      (p.picture as { data?: { url?: string } })?.data?.url ?? null,             // $10
      p.link        ?? null,                                                       // $11
      extractPageInsight(dayData, 'page_follows'),                                 // $12
      extractPageInsight(dayData, 'page_daily_follows_unique'),                    // $13
      extractPageInsight(dayData, 'page_media_view'),                              // $14
      extractPageInsight(dayData, 'page_total_media_view_unique'),                 // $15
      extractPageInsight(dayData, 'page_video_views'),                             // $16
      extractPageInsight(dayData, 'page_views_total'),                             // $17
      extractPageInsight(dayData, 'page_post_engagements'),                        // $18
      extractPageInsight(dayData, 'page_website_clicks'),                          // $19
      extractPageInsight(dayData, 'page_impressions_unique'),                      // $20
    ]
  )
}

// ─── Post Snapshots ───────────────────────────────────────────────────────────

export interface FbPostSnapshotItem {
  socialAccountId: string
  postId:          string
  postedAt:        string | null
  message:         string | null
  story:           string | null
  fullPicture:     string | null
  permalinkUrl:    string | null
  postType:        string | null
  reactionsCount:  number | null
  likesCount:      number | null
  commentsCount:   number | null
  sharesCount:     number | null
  impressions:     number | null
  reach:           number | null
  clicks:          number | null
  reactionsByType: Record<string, number> | null
  videoViews:      number | null
}

const POST_UPSERT_SQL = `
  INSERT INTO l0_raw.fb_post_snapshots (
    social_account_id, post_id, posted_at, message, story,
    full_picture, permalink_url, post_type,
    reactions_count, likes_count, comments_count, shares_count,
    impressions, reach, clicks, reactions_by_type, video_views
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8,
    $9, $10, $11, $12,
    $13, $14, $15, $16, $17
  )
  ON CONFLICT (post_id) DO UPDATE SET
    fetched_at        = NOW(),
    message           = EXCLUDED.message,
    story             = EXCLUDED.story,
    reactions_count   = EXCLUDED.reactions_count,
    likes_count       = EXCLUDED.likes_count,
    comments_count    = EXCLUDED.comments_count,
    shares_count      = EXCLUDED.shares_count,
    impressions       = EXCLUDED.impressions,
    reach             = EXCLUDED.reach,
    clicks            = EXCLUDED.clicks,
    reactions_by_type = EXCLUDED.reactions_by_type,
    video_views       = EXCLUDED.video_views`

export async function saveFbPostSnapshots(items: FbPostSnapshotItem[]): Promise<void> {
  if (items.length === 0) return
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      await client.query(POST_UPSERT_SQL, [
        item.socialAccountId,                                                 // $1
        item.postId,                                                          // $2
        item.postedAt,                                                        // $3
        item.message,                                                         // $4
        item.story,                                                           // $5
        item.fullPicture,                                                     // $6
        item.permalinkUrl,                                                    // $7
        item.postType,                                                        // $8
        item.reactionsCount,                                                  // $9
        item.likesCount,                                                      // $10
        item.commentsCount,                                                   // $11
        item.sharesCount,                                                     // $12
        item.impressions,                                                     // $13
        item.reach,                                                           // $14
        item.clicks,                                                          // $15
        item.reactionsByType ? JSON.stringify(item.reactionsByType) : null,  // $16
        item.videoViews,                                                      // $17
      ])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface FbCommentItem {
  socialAccountId: string
  postId:          string
  commentId:       string
  linkPost:        string | null
  linkComment:     string | null
  postDate:        string | null
  commentTime:     string | null
  commentText:     string | null
  commentUsername: string | null
  commentUserId:   string | null
  likesCount:      number
  repliesCount:    number
  reactionsCount:  number
  hasAttachment:   boolean
  parentId:        string | null
}

export async function saveFbComments(items: FbCommentItem[]): Promise<void> {
  if (items.length === 0) return
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      await client.query(
        `INSERT INTO l0_raw.fb_comments (
          social_account_id, post_id, comment_id,
          link_post, link_comment, post_date,
          comment_time, comment_text, comment_username, comment_user_id,
          likes_count, replies_count, reactions_count, has_attachment, parent_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (comment_id) DO UPDATE SET
          comment_text     = EXCLUDED.comment_text,
          comment_username = EXCLUDED.comment_username,
          comment_user_id  = EXCLUDED.comment_user_id,
          likes_count      = EXCLUDED.likes_count,
          replies_count    = EXCLUDED.replies_count,
          reactions_count  = EXCLUDED.reactions_count,
          has_attachment   = EXCLUDED.has_attachment,
          link_comment     = EXCLUDED.link_comment`,
        [
          item.socialAccountId, // $1
          item.postId,          // $2
          item.commentId,       // $3
          item.linkPost,        // $4
          item.linkComment,     // $5
          item.postDate,        // $6
          item.commentTime,     // $7
          item.commentText,     // $8
          item.commentUsername, // $9
          item.commentUserId,   // $10
          item.likesCount,      // $11
          item.repliesCount,    // $12
          item.reactionsCount,  // $13
          item.hasAttachment,   // $14
          item.parentId,        // $15
        ]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
