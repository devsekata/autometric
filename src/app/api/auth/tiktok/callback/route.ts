import { NextRequest, NextResponse } from 'next/server'

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY!
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET!
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL!
const REDIRECT_URI  = `${APP_URL}/api/auth/tiktok/callback`

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code       = searchParams.get('code')
  const stateB64   = searchParams.get('state')
  const oauthError = searchParams.get('error')

  if (oauthError || !code || !stateB64) {
    return popupPage(oauthError ?? 'Authorization denied')
  }

  let codeVerifier: string
  try {
    const state = JSON.parse(Buffer.from(stateB64, 'base64url').toString())
    codeVerifier = state.codeVerifier
    if (!codeVerifier) throw new Error('missing codeVerifier')
  } catch {
    return popupPage('Invalid state')
  }

  try {
    // Exchange code for access token (PKCE)
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key:    CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.error_description ?? tokenData.message ?? tokenData.error ?? 'Token exchange failed'
      return popupPage(msg)
    }

    const accessToken:  string = tokenData.access_token
    const refreshToken: string = tokenData.refresh_token ?? ''
    const expiresIn:    number = tokenData.expires_in ?? 86400

    // Fetch user profile — username requires user.info.profile scope
    const profileRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const profileData = await profileRes.json()
    const user = profileData.data?.user

    const handle = user?.username || user?.display_name
    if (!handle) {
      return popupPage('Failed to fetch TikTok profile')
    }

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    return popupPage(null, {
      platform:       'tiktok',
      platformUserId: user.open_id ?? null,
      username:       handle,
      avatarUrl:      user.avatar_url ?? null,
      profileUrl:     `https://www.tiktok.com/@${handle}`,
      oauthToken:     accessToken,
      refreshToken,
      tokenExpiresAt,
    })
  } catch (err) {
    console.error('[TikTok callback]', err)
    return popupPage('Something went wrong')
  }
}

function popupPage(error: string | null, data?: object) {
  const target = JSON.stringify(APP_URL)
  const script = error
    ? `window.opener?.postMessage({type:'OAUTH_ERROR',error:${JSON.stringify(error)}},${target});window.close();`
    : `window.opener?.postMessage({type:'OAUTH_CONNECTED',...${JSON.stringify(data)}},${target});window.close();`

  const html = `<!DOCTYPE html><html><head><title>Connecting…</title></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#6b7280">
  ${error ? 'Connection failed. You may close this window.' : 'Connected! Closing…'}
</p>
<script>${script}</script>
</body></html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
}
