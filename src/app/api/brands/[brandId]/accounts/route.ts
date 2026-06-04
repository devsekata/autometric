import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/auth'
import { verifyBrandAccess, connectSocialAccount } from '@/lib/brands/queries'
import { uploadAvatarFromUrl } from '@/lib/cloudinary/upload'
import { PLATFORM_LIST } from '@/lib/brands/types'
import { initialIgSync } from '@/lib/instagram/sync'
import { initialTtSync } from '@/lib/tiktok/sync'
import { initialFbSync } from '@/lib/facebook/sync'
import { logSyncEntries } from '@/lib/monitoring/logger'

type Params = { params: Promise<{ brandId: string }> }

function runInitialSync(
  fn: () => Promise<Record<string, { count: number; error: string | null }>>,
  meta: { platform: string; socialAccountId: string; brandId: string; orgId: string }
) {
  const runId     = randomUUID()
  const startedAt = new Date()

  fn().then(async (result) => {
    const finishedAt = new Date()
    await logSyncEntries(
      Object.entries(result).map(([category, { count, error }]) => ({
        runId,
        jobName:         'initial-sync',
        platform:        meta.platform,
        category,
        socialAccountId: meta.socialAccountId,
        brandId:         meta.brandId,
        orgId:           meta.orgId,
        status:          error ? 'failed' : 'success',
        recordsSynced:   error ? null : count,
        errorMessage:    error ?? null,
        startedAt,
        finishedAt,
      }))
    ).catch(e => console.error('[runInitialSync] log failed:', e))
  }).catch(async (err) => {
    const finishedAt = new Date()
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[runInitialSync] ${meta.platform} failed:`, err)
    await logSyncEntries([{
      runId,
      jobName:         'initial-sync',
      platform:        meta.platform,
      category:        'unknown',
      socialAccountId: meta.socialAccountId,
      brandId:         meta.brandId,
      orgId:           meta.orgId,
      status:          'failed',
      recordsSynced:   null,
      errorMessage:    msg,
      startedAt,
      finishedAt,
    }]).catch(e => console.error('[runInitialSync] log failed:', e))
  })
}

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
    const platform        = typeof body?.platform       === 'string' ? body.platform.trim() : ''
    const username        = typeof body?.username       === 'string' ? body.username.trim().replace(/^@/, '') : ''
    const oauthToken      = typeof body?.oauthToken     === 'string' ? body.oauthToken     : null
    const refreshToken    = typeof body?.refreshToken   === 'string' ? body.refreshToken   : null
    const tokenExpiresAt  = typeof body?.tokenExpiresAt === 'string' ? body.tokenExpiresAt : null
    const avatarUrl       = typeof body?.avatarUrl      === 'string' ? body.avatarUrl      : null
    const profileUrl      = typeof body?.profileUrl     === 'string' ? body.profileUrl     : null
    const platformUserId  = typeof body?.platformUserId === 'string' ? body.platformUserId : null
    const skipInitialSync = body?.skipInitialSync === true

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
      oauthToken, refreshToken, tokenExpiresAt, avatarUrl: finalAvatarUrl, profileUrl, platformUserId,
    })

    const meta = { platform, socialAccountId: account.id, brandId, orgId }

    if (!skipInitialSync && is_new && platform === 'instagram' && platformUserId && oauthToken) {
      runInitialSync(() => initialIgSync(account.id, platformUserId, oauthToken, brandId), meta)
    }

    if (!skipInitialSync && platform === 'tiktok' && oauthToken) {
      runInitialSync(() => initialTtSync(account.id, oauthToken, brandId), meta)
    }

    if (!skipInitialSync && platform === 'facebook' && platformUserId && oauthToken) {
      runInitialSync(() => initialFbSync(account.id, platformUserId, oauthToken, brandId), meta)
    }

    return NextResponse.json({ data: account, is_new }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/accounts]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
