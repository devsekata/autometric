import { randomUUID } from 'crypto'
import pool from '@/lib/db'
import { initialIgSync } from '@/lib/instagram/sync'
import { initialTtSync } from '@/lib/tiktok/sync'
import { initialFbSync } from '@/lib/facebook/sync'
import { refreshTiktokToken } from '@/lib/tiktok/refresh'
import { refreshInstagramToken } from '@/lib/instagram/refresh'
import { logSyncEntries, SyncEntry } from '@/lib/monitoring/logger'

type SchedulerAccount = {
  socialAccountId: string
  platformUserId:  string | null
  oauthToken:      string
  refreshToken:    string | null
  tokenExpiresAt:  string | null
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

// Thresholds: refresh if token expires within this many ms
const TIKTOK_REFRESH_THRESHOLD_MS    = 2  * 60 * 60 * 1000  // 2 hours
const INSTAGRAM_REFRESH_THRESHOLD_MS = 7  * 24 * 60 * 60 * 1000  // 7 days

async function ensureFreshToken(acct: SchedulerAccount): Promise<string> {
  const { platform, oauthToken, refreshToken, tokenExpiresAt, socialAccountId } = acct

  if (!tokenExpiresAt) return oauthToken

  const expiresMs  = new Date(tokenExpiresAt).getTime()
  const nowMs      = Date.now()

  if (platform === 'tiktok') {
    if (expiresMs < nowMs) {
      throw new Error('TikTok token expired — reconnect required')
    }
    const needsRefresh = expiresMs - nowMs < TIKTOK_REFRESH_THRESHOLD_MS
    if (!needsRefresh) return oauthToken
    if (!refreshToken) {
      throw new Error('TikTok token expiring but no refresh_token stored — reconnect required')
    }
    console.log(`[scheduler] refreshing TikTok token for socialAccountId=${socialAccountId}`)
    return refreshTiktokToken(socialAccountId, refreshToken)
  }

  if (platform === 'instagram') {
    const timeLeftMs = expiresMs - nowMs
    if (timeLeftMs < 0) {
      throw new Error('Instagram token expired — reconnect required')
    }
    // Short-lived tokens (<2 days) cannot be refreshed with ig_refresh_token — need reconnect
    if (timeLeftMs < 2 * 24 * 60 * 60 * 1000) {
      throw new Error('Instagram token is short-lived and cannot be refreshed — reconnect required')
    }
    if (timeLeftMs > INSTAGRAM_REFRESH_THRESHOLD_MS) return oauthToken
    console.log(`[scheduler] refreshing Instagram token for socialAccountId=${socialAccountId}`)
    return refreshInstagramToken(socialAccountId, oauthToken)
  }

  return oauthToken
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
      sa.refresh_token    AS "refreshToken",
      sa.token_expires_at AS "tokenExpiresAt",
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
      const token = await ensureFreshToken(acct)

      let result: Record<string, { count: number; error: string | null }>

      if (acct.platform === 'instagram' && acct.platformUserId) {
        result = await initialIgSync(acct.socialAccountId, acct.platformUserId, token, acct.brandId)
      } else if (acct.platform === 'tiktok') {
        result = await initialTtSync(acct.socialAccountId, token, acct.brandId)
      } else if (acct.platform === 'facebook' && acct.platformUserId) {
        result = await initialFbSync(acct.socialAccountId, acct.platformUserId, token, acct.brandId)
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
      const finishedAt = new Date()
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${acct.platform}/${acct.socialAccountId}: ${msg}`)
      console.error(`[scheduler] account ${acct.socialAccountId} threw:`, err)
      allEntries.push({
        runId,
        jobName,
        platform:        acct.platform,
        category:        'unknown',
        socialAccountId: acct.socialAccountId,
        brandId:         acct.brandId,
        orgId:           acct.orgId,
        status:          'failed',
        recordsSynced:   null,
        errorMessage:    msg,
        startedAt,
        finishedAt,
      })
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
