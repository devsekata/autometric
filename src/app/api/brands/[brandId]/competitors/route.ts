import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, addCompetitor, listBrandCompetitors } from '@/lib/brands/queries'
import { PLATFORM_LIST } from '@/lib/brands/types'
import { initialFbCompetitorSync, initialTiktokCompetitorSync, initialIgCompetitorSync } from '@/lib/apify/sync'
import { competitorHasSnapshot } from '@/lib/competitors/queries'
import { COMPETITOR_ADD_ENABLED } from '@/lib/featureFlags'

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
    // Adding competitors is temporarily disabled app-wide (see @/lib/featureFlags).
    if (!COMPETITOR_ADD_ENABLED) {
      return NextResponse.json({ error: 'Adding competitors is temporarily disabled.' }, { status: 403 })
    }

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

    if (platform === 'instagram') {
      // Instagram profile (incl. avatar) is fetched in the background Apify sync —
      // runs take minutes, so we don't block. Avatar/platform_user_id are
      // backfilled by initialIgCompetitorSync.
      profile = { profileUrl: `https://www.instagram.com/${username}` }
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
      // Instagram: fire-and-forget Apify sync (profile + posts 30 hari)
      if (platform === 'instagram') {
        initialIgCompetitorSync(accountId, username).catch(err =>
          console.error('[ig competitor initial-sync]', err)
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
    console.error('[POST /api/brands/[brandId]/competitors]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
