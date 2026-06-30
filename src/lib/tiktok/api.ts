const TT_API = 'https://open.tiktokapis.com/v2'

const PROFILE_FIELDS = [
  'open_id', 'display_name', 'bio_description', 'avatar_url',
  'is_verified', 'follower_count', 'following_count', 'likes_count', 'video_count',
].join(',')

const VIDEO_FIELDS = [
  'id', 'create_time', 'title', 'video_description',
  'duration', 'cover_image_url', 'share_url',
  'like_count', 'comment_count', 'share_count', 'view_count',
].join(',')

export async function fetchTtProfile(accessToken: string) {
  const res = await fetch(
    `${TT_API}/user/info/?fields=${PROFILE_FIELDS}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  return res.json()
}

export async function fetchAllTtVideos(accessToken: string, daysSince = 30): Promise<Record<string, unknown>[]> {
  const cutoffSec = Math.floor((Date.now() - daysSince * 24 * 60 * 60 * 1000) / 1000)
  const all: Record<string, unknown>[] = []
  let cursor: number | undefined
  let hasMore = true

  while (hasMore) {
    const body: Record<string, unknown> = { max_count: 20 }
    if (cursor !== undefined) body.cursor = cursor

    const res = await fetch(`${TT_API}/video/list/?fields=${VIDEO_FIELDS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await res.json() as {
      error?: { code?: string; message?: string }
      data?:  { videos?: Record<string, unknown>[]; has_more?: boolean; cursor?: number }
    }

    if (data.error?.code && data.error.code !== 'ok') {
      console.error('[fetchAllTtVideos]', JSON.stringify(data.error))
      break
    }

    const videos = data.data?.videos ?? []
    let reachedCutoff = false

    for (const v of videos) {
      if (typeof v.create_time === 'number' && v.create_time < cutoffSec) {
        reachedCutoff = true
        break
      }
      all.push(v)
    }

    hasMore = !reachedCutoff && (data.data?.has_more ?? false)
    cursor  = data.data?.cursor
  }

  return all
}
