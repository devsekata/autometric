import { fetchFbProfile, fetchFbPosts, fetchTiktokPosts, fetchIgProfile, fetchIgPosts } from '@/lib/apify/client'
import {
  saveFbCompetitorSnapshot, saveFbCompetitorMedias,
  saveTiktokCompetitorSnapshot, saveTiktokCompetitorMedias,
  saveIgCompetitorSnapshot, saveIgCompetitorMedias,
} from '@/lib/apify/queries'
import type { CompetitorSyncAccount } from './queries'

const COMPETITOR_POST_DAYS = 30

// Daily profile snapshot for one competitor. Returns the number of snapshots
// written (always 1 on success). Mirrors the per-platform initial-sync flows,
// but profile-only — the avatar/profile_url backfill already happened on add.
export async function syncCompetitorProfile(acct: CompetitorSyncAccount): Promise<number> {
  switch (acct.platform) {
    case 'instagram': {
      const profile = await fetchIgProfile(acct.username)
      if (!profile) throw new Error(`Instagram account "${acct.username}" not found`)
      await saveIgCompetitorSnapshot(acct.socialAccountId, acct.username, profile)
      return 1
    }
    case 'facebook': {
      const profile = await fetchFbProfile(acct.username)
      if (!profile) throw new Error(`Facebook page "${acct.username}" not found`)
      await saveFbCompetitorSnapshot(acct.socialAccountId, acct.username, profile)
      return 1
    }
    case 'tiktok': {
      // TikTok profile is embedded in posts (authorMeta). Pull the latest few
      // purely to capture the current profile state.
      const latest = await fetchTiktokPosts(acct.username, null, 5)
      const author = latest.find(p => p.authorMeta)?.authorMeta ?? null
      if (!author) throw new Error(`TikTok account "${acct.username}" returned no profile`)
      await saveTiktokCompetitorSnapshot(acct.socialAccountId, acct.username, author)
      return 1
    }
    default:
      throw new Error(`Unsupported competitor platform: ${acct.platform}`)
  }
}

// Monthly posts sync (last COMPETITOR_POST_DAYS) for one competitor. Returns the
// number of posts written. Saves are idempotent (ON CONFLICT upsert).
export async function syncCompetitorPosts(acct: CompetitorSyncAccount): Promise<number> {
  switch (acct.platform) {
    case 'instagram': {
      const posts = await fetchIgPosts(acct.username, COMPETITOR_POST_DAYS)
      await saveIgCompetitorMedias(acct.socialAccountId, posts)
      return posts.length
    }
    case 'facebook': {
      const posts = await fetchFbPosts(acct.username, COMPETITOR_POST_DAYS)
      await saveFbCompetitorMedias(acct.socialAccountId, posts)
      return posts.length
    }
    case 'tiktok': {
      const posts = await fetchTiktokPosts(acct.username, COMPETITOR_POST_DAYS)
      await saveTiktokCompetitorMedias(acct.socialAccountId, posts)
      return posts.length
    }
    default:
      throw new Error(`Unsupported competitor platform: ${acct.platform}`)
  }
}
