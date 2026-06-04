import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedFbAccount } from '@/lib/brands/queries'
import { initialFbSync } from '@/lib/facebook/sync'
import { logSyncEntries } from '@/lib/monitoring/logger'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/facebook/initial-sync
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedFbAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected Facebook account found.' }, { status: 404 })
    }

    const { id: socialAccountId, platform_user_id, oauth_token } = account
    const runId     = randomUUID()
    const startedAt = new Date()

    const result = await initialFbSync(socialAccountId, platform_user_id, oauth_token, brandId)
    const finishedAt = new Date()

    await logSyncEntries(
      (Object.entries(result) as [keyof typeof result, { count: number; error: string | null }][])
        .map(([category, { count, error }]) => ({
          runId, jobName: 'initial-sync', platform: 'facebook', category,
          socialAccountId, brandId, orgId,
          status: error ? 'failed' as const : 'success' as const,
          recordsSynced: error ? null : count,
          errorMessage: error,
          startedAt, finishedAt,
        }))
    ).catch(e => console.error('[fb initial-sync] log failed:', e))

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/facebook/initial-sync]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
