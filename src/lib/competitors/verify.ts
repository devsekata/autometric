/**
 * Verifikasi keberadaan akun competitor.
 *
 * Ada DUA pengecekan, di dua waktu berbeda, dan keduanya perlu:
 *
 * 1. `precheckAccount()` — murah (~1-2 detik), dijalankan saat user klik Add.
 *    Cuma melihat status HTTP halaman profil publik; tidak menarik data, tidak
 *    lewat Apify, tidak ada biaya. Tugasnya HANYA menangkap salah tulis sebelum
 *    ada baris yang dibuat di database.
 *
 * 2. Apify initial sync (lihat @/lib/apify/sync) — definitif tapi 1-8 menit,
 *    jadi jalan di background. Inilah yang menentukan status akhir 'verified'
 *    atau menghapus linknya.
 */

/** Prefix penanda pada message error yang berarti "akunnya memang tidak ada". */
const NOT_FOUND_MARK = '[not-found]'

/**
 * Akun terbukti tidak ada di platform — beda dari gangguan sementara.
 *
 * Dibedakan karena aksinya beda: not-found menghapus link competitor, sedangkan
 * Apify 500 / `fetch failed` / timeout harus membiarkan statusnya 'pending' agar
 * scheduler harian mencoba lagi. Tanpa pembedaan ini, satu error transien di
 * Apify bisa menghapus competitor yang sebenarnya valid.
 */
export class AccountNotFoundError extends Error {
  constructor(message: string) {
    super(`${NOT_FOUND_MARK} ${message}`)
    this.name = 'AccountNotFoundError'
  }
}

/**
 * Apakah pesan error ini berarti akunnya tidak ada?
 *
 * Cocokkan penanda, bukan prosa Inggrisnya: pesan Apify berubah sewaktu-waktu,
 * dan salah baca di sini berarti menghapus competitor yang valid.
 */
export function isAccountNotFound(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.includes(NOT_FOUND_MARK)
}

/** Buang penanda internal sebelum pesan ditampilkan ke user. */
export function cleanErrorMessage(message: string): string {
  return message.replace(NOT_FOUND_MARK, '').trim()
}

/**
 * Charset handle yang diterima actor Apify.
 *
 * Ini batasan ACTOR, bukan cuma aturan platform. Actor Instagram menolak
 * start-run mentah-mentah kalau URL-nya tidak cocok:
 *
 *   Field input.directUrls.0 must match pattern
 *   ^(https:\/\/)?(www\.)?instagram\.com\/[A-Za-z0-9._-]+(\/.*)?$
 *
 * Jadi handle berspasi seperti "zx csdcsd" bukan sekadar tidak ditemukan — dia
 * membuat run gagal sebelum dimulai, setiap hari, selamanya. Divalidasi di sini
 * supaya tidak pernah masuk database, dan supaya yang sudah ada bisa dilepas.
 *
 * Facebook mengizinkan tanda hubung karena URL page vanity memang memakainya
 * (mis. /Some-Page-Name-12345/); Instagram dan TikTok tidak mengenal hubung.
 * Hanya berlaku untuk akun COMPETITOR — akun milik sendiri lewat OAuth boleh
 * punya `username` berupa nama tampilan (mis. "Fibonacci Space") dan tidak
 * pernah menyentuh actor ini.
 */
const HANDLE_RE: Record<string, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  tiktok:    /^[A-Za-z0-9._]{1,24}$/,
  facebook:  /^[A-Za-z0-9._-]{1,100}$/,
}

export function isValidHandle(platform: string, username: string): boolean {
  const re = HANDLE_RE[platform]
  return re ? re.test(username) : username.length > 0 && !/\s/.test(username)
}

export function invalidHandleMessage(platform: string, username: string): string {
  const label = PLATFORM_LABEL[platform] ?? platform
  const allowed = platform === 'facebook'
    ? 'huruf, angka, titik, garis bawah, dan tanda hubung'
    : 'huruf, angka, titik, dan garis bawah'
  return `"${username}" bukan username ${label} yang valid — hanya boleh ${allowed}, tanpa spasi.`
}

/**
 * Handle yang tidak mungkin valid = akun yang tidak mungkin ada.
 *
 * Dilempar sebagai AccountNotFoundError supaya scheduler melepas linknya, bukan
 * mengulanginya tiap hari. Dicek sendiri, TIDAK dengan membaca error
 * `invalid-input` dari Apify: error itu juga muncul kalau parameter actor lain
 * yang salah, dan salah tafsir di sana berarti menghapus semua competitor.
 */
export function assertValidHandle(platform: string, username: string): void {
  if (!isValidHandle(platform, username)) {
    throw new AccountNotFoundError(invalidHandleMessage(platform, username))
  }
}

export type PrecheckResult =
  | { state: 'exists' }
  | { state: 'not_found' }
  /** Platform menolak/memblokir kita — jawabannya tidak bisa dipercaya. */
  | { state: 'unknown'; reason: string }

const PRECHECK_TIMEOUT_MS = 6_000

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * Kenapa hanya TikTok yang benar-benar bisa di-pre-check.
 *
 * Menembak halaman profil publik ketiga platform sudah diuji dan hasilnya:
 *
 *   instagram.com/<ada>    → 200, 604.358 byte login-wall
 *   instagram.com/<ngawur> → 200, 604.371 byte login-wall  ← identik
 *   facebook.com/<ada>     → 400 "Error"
 *   facebook.com/<ngawur>  → 400 "Error"                    ← identik
 *   tiktok.com/@<ada>      → 200, 1.462 byte shell anti-bot
 *   tiktok.com/@<ngawur>   → 200, 1.462 byte shell anti-bot ← identik
 *
 * Endpoint JSON-nya juga: `instagram.com/api/v1/users/web_profile_info` membalas
 * 429 dari IP server, dan Facebook tidak punya lookup publik tanpa token. Jadi
 * untuk IG dan FB, request apa pun dari server TIDAK membawa informasi — dan
 * request yang tidak membawa informasi tidak layak menahan klik user 1-2 detik.
 * Keduanya langsung 'unknown' dan diserahkan ke verifikasi Apify.
 *
 * TikTok punya oEmbed publik yang membedakan dengan bersih (diuji: 7 akun asli
 * → 200, handle ngawur → 400), jadi TikTok dapat penolakan instan.
 */
const PRECHECK: Record<string, ((username: string) => Promise<PrecheckResult>) | null> = {
  tiktok:    precheckTiktok,
  instagram: null,
  facebook:  null,
}

async function precheckTiktok(username: string): Promise<PrecheckResult> {
  const url = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@${encodeURIComponent(username)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PRECHECK_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } })
    if (res.ok) return { state: 'exists' }
    // oEmbed membalas 400 untuk handle yang tidak ada, bukan 404.
    if (res.status === 400 || res.status === 404) return { state: 'not_found' }
    return { state: 'unknown', reason: `oembed HTTP ${res.status}` }
  } catch (err) {
    // Timeout, DNS, TLS — tidak memberi tahu apa pun soal akunnya.
    return { state: 'unknown', reason: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cek cepat sebelum baris competitor dibuat.
 *
 * Kontraknya: HANYA 'not_found' yang boleh menolak. 'exists' dan 'unknown'
 * sama-sama diteruskan — 'exists' bukan jaminan (lihat catatan di PRECHECK:
 * Instagram membalas 200 untuk username apa pun), jadi keputusan akhir tetap
 * milik Apify di background.
 */
export async function precheckAccount(platform: string, username: string): Promise<PrecheckResult> {
  const fn = PRECHECK[platform]
  if (!fn) {
    return { state: 'unknown', reason: `${platform} tidak punya lookup publik yang bisa dipercaya dari server` }
  }
  return fn(username)
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
}

export function notFoundMessage(platform: string, username: string): string {
  return `Akun @${username} tidak ditemukan di ${PLATFORM_LABEL[platform] ?? platform}. Periksa lagi penulisannya.`
}

export type VerifyOutcome =
  | { state: 'verified' }
  /** Platform memastikan akunnya tidak ada → link competitor dihapus. */
  | { state: 'not_found'; error: string }
  /** Gangguan sementara → biarkan 'pending', scheduler harian mencoba lagi. */
  | { state: 'retry'; error: string }

/**
 * Keputusan verifikasi dari kaki profile SAJA.
 *
 * Kaki posts sengaja tidak ikut menentukan: kaki itu boleh kosong atau gagal
 * untuk akun yang sepenuhnya valid — akun baru yang belum posting 30 hari
 * terakhir, atau akun private — jadi memakainya sebagai bukti keberadaan akan
 * menghapus competitor yang benar.
 *
 * Karena kaki posts tidak menentukan, keputusannya juga tidak perlu MENUNGGU
 * kaki itu. Itulah sebabnya fungsi ini menerima satu kaki dan bukan hasil sync
 * lengkap: initialIg/FbCompetitorSync memanggilnya lewat `onProfileSettled`
 * begitu profilnya turun, tanpa menunggu scrape 30 hari selesai.
 */
export function outcomeFromProfileLeg(
  profile: { count: number; error: string | null },
): VerifyOutcome {
  if (!profile.error) return { state: 'verified' }
  const error = cleanErrorMessage(profile.error)
  return isAccountNotFound(profile.error) ? { state: 'not_found', error } : { state: 'retry', error }
}

/**
 * Keputusan verifikasi dari hasil sync lengkap.
 *
 * Tersisa untuk satu jalur yang memang tidak bisa memutuskan lebih awal:
 * TikTok, yang profilnya menumpang di respons posts (satu actor run), jadi
 * kaki profile-nya tidak pernah selesai duluan. Instagram dan Facebook lewat
 * outcomeFromProfileLeg; scheduler harian punya jalurnya sendiri di
 * @/lib/competitors/scheduler, yang sudah memisahkan profile dari posts.
 */
export function outcomeFromScrape(
  result: Record<string, { count: number; error: string | null }>,
): VerifyOutcome {
  const profile = Object.entries(result).find(([key]) => key.endsWith('_profile'))?.[1]
  if (!profile) return { state: 'retry', error: 'hasil sync tidak memuat bagian profile' }
  return outcomeFromProfileLeg(profile)
}
