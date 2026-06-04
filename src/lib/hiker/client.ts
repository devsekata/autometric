const HIKER_BASE = 'https://api.hikerapi.com'

export interface HikerIgUser {
  pk: string
  username: string
  full_name: string
  profile_pic_url: string | null
  is_private: boolean
  is_verified: boolean
  follower_count: number
  following_count: number
  media_count: number
  biography?: string
}

export async function fetchHikerIgUserByUsername(username: string): Promise<HikerIgUser> {
  const apiKey = process.env.HIKER_API_KEY
  if (!apiKey) throw new Error('HIKER_API_KEY is not set')

  const res = await fetch(
    `${HIKER_BASE}/v1/user/by/username?username=${encodeURIComponent(username)}`,
    { headers: { 'x-access-key': apiKey } }
  )

  if (res.status === 404) {
    throw new HikerNotFoundError(username)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Hiker API error ${res.status}: ${body}`)
  }

  return res.json()
}

export class HikerNotFoundError extends Error {
  constructor(username: string) {
    super(`Instagram user @${username} not found`)
    this.name = 'HikerNotFoundError'
  }
}
