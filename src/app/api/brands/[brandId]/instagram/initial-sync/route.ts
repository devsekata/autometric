import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { initialIgSync } from '@/lib/instagram/sync'
import { logSyncEntries, logInitialScrape, summarizeScrapeResult } from '@/lib/monitoring/logger'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/instagram/initial-sync
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
    const runId     = randomUUID()
    const startedAt = new Date()

    const result = await initialIgSync(socialAccountId, platform_user_id, oauth_token, brandId)
    const finishedAt = new Date()

    await logSyncEntries(
      (Object.entries(result) as [keyof typeof result, { count: number; error: string | null }][])
        .map(([category, { count, error }]) => ({
          runId, jobName: 'initial-sync', platform: 'instagram', category,
          socialAccountId, brandId, orgId,
          status: error ? 'failed' as const : 'success' as const,
          recordsSynced: error ? null : count,
          errorMessage: error,
          startedAt, finishedAt,
        }))
    ).catch(e => console.error('[ig initial-sync] log failed:', e))

    // Also record the first connect (aggregate) in the initial_scrape_logs audit trail.
    await logInitialScrape({
      socialAccountId, platform: 'instagram', brandId, orgId,
      ...summarizeScrapeResult(result),
      startedAt, finishedAt,
    }).catch(e => console.error('[ig initial-scrape] log failed:', e))

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/instagram/initial-sync]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
