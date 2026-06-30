import pool from '@/lib/db'
import { PoolClient } from 'pg'

export interface TtProfileSnapshotPayload {
  socialAccountId: string
  openId:          string | null
  displayName:     string | null
  bioDescription:  string | null
  avatarUrl:       string | null
  isVerified:      boolean | null
  followerCount:   number | null
  followingCount:  number | null
  likesCount:      number | null
  videoCount:      number | null
}

export async function saveTtProfileSnapshot(payload: TtProfileSnapshotPayload): Promise<void> {
  await pool.query(
    `INSERT INTO l0_raw.tt_profile_snapshots (
      social_account_id,
      open_id, display_name, bio_description, avatar_url, is_verified,
      follower_count, following_count, likes_count, video_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
    DO NOTHING`,
    [
      payload.socialAccountId,
      payload.openId,
      payload.displayName,
      payload.bioDescription,
      payload.avatarUrl,
      payload.isVerified,
      payload.followerCount,
      payload.followingCount,
      payload.likesCount,
      payload.videoCount,
    ]
  )
}

export interface TtVideoSnapshotItem {
  socialAccountId: string
  videoId:         string
  postedAt:        string | null
  title:           string | null
  description:     string | null
  duration:        number | null
  coverImageUrl:   string | null
  shareUrl:        string | null
  likeCount:       number | null
  commentCount:    number | null
  shareCount:      number | null
  viewCount:       number | null
}

const VIDEO_UPSERT_SQL = `
  INSERT INTO l0_raw.tt_video_snapshots (
    social_account_id, video_id, posted_at, title, description,
    duration, cover_image_url, share_url,
    like_count, comment_count, share_count, view_count, engagement_rate
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (video_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
  DO UPDATE SET
    fetched_at      = NOW(),
    title           = EXCLUDED.title,
    description     = EXCLUDED.description,
    like_count      = EXCLUDED.like_count,
    comment_count   = EXCLUDED.comment_count,
    share_count     = EXCLUDED.share_count,
    view_count      = EXCLUDED.view_count,
    engagement_rate = EXCLUDED.engagement_rate`

export async function saveTtVideoSnapshots(items: TtVideoSnapshotItem[]): Promise<void> {
  if (!items.length) return
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const v of items) {
      const engagementRate = v.viewCount
        ? ((v.likeCount ?? 0) + (v.commentCount ?? 0) + (v.shareCount ?? 0)) / v.viewCount * 100
        : null

      await client.query(VIDEO_UPSERT_SQL, [
        v.socialAccountId, // $1
        v.videoId,         // $2
        v.postedAt,        // $3
        v.title,           // $4
        v.description,     // $5
        v.duration,        // $6
        v.coverImageUrl,   // $7
        v.shareUrl,        // $8
        v.likeCount,       // $9
        v.commentCount,    // $10
        v.shareCount,      // $11
        v.viewCount,       // $12
        engagementRate,    // $13
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
