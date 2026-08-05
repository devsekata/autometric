const APIFY_BASE = 'https://api.apify.com/v2'

// Apify actor IDs (username~actor-name)
const FB_PROFILE_ACTOR = 'apify~facebook-pages-scraper'
const FB_POSTS_ACTOR   = 'apify~facebook-posts-scraper'
// TikTok uses a single actor: the profile (authorMeta) is embedded in every post.
const TIKTOK_ACTOR     = 'clockworks~tiktok-scraper'
// Instagram uses one actor for both profile (resultsType 'details') and posts
// (resultsType 'posts'). We call it twice — mirroring the FB two-actor flow.
const IG_ACTOR         = 'apify~instagram-scraper'

// Polling config for async actor runs (Facebook scrapers can take minutes)
const POLL_INTERVAL_MS = 5_000
const MAX_WAIT_MS       = 8 * 60_000

// --- Item error ---
//
// Actor Apify TIDAK mengembalikan dataset kosong untuk akun yang tidak ada. Dia
// mengembalikan satu item penanda error, dan untuk Instagram item itu bahkan
// memuat `username` yang kita kirimkan — jadi mengecek `items[0]` truthy atau
// melihat `username` sama-sama tidak cukup. Bentuk aslinya (diuji 30 Jul 2026):
//
//   IG @ngawur → { url, username: '<yang kita kirim>', error: 'not_found',
//                  errorDescription: 'Post does not exist' }
//   FB /ngawur → { url, error: 'not_available',
//                  errorDescription: "This content isn't available because …" }
export interface ApifyItemError {
  error?: string
  errorDescription?: string
}

/**
 * Kode error yang berarti "tidak akan pernah ada datanya".
 *
 * `not_available` juga muncul untuk halaman yang dibatasi audiensnya, bukan hanya
 * yang dihapus — Apify tidak membedakan keduanya. Efeknya bagi kita sama: profil
 * itu tidak bisa di-scrape sama sekali. Kode di luar daftar ini DIANGGAP
 * SEMENTARA dan tidak boleh memicu penghapusan competitor.
 */
const GONE_CODES = new Set(['not_found', 'not_available'])

/** Ambil penanda error dari satu item dataset, kalau ada. */
export function apifyItemError(item: unknown): { code: string; description: string; gone: boolean } | null {
  if (!item || typeof item !== 'object') return null
  const { error, errorDescription } = item as ApifyItemError
  if (!error) return null
  return { code: error, description: errorDescription ?? '', gone: GONE_CODES.has(error) }
}

// --- Raw response shapes (only the fields we map) ---

export interface ApifyFbProfile extends ApifyItemError {
  facebookId?: string
  pageId?: string
  title?: string
  pageName?: string
  facebookUrl?: string
  pageUrl?: string
  followers?: number
  likes?: number
  ratingCount?: number
  email?: string | null
  creation_date?: string | null
  categories?: string[]
  info?: string[] | string | null
  intro?: string | null
  websites?: string[]
  profilePhoto?: string | null
  profilePictureUrl?: string | null
}

export interface ApifyFbPostMedia {
  image?: { uri?: string } | null
}

export interface ApifyFbPost {
  postId?: string
  text?: string | null
  time?: string | null              // ISO timestamp
  topLevelUrl?: string | null
  url?: string | null
  user?: { name?: string } | null
  likes?: number
  shares?: number
  topReactionsCount?: number
  media?: ApifyFbPostMedia[]
}

// --- TikTok (clockworks~tiktok-scraper) ---
// The profile lives in authorMeta, embedded in every post item.
export interface ApifyTiktokAuthorMeta {
  id?: string
  name?: string
  nickName?: string
  verified?: boolean
  signature?: string | null
  bioLink?: string | null
  avatar?: string | null
  originalAvatarUrl?: string | null
  privateAccount?: boolean
  ttSeller?: boolean
  profileUrl?: string | null
  following?: number
  fans?: number
  heart?: number
  video?: number
  commerceUserInfo?: { commerceUser?: boolean; category?: string | null } | null
}

export interface ApifyTiktokPost {
  id?: string
  text?: string | null
  textLanguage?: string | null
  createTimeISO?: string | null
  createTime?: number | null
  webVideoUrl?: string | null
  diggCount?: number
  commentCount?: number
  playCount?: number
  collectCount?: number
  shareCount?: number
  isPinned?: boolean
  isSponsored?: boolean
  isAd?: boolean
  isSlideshow?: boolean
  slideshowImageLinks?: unknown[]
  hashtags?: { name?: string }[]
  mentions?: string[]
  videoMeta?: { duration?: number; coverUrl?: string | null } | null
  musicMeta?: { musicName?: string | null; musicAuthor?: string | null } | null
  authorMeta?: ApifyTiktokAuthorMeta | null
}

// --- Instagram (apify~instagram-scraper) ---
// Profile (resultsType 'details') and posts (resultsType 'posts') come from the
// same actor, so we model both shapes here.
export interface ApifyIgProfile extends ApifyItemError {
  id?: string
  username?: string
  fullName?: string
  biography?: string | null
  verified?: boolean
  followersCount?: number
  followsCount?: number
  igtvVideoCount?: number
  postsCount?: number
  private?: boolean
  isBusinessAccount?: boolean
  businessCategoryName?: string | null
  externalUrl?: string | null
  externalUrls?: Array<{ url?: string }>
  profilePicUrl?: string | null
  profilePicUrlHD?: string | null
}

export interface ApifyIgPost {
  id?: string
  shortCode?: string
  type?: string            // 'Image' | 'Video' | 'Sidecar'
  productType?: string     // 'clips' for reels
  caption?: string | null
  url?: string | null
  displayUrl?: string | null
  timestamp?: string | null // ISO timestamp
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
  videoPlayCount?: number
  videoDuration?: number
  hashtags?: string[]       // already stripped of the leading '#'
  mentions?: string[]
  taggedUsers?: Array<{ username?: string }>
  images?: unknown[]        // Sidecar slides
  childPosts?: unknown[]    // Sidecar children
  coauthorProducers?: Array<{ username?: string }>
  ownerUsername?: string
  isPinned?: boolean
  isSponsored?: boolean
  isCommentsDisabled?: boolean
  musicInfo?: { song_name?: string | null; artist_name?: string | null } | null
}

// --- Generic Apify run helpers ---

function apifyToken(): string {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set')
  return token
}

async function startActorRun(actorId: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${apifyToken()}`,
    },
    body: JSON.stringify(input),
  })

  if (res.status === 401 || res.status === 403) throw new ApifyAuthError()
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apify start-run error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const runId = data?.data?.id
  if (!runId) throw new Error('Apify start-run returned no run id')
  return runId
}

async function getRunStatus(runId: string): Promise<string> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, {
    headers: { Authorization: `Bearer ${apifyToken()}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apify run-status error ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data?.data?.status ?? 'UNKNOWN'
}

async function downloadDataset<T>(runId: string): Promise<T[]> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items`, {
    headers: { Authorization: `Bearer ${apifyToken()}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apify dataset error ${res.status}: ${body}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Start an actor run, poll until it finishes, then download dataset items.
async function runActor<T>(actorId: string, input: Record<string, unknown>): Promise<T[]> {
  const runId = await startActorRun(actorId, input)
  const start = Date.now()

  while (Date.now() - start < MAX_WAIT_MS) {
    const status = await getRunStatus(runId)
    if (status === 'SUCCEEDED') return downloadDataset<T>(runId)
    if (status === 'FAILED')    throw new Error(`Apify run ${runId} failed`)
    if (status === 'ABORTED')   throw new Error(`Apify run ${runId} aborted`)
    if (status === 'TIMED-OUT') throw new Error(`Apify run ${runId} timed out`)
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Apify run ${runId} did not finish within ${MAX_WAIT_MS / 1000}s`)
}

// --- Facebook fetchers ---

function facebookUrlFromUsername(username: string): string {
  const clean = username.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(clean)) return clean
  return `https://www.facebook.com/${clean}/`
}

export async function fetchFbProfile(username: string): Promise<ApifyFbProfile | null> {
  const items = await runActor<ApifyFbProfile>(FB_PROFILE_ACTOR, {
    startUrls: [{ url: facebookUrlFromUsername(username), method: 'GET' }],
  })
  return items[0] ?? null
}

export async function fetchFbPosts(username: string, days: number): Promise<ApifyFbPost[]> {
  const items = await runActor<ApifyFbPost>(FB_POSTS_ACTOR, {
    startUrls:          [{ url: facebookUrlFromUsername(username), method: 'GET' }],
    onlyPostsNewerThan: `${days} days`,
    resultsLimit:       500,
    captionText:        false,
  })
  return dropErrorItems(items)
}

/**
 * Buang item penanda error dari daftar post.
 *
 * Untuk akun yang tidak ada, actor mengembalikan SATU item error. Tanpa disaring,
 * item itu terhitung sebagai "1 post ditemukan" — angka yang bohong di log dan di
 * `records_synced`. Khusus fetcher profil item ini TIDAK disaring: di sana isinya
 * justru dibutuhkan untuk membedakan akun hilang dari gangguan sementara.
 */
function dropErrorItems<T>(items: T[]): T[] {
  return items.filter(i => !apifyItemError(i))
}

// --- TikTok fetcher ---

function tiktokHandle(username: string): string {
  return username.trim().replace(/^@/, '')
}

// Fetch a competitor's TikTok posts. When `days` is set, only posts newer than
// that date are returned. Pass days = null to fetch the latest `resultsPerPage`
// posts regardless of date — used as a fallback to capture authorMeta (profile)
// for low-activity accounts that have no posts in the date window.
export async function fetchTiktokPosts(
  username: string,
  days: number | null,
  resultsPerPage = 200,
): Promise<ApifyTiktokPost[]> {
  const input: Record<string, unknown> = {
    profiles:              [tiktokHandle(username)],
    profileScrapeSections: ['videos'],
    profileSorting:        'latest',
    excludePinnedPosts:    false,
    scrapeRelatedVideos:   false,
    shouldDownloadAvatars: false,
    shouldDownloadCovers:  false,
    shouldDownloadVideos:  false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
    maxProfilesPerQuery:   1,
    resultsPerPage,
  }
  if (days !== null) {
    const oldest = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    input.oldestPostDateUnified = oldest
    input.newestPostDate        = new Date().toISOString().slice(0, 10)
  }
  return runActor<ApifyTiktokPost>(TIKTOK_ACTOR, input)
}

// --- Instagram fetchers ---

function instagramUrlFromUsername(username: string): string {
  const clean = username.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(clean)) return clean
  return `https://www.instagram.com/${clean}/`
}

export async function fetchIgProfile(username: string): Promise<ApifyIgProfile | null> {
  const items = await runActor<ApifyIgProfile>(IG_ACTOR, {
    directUrls:                        [instagramUrlFromUsername(username)],
    resultsType:                       'details',
    resultsLimit:                      1,
    searchType:                        'user',
    searchLimit:                       1,
    addParentData:                     false,
    enhanceUserSearchWithFacebookPage: false,
    isUserReelFeedURL:                 false,
    isUserTaggedFeedURL:               false,
  })
  return items[0] ?? null
}

export async function fetchIgPosts(username: string, days: number): Promise<ApifyIgPost[]> {
  const items = await runActor<ApifyIgPost>(IG_ACTOR, {
    directUrls:                        [instagramUrlFromUsername(username)],
    resultsType:                       'posts',
    onlyPostsNewerThan:                `${days} days`,
    resultsLimit:                      1000,
    searchType:                        'user',
    searchLimit:                       1,
    addParentData:                     false,
    enhanceUserSearchWithFacebookPage: false,
    isUserReelFeedURL:                 false,
    isUserTaggedFeedURL:               false,
  })
  return dropErrorItems(items)
}

export class ApifyAuthError extends Error {
  constructor() {
    super('Apify token invalid atau tidak punya akses. Cek APIFY_API_TOKEN.')
    this.name = 'ApifyAuthError'
  }
}
