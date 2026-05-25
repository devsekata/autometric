import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, connectSocialAccount } from '@/lib/brands/queries'
import { uploadAvatarFromUrl } from '@/lib/cloudinary/upload'
import { PLATFORM_LIST } from '@/lib/brands/types'
import { initialIgSync } from '@/lib/instagram/sync'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/accounts
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const body = await req.json()
    const platform       = typeof body?.platform       === 'string' ? body.platform.trim() : ''
    const username       = typeof body?.username       === 'string' ? body.username.trim().replace(/^@/, '') : ''
    const oauthToken     = typeof body?.oauthToken     === 'string' ? body.oauthToken     : null
    const tokenExpiresAt = typeof body?.tokenExpiresAt === 'string' ? body.tokenExpiresAt : null
    const avatarUrl      = typeof body?.avatarUrl      === 'string' ? body.avatarUrl      : null
    const profileUrl     = typeof body?.profileUrl     === 'string' ? body.profileUrl     : null
    const platformUserId = typeof body?.platformUserId === 'string' ? body.platformUserId : null

    if (!platform || !PLATFORM_LIST.includes(platform as never)) {
      return NextResponse.json({ error: 'Valid platform is required.' }, { status: 400 })
    }
    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }

    let finalAvatarUrl = avatarUrl
    if (avatarUrl && !avatarUrl.includes('res.cloudinary.com')) {
      const slug = username.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
      finalAvatarUrl = await uploadAvatarFromUrl(avatarUrl, `${platform}/${slug}`) ?? avatarUrl
    }

    const { is_new, ...account } = await connectSocialAccount(brandId, platform, username, {
      oauthToken, tokenExpiresAt, avatarUrl: finalAvatarUrl, profileUrl, platformUserId,
    })

    if (is_new && platform === 'instagram' && platformUserId && oauthToken) {
      initialIgSync(account.id, platformUserId, oauthToken, brandId)
        .catch(err => console.error('[initialIgSync]', err))
    }

    return NextResponse.json({ data: account, is_new }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/accounts]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
