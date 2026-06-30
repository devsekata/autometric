import pool from '@/lib/db'

export async function refreshTiktokToken(socialAccountId: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(`TikTok token refresh failed: ${JSON.stringify(data)}`)
  }

  const newAccessToken:  string = data.access_token
  const newRefreshToken: string = data.refresh_token  ?? refreshToken
  const expiresIn:       number = data.expires_in     ?? 86400
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  await pool.query(
    `UPDATE social_accounts
     SET oauth_token = $1, refresh_token = $2, token_expires_at = $3
     WHERE id = $4`,
    [newAccessToken, newRefreshToken, tokenExpiresAt, socialAccountId]
  )

  console.log(`[refreshTiktokToken] socialAccountId=${socialAccountId} refreshed OK, expires=${tokenExpiresAt}`)
  return newAccessToken
}
