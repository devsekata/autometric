import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.INSTAGRAM_APP_ID!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!
const REDIRECT_URI = `${APP_URL}/api/auth/instagram/callback`
const SCOPES = 'instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const brandId = searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const state = Buffer.from(JSON.stringify({ brandId, origin })).toString('base64url')

  const params = new URLSearchParams({
    force_reauth: 'true',
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
  })

  return NextResponse.redirect(`https://www.instagram.com/oauth/authorize?${params}`)
}
