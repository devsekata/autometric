import pool from '@/lib/db'
import { PoolClient } from 'pg'

// ─── Demographics ─────────────────────────────────────────────────────────────

type DemographicsBreakdownResult = {
  dimension_values: string[]
  value: number
}

type DemographicsBreakdown = {
  dimension_keys: string[]
  results: DemographicsBreakdownResult[]
}

type DemographicsMetricItem = {
  name: string
  total_value?: { breakdowns?: DemographicsBreakdown[] }
}

type DemographicsRaw = { data?: DemographicsMetricItem[] }

function parseBreakdown(raw: DemographicsRaw, metric: string): Record<string, number> {
  const item = (raw?.data ?? []).find(i => i.name === metric)
  const results = item?.total_value?.breakdowns?.[0]?.results ?? []
  return Object.fromEntries(results.map(r => [r.dimension_values[0], r.value]))
}

export interface IgDemographics {
  fetchedAt:        string
  engagedAudience: {
    age:     Record<string, number>
    city:    Record<string, number>
    country: Record<string, number>
    gender:  Record<string, number>
  }
  followers: {
    age:     Record<string, number>
    city:    Record<string, number>
    country: Record<string, number>
    gender:  Record<string, number>
  }
}

export async function getIgLatestDemographics(socialAccountId: string): Promise<IgDemographics | null> {
  const { rows } = await pool.query(
    `SELECT demographics_age, demographics_city, demographics_country, demographics_gender, fetched_at
     FROM l0_raw.ig_profile_snapshots
     WHERE social_account_id = $1
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [socialAccountId]
  )
  if (!rows.length) return null

  const row = rows[0]
  const age     = row.demographics_age     as DemographicsRaw
  const city    = row.demographics_city    as DemographicsRaw
  const country = row.demographics_country as DemographicsRaw
  const gender  = row.demographics_gender  as DemographicsRaw

  return {
    fetchedAt: row.fetched_at,
    engagedAudience: {
      age:     parseBreakdown(age,     'engaged_audience_demographics'),
      city:    parseBreakdown(city,    'engaged_audience_demographics'),
      country: parseBreakdown(country, 'engaged_audience_demographics'),
      gender:  parseBreakdown(gender,  'engaged_audience_demographics'),
    },
    followers: {
      age:     parseBreakdown(age,     'follower_demographics'),
      city:    parseBreakdown(city,    'follower_demographics'),
      country: parseBreakdown(country, 'follower_demographics'),
      gender:  parseBreakdown(gender,  'follower_demographics'),
    },
  }
}

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
  follows:                  number | null
  profileVisits:            number | null
  views:                    number | null
  reposts:                  number | null
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
    follows, profile_visits, views, reposts,
    reel_avg_watch_time, reel_video_view_total_time,
    video_duration, carousel_media_count, cover_image
  ) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12,
    $13, $14, $15, $16,
    $17, $18,
    $19, $20, $21
  )
  ON CONFLICT (media_id)
  DO UPDATE SET
    fetched_at                 = NOW(),
    caption                    = EXCLUDED.caption,
    reach                      = EXCLUDED.reach,
    saved                      = EXCLUDED.saved,
    comments                   = EXCLUDED.comments,
    shares                     = EXCLUDED.shares,
    total_interactions         = EXCLUDED.total_interactions,
    likes                      = EXCLUDED.likes,
    follows                    = EXCLUDED.follows,
    profile_visits             = EXCLUDED.profile_visits,
    views                      = EXCLUDED.views,
    reposts                    = EXCLUDED.reposts,
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
  hidden:          boolean | null
  parentId:        string | null
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
          likes_count, replies_count,
          hidden, parent_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (comment_id) DO UPDATE SET
          comment_text     = EXCLUDED.comment_text,
          comment_username = EXCLUDED.comment_username,
          likes_count      = EXCLUDED.likes_count,
          replies_count    = EXCLUDED.replies_count,
          hidden           = EXCLUDED.hidden`,
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
          item.hidden,          // $11
          item.parentId,        // $12
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
        item.follows,                // $13
        item.profileVisits,          // $14
        item.views,                  // $15
        item.reposts,                // $16
        item.reelAvgWatchTime,       // $17
        item.reelVideoViewTotalTime, // $18
        item.videoDuration,          // $19
        item.carouselMediaCount,     // $20
        item.coverImage,             // $21
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

// ─── Stories ──────────────────────────────────────────────────────────────────

export interface IgStoryItem {
  socialAccountId:   string
  mediaId:           string
  username:          string | null
  postedAt:          string | null
  mediaType:         string | null
  permalink:         string | null
  mediaUrl:          string | null
  thumbnailUrl:      string | null
  videoDuration:     number | null
  reach:             number | null
  replies:           number | null
  shares:            number | null
  follows:           number | null
  profileVisits:     number | null
  profileActivity:   number | null
  reposts:           number | null
  totalInteractions: number | null
  totalViews:        number | null
  facebookViews:     number | null
  navigation:        Record<string, number> | null
}

export async function saveIgStories(items: IgStoryItem[]): Promise<void> {
  if (items.length === 0) return
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      await client.query(
        `INSERT INTO l0_raw.ig_stories (
          social_account_id, media_id, username, posted_at, media_type, permalink,
          media_url, thumbnail_url, video_duration,
          reach, replies, shares, follows,
          profile_visits, profile_activity, reposts,
          total_interactions, total_views, facebook_views, navigation
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20
        )
        ON CONFLICT (media_id) DO UPDATE SET
          fetched_at         = NOW(),
          username           = EXCLUDED.username,
          video_duration     = EXCLUDED.video_duration,
          reach              = EXCLUDED.reach,
          replies            = EXCLUDED.replies,
          shares             = EXCLUDED.shares,
          follows            = EXCLUDED.follows,
          profile_visits     = EXCLUDED.profile_visits,
          profile_activity   = EXCLUDED.profile_activity,
          reposts            = EXCLUDED.reposts,
          total_interactions = EXCLUDED.total_interactions,
          total_views        = EXCLUDED.total_views,
          facebook_views     = EXCLUDED.facebook_views,
          navigation         = EXCLUDED.navigation`,
        [
          item.socialAccountId,                                          // $1
          item.mediaId,                                                  // $2
          item.username,                                                 // $3
          item.postedAt,                                                 // $4
          item.mediaType,                                                // $5
          item.permalink,                                                // $6
          item.mediaUrl,                                                 // $7
          item.thumbnailUrl,                                             // $8
          item.videoDuration,                                            // $9
          item.reach,                                                    // $10
          item.replies,                                                  // $11
          item.shares,                                                   // $12
          item.follows,                                                  // $13
          item.profileVisits,                                            // $14
          item.profileActivity,                                          // $15
          item.reposts,                                                  // $16
          item.totalInteractions,                                        // $17
          item.totalViews,                                               // $18
          item.facebookViews,                                            // $19
          item.navigation ? JSON.stringify(item.navigation) : null,     // $20
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

// ─── Tagged posts ─────────────────────────────────────────────────────────────

export interface IgTaggedPostItem {
  socialAccountId: string
  mediaId:         string
  postedAt:        string | null
  caption:         string | null
  mediaType:       string | null
  permalink:       string | null
  taggedBy:        string | null
  likeCount:       number | null
  commentCount:    number | null
  coverImage:      string | null
}

export async function saveIgTaggedPosts(items: IgTaggedPostItem[]): Promise<void> {
  if (items.length === 0) return
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      await client.query(
        `INSERT INTO l0_raw.ig_tagged_posts (
          social_account_id, media_id, posted_at,
          caption, media_type, permalink,
          tagged_by, like_count, comment_count,
          cover_image
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (social_account_id, media_id) DO UPDATE SET
          caption       = EXCLUDED.caption,
          media_type    = EXCLUDED.media_type,
          permalink     = EXCLUDED.permalink,
          tagged_by     = EXCLUDED.tagged_by,
          like_count    = EXCLUDED.like_count,
          comment_count = EXCLUDED.comment_count,
          cover_image   = EXCLUDED.cover_image,
          fetched_at    = NOW()`,
        [
          item.socialAccountId, // $1
          item.mediaId,         // $2
          item.postedAt,        // $3
          item.caption,         // $4
          item.mediaType,       // $5
          item.permalink,       // $6
          item.taggedBy,        // $7
          item.likeCount,       // $8
          item.commentCount,    // $9
          item.coverImage,      // $10
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
