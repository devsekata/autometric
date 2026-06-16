import { fetchFbProfile, fetchFbPosts, fetchTiktokPosts } from './client'
import type { ApifyTiktokPost } from './client'
import {
  saveFbCompetitorSnapshot, saveFbCompetitorMedias,
  saveTiktokCompetitorSnapshot, saveTiktokCompetitorMedias,
} from './queries'
import { updateSocialAccountProfile } from '@/lib/brands/queries'
import { uploadAvatarFromUrl } from '@/lib/cloudinary/upload'

const COMPETITOR_POST_DAYS = 30

export type FbCompetitorSyncResult = {
  fb_competitor_profile: { count: number; error: string | null }
  fb_competitor_posts:   { count: number; error: string | null }
}

// Initial sync for a Facebook competitor — profile + posts (last 30 days) via Apify.
// Mirrors the Instagram/Hiker competitor flow, but the profile fetch (incl. avatar
// upload) runs here in the background because Apify runs take minutes.
export async function initialFbCompetitorSync(
  socialAccountId: string,
  username: string,
): Promise<FbCompetitorSyncResult> {
  const [profileResult, postsResult] = await Promise.allSettled([
    // 1. Profile snapshot (today) + avatar upload + social_account backfill
    (async () => {
      const profile = await fetchFbProfile(username)
      if (!profile) throw new Error(`Facebook page "${username}" not found`)

      await saveFbCompetitorSnapshot(socialAccountId, username, profile)

      const avatarSource = profile.profilePictureUrl ?? null
      const avatarUrl = avatarSource
        ? await uploadAvatarFromUrl(avatarSource, `competitor_fb_${username}`)
        : null

      await updateSocialAccountProfile(socialAccountId, {
        avatarUrl,
        profileUrl:     profile.facebookUrl ?? profile.pageUrl ?? `https://www.facebook.com/${username}`,
        platformUserId: profile.facebookId ?? profile.pageId ?? null,
      })
      return 1
    })(),

    // 2. Posts — last 30 days
    (async () => {
      const posts = await fetchFbPosts(username, COMPETITOR_POST_DAYS)
      await saveFbCompetitorMedias(socialAccountId, posts)
      return posts.length
    })(),
  ])

  const errMsg = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected'
      ? (r.reason instanceof Error ? r.reason.message : String(r.reason))
      : null

  return {
    fb_competitor_profile: profileResult.status === 'fulfilled'
      ? { count: 1,                           error: null }
      : { count: 0,                           error: errMsg(profileResult) },
    fb_competitor_posts:   postsResult.status === 'fulfilled'
      ? { count: postsResult.value as number, error: null }
      : { count: 0,                           error: errMsg(postsResult) },
  }
}

export type TiktokCompetitorSyncResult = {
  tiktok_competitor_profile: { count: number; error: string | null }
  tiktok_competitor_posts:   { count: number; error: string | null }
}

// Initial sync for a TikTok competitor via Apify (clockworks~tiktok-scraper).
// Unlike Facebook, ONE actor run returns both the posts and the profile — the
// profile (authorMeta) is embedded in every post. So we fetch once, then save
// the snapshot and the posts independently. If the account has no posts in the
// 30-day window, we fall back to the latest few posts purely to capture profile.
export async function initialTiktokCompetitorSync(
  socialAccountId: string,
  username: string,
): Promise<TiktokCompetitorSyncResult> {
  const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e))

  let posts: ApifyTiktokPost[] = []
  try {
    posts = await fetchTiktokPosts(username, COMPETITOR_POST_DAYS)
  } catch (err) {
    // A failed fetch means neither profile nor posts can be saved.
    const msg = errStr(err)
    return {
      tiktok_competitor_profile: { count: 0, error: msg },
      tiktok_competitor_posts:   { count: 0, error: msg },
    }
  }

  // Find authorMeta from the window's posts; fall back to latest posts if empty.
  let author = posts.find(p => p.authorMeta)?.authorMeta ?? null
  if (!author) {
    try {
      const latest = await fetchTiktokPosts(username, null, 5)
      author = latest.find(p => p.authorMeta)?.authorMeta ?? null
    } catch {
      // ignore — profile branch reports the missing-author error below
    }
  }

  let profileResult: { count: number; error: string | null }
  try {
    if (!author) throw new Error(`TikTok account "${username}" returned no posts/profile`)
    await saveTiktokCompetitorSnapshot(socialAccountId, username, author)

    const avatarSource = author.avatar ?? author.originalAvatarUrl ?? null
    const avatarUrl = avatarSource
      ? await uploadAvatarFromUrl(avatarSource, `competitor_tiktok_${username}`)
      : null

    await updateSocialAccountProfile(socialAccountId, {
      avatarUrl,
      profileUrl:     author.profileUrl ?? `https://www.tiktok.com/@${username}`,
      platformUserId: author.id ?? null,
    })
    profileResult = { count: 1, error: null }
  } catch (err) {
    profileResult = { count: 0, error: errStr(err) }
  }

  let postsResult: { count: number; error: string | null }
  try {
    await saveTiktokCompetitorMedias(socialAccountId, posts)
    postsResult = { count: posts.length, error: null }
  } catch (err) {
    postsResult = { count: 0, error: errStr(err) }
  }

  return {
    tiktok_competitor_profile: profileResult,
    tiktok_competitor_posts:   postsResult,
  }
}
