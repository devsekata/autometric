import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, addCompetitor, listBrandCompetitors } from '@/lib/brands/queries'
import { PLATFORM_LIST } from '@/lib/brands/types'
import { fetchHikerIgUserByUsername, HikerNotFoundError, HikerInsufficientFundsError, HikerValidationError, HikerIgUser } from '@/lib/hiker/client'
import { uploadAvatarFromUrl } from '@/lib/cloudinary/upload'
import { initialCompetitorSync } from '@/lib/hiker/sync'
import { initialFbCompetitorSync, initialTiktokCompetitorSync } from '@/lib/apify/sync'
import { competitorHasSnapshot } from '@/lib/competitors/queries'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/competitors
// Returns the brand's competitors with their (possibly backfilled) avatars.
// Used by the client to poll for Facebook avatars that land after the async Apify sync.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const competitors = await listBrandCompetitors(brandId)
    return NextResponse.json({ data: competitors })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/competitors]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/brands/[brandId]/competitors
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const body = await req.json()
    const platform = typeof body?.platform === 'string' ? body.platform.trim() : ''
    const username  = typeof body?.username  === 'string' ? body.username.trim().replace(/^@/, '') : ''

    if (!platform || !PLATFORM_LIST.includes(platform as never)) {
      return NextResponse.json({ error: 'Valid platform is required.' }, { status: 400 })
    }
    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }

    let profile: { avatarUrl?: string; profileUrl?: string; platformUserId?: string } | undefined
    let hikerUser: HikerIgUser | null = null

    if (platform === 'instagram') {
      hikerUser = await fetchHikerIgUserByUsername(username)
      const avatarUrl = hikerUser.profile_pic_url
        ? await uploadAvatarFromUrl(hikerUser.profile_pic_url, `competitor_ig_${username}`)
        : null
      profile = {
        avatarUrl:      avatarUrl ?? undefined,
        profileUrl:     `https://www.instagram.com/${username}`,
        platformUserId: hikerUser.pk,
      }
    } else if (platform === 'facebook') {
      // Facebook profile (incl. avatar) is fetched in the background sync —
      // Apify runs take minutes, so we don't block the request. Store the page
      // URL now; avatar/platform_user_id are backfilled by initialFbCompetitorSync.
      profile = { profileUrl: `https://www.facebook.com/${username}` }
    } else if (platform === 'tiktok') {
      // TikTok profile (incl. avatar) is fetched in the background Apify sync —
      // runs take minutes, so we don't block. Avatar/platform_user_id are
      // backfilled by initialTiktokCompetitorSync.
      profile = { profileUrl: `https://www.tiktok.com/@${username}` }
    }

    const competitor = await addCompetitor(brandId, platform, username, profile)

    // Fire-and-forget: initial sync ke l0_raw (profile + posts 30 hari).
    // Skip hanya jika competitor INI sudah punya snapshot (sudah pernah di-sync,
    // shared antar brand/org). Jangan pakai is_new_account: social_accounts row
    // bisa tersisa sebagai orphan setelah removeCompetitor, sehingga re-add tidak
    // pernah ter-sync padahal datanya kosong.
    const accountId    = competitor.social_account_id
    const alreadySynced = await competitorHasSnapshot(accountId, platform)

    if (!alreadySynced) {
      if (platform === 'instagram' && hikerUser) {
        const user = hikerUser
        initialCompetitorSync(accountId, user).catch(err =>
          console.error('[competitor initial-sync]', err)
        )
      }

      // Facebook: fire-and-forget Apify sync (profile + posts 30 hari)
      if (platform === 'facebook') {
        initialFbCompetitorSync(accountId, username).catch(err =>
          console.error('[fb competitor initial-sync]', err)
        )
      }

      // TikTok: fire-and-forget Apify sync (profile + posts 30 hari)
      if (platform === 'tiktok') {
        initialTiktokCompetitorSync(accountId, username).catch(err =>
          console.error('[tiktok competitor initial-sync]', err)
        )
      }
    }

    return NextResponse.json({ data: competitor }, { status: 201 })
  } catch (err) {
    if (err instanceof HikerNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof HikerInsufficientFundsError) {
      return NextResponse.json({ error: err.message }, { status: 402 })
    }
    if (err instanceof HikerValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[POST /api/brands/[brandId]/competitors]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
