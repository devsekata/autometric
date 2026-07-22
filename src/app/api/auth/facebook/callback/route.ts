import { NextRequest, NextResponse } from 'next/server'

const APP_ID     = process.env.META_APP_ID!
const APP_SECRET = process.env.META_APP_SECRET!
const APP_URL    = process.env.NEXT_PUBLIC_APP_URL!
const REDIRECT_URI = `${APP_URL}/api/auth/facebook/callback`

type Option = {
  platform: 'facebook' | 'instagram'
  platformUserId: string
  username: string
  avatarUrl: string | null
  profileUrl: string
  oauthToken: string
  tokenExpiresAt: string | null
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code       = searchParams.get('code')
  const stateB64   = searchParams.get('state')
  const oauthError = searchParams.get('error')

  if (oauthError || !code || !stateB64) {
    return popupPage(oauthError ?? 'Authorization denied')
  }

  let mode: string
  try {
    const state = JSON.parse(Buffer.from(stateB64, 'base64url').toString())
    mode = state.mode ?? 'instagram'
  } catch {
    return popupPage('Invalid state')
  }

  try {
    // Exchange code for short-lived user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({ client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code })
    )
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) {
      return popupPage(tokenData.error?.message ?? 'Token exchange failed')
    }
    const shortToken: string = tokenData.access_token

    // Exchange for long-lived user token (~60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: shortToken })
    )
    const longData   = await longRes.json()
    console.log('[Facebook callback] Long-lived token exchange response:', JSON.stringify({ access_token: !!longData.access_token, expires_in: longData.expires_in, error: longData.error }))
    if (!longData.access_token) {
      console.error('[Facebook callback] Long-lived token exchange failed:', JSON.stringify(longData))
    }
    const userToken: string = longData.access_token ?? shortToken
    const expiresIn: number = longData.expires_in   ?? 3600

    // 1. Try personal account Pages (/me/accounts)
    const pagesRes  = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,link&access_token=${userToken}`)
    const pagesData = await pagesRes.json()
    let pages: Array<{ id: string; name: string; access_token: string; link?: string }> = pagesData.data ?? []

    // 2. Fallback: Business-owned Pages via /me/businesses
    if (pages.length === 0) {
      const bizRes  = await fetch(`https://graph.facebook.com/v21.0/me/businesses?access_token=${userToken}`)
      const bizData = await bizRes.json()
      const businesses: Array<{ id: string; name: string }> = bizData.data ?? []

      for (const biz of businesses) {
        const bizPagesRes  = await fetch(
          `https://graph.facebook.com/v21.0/${biz.id}/owned_pages?fields=id,name,link&access_token=${userToken}`
        )
        const bizPagesData = await bizPagesRes.json()
        const bizPages: Array<{ id: string; name: string; link?: string }> = bizPagesData.data ?? []

        for (const p of bizPages) {
          const ptRes  = await fetch(`https://graph.facebook.com/v21.0/${p.id}?fields=access_token,link&access_token=${userToken}`)
          const ptData = await ptRes.json()
          if (ptData.access_token) {
            pages.push({ id: p.id, name: p.name, access_token: ptData.access_token, link: p.link ?? ptData.link })
          }
        }
        if (pages.length > 0) break
      }
    }

    if (pages.length === 0) {
      return popupPage('No Facebook Pages found. Make sure you manage a Facebook Page.')
    }

    // ── Facebook Page mode ──
    if (mode === 'facebook') {
      const options = await Promise.all(pages.map(async (page) => {
        const picRes  = await fetch(`https://graph.facebook.com/v21.0/${page.id}/picture?redirect=false&type=large&access_token=${page.access_token}`)
        const picData = await picRes.json()
        const picSrc: string | null = picData.data?.is_silhouette ? null : (picData.data?.url ?? null)
        return {
          platform:       'facebook' as const,
          platformUserId: page.id,
          username:       page.name,
          avatarUrl:      picSrc,
          profileUrl:     page.link ?? `https://www.facebook.com/${page.id}`,
          oauthToken:     page.access_token,
          tokenExpiresAt: null, // Page Access Token tidak expire
        }
      }))

      return selectionPage(options)
    }

    // ── Instagram Business mode ──
    const igOptions: Option[] = []
    for (const page of pages) {
      const igRes  = await fetch(
        `https://graph.facebook.com/v21.0/${page.id}` +
        `?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count}` +
        `&access_token=${page.access_token}`
      )
      const igData = await igRes.json()
      const ig     = igData.instagram_business_account

      if (ig?.username) {
        igOptions.push({
          platform:       'instagram',
          platformUserId: ig.id,
          username:       ig.username,
          avatarUrl:      ig.profile_picture_url ?? null,
          profileUrl:     `https://www.instagram.com/${ig.username}`,
          oauthToken:     page.access_token,
          tokenExpiresAt: null, // Page Access Token tidak expire
        })
      }
    }

    if (igOptions.length === 0) return popupPage('No Instagram Business account found linked to your Facebook Pages.')
    return selectionPage(igOptions)

  } catch (err) {
    console.error('[Facebook OAuth callback]', err)
    return popupPage('Something went wrong')
  }
}

function popupPage(error: string | null, data?: object) {
  const script = error
    ? `window.opener?.postMessage({type:'OAUTH_ERROR',error:${JSON.stringify(error)}},window.location.origin);window.close();`
    : `window.opener?.postMessage({type:'OAUTH_CONNECTED',...${JSON.stringify(data)}},window.location.origin);window.close();`

  const html = `<!DOCTYPE html><html><head><title>Connecting…</title></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#6b7280">
  ${error ? 'Connection failed. You may close this window.' : 'Connected! Closing…'}
</p>
<script>${script}</script>
</body></html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
}

function selectionPage(options: Option[]) {
  const safeOpts = JSON.stringify(options).replace(/<\/script>/gi, '<\\/script>')

  const items = options.map((opt, i) => `
    <button class="item" onclick="pick(${i})">
      <div class="av">${opt.avatarUrl
        ? `<img src="${esc(opt.avatarUrl)}" onerror="this.style.display='none'" />`
        : `<span class="av-icon">◉</span>`
      }</div>
      <div class="info">
        <div class="name">${esc(opt.username)}</div>
        <div class="type">${opt.platform === 'instagram' ? 'Instagram Business' : 'Facebook Page'}</div>
      </div>
      <span class="arr">›</span>
    </button>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Select Account</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:-apple-system,'Segoe UI',sans-serif;background:#f9fafb;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.header{padding:20px 20px 14px;background:white;border-bottom:1px solid #f0f0f0;flex-shrink:0}
.header h2{font-size:15px;font-weight:700;color:#111827;margin:0 0 4px}
.header p{font-size:12px;color:#9ca3af;margin:0}
.list{flex:1;overflow-y:auto;padding:10px}
.item{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;background:white;border:1.5px solid #f3f4f6;border-radius:12px;margin-bottom:7px;cursor:pointer;transition:border-color 0.15s,background 0.15s;text-align:left}
.item:hover{border-color:#1B8A80;background:#f0f7fa}
.item:active{background:#e0eef4}
.av{width:42px;height:42px;border-radius:50%;background:#e5e7eb;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
.av img{width:42px;height:42px;object-fit:cover;display:block}
.av-icon{font-size:18px;color:#9ca3af}
.info{flex:1;min-width:0}
.name{font-size:13.5px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.type{font-size:11.5px;color:#9ca3af;margin-top:3px}
.arr{color:#d1d5db;font-size:22px;line-height:1;flex-shrink:0}
.overlay{display:none;position:fixed;inset:0;background:white;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.overlay.on{display:flex}
.spinner{width:28px;height:28px;border:2.5px solid #e5e7eb;border-top-color:#1B8A80;border-radius:50%;animation:sp 0.7s linear infinite}
.overlay p{font-size:13px;color:#6b7280;margin:0}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="header">
  <h2>Choose an account to connect</h2>
  <p>${options.length} account${options.length !== 1 ? 's' : ''} found &middot; Select one to continue</p>
</div>
<div class="list" id="list">${items}</div>
<div class="overlay" id="overlay">
  <div class="spinner"></div>
  <p>Connecting…</p>
</div>
<script>
const O=${safeOpts};
function pick(i){
  document.getElementById('list').style.display='none';
  document.getElementById('overlay').classList.add('on');
  const o=O[i];
  window.opener?.postMessage({type:'OAUTH_CONNECTED',platform:o.platform,platformUserId:o.platformUserId,username:o.username,avatarUrl:o.avatarUrl,profileUrl:o.profileUrl,oauthToken:o.oauthToken,tokenExpiresAt:o.tokenExpiresAt},window.location.origin);
  setTimeout(()=>window.close(),400);
}
</script>
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
}
