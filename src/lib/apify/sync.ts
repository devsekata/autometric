import { fetchFbProfile, fetchFbPosts, fetchTiktokPosts, fetchIgProfile, fetchIgPosts, apifyItemError } from './client'
import type { ApifyTiktokPost } from './client'
import {
  saveFbCompetitorSnapshot, saveFbCompetitorMedias,
  saveTiktokCompetitorSnapshot, saveTiktokCompetitorMedias,
  saveIgCompetitorSnapshot, saveIgCompetitorMedias,
} from './queries'
import { updateSocialAccountProfile } from '@/lib/brands/queries'
import { uploadAvatarFromUrl } from '@/lib/cloudinary/upload'
import { AccountNotFoundError, assertValidHandle } from '@/lib/competitors/verify'

const COMPETITOR_POST_DAYS = 30

/** Satu kaki hasil sync: berapa baris masuk, dan kenapa gagal kalau gagal. */
export type SyncLeg = { count: number; error: string | null }

const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e))

const settledLeg = (r: PromiseSettledResult<number>): SyncLeg =>
  r.status === 'fulfilled'
    ? { count: r.value, error: null }
    : { count: 0,       error: errStr(r.reason) }

export interface CompetitorSyncOptions {
  /**
   * Dipanggil begitu kaki PROFILE selesai, tanpa menunggu kaki posts.
   *
   * Murni soal lama user menunggu. Verifikasi hanya membaca kaki profile (lihat
   * outcomeFromProfileLeg), tapi Promise fungsi ini baru resolve setelah KEDUA
   * kaki selesai — dan kaki posts (30 hari, sampai 1000 post) bisa jalan
   * bermenit-menit. Tanpa kanal ini, jawaban yang sudah ada di detik ke-30 baru
   * sampai ke user di menit ke-3, sering setelah UI-nya menyerah menunggu.
   *
   * TikTok tidak punya opsi ini: profilnya menumpang di respons posts (satu
   * actor run), jadi memang tidak ada yang bisa diumumkan lebih awal.
   */
  onProfileSettled?: (leg: SyncLeg) => void
}

/**
 * Umumkan hasil kaki profile lebih awal.
 *
 * Callback-nya diberi pagar sendiri: kaki profile sudah selesai mengerjakan
 * bagiannya (snapshot, avatar, backfill) sebelum ini dipanggil, jadi kalau
 * pemanggil melempar, itu tidak boleh menular jadi kegagalan sync.
 */
function announceProfile(profileLeg: Promise<number>, opts: CompetitorSyncOptions): void {
  const notify = opts.onProfileSettled
  if (!notify) return
  profileLeg
    .then(() => notify({ count: 1, error: null }), err => notify({ count: 0, error: errStr(err) }))
    .catch(e => console.error('[apify sync] onProfileSettled gagal:', e))
}

/**
 * Pastikan item profil dari Apify betul-betul profil, bukan penanda error.
 *
 * Wajib dipanggil sebelum menyimpan snapshot. Tanpa ini, akun salah ketik akan
 * lolos jadi 'verified' dan meninggalkan snapshot sampah di l0_raw — persisnya
 * yang terjadi sebelum guard ini ada, dan sebabnya beberapa competitor jelas-jelas
 * hasil typo masih terdaftar di produksi.
 *
 * Membedakan dua jenis kegagalan:
 *   - kode 'gone' (not_found / not_available) → AccountNotFoundError → link dilepas
 *   - kode lain / item tanpa identitas        → Error biasa → tetap 'pending', diulang
 */
function assertProfileItem(
  item: unknown, hasIdentity: boolean, label: string,
): void {
  const err = apifyItemError(item)
  if (err) {
    const msg = `${label}: ${err.code}${err.description ? ` — ${err.description}` : ''}`
    throw err.gone ? new AccountNotFoundError(msg) : new Error(msg)
  }
  // Tanpa error tapi juga tanpa id: bentuk yang tidak dikenali. Diperlakukan
  // sementara — lebih baik mengulang daripada menghapus competitor yang benar.
  if (!hasIdentity) throw new Error(`${label}: profil tanpa id, bentuk respons tak dikenali`)
}

export type IgCompetitorSyncResult = {
  ig_competitor_profile: { count: number; error: string | null }
  ig_competitor_posts:   { count: number; error: string | null }
}

// Initial sync for an Instagram competitor — profile + posts (last 30 days) via
// Apify (apify~instagram-scraper). Mirrors the Facebook flow: the profile fetch
// (incl. avatar upload + social_account backfill) runs here in the background
// because Apify runs take minutes.
export async function initialIgCompetitorSync(
  socialAccountId: string,
  username: string,
  opts: CompetitorSyncOptions = {},
): Promise<IgCompetitorSyncResult> {
  assertValidHandle('instagram', username)

  // 1. Profile snapshot (today) + avatar upload + social_account backfill
  const profileLeg = (async () => {
    const profile = await fetchIgProfile(username)
    if (!profile) throw new AccountNotFoundError(`Instagram account "${username}" not found`)
    assertProfileItem(profile, !!profile.id, `Instagram @${username}`)

    await saveIgCompetitorSnapshot(socialAccountId, username, profile)

    const avatarSource = profile.profilePicUrlHD ?? profile.profilePicUrl ?? null
    const avatarUrl = avatarSource
      ? await uploadAvatarFromUrl(avatarSource, `competitor_ig_${username}`)
      : null

    await updateSocialAccountProfile(socialAccountId, {
      avatarUrl,
      profileUrl:     `https://www.instagram.com/${username}`,
      platformUserId: profile.id ?? null,
    })
    return 1
  })()
  announceProfile(profileLeg, opts)

  // 2. Posts — last 30 days
  const postsLeg = (async () => {
    const posts = await fetchIgPosts(username, COMPETITOR_POST_DAYS)
    await saveIgCompetitorMedias(socialAccountId, posts)
    return posts.length
  })()

  const [profileResult, postsResult] = await Promise.allSettled([profileLeg, postsLeg])

  return {
    ig_competitor_profile: settledLeg(profileResult),
    ig_competitor_posts:   settledLeg(postsResult),
  }
}

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
  opts: CompetitorSyncOptions = {},
): Promise<FbCompetitorSyncResult> {
  assertValidHandle('facebook', username)

  // 1. Profile snapshot (today) + avatar upload + social_account backfill
  const profileLeg = (async () => {
    const profile = await fetchFbProfile(username)
    if (!profile) throw new AccountNotFoundError(`Facebook page "${username}" not found`)
    assertProfileItem(profile, !!(profile.facebookId ?? profile.pageId), `Facebook /${username}`)

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
  })()
  announceProfile(profileLeg, opts)

  // 2. Posts — last 30 days
  const postsLeg = (async () => {
    const posts = await fetchFbPosts(username, COMPETITOR_POST_DAYS)
    await saveFbCompetitorMedias(socialAccountId, posts)
    return posts.length
  })()

  const [profileResult, postsResult] = await Promise.allSettled([profileLeg, postsLeg])

  return {
    fb_competitor_profile: settledLeg(profileResult),
    fb_competitor_posts:   settledLeg(postsResult),
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
//
// Konsekuensinya: tidak ada CompetitorSyncOptions.onProfileSettled di sini —
// profilnya baru diketahui setelah posts-nya turun, jadi tidak ada yang bisa
// diumumkan lebih awal. Verifikasi TikTok tetap menunggu hasil lengkap, tapi
// typo-nya sudah tertangkap pre-check oEmbed di jalur add (lihat verify.ts).
export async function initialTiktokCompetitorSync(
  socialAccountId: string,
  username: string,
): Promise<TiktokCompetitorSyncResult> {
  assertValidHandle('tiktok', username)

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
    // SENGAJA bukan AccountNotFoundError: akun TikTok yang valid tapi belum
    // pernah posting (atau private) juga tidak mengembalikan authorMeta, dan
    // menghapusnya berarti membuang competitor yang benar. Typo TikTok sudah
    // ditangkap pre-check 404 di jalur add.
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
