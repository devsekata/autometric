import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedTtAccount } from '@/lib/brands/queries'
import { initialTtSync } from '@/lib/tiktok/sync'
import { logSyncEntries, logInitialScrape, summarizeScrapeResult } from '@/lib/monitoring/logger'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/tiktok/initial-sync
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedTtAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected TikTok account found.' }, { status: 404 })
    }

    const { id: socialAccountId, oauth_token } = account
    const runId     = randomUUID()
    const startedAt = new Date()

    const result = await initialTtSync(socialAccountId, oauth_token, brandId)
    const finishedAt = new Date()

    await logSyncEntries(
      (Object.entries(result) as [keyof typeof result, { count: number; error: string | null }][])
        .map(([category, { count, error }]) => ({
          runId, jobName: 'initial-sync', platform: 'tiktok', category,
          socialAccountId, brandId, orgId,
          status: error ? 'failed' as const : 'success' as const,
          recordsSynced: error ? null : count,
          errorMessage: error,
          startedAt, finishedAt,
        }))
    ).catch(e => console.error('[tt initial-sync] log failed:', e))

    // Also record the first connect (aggregate) in the initial_scrape_logs audit trail.
    await logInitialScrape({
      socialAccountId, platform: 'tiktok', brandId, orgId,
      ...summarizeScrapeResult(result),
      startedAt, finishedAt,
    }).catch(e => console.error('[tt initial-scrape] log failed:', e))

    return NextResponse.json({ success: true, socialAccountId })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/tiktok/initial-sync]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
