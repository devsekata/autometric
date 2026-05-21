const GRAPH = 'https://graph.facebook.com/v21.0'

// Returns Unix timestamp (seconds) for midnight WIB (UTC+7) of the current day + offsetDays.
// e.g. wibMidnight(0) = today 00:00 WIB in UTC seconds
//      wibMidnight(-1) = yesterday 00:00 WIB in UTC seconds
function wibMidnight(offsetDays = 0): number {
  const WIB_MS = 7 * 3600 * 1000
  const nowWib = new Date(Date.now() + WIB_MS)
  const dayStartVirtual = Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate() + offsetDays)
  return Math.floor((dayStartVirtual - WIB_MS) / 1000)
}

function stripPaging<T extends Record<string, unknown>>(data: T): Omit<T, 'paging'> {
  const { paging: _, ...rest } = data
  return rest
}

const PROFILE_FIELDS = [
  'username',
  'name',
  'biography',
  'website',
  'profile_picture_url',
  'followers_count',
  'follows_count',
  'media_count',
].join(',')

const INSIGHTS_DAY_METRICS = [
  'accounts_engaged',
  'comments',
  'follows_and_unfollows',
  'likes',
  'profile_links_taps',
  'reach',
  'replies',
  'reposts',
  'saves',
  'shares',
  'total_interactions',
  'views',
].join(',')

const INSIGHTS_LIFETIME_METRICS = [
  'engaged_audience_demographics',
  'follower_demographics',
].join(',')

export async function fetchIgProfile(igUserId: string, accessToken: string) {
  const res = await fetch(
    `${GRAPH}/${igUserId}?fields=${PROFILE_FIELDS}&access_token=${accessToken}`
  )
  return res.json()
}

export async function fetchIgInsightsDay(igUserId: string, accessToken: string) {
  const until = wibMidnight(0)
  const since = until - 86400

  const res  = await fetch(
    `${GRAPH}/${igUserId}/insights` +
    `?metric=${INSIGHTS_DAY_METRICS}` +
    `&period=day&since=${since}&until=${until}` +
    `&metric_type=total_value` +
    `&access_token=${accessToken}`
  )
  return stripPaging(await res.json())
}

export async function fetchIgInsightsLifetime(igUserId: string, accessToken: string) {
  const breakdowns = ['age', 'city', 'country', 'gender'] as const

  const results = await Promise.all(
    breakdowns.map(breakdown =>
      fetch(
        `${GRAPH}/${igUserId}/insights` +
        `?metric=${INSIGHTS_LIFETIME_METRICS}` +
        `&period=lifetime` +
        `&metric_type=total_value` +
        `&timeframe=this_month` +
        `&breakdown=${breakdown}` +
        `&access_token=${accessToken}`
      ).then(r => r.json()).then(data => ({ breakdown, data: stripPaging(data) }))
    )
  )

  return Object.fromEntries(results.map(r => [r.breakdown, r.data]))
}

const MEDIA_FIELDS = [
  'id', 'caption', 'media_type', 'permalink', 'timestamp',
  'media_url', 'thumbnail_url', 'video_duration', 'children{id}',
].join(',')

function getMediaInsightMetrics(mediaType: string): string {
  if (mediaType === 'REELS') {
    return [
      'plays', 'reach', 'saved', 'shares', 'total_interactions',
      'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time',
      'comments', 'likes',
    ].join(',')
  }
  const base = [
    'reach', 'saved', 'likes', 'comments',
    'shares', 'total_interactions', 'follows', 'profile_visits',
  ]
  if (mediaType === 'VIDEO') base.push('video_views')
  return base.join(',')
}

export async function fetchIgMedia(igUserId: string, accessToken: string) {
  const res = await fetch(
    `${GRAPH}/${igUserId}/media?fields=${MEDIA_FIELDS}&limit=50&access_token=${accessToken}`
  )
  return stripPaging(await res.json())
}

export async function fetchAllIgMedia(igUserId: string, accessToken: string, daysSince = 30) {
  const cutoff = Date.now() - daysSince * 24 * 60 * 60 * 1000
  const all: Record<string, unknown>[] = []

  let url: string | null =
    `${GRAPH}/${igUserId}/media?fields=${MEDIA_FIELDS}&limit=50&access_token=${accessToken}`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string } }
    const items = data.data ?? []

    let reachedCutoff = false
    for (const item of items) {
      if (item.timestamp && new Date(item.timestamp as string).getTime() < cutoff) {
        reachedCutoff = true
        break
      }
      all.push(item)
    }

    url = (!reachedCutoff && data.paging?.next) ? data.paging.next! : null
  }

  return all
}

export async function fetchAllIgComments(mediaId: string, accessToken: string) {
  const all: Record<string, unknown>[] = []

  let url: string | null =
    `${GRAPH}/${mediaId}/comments` +
    `?fields=id,text,username,timestamp,like_count,replies_count` +
    `&limit=50&access_token=${accessToken}`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string } }
    all.push(...(data.data ?? []))
    url = data.paging?.next ?? null
  }

  return all
}

export async function fetchIgMediaInsights(mediaId: string, accessToken: string, mediaType: string) {
  const metrics = getMediaInsightMetrics(mediaType)
  const res = await fetch(
    `${GRAPH}/${mediaId}/insights?metric=${metrics}&access_token=${accessToken}`
  )
  return res.json()
}

export async function fetchIgFollowerCountHistory(igUserId: string, accessToken: string, days = 30) {
  const until = wibMidnight(0)
  const since = until - days * 86400

  const res = await fetch(
    `${GRAPH}/${igUserId}/insights` +
    `?metric=follower_count` +
    `&period=day` +
    `&since=${since}&until=${until}` +
    `&access_token=${accessToken}`
  )
  return stripPaging(await res.json())
}

export async function fetchIgComments(mediaId: string, accessToken: string) {
  const res = await fetch(
    `${GRAPH}/${mediaId}/comments` +
    `?fields=id,text,username,timestamp,like_count,replies_count` +
    `&limit=50` +
    `&access_token=${accessToken}`
  )
  return stripPaging(await res.json())
}

export async function fetchIgFollowsUnfollows(igUserId: string, accessToken: string) {
  const until = wibMidnight(0)
  const since = until - 86400

  const res = await fetch(
    `${GRAPH}/${igUserId}/insights` +
    `?metric=follows_and_unfollows` +
    `&period=day&since=${since}&until=${until}` +
    `&metric_type=total_value` +
    `&breakdown=follow_type` +
    `&access_token=${accessToken}`
  )
  return stripPaging(await res.json())
}
