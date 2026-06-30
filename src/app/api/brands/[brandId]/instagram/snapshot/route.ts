import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchIgProfile, fetchIgInsightsDay, fetchIgInsightsLifetime, fetchIgFollowsUnfollows } from '@/lib/instagram/graph'
import { saveIgSnapshot } from '@/lib/instagram/queries'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/instagram/snapshot
// Fetch raw data from Graph API and save to ig_profile_snapshots
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedIgAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected Instagram account found.' }, { status: 404 })
    }

    const { id: socialAccountId, platform_user_id, oauth_token } = account

    const [profile, insightsDay, insightsLifetime, followsAndUnfollows] = await Promise.all([
      fetchIgProfile(platform_user_id, oauth_token),
      fetchIgInsightsDay(platform_user_id, oauth_token),
      fetchIgInsightsLifetime(platform_user_id, oauth_token),
      fetchIgFollowsUnfollows(platform_user_id, oauth_token),
    ])

    await saveIgSnapshot({
      socialAccountId,
      profile,
      insightsDay,
      followsAndUnfollows,
      insightsLifetime,
    })

    return NextResponse.json({ success: true, fetched_at: new Date().toISOString() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/instagram/snapshot]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
