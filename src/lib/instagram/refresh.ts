import pool from '@/lib/db'

export async function refreshInstagramToken(socialAccountId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${accessToken}`
  )

  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(`Instagram token refresh failed: ${JSON.stringify(data)}`)
  }

  const newToken:  string = data.access_token
  const expiresIn: number = data.expires_in ?? 5184000 // 60 days default
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  await pool.query(
    `UPDATE social_accounts SET oauth_token = $1, token_expires_at = $2 WHERE id = $3`,
    [newToken, tokenExpiresAt, socialAccountId]
  )

  console.log(`[refreshInstagramToken] socialAccountId=${socialAccountId} refreshed OK, expires=${tokenExpiresAt}`)
  return newToken
}
