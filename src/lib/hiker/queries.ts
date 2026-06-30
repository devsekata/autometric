import pool from '@/lib/db'
import type { HikerIgUser, HikerMediaItem } from './client'
import { mediaItemPk } from './client'

function mediaTypeLabel(type: number, productType?: string): string {
  if (type === 8) return 'CAROUSEL_ALBUM'
  if (type === 2 && productType === 'clips') return 'REELS'
  if (type === 2) return 'VIDEO'
  return 'IMAGE'
}

function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return []
  return (text.match(/#[\wÀ-￿-]+/g) ?? []).map(h => h.slice(1))
}

function extractMentions(usertags?: HikerMediaItem['usertags']): string[] {
  return usertags?.in?.map(t => t.user.username) ?? []
}

function coverImageFromItem(item: HikerMediaItem): string | null {
  // Regular image / reel: image_versions2
  const fromRoot = item.image_versions2?.candidates?.[0]?.url ?? null
  if (fromRoot) return fromRoot
  // Carousel: first child's image_versions2
  return item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url ?? null
}

export async function saveCompetitorSnapshot(
  socialAccountId: string,
  user: HikerIgUser,
): Promise<void> {
  const bioLinks = user.bio_links?.map(l => l.url) ?? null

  await pool.query(
    `INSERT INTO l0_raw.ig_competitor_snapshots
       (social_account_id, username, full_name, biography, is_verified,
        follower_count, following_count, media_count,
        is_private, is_business, account_category, external_url, bio_links)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
     DO UPDATE SET
       username         = EXCLUDED.username,
       full_name        = EXCLUDED.full_name,
       biography        = EXCLUDED.biography,
       is_verified      = EXCLUDED.is_verified,
       follower_count   = EXCLUDED.follower_count,
       following_count  = EXCLUDED.following_count,
       media_count      = EXCLUDED.media_count,
       is_private       = EXCLUDED.is_private,
       is_business      = EXCLUDED.is_business,
       account_category = EXCLUDED.account_category,
       external_url     = EXCLUDED.external_url,
       bio_links        = EXCLUDED.bio_links`,
    [
      socialAccountId,
      user.username,
      user.full_name,
      user.biography ?? null,
      user.is_verified,
      user.follower_count,
      user.following_count,
      user.media_count,
      user.is_private ?? null,
      user.is_business ?? null,
      user.account_category ?? null,
      user.external_url ?? null,
      bioLinks,
    ],
  )
}

export async function saveCompetitorMedias(
  socialAccountId: string,
  items: HikerMediaItem[],
): Promise<void> {
  if (items.length === 0) return

  for (const item of items) {
    const takenAtTs     = item['1ltaken_at'] ?? 0
    const postedAt      = takenAtTs ? new Date(takenAtTs * 1000).toISOString() : null
    const caption       = item.caption?.text ?? null
    const mediaType     = mediaTypeLabel(item.media_type, item.product_type)
    const shortcode     = item.code
    const permalink     = `https://www.instagram.com/p/${item.code}/`
    const coverImage    = coverImageFromItem(item)
    const slideCount    = item.carousel_media_count ?? (item.carousel_media?.length ?? null)
    const videoDuration = item['1fvideo_duration'] ?? null
    const hashtags      = extractHashtags(caption)
    const mentions      = extractMentions(item.usertags)
    const isCollaborator    = (item.coauthor_producers?.length ?? 0) > 0
    const isSponsored       = item.is_paid_partnership ?? ((item.sponsor_tags?.length ?? 0) > 0 ? true : null)
    const isCommentDisabled = item.comments_disabled ?? null
    const isPinned          = item.is_pinned ?? null
    const musicInfo    = item.music_metadata?.music_info?.music_asset_info
    const musicTitle   = musicInfo?.title ?? null
    const musicAuthor  = musicInfo?.display_artist ?? null
    const likeCount    = item.like_and_view_counts_disabled ? null : (item.like_count ?? null)
    const commentCount = item.comment_count ?? null
    const viewCount    = item.view_count ?? item.play_count ?? item.ig_play_count ?? null

    await pool.query(
      `INSERT INTO l0_raw.ig_competitor_media
         (social_account_id, media_id, posted_at, caption, media_type,
          shortcode, permalink, cover_image,
          slide_count, video_duration,
          hashtags_list, hashtags_count, mentions,
          is_collaborator, is_sponsored, is_comment_disabled, is_pinned,
          music_title, music_author,
          like_count, comment_count, view_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (social_account_id, media_id) DO UPDATE SET
         caption             = COALESCE(ig_competitor_media.caption, EXCLUDED.caption),
         cover_image         = COALESCE(ig_competitor_media.cover_image, EXCLUDED.cover_image),
         hashtags_list       = COALESCE(ig_competitor_media.hashtags_list, EXCLUDED.hashtags_list),
         hashtags_count      = COALESCE(ig_competitor_media.hashtags_count, EXCLUDED.hashtags_count),
         mentions            = COALESCE(ig_competitor_media.mentions, EXCLUDED.mentions),
         is_collaborator     = EXCLUDED.is_collaborator,
         is_sponsored        = EXCLUDED.is_sponsored,
         is_comment_disabled = EXCLUDED.is_comment_disabled,
         is_pinned           = EXCLUDED.is_pinned,
         music_title         = COALESCE(ig_competitor_media.music_title, EXCLUDED.music_title),
         music_author        = COALESCE(ig_competitor_media.music_author, EXCLUDED.music_author),
         like_count          = EXCLUDED.like_count,
         comment_count       = EXCLUDED.comment_count,
         view_count          = EXCLUDED.view_count,
         fetched_at          = NOW()`,
      [
        socialAccountId, mediaItemPk(item), postedAt, caption, mediaType,
        shortcode, permalink, coverImage,
        slideCount, videoDuration,
        hashtags, hashtags.length, mentions,
        isCollaborator, isSponsored, isCommentDisabled, isPinned,
        musicTitle, musicAuthor,
        likeCount, commentCount, viewCount,
      ],
    )
  }
}
