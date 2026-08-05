import { fetchIgProfile, fetchFbProfile, apifyItemError } from '@/lib/apify/client'
import {
  isValidHandle, invalidHandleMessage, precheckAccount, notFoundMessage,
} from '@/lib/competitors/verify'

/**
 * Verifikasi keberadaan akun MILIK SENDIRI yang datanya diunggah manual (CSV/FPK).
 *
 * Bedanya dari verifikasi competitor: di sini profilnya ditarik lalu DIBUANG —
 * tidak ada snapshot yang disimpan. Yang dinilai cuma "akun ini ada atau tidak",
 * karena angka-angkanya nanti datang dari file yang diunggah, bukan dari scraping.
 *
 * Modul ini SERVER-ONLY: mengimpor @/lib/apify/client yang butuh APIFY_API_TOKEN.
 * Jangan diimpor dari komponen klien — pakai isValidHandle dari
 * @/lib/competitors/verify untuk validasi format di sisi klien.
 */

export type AccountCheck =
  /** Terbukti ada, atau tidak ada alasan untuk menolak. */
  | { state: 'exists' }
  /** Terbukti tidak ada / tidak mungkin valid → tolak. */
  | { state: 'rejected'; message: string }
  /** Tidak bisa dipastikan (Apify error, platform memblokir) → JANGAN blokir. */
  | { state: 'unverified'; reason: string }

export async function checkAccountExists(
  platform: string,
  username: string,
  opts: { apify?: boolean } = {},
): Promise<AccountCheck> {
  // 1. Format — instan, gratis, dan menangkap kasus paling sering (salah ketik,
  //    spasi ikut tersalin). Juga wajib: handle berspasi membuat actor Apify
  //    menolak start-run, bukan sekadar tidak menemukan akunnya.
  if (!isValidHandle(platform, username)) {
    return { state: 'rejected', message: invalidHandleMessage(platform, username) }
  }

  // 2. Pre-check gratis. Hanya 'not_found' yang menolak — lihat catatan di
  //    @/lib/competitors/verify soal kenapa IG/FB selalu 'unknown'.
  const pre = await precheckAccount(platform, username)
  if (pre.state === 'not_found') {
    return { state: 'rejected', message: notFoundMessage(platform, username) }
  }

  // 3. TikTok berhenti di sini: oEmbed sudah definitif, dan menariknya lewat
  //    Apify justru lebih buruk — akun TikTok valid yang belum pernah posting
  //    tidak mengembalikan authorMeta, jadi akan salah ditolak.
  if (platform === 'tiktok') {
    return pre.state === 'exists' ? { state: 'exists' } : { state: 'unverified', reason: pre.reason }
  }

  if (opts.apify === false) {
    return pre.state === 'exists' ? { state: 'exists' } : { state: 'unverified', reason: 'Apify dilewati' }
  }

  // 4. Apify — satu-satunya jawaban definitif untuk Instagram dan Facebook.
  try {
    if (platform === 'instagram') {
      const profile = await fetchIgProfile(username)
      return judge(profile, !!profile?.id, `Instagram @${username}`, platform, username)
    }
    if (platform === 'facebook') {
      const profile = await fetchFbProfile(username)
      return judge(profile, !!(profile?.facebookId ?? profile?.pageId), `Facebook /${username}`, platform, username)
    }
    return { state: 'unverified', reason: `${platform} tidak punya verifikasi Apify` }
  } catch (err) {
    // Apify 500, timeout, token bermasalah — semuanya soal kita, bukan soal
    // akunnya. Memblokir unggahan di sini akan menahan data yang sah.
    return { state: 'unverified', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Terjemahkan satu item profil Apify menjadi keputusan.
 *
 * Item error dengan kode 'gone' (not_found / not_available) satu-satunya yang
 * menolak. Kode lain dan bentuk tak dikenali dianggap belum terverifikasi —
 * prinsip yang sama dipakai di seluruh alur competitor: hanya jawaban negatif
 * yang PASTI boleh menggagalkan sesuatu.
 */
function judge(
  item: unknown, hasIdentity: boolean, label: string, platform: string, username: string,
): AccountCheck {
  const err = apifyItemError(item)
  if (err?.gone) {
    return {
      state: 'rejected',
      message: `${notFoundMessage(platform, username)} (${label}: ${err.code})`,
    }
  }
  if (err) return { state: 'unverified', reason: `${label}: ${err.code}` }
  if (!item || !hasIdentity) return { state: 'unverified', reason: `${label}: profil tanpa id` }
  return { state: 'exists' }
}
