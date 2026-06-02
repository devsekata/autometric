import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedTtAccount } from '@/lib/brands/queries'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/tiktok/debug
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  const userId  = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { brandId } = await params
  const orgId = await verifyBrandAccess(brandId, userId)
  if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

  const account = await getConnectedTtAccount(brandId)
  if (!account) return NextResponse.json({ error: 'No TikTok account connected.' }, { status: 404 })

  const token = account.oauth_token
  const TT    = 'https://open.tiktokapis.com/v2'

  const [profileRes, videoRes] = await Promise.all([
    fetch(`${TT}/user/info/?fields=open_id,display_name,bio_description,avatar_url,is_verified,follower_count,following_count,likes_count,video_count`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${TT}/video/list/?fields=id,create_time,title,video_description,duration,cover_image_url,share_url,like_count,comment_count,share_count,view_count`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ max_count: 3 }),
    }),
  ])

  const [profileData, videoData] = await Promise.all([profileRes.json(), videoRes.json()])

  return NextResponse.json({
    token_prefix: token.slice(0, 20) + '...',
    profile:      profileData,
    videos:       videoData,
  })
}
