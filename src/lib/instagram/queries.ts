import pool from '@/lib/db'
import { PoolClient } from 'pg'

interface IgSnapshotPayload {
  socialAccountId:     string
  profile:             Record<string, unknown>
  insightsDay:         Record<string, unknown>
  followsAndUnfollows: Record<string, unknown>
  insightsLifetime:    Record<string, Record<string, unknown>>
}

type DayMetricItem = { name: string; total_value?: { value: number } }

function extractDayMetrics(data: DayMetricItem[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of data ?? []) {
    map[item.name] = item.total_value?.value ?? 0
  }
  return map
}

export async function saveIgSnapshot(payload: IgSnapshotPayload): Promise<void> {
  const rawDay = payload.insightsDay as { data?: DayMetricItem[] }
  const m = extractDayMetrics(rawDay?.data ?? [])
  const p = payload.profile

  await pool.query(
    `INSERT INTO l0_raw.ig_profile_snapshots (
      social_account_id,
      username, name, biography, website,
      followers_count, follows_count, media_count,
      accounts_engaged, comments, likes, profile_links_taps,
      reach, replies, reposts, saves, shares, total_interactions, views,
      follows_and_unfollows,
      demographics_age, demographics_city, demographics_country, demographics_gender
    ) VALUES (
      $1,
      $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19,
      $20,
      $21, $22, $23, $24
    )
    ON CONFLICT (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
    DO NOTHING`,
    [
      payload.socialAccountId,     // $1
      p.username    ?? null,        // $2
      p.name        ?? null,        // $3
      p.biography   ?? null,        // $4
      p.website     ?? null,        // $5
      p.followers_count ?? null,    // $6
      p.follows_count   ?? null,    // $7
      p.media_count     ?? null,    // $8
      m.accounts_engaged   ?? null, // $9
      m.comments           ?? null, // $10
      m.likes              ?? null, // $11
      m.profile_links_taps ?? null, // $12
      m.reach              ?? null, // $13
      m.replies            ?? null, // $14
      m.reposts            ?? null, // $15
      m.saves              ?? null, // $16
      m.shares             ?? null, // $17
      m.total_interactions ?? null, // $18
      m.views              ?? null, // $19
      JSON.stringify(payload.followsAndUnfollows        ?? {}), // $20
      JSON.stringify(payload.insightsLifetime?.age      ?? {}), // $21
      JSON.stringify(payload.insightsLifetime?.city     ?? {}), // $22
      JSON.stringify(payload.insightsLifetime?.country  ?? {}), // $23
      JSON.stringify(payload.insightsLifetime?.gender   ?? {}), // $24
    ]
  )
}

// ─── Media snapshots ──────────────────────────────────────────────────────────

export interface IgMediaSnapshotItem {
  socialAccountId:          string
  mediaId:                  string
  postedAt:                 string | null
  caption:                  string | null
  mediaType:                string | null
  permalink:                string | null
  reach:                    number | null
  saved:                    number | null
  comments:                 number | null
  shares:                   number | null
  totalInteractions:        number | null
  likes:                    number | null
  impressions:              number | null
  follows:                  number | null
  profileVisits:            number | null
  videoViews:               number | null
  reelPlays:                number | null
  reelAvgWatchTime:         number | null
  reelVideoViewTotalTime:   number | null
  videoDuration:            number | null
  carouselMediaCount:       number | null
  coverImage:               string | null
}

type InsightItem = {
  name: string
  total_value?: { value: number }
  values?: Array<{ value: number }>
}

export function extractMediaInsights(data: InsightItem[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of data ?? []) {
    map[item.name] = item.total_value?.value ?? item.values?.[0]?.value ?? 0
  }
  return map
}

const MEDIA_UPSERT_SQL = `
  INSERT INTO l0_raw.ig_media_snapshots (
    social_account_id, media_id, posted_at, caption, media_type, permalink,
    reach, saved, comments, shares, total_interactions, likes,
    impressions, follows, profile_visits, video_views,
    reel_plays, reel_avg_watch_time, reel_video_view_total_time,
    video_duration, carousel_media_count, cover_image
  ) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12,
    $13, $14, $15, $16,
    $17, $18, $19,
    $20, $21, $22
  )
  ON CONFLICT (media_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
  DO UPDATE SET
    caption                    = EXCLUDED.caption,
    reach                      = EXCLUDED.reach,
    saved                      = EXCLUDED.saved,
    comments                   = EXCLUDED.comments,
    shares                     = EXCLUDED.shares,
    total_interactions         = EXCLUDED.total_interactions,
    likes                      = EXCLUDED.likes,
    impressions                = EXCLUDED.impressions,
    follows                    = EXCLUDED.follows,
    profile_visits             = EXCLUDED.profile_visits,
    video_views                = EXCLUDED.video_views,
    reel_plays                 = EXCLUDED.reel_plays,
    reel_avg_watch_time        = EXCLUDED.reel_avg_watch_time,
    reel_video_view_total_time = EXCLUDED.reel_video_view_total_time,
    video_duration             = EXCLUDED.video_duration,
    carousel_media_count       = EXCLUDED.carousel_media_count,
    cover_image                = EXCLUDED.cover_image`

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface IgCommentItem {
  socialAccountId: string
  mediaId:         string
  commentId:       string
  linkPost:        string | null
  linkComment:     string | null
  commentTime:     string | null
  commentText:     string | null
  commentUsername: string | null
  likesCount:      number
  repliesCount:    number
}

export async function saveIgComments(items: IgCommentItem[]): Promise<void> {
  if (items.length === 0) return
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      await client.query(
        `INSERT INTO l0_raw.ig_comments (
          social_account_id, media_id, comment_id,
          link_post, link_comment,
          comment_time, comment_text, comment_username,
          likes_count, replies_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (comment_id) DO UPDATE SET
          likes_count   = EXCLUDED.likes_count,
          replies_count = EXCLUDED.replies_count`,
        [
          item.socialAccountId, // $1
          item.mediaId,         // $2
          item.commentId,       // $3
          item.linkPost,        // $4
          item.linkComment,     // $5
          item.commentTime,     // $6
          item.commentText,     // $7
          item.commentUsername, // $8
          item.likesCount,      // $9
          item.repliesCount,    // $10
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

export async function saveIgMediaSnapshots(items: IgMediaSnapshotItem[]): Promise<void> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      await client.query(MEDIA_UPSERT_SQL, [
        item.socialAccountId,       // $1
        item.mediaId,               // $2
        item.postedAt,              // $3
        item.caption,               // $4
        item.mediaType,             // $5
        item.permalink,             // $6
        item.reach,                 // $7
        item.saved,                 // $8
        item.comments,              // $9
        item.shares,                // $10
        item.totalInteractions,     // $11
        item.likes,                 // $12
        item.impressions,           // $13
        item.follows,               // $14
        item.profileVisits,         // $15
        item.videoViews,            // $16
        item.reelPlays,             // $17
        item.reelAvgWatchTime,      // $18
        item.reelVideoViewTotalTime, // $19
        item.videoDuration,         // $20
        item.carouselMediaCount,    // $21
        item.coverImage,            // $22
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
