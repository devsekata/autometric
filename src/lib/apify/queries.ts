import pool from '@/lib/db'
import type {
  ApifyFbProfile, ApifyFbPost, ApifyFbPostMedia,
  ApifyTiktokAuthorMeta, ApifyTiktokPost,
  ApifyIgProfile, ApifyIgPost,
} from './client'

function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return []
  return text.match(/#[\wÀ-￿]+/g) ?? []
}

function mediaUrls(media: ApifyFbPostMedia[] | undefined): string[] {
  if (!Array.isArray(media)) return []
  return media
    .map(m => m.image?.uri)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
}

// Apify FB profile creation_date comes as "September 29, 2023" → 'YYYY-MM-DD'
function parseCreationDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

// info can be an array of lines or a single string
function joinInfo(info: ApifyFbProfile['info']): string | null {
  if (Array.isArray(info)) return info.map(String).join('\n')
  return info ? String(info) : null
}

// page_name = title before the "|" separator (e.g. "VinFast | Indonesia" → "VinFast")
function pageNameFromTitle(title: string | null | undefined): string | null {
  if (!title) return null
  return title.split('|')[0].trim() || null
}

export async function saveFbCompetitorSnapshot(
  socialAccountId: string,
  username: string,
  profile: ApifyFbProfile,
): Promise<void> {
  const categories   = Array.isArray(profile.categories) ? profile.categories : null
  const websitesLink = Array.isArray(profile.websites)   ? profile.websites   : null

  await pool.query(
    `INSERT INTO l0_raw.fb_competitor_snapshots
       (social_account_id, username, account_id, page_id, page_name, page_title,
        follower_count, like_count, rating_count, email, creation_date,
        categories, info, intro, websites_link, page_url, profile_photo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
     DO UPDATE SET
       username       = EXCLUDED.username,
       account_id     = EXCLUDED.account_id,
       page_id        = EXCLUDED.page_id,
       page_name      = EXCLUDED.page_name,
       page_title     = EXCLUDED.page_title,
       follower_count = EXCLUDED.follower_count,
       like_count     = EXCLUDED.like_count,
       rating_count   = EXCLUDED.rating_count,
       email          = EXCLUDED.email,
       creation_date  = EXCLUDED.creation_date,
       categories     = EXCLUDED.categories,
       info           = EXCLUDED.info,
       intro          = EXCLUDED.intro,
       websites_link  = EXCLUDED.websites_link,
       page_url       = EXCLUDED.page_url,
       profile_photo  = EXCLUDED.profile_photo`,
    [
      socialAccountId,
      username,
      profile.facebookId ?? null,
      profile.pageId ?? null,
      pageNameFromTitle(profile.title) ?? profile.pageName ?? null,
      profile.title ?? null,
      profile.followers ?? null,
      profile.likes ?? null,
      profile.ratingCount ?? null,
      profile.email ?? null,
      parseCreationDate(profile.creation_date),
      categories,
      joinInfo(profile.info),
      profile.intro ?? null,
      websitesLink,
      profile.facebookUrl ?? profile.pageUrl ?? null,
      profile.profilePhoto ?? null,
    ],
  )
}

export async function saveFbCompetitorMedias(
  socialAccountId: string,
  posts: ApifyFbPost[],
): Promise<void> {
  if (posts.length === 0) return

  for (const post of posts) {
    const postId = post.postId
    if (!postId) continue

    const postDate   = post.time ? new Date(post.time).toISOString() : null
    const caption    = post.text ?? null
    const url        = post.topLevelUrl ?? post.url ?? null
    const pageName   = post.user?.name ?? null
    const media      = mediaUrls(post.media)
    // First media element is the post-link object, not an image → length - 1, min 0
    const mediaCount = Array.isArray(post.media) ? Math.max(0, post.media.length - 1) : 0
    const hashtags   = extractHashtags(caption)

    await pool.query(
      `INSERT INTO l0_raw.fb_competitor_media
         (social_account_id, post_id, post_date, caption, url, page_name,
          like_count, share_count, top_reactions_count,
          media_count, media, hashtags_list, hashtags_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (social_account_id, post_id) DO UPDATE SET
         caption             = COALESCE(fb_competitor_media.caption, EXCLUDED.caption),
         url                 = COALESCE(fb_competitor_media.url, EXCLUDED.url),
         page_name           = EXCLUDED.page_name,
         like_count          = EXCLUDED.like_count,
         share_count         = EXCLUDED.share_count,
         top_reactions_count = EXCLUDED.top_reactions_count,
         media_count         = EXCLUDED.media_count,
         media               = COALESCE(fb_competitor_media.media, EXCLUDED.media),
         hashtags_list       = COALESCE(fb_competitor_media.hashtags_list, EXCLUDED.hashtags_list),
         hashtags_count      = COALESCE(fb_competitor_media.hashtags_count, EXCLUDED.hashtags_count),
         fetched_at          = NOW()`,
      [
        socialAccountId, postId, postDate, caption, url, pageName,
        post.likes ?? null, post.shares ?? null, post.topReactionsCount ?? null,
        mediaCount, media, hashtags, hashtags.length,
      ],
    )
  }
}

// --- TikTok ---

function hashtagNames(hashtags: ApifyTiktokPost['hashtags']): string[] {
  if (!Array.isArray(hashtags)) return []
  return hashtags
    .map(h => h?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
}

export async function saveTiktokCompetitorSnapshot(
  socialAccountId: string,
  username: string,
  author: ApifyTiktokAuthorMeta,
): Promise<void> {
  const commerce = author.commerceUserInfo ?? null

  await pool.query(
    `INSERT INTO l0_raw.tiktok_competitor_snapshots
       (social_account_id, username, account_id, account_nickname,
        following_count, follower_count, video_count, like_count,
        is_verified, bio_signature, bio_link, is_private, is_seller,
        is_commerce_user, commerce_user_category, avatar)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'))
     DO UPDATE SET
       username               = EXCLUDED.username,
       account_id             = EXCLUDED.account_id,
       account_nickname       = EXCLUDED.account_nickname,
       following_count        = EXCLUDED.following_count,
       follower_count         = EXCLUDED.follower_count,
       video_count            = EXCLUDED.video_count,
       like_count             = EXCLUDED.like_count,
       is_verified            = EXCLUDED.is_verified,
       bio_signature          = EXCLUDED.bio_signature,
       bio_link               = EXCLUDED.bio_link,
       is_private             = EXCLUDED.is_private,
       is_seller              = EXCLUDED.is_seller,
       is_commerce_user       = EXCLUDED.is_commerce_user,
       commerce_user_category = EXCLUDED.commerce_user_category,
       avatar                 = EXCLUDED.avatar`,
    [
      socialAccountId,
      username,
      author.id ?? null,
      author.nickName ?? null,
      author.following ?? null,
      author.fans ?? null,
      author.video ?? null,
      author.heart ?? null,
      author.verified ?? null,
      author.signature ?? null,
      author.bioLink ?? null,
      author.privateAccount ?? null,
      author.ttSeller ?? null,
      commerce?.commerceUser ?? false,
      commerce?.category ?? null,
      author.avatar ?? author.originalAvatarUrl ?? null,
    ],
  )
}

export async function saveTiktokCompetitorMedias(
  socialAccountId: string,
  posts: ApifyTiktokPost[],
): Promise<void> {
  if (posts.length === 0) return

  for (const post of posts) {
    const postId = post.id
    if (!postId) continue

    const postDate = post.createTimeISO
      ? new Date(post.createTimeISO).toISOString()
      : post.createTime
        ? new Date(post.createTime * 1000).toISOString()
        : null

    const isSlideshow = post.isSlideshow === true
    const mediaType   = isSlideshow ? 'image' : 'video'
    const slideCount  = isSlideshow && Array.isArray(post.slideshowImageLinks)
      ? post.slideshowImageLinks.length
      : 0

    const hashtags = hashtagNames(post.hashtags)
    const mentions = Array.isArray(post.mentions) ? post.mentions : []

    await pool.query(
      `INSERT INTO l0_raw.tiktok_competitor_media
         (social_account_id, post_id, post_date, caption, caption_language,
          media_type, slide_count, like_count, comment_count, play_count,
          saved_count, share_count, video_duration, hashtags_list, hashtags_count,
          mentions, url, cover_image, is_pinned, is_sponsored, is_ad,
          music_title, music_author)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (social_account_id, post_id) DO UPDATE SET
         post_date        = EXCLUDED.post_date,
         caption          = EXCLUDED.caption,
         caption_language = EXCLUDED.caption_language,
         media_type       = EXCLUDED.media_type,
         slide_count      = EXCLUDED.slide_count,
         like_count       = EXCLUDED.like_count,
         comment_count    = EXCLUDED.comment_count,
         play_count       = EXCLUDED.play_count,
         saved_count      = EXCLUDED.saved_count,
         share_count      = EXCLUDED.share_count,
         video_duration   = EXCLUDED.video_duration,
         hashtags_list    = EXCLUDED.hashtags_list,
         hashtags_count   = EXCLUDED.hashtags_count,
         mentions         = EXCLUDED.mentions,
         url              = EXCLUDED.url,
         cover_image      = EXCLUDED.cover_image,
         is_pinned        = EXCLUDED.is_pinned,
         is_sponsored     = EXCLUDED.is_sponsored,
         is_ad            = EXCLUDED.is_ad,
         music_title      = EXCLUDED.music_title,
         music_author     = EXCLUDED.music_author,
         fetched_at       = NOW()`,
      [
        socialAccountId, postId, postDate, post.text ?? null, post.textLanguage ?? null,
        mediaType, slideCount, post.diggCount ?? null, post.commentCount ?? null, post.playCount ?? null,
        post.collectCount ?? null, post.shareCount ?? null, post.videoMeta?.duration ?? null, hashtags, hashtags.length,
        mentions, post.webVideoUrl ?? null, post.videoMeta?.coverUrl ?? null,
        post.isPinned ?? null, post.isSponsored ?? null, post.isAd ?? null,
        post.musicMeta?.musicName ?? null, post.musicMeta?.musicAuthor ?? null,
      ],
    )
  }
}

// --- Instagram ---
// Writes to the same l0_raw.ig_competitor_* tables the Hiker flow used — only the
// data source changed (Apify apify~instagram-scraper), so the schema is untouched.

// Apify IG post.type ('Image'|'Video'|'Sidecar') + productType ('clips' = reel)
// → the media_type labels the medallion layer already expects.
function igMediaTypeLabel(type: string | undefined, productType: string | undefined): string {
  if (type === 'Sidecar') return 'CAROUSEL_ALBUM'
  if (type === 'Video' && productType === 'clips') return 'REELS'
  if (type === 'Video') return 'VIDEO'
  return 'IMAGE'
}

function igMentions(taggedUsers: ApifyIgPost['taggedUsers']): string[] {
  if (!Array.isArray(taggedUsers)) return []
  return taggedUsers
    .map(u => u?.username)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
}

function igBioLinks(externalUrls: ApifyIgProfile['externalUrls'], externalUrl: string | null | undefined): string[] | null {
  const links: string[] = []
  if (Array.isArray(externalUrls)) {
    for (const e of externalUrls) {
      if (typeof e?.url === 'string' && e.url.length > 0) links.push(e.url)
    }
  }
  if (externalUrl && !links.includes(externalUrl)) links.push(externalUrl)
  return links.length > 0 ? links : null
}

export async function saveIgCompetitorSnapshot(
  socialAccountId: string,
  username: string,
  profile: ApifyIgProfile,
): Promise<void> {
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
      profile.username ?? username,
      profile.fullName ?? null,
      profile.biography ?? null,
      profile.verified ?? null,
      profile.followersCount ?? null,
      profile.followsCount ?? null,
      profile.postsCount ?? null,
      profile.private ?? null,
      profile.isBusinessAccount ?? null,
      profile.businessCategoryName ?? null,
      profile.externalUrl ?? null,
      igBioLinks(profile.externalUrls, profile.externalUrl),
    ],
  )
}

export async function saveIgCompetitorMedias(
  socialAccountId: string,
  posts: ApifyIgPost[],
): Promise<void> {
  if (posts.length === 0) return

  for (const post of posts) {
    const mediaId = post.id
    if (!mediaId) continue

    const postedAt   = post.timestamp ? new Date(post.timestamp).toISOString() : null
    const caption    = post.caption ?? null
    const mediaType  = igMediaTypeLabel(post.type, post.productType)
    const shortcode  = post.shortCode ?? null
    const permalink  = post.url ?? (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null)
    const coverImage = post.displayUrl ?? null
    const slideCount = post.type === 'Sidecar'
      ? (post.childPosts?.length ?? post.images?.length ?? null)
      : null
    const videoDuration = post.videoDuration ?? null
    const hashtags   = Array.isArray(post.hashtags) ? post.hashtags : []
    const mentions   = igMentions(post.taggedUsers)
    const isCollaborator    = (post.coauthorProducers?.length ?? 0) > 0
    const isSponsored       = post.isSponsored ?? null
    const isCommentDisabled = post.isCommentsDisabled ?? null
    const isPinned          = post.isPinned ?? null
    const musicTitle  = post.musicInfo?.song_name ?? null
    const musicAuthor = post.musicInfo?.artist_name ?? null
    const likeCount    = post.likesCount ?? null
    const commentCount = post.commentsCount ?? null
    const viewCount    = post.videoViewCount ?? post.videoPlayCount ?? null

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
        socialAccountId, mediaId, postedAt, caption, mediaType,
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
