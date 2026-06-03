import { randomUUID } from 'crypto'
import pool from '@/lib/db'
import { initialIgSync } from '@/lib/instagram/sync'
import { initialTtSync } from '@/lib/tiktok/sync'
import { initialFbSync } from '@/lib/facebook/sync'
import { logSyncEntries, SyncEntry } from '@/lib/monitoring/logger'

type SchedulerAccount = {
  socialAccountId: string
  platformUserId:  string | null
  oauthToken:      string
  platform:        string
  brandId:         string
  orgId:           string
}

export type SchedulerSummary = {
  runId:    string
  accounts: number
  entries:  number
  success:  number
  failed:   number
  errors?:  string[]
}

export async function runScheduler(
  jobName: 'daily-sync' | 'manual-sync' = 'daily-sync'
): Promise<SchedulerSummary> {
  const runId      = randomUUID()
  const allEntries: SyncEntry[] = []
  const errors:     string[]    = []

  const { rows: accounts } = await pool.query<SchedulerAccount>(`
    SELECT
      sa.id               AS "socialAccountId",
      sa.platform_user_id AS "platformUserId",
      sa.oauth_token      AS "oauthToken",
      p.key               AS platform,
      b.id                AS "brandId",
      b.organization_id   AS "orgId"
    FROM social_accounts sa
    JOIN brand_social_accounts bsa ON bsa.social_account_id = sa.id
    JOIN brands b                  ON b.id  = bsa.brand_id
    JOIN platforms p               ON p.id  = sa.platform_id
    WHERE sa.connected = true
      AND sa.oauth_token IS NOT NULL
    ORDER BY p.key, b.id
  `)

  console.log(`[scheduler] START job=${jobName} run_id=${runId} accounts=${accounts.length}`)

  for (const acct of accounts) {
    const startedAt = new Date()
    try {
      let result: Record<string, { count: number; error: string | null }>

      if (acct.platform === 'instagram' && acct.platformUserId) {
        result = await initialIgSync(acct.socialAccountId, acct.platformUserId, acct.oauthToken, acct.brandId)
      } else if (acct.platform === 'tiktok') {
        result = await initialTtSync(acct.socialAccountId, acct.oauthToken, acct.brandId)
      } else if (acct.platform === 'facebook' && acct.platformUserId) {
        result = await initialFbSync(acct.socialAccountId, acct.platformUserId, acct.oauthToken, acct.brandId)
      } else {
        continue
      }

      const finishedAt = new Date()
      for (const [category, { count, error }] of Object.entries(result)) {
        allEntries.push({
          runId,
          jobName,
          platform:        acct.platform,
          category,
          socialAccountId: acct.socialAccountId,
          brandId:         acct.brandId,
          orgId:           acct.orgId,
          status:          error ? 'failed'  : 'success',
          recordsSynced:   error ? null      : count,
          errorMessage:    error ?? null,
          startedAt,
          finishedAt,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${acct.platform}/${acct.socialAccountId}: ${msg}`)
      console.error(`[scheduler] account ${acct.socialAccountId} threw:`, err)
    }
  }

  if (allEntries.length > 0) {
    await logSyncEntries(allEntries).catch(e => console.error('[scheduler] log failed:', e))
  }

  const summary: SchedulerSummary = {
    runId,
    accounts:  accounts.length,
    entries:   allEntries.length,
    success:   allEntries.filter(e => e.status === 'success').length,
    failed:    allEntries.filter(e => e.status === 'failed').length + errors.length,
    errors:    errors.length > 0 ? errors : undefined,
  }

  console.log(`[scheduler] DONE`, summary)
  return summary
}
