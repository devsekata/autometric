const HIKER_BASE = 'https://api.hikerapi.com'

export interface HikerIgUser {
  pk: string
  username: string
  full_name: string
  profile_pic_url: string | null
  is_private: boolean
  is_verified: boolean
  is_business?: boolean
  follower_count: number
  following_count: number
  media_count: number
  biography?: string
  account_category?: string
  external_url?: string | null
  bio_links?: Array<{ url: string; link_type?: string }>
}

export async function fetchHikerIgUserByUsername(username: string): Promise<HikerIgUser> {
  const apiKey = process.env.HIKER_API_KEY
  if (!apiKey) throw new Error('HIKER_API_KEY is not set')

  const res = await fetch(
    `${HIKER_BASE}/v2/user/by/username?username=${encodeURIComponent(username)}`,
    { headers: { 'x-access-key': apiKey } }
  )

  if (res.status === 404) {
    throw new HikerNotFoundError(username)
  }

  if (res.status === 402) {
    throw new HikerInsufficientFundsError()
  }

  if (res.status === 400) {
    const body = await res.json().catch(() => ({}))
    throw new HikerValidationError(body?.detail ?? 'Invalid username.')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Hiker API error ${res.status}: ${body}`)
  }

  // v2 wraps response: { user: { ... } }
  const data = await res.json()
  return data.user ?? data
}

export interface HikerMediaItem {
  pk: string
  id?: string
  code: string
  // g2 uses GraphQL-encoded field names for long/float
  '1ltaken_at'?: number        // unix timestamp (g2)
  '1fvideo_duration'?: number  // seconds (g2)
  media_type: number           // 1=photo, 2=video/reel, 8=carousel
  product_type?: string        // 'feed' | 'clips' | 'carousel_container'
  caption?: { text?: string } | null
  like_and_view_counts_disabled?: boolean
  like_count?: number
  comment_count?: number
  view_count?: number
  play_count?: number
  ig_play_count?: number
  fb_play_count?: number
  // g2 uses image_versions2 instead of thumbnail_url
  image_versions2?: { candidates?: Array<{ url: string; width: number; height: number }> } | null
  video_url?: string | null
  // carousel sub-items (g2)
  carousel_media?: Array<{
    image_versions2?: { candidates?: Array<{ url: string }> } | null
  }>
  carousel_media_count?: number | null
  usertags?: { in?: Array<{ user: { username: string } }> }
  coauthor_producers?: Array<{ username: string }>
  is_paid_partnership?: boolean | null
  sponsor_tags?: Array<unknown>
  comments_disabled?: boolean | null
  is_pinned?: boolean | null
  music_metadata?: {
    music_info?: {
      music_asset_info?: { title?: string; display_artist?: string }
    }
  } | null
}

// Extract pure numeric pk from g2 "pk_ownerid" or plain v1 pk
export function mediaItemPk(item: HikerMediaItem): string {
  if (item.pk) return item.pk
  if (item.id) return item.id.split('_')[0]
  throw new Error('HikerMediaItem has neither pk nor id')
}

// g2 response: { response: { items, more_available }, next_page_id }
type G2MediaResponse = {
  response: {
    items: HikerMediaItem[]
    more_available: boolean
  }
  next_page_id: string | null
}

async function hikerGet<T>(path: string): Promise<T> {
  const apiKey = process.env.HIKER_API_KEY
  if (!apiKey) throw new Error('HIKER_API_KEY is not set')
  const res = await fetch(`${HIKER_BASE}${path}`, { headers: { 'x-access-key': apiKey } })
  if (res.status === 402) throw new HikerInsufficientFundsError()
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Hiker API error ${res.status}: ${body}`)
  }
  return res.json()
}

export async function fetchAllHikerIgMedias(
  userId: string,
  days: number,
): Promise<HikerMediaItem[]> {
  const cutoffTs = Math.floor(Date.now() / 1000) - days * 86400
  const all: HikerMediaItem[] = []
  let pageId: string | null = null

  while (true) {
    const params = new URLSearchParams({ user_id: userId, flat: 'true' })
    if (pageId) params.set('next_page_id', pageId)
    const raw = await hikerGet<G2MediaResponse>(`/g2/user/medias?${params}`)

    const items = raw.response?.items ?? []
    for (const item of items) {
      const ts = item['1ltaken_at'] ?? 0
      if (ts < cutoffTs) return all
      all.push(item)
    }

    if (!raw.response?.more_available || !raw.next_page_id) break
    pageId = raw.next_page_id
  }

  return all
}

export class HikerNotFoundError extends Error {
  constructor(username: string) {
    super(`Instagram user @${username} not found`)
    this.name = 'HikerNotFoundError'
  }
}

export class HikerInsufficientFundsError extends Error {
  constructor() {
    super('Hiker API credit habis. Top up di hikerapi.com/billing.')
    this.name = 'HikerInsufficientFundsError'
  }
}

export class HikerValidationError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'HikerValidationError'
  }
}
