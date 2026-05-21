import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.META_APP_ID!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!
const REDIRECT_URI = `${APP_URL}/api/auth/facebook/callback`
const SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
].join(',')

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const brandId = searchParams.get('brandId')
  const mode    = searchParams.get('mode') ?? 'instagram'   // 'instagram' | 'facebook'
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const state = Buffer.from(JSON.stringify({ brandId, origin, mode })).toString('base64url')

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: 'code',
    state,
  })

  return NextResponse.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params}`)
}
