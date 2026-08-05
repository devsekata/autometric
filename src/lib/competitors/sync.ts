import {
  fetchFbProfile, fetchFbPosts, fetchTiktokPosts, fetchIgProfile, fetchIgPosts, apifyItemError,
} from '@/lib/apify/client'
import {
  saveFbCompetitorSnapshot, saveFbCompetitorMedias,
  saveTiktokCompetitorSnapshot, saveTiktokCompetitorMedias,
  saveIgCompetitorSnapshot, saveIgCompetitorMedias,
} from '@/lib/apify/queries'
import type { CompetitorSyncAccount } from './queries'
import { AccountNotFoundError, assertValidHandle } from './verify'

const COMPETITOR_POST_DAYS = 30

/**
 * Sama seperti assertProfileItem di @/lib/apify/sync, dipakai jalur harian.
 *
 * Actor Apify membalas satu item penanda error untuk akun yang tidak ada, bukan
 * dataset kosong — jadi pengecekan truthy saja meloloskan akun hantu. Kode 'gone'
 * memicu AccountNotFoundError (scheduler melepas linknya); kode lain dianggap
 * sementara supaya competitor yang valid tidak ikut terhapus.
 */
function assertProfileItem(item: unknown, hasIdentity: boolean, label: string): void {
  const err = apifyItemError(item)
  if (err) {
    const msg = `${label}: ${err.code}${err.description ? ` — ${err.description}` : ''}`
    throw err.gone ? new AccountNotFoundError(msg) : new Error(msg)
  }
  if (!hasIdentity) throw new Error(`${label}: profil tanpa id, bentuk respons tak dikenali`)
}

// Daily profile snapshot for one competitor. Returns the number of snapshots
// written (always 1 on success). Mirrors the per-platform initial-sync flows,
// but profile-only — the avatar/profile_url backfill already happened on add.
export async function syncCompetitorProfile(acct: CompetitorSyncAccount): Promise<number> {
  // Sebelum menyentuh Apify: handle yang melanggar pola actor tidak akan pernah
  // berhasil. Melemparnya di sini melepas linknya lewat jalur not-found dan
  // menghemat satu start-run yang pasti gagal.
  assertValidHandle(acct.platform, acct.username)
  switch (acct.platform) {
    case 'instagram': {
      const profile = await fetchIgProfile(acct.username)
      if (!profile) throw new AccountNotFoundError(`Instagram account "${acct.username}" not found`)
      assertProfileItem(profile, !!profile.id, `Instagram @${acct.username}`)
      await saveIgCompetitorSnapshot(acct.socialAccountId, acct.username, profile)
      return 1
    }
    case 'facebook': {
      const profile = await fetchFbProfile(acct.username)
      if (!profile) throw new AccountNotFoundError(`Facebook page "${acct.username}" not found`)
      assertProfileItem(profile, !!(profile.facebookId ?? profile.pageId), `Facebook /${acct.username}`)
      await saveFbCompetitorSnapshot(acct.socialAccountId, acct.username, profile)
      return 1
    }
    case 'tiktok': {
      // TikTok profile is embedded in posts (authorMeta). Pull the latest few
      // purely to capture the current profile state.
      const latest = await fetchTiktokPosts(acct.username, null, 5)
      const author = latest.find(p => p.authorMeta)?.authorMeta ?? null
      // Bukan AccountNotFoundError — akun kosong/private juga tanpa authorMeta.
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
  assertValidHandle(acct.platform, acct.username)
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
