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
  'id', 'caption', 'media_type', 'media_product_type', 'permalink', 'timestamp',
  'media_url', 'thumbnail_url', 'video_duration', 'children{id}',
].join(',')

function getMediaInsightMetrics(mediaType: string): string {
  if (mediaType === 'REELS') {
    // follows & profile_visits not available for REELS per Instagram API docs
    return [
      'reach', 'saved', 'shares', 'total_interactions',
      'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time',
      'comments', 'likes', 'reposts', 'views',
    ].join(',')
  }
  return [
    'reach', 'saved', 'likes', 'comments',
    'shares', 'total_interactions', 'follows', 'profile_visits',
    'views', 'reposts',
  ].join(',')
}

const TAGGED_FIELDS = [
  'id', 'caption', 'media_type', 'permalink', 'timestamp',
  'username', 'like_count', 'comments_count', 'thumbnail_url',
].join(',')

export async function fetchAllIgTaggedPosts(igUserId: string, accessToken: string, daysSince = 30, maxItems = 200) {
  const cutoff = Date.now() - daysSince * 24 * 60 * 60 * 1000
  const all: Record<string, unknown>[] = []

  // Single-pass: request all fields directly from /tags with small limit per page.
  // Must follow 'next' URL directly — API returns v25.0 cursors that break if reconstructed with v21.0.
  const firstParams = new URLSearchParams({
    fields:       TAGGED_FIELDS,
    limit:        '5',
    access_token: accessToken,
  })
  let nextUrl: string | null = `${GRAPH}/${igUserId}/tags?${firstParams}`

  while (nextUrl && all.length < maxItems) {
    const res  = await fetch(nextUrl)
    const data = await res.json() as {
      data?:   Record<string, unknown>[]
      paging?: { next?: string }
      error?:  unknown
    }

    if (data.error) {
      console.error(`[fetchAllIgTaggedPosts] igUserId=${igUserId}:`, JSON.stringify(data.error))
      break
    }

    let reachedCutoff = false
    for (const item of data.data ?? []) {
      if (item.timestamp && new Date(item.timestamp as string).getTime() < cutoff) {
        reachedCutoff = true
        break
      }
      all.push(item)
      if (all.length >= maxItems) break
    }

    nextUrl = (!reachedCutoff && data.paging?.next) ? data.paging.next : null
  }

  console.log(`[fetchAllIgTaggedPosts] igUserId=${igUserId} fetched=${all.length}`)
  return all
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
    const data = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: unknown }

    if (data.error) {
      console.error(`[fetchAllIgMedia] igUserId=${igUserId}:`, JSON.stringify(data.error))
      break
    }

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
    `?fields=id,text,username,from{id,username},timestamp,like_count,replies{id},hidden,parent_id` +
    `&limit=50&access_token=${accessToken}`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: unknown }
    if (data.error) {
      console.error(`[fetchAllIgComments] mediaId=${mediaId}:`, JSON.stringify(data.error))
      break
    }
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
  const json = await res.json()
  if (json.error) {
    console.error(`[fetchIgMediaInsights] ${mediaType} ${mediaId}:`, JSON.stringify(json.error))
  }
  return json
}


const STORY_FIELDS = [
  'id', 'username', 'media_type', 'permalink', 'timestamp', 'media_url', 'thumbnail_url',
].join(',')

const STORY_INSIGHT_METRICS = [
  'reach', 'replies', 'shares', 'follows',
  'profile_visits', 'profile_activity',
  'reposts', 'total_interactions', 'total_views', 'facebook_views',
].join(',')

export async function fetchIgStories(igUserId: string, accessToken: string) {
  const res = await fetch(
    `${GRAPH}/${igUserId}/stories?fields=${STORY_FIELDS}&access_token=${accessToken}`
  )
  const json = await res.json()
  if (json.error) {
    console.error(`[fetchIgStories] igUserId=${igUserId}:`, JSON.stringify(json.error))
  }
  return json
}

export async function fetchIgStoryInsights(mediaId: string, accessToken: string) {
  const [mainRes, navRes] = await Promise.all([
    fetch(`${GRAPH}/${mediaId}/insights?metric=${STORY_INSIGHT_METRICS}&access_token=${accessToken}`),
    fetch(`${GRAPH}/${mediaId}/insights?metric=navigation&breakdown=story_navigation_action_type&access_token=${accessToken}`),
  ])

  const [mainJson, navJson] = await Promise.all([mainRes.json(), navRes.json()])

  if (mainJson.error) {
    console.error(`[fetchIgStoryInsights] mediaId=${mediaId}:`, JSON.stringify(mainJson.error))
  }
  if (navJson.error) {
    console.error(`[fetchIgStoryInsights navigation] mediaId=${mediaId}:`, JSON.stringify(navJson.error))
  }

  return { data: [...(mainJson.data ?? []), ...(navJson.data ?? [])] }
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
