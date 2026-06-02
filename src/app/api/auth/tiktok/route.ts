import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const CLIENT_KEY   = process.env.TIKTOK_CLIENT_KEY!
const APP_URL      = process.env.NEXT_PUBLIC_APP_URL!
const REDIRECT_URI = `${APP_URL}/api/auth/tiktok/callback`
const SCOPES       = 'user.info.basic,user.info.profile,user.info.stats,video.list'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const codeVerifier  = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state         = Buffer.from(JSON.stringify({ brandId, codeVerifier })).toString('base64url')

  const params = new URLSearchParams({
    client_key:            CLIENT_KEY,
    redirect_uri:          REDIRECT_URI,
    response_type:         'code',
    scope:                 SCOPES,
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })

  return NextResponse.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params}`)
}
