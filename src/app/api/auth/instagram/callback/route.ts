import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.INSTAGRAM_APP_ID!
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!
const REDIRECT_URI = `${APP_URL}/api/auth/instagram/callback`

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code       = searchParams.get('code')
  const stateB64   = searchParams.get('state')
  const oauthError = searchParams.get('error')

  if (oauthError || !code || !stateB64) {
    return popupPage(oauthError ?? 'Authorization denied')
  }

  try {
    JSON.parse(Buffer.from(stateB64, 'base64url').toString())
  } catch {
    return popupPage('Invalid state')
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APP_ID,
        client_secret: APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) {
      return popupPage(tokenData.error_message ?? 'Token exchange failed')
    }
    const shortToken: string = tokenData.access_token

    // Exchange for long-lived token (~60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${shortToken}`
    )
    const longData    = await longRes.json()
    const accessToken: string = longData.access_token ?? shortToken
    const expiresIn:   number = longData.expires_in   ?? 3600

    // Fetch Instagram profile
    const profileRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=id,username,name,profile_picture_url,followers_count&access_token=${accessToken}`
    )
    const profile = await profileRes.json()
    if (!profile.username) {
      return popupPage('Failed to fetch Instagram profile')
    }

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
    const avatarUrl: string | null = profile.profile_picture_url ?? null

    return popupPage(null, {
      platform:       'instagram',
      platformUserId: profile.id ?? null,
      username:       profile.username,
      avatarUrl,
      profileUrl:     `https://www.instagram.com/${profile.username}`,
      oauthToken:     accessToken,
      tokenExpiresAt,
    })
  } catch (err) {
    console.error('[Instagram callback]', err)
    return popupPage('Something went wrong')
  }
}

function popupPage(error: string | null, data?: object) {
  const target = JSON.stringify(APP_URL)
  const script = error
    ? `window.opener?.postMessage({ type: 'OAUTH_ERROR', error: ${JSON.stringify(error)} }, ${target}); window.close();`
    : `window.opener?.postMessage({ type: 'OAUTH_CONNECTED', ...${JSON.stringify(data)} }, ${target}); window.close();`

  const html = `<!DOCTYPE html><html><head><title>Connecting…</title></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#6b7280">
  ${error ? 'Connection failed. You can close this window.' : 'Connected! Closing…'}
</p>
<script>${script}</script>
</body></html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
}
