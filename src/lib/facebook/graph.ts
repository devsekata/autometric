const GRAPH = 'https://graph.facebook.com/v21.0'

function wibMidnight(offsetDays = 0): number {
  const WIB_MS = 7 * 3600 * 1000
  const nowWib = new Date(Date.now() + WIB_MS)
  const dayStartVirtual = Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate() + offsetDays)
  return Math.floor((dayStartVirtual - WIB_MS) / 1000)
}

const FB_PROFILE_FIELDS = [
  'id', 'name', 'about', 'category', 'fan_count', 'followers_count',
  'website', 'cover{source}', 'picture{url}', 'link',
].join(',')

export async function fetchFbProfile(pageId: string, accessToken: string) {
  const res = await fetch(`${GRAPH}/${pageId}?fields=${FB_PROFILE_FIELDS}&access_token=${accessToken}`)
  return res.json()
}

// Request each daily metric individually — one bad metric won't block the rest
const FB_PAGE_DAILY_METRICS = [
  'page_follows',
  'page_daily_follows_unique',
  'page_media_view',
  'page_total_media_view_unique',
  'page_video_views',
  'page_views_total',
  'page_post_engagements',
  'page_website_clicks',
  'page_impressions_unique',
] as const

export async function fetchFbPageInsightsDay(pageId: string, accessToken: string) {
  const until = wibMidnight(0)
  const since = until - 86400

  const results = await Promise.allSettled(
    FB_PAGE_DAILY_METRICS.map(m =>
      fetch(
        `${GRAPH}/${pageId}/insights?metric=${m}` +
        `&period=day&since=${since}&until=${until}` +
        `&access_token=${accessToken}`
      ).then(r => r.json())
    )
  )

  const combined: unknown[] = []
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      const json = r.value as { data?: unknown[]; error?: unknown }
      if (json.error) {
        console.error(`[fetchFbPageInsightsDay] ${FB_PAGE_DAILY_METRICS[i]} pageId=${pageId}:`, JSON.stringify(json.error))
      } else {
        combined.push(...(json.data ?? []))
      }
    }
  }
  return { data: combined }
}

const FB_POST_FIELDS = [
  'id', 'message', 'story',
  'full_picture', 'permalink_url', 'created_time',
  'attachments{type}',
  'reactions.summary(true)',
  'likes.summary(true)',
  'comments.summary(true)',
  'shares',
  'from{id}',
].join(',')

export async function fetchAllFbPosts(pageId: string, accessToken: string, daysSince = 30) {
  const cutoff = Date.now() - daysSince * 24 * 60 * 60 * 1000
  const all: Record<string, unknown>[] = []

  let url: string | null =
    `${GRAPH}/${pageId}/feed?fields=${FB_POST_FIELDS}&limit=50&access_token=${accessToken}`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: unknown }

    if (data.error) {
      console.error(`[fetchAllFbPosts] pageId=${pageId}:`, JSON.stringify(data.error))
      break
    }

    const items = data.data ?? []
    let reachedCutoff = false

    for (const item of items) {
      if (item.created_time && new Date(item.created_time as string).getTime() < cutoff) {
        reachedCutoff = true
        break
      }
      const fromId = (item.from as { id?: string } | undefined)?.id
      if (fromId && fromId !== pageId) continue
      all.push(item)
    }

    url = (!reachedCutoff && data.paging?.next) ? data.paging.next! : null
  }

  return all
}

// Request each post metric individually to isolate failures
const FB_POST_INSIGHT_METRICS = [
  'post_media_view',
  'post_total_media_view_unique',
  'post_clicks',
  'post_reactions_by_type_total',
  'post_video_views',
] as const

export async function fetchFbPostInsights(postId: string, accessToken: string) {
  const results = await Promise.allSettled(
    FB_POST_INSIGHT_METRICS.map(m =>
      fetch(
        `${GRAPH}/${postId}/insights?metric=${m}&period=lifetime&access_token=${accessToken}`
      ).then(r => r.json())
    )
  )

  const combined: unknown[] = []
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      const json = r.value as { data?: unknown[]; error?: unknown }
      if (json.error) {
        console.error(`[fetchFbPostInsights] ${FB_POST_INSIGHT_METRICS[i]} postId=${postId}:`, JSON.stringify(json.error))
      } else {
        combined.push(...(json.data ?? []))
      }
    }
  }
  return { data: combined }
}

export async function fetchAllFbComments(postId: string, accessToken: string) {
  const all: Record<string, unknown>[] = []

  let url: string | null =
    `${GRAPH}/${postId}/comments` +
    `?fields=id,message,from{id,name},created_time,like_count,comment_count,parent{id},reactions.summary(true),attachment,permalink_url` +
    `&limit=50&access_token=${accessToken}`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: unknown }
    if (data.error) {
      console.error(`[fetchAllFbComments] postId=${postId}:`, JSON.stringify(data.error))
      break
    }
    all.push(...(data.data ?? []))
    url = data.paging?.next ?? null
  }

  return all
}
