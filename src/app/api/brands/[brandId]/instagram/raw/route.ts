import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchIgProfile, fetchIgInsightsDay, fetchIgInsightsLifetime, fetchIgFollowsUnfollows } from '@/lib/instagram/graph'

type Params = { params: Promise<{ brandId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
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

    const { platform_user_id, oauth_token } = account

    const [profile, insightsDay, insightsLifetime, followsUnfollows] = await Promise.all([
      fetchIgProfile(platform_user_id, oauth_token),
      fetchIgInsightsDay(platform_user_id, oauth_token),
      fetchIgInsightsLifetime(platform_user_id, oauth_token),
      fetchIgFollowsUnfollows(platform_user_id, oauth_token),
    ])

    return NextResponse.json({
      data: {
        fetched_at:            new Date().toISOString(),
        profile,
        insights_day:          insightsDay,
        follows_and_unfollows: followsUnfollows,
        insights_lifetime:     insightsLifetime,
      }
    })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/instagram/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
