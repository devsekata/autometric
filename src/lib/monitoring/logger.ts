import pool from '@/lib/db'

export type SyncEntry = {
  runId:           string
  jobName:         string
  platform:        string
  category:        string
  socialAccountId: string
  brandId:         string
  orgId:           string | null
  status:          'success' | 'failed' | 'skipped'
  recordsSynced:   number | null
  errorMessage:    string | null
  startedAt:       Date
  finishedAt:      Date
}

export async function logSyncEntries(entries: SyncEntry[]): Promise<void> {
  if (entries.length === 0) return

  const placeholders = entries.map((_, i) => {
    const n = i * 12
    return `($${n+1},$${n+2},$${n+3},$${n+4},$${n+5},$${n+6},$${n+7},$${n+8},$${n+9},$${n+10},$${n+11},$${n+12})`
  }).join(', ')

  const values = entries.flatMap(e => [
    e.runId, e.jobName, e.platform, e.category,
    e.socialAccountId, e.brandId, e.orgId,
    e.status, e.recordsSynced, e.errorMessage,
    e.startedAt, e.finishedAt,
  ])

  await pool.query(
    `INSERT INTO scheduler_logs
       (run_id, job_name, platform, category, social_account_id, brand_id, org_id,
        status, records_synced, error_message, started_at, finished_at)
     VALUES ${placeholders}`,
    values
  )
}
