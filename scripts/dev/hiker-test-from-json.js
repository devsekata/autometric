/**
 * Test saveCompetitorSnapshot + saveCompetitorMedias dari JSON dump (tanpa panggil API).
 * Jalankan: node scripts/hiker-test-from-json.js <username> <social_account_id>
 */
require('dotenv').config({ path: '.env.local' })
const fs   = require('fs')
const path = require('path')
const { Pool } = require('pg')

const username        = process.argv[2]
const socialAccountId = process.argv[3]
if (!username || !socialAccountId) {
  console.error('Usage: node scripts/hiker-test-from-json.js <username> <social_account_id>')
  process.exit(1)
}

const pool   = new Pool({ connectionString: process.env.DATABASE_URL })
const outDir = path.join(__dirname, '../seeds/hiker')

// ── helpers (copy dari queries.ts) ────────────────────────────────────────────
function mediaTypeLabel(type, productType) {
  if (type === 8) return 'CAROUSEL_ALBUM'
  if (type === 2 && productType === 'clips') return 'REELS'
  if (type === 2) return 'VIDEO'
  return 'IMAGE'
}
function mediaItemPk(item) {
  if (item.pk) return item.pk
  if (item.id) return item.id.split('_')[0]
  throw new Error('no pk or id')
}
function extractHashtags(text) {
  if (!text) return []
  return (text.match(/#[\wÀ-￿-]+/g) ?? []).map(h => h.slice(1))
}
function extractMentions(usertags) {
  return usertags?.in?.map(t => t.user.username) ?? []
}
function coverImageFromItem(item) {
  const fromRoot = item.image_versions2?.candidates?.[0]?.url ?? null
  if (fromRoot) return fromRoot
  return item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url ?? null
}

async function saveSnapshot(user) {
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
      user.username, user.full_name,
      user.biography ?? null,
      user.is_verified,
      user.follower_count, user.following_count, user.media_count,
      user.is_private ?? null,
      user.is_business ?? null,
      user.account_category ?? null,
      user.external_url ?? null,
      bioLinks,
    ],
  )
}

async function saveMedias(items) {
  let saved = 0
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
    saved++
  }
  return saved
}

async function main() {
  // Load JSON
  const userFile  = path.join(outDir, `${username}_profile.json`)
  const mediaFile = path.join(outDir, `${username}_medias.json`)

  if (!fs.existsSync(userFile) || !fs.existsSync(mediaFile)) {
    console.error(`JSON files not found. Run: node scripts/hiker-dump.js ${username}`)
    process.exit(1)
  }

  const user      = JSON.parse(fs.readFileSync(userFile, 'utf8'))
  const mediaPages = JSON.parse(fs.readFileSync(mediaFile, 'utf8'))

  // Inspect raw fields
  console.log('\n=== PROFILE fields ===')
  console.log('username:', user.username)
  console.log('biography:', user.biography?.substring(0, 50))
  console.log('is_business:', user.is_business)
  console.log('account_category:', user.account_category)
  console.log('external_url:', user.external_url)
  console.log('bio_links:', JSON.stringify(user.bio_links?.slice(0, 2)))

  const allItems = mediaPages.flatMap(p => p.response?.items ?? [])
  console.log('\n=== MEDIA sample (first item) fields ===')
  if (allItems[0]) {
    const s = allItems[0]
    console.log('pk:', s.pk)
    console.log('code:', s.code)
    console.log('1ltaken_at (unix):', s['1ltaken_at'], '→', s['1ltaken_at'] ? new Date(s['1ltaken_at']*1000).toISOString() : null)
    console.log('media_type:', s.media_type, '| product_type:', s.product_type)
    console.log('caption.text:', s.caption?.text?.substring(0, 60))
    console.log('image_versions2 url:', s.image_versions2?.candidates?.[0]?.url ? 'EXISTS' : null)
    console.log('carousel_media_count:', s.carousel_media_count)
    console.log('1fvideo_duration:', s['1fvideo_duration'])
    console.log('like_count:', s.like_count, '| comment_count:', s.comment_count, '| view_count:', s.view_count)
    console.log('is_paid_partnership:', s.is_paid_partnership)
    console.log('comments_disabled:', s.comments_disabled)
    console.log('coauthor_producers:', s.coauthor_producers)
    console.log('clips_metadata music:', s.clips_metadata?.music_info?.music_asset_info?.title)
  }

  // Save to DB
  console.log('\n=== Saving to DB ===')
  await saveSnapshot(user)
  console.log('Snapshot saved ✓')

  const saved = await saveMedias(allItems)
  console.log(`Media saved: ${saved} items ✓`)

  // Verify
  const snap = await pool.query(
    `SELECT username, follower_count, is_business, account_category, external_url, bio_links
     FROM l0_raw.ig_competitor_snapshots WHERE social_account_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
    [socialAccountId]
  )
  console.log('\n=== Snapshot in DB ===')
  console.log(snap.rows[0])

  const stats = await pool.query(
    `SELECT COUNT(*) total,
            COUNT(caption) with_caption,
            COUNT(cover_image) with_cover,
            COUNT(hashtags_list) FILTER (WHERE hashtags_count > 0) with_hashtags,
            COUNT(*) FILTER (WHERE media_type = 'CAROUSEL_ALBUM') carousel,
            COUNT(cover_image) FILTER (WHERE media_type = 'CAROUSEL_ALBUM') carousel_with_cover
     FROM l0_raw.ig_competitor_media WHERE social_account_id = $1`,
    [socialAccountId]
  )
  console.log('\n=== Media in DB ===')
  console.log(stats.rows[0])

  await pool.end()
}

main().catch(console.error)
