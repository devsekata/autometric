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

export type InitialScrapeEntry = {
  socialAccountId: string
  platform:        string
  brandId:         string | null
  orgId:           string | null
  status:          'success' | 'failed'
  recordsSynced:   number | null
  errorMessage:    string | null
  startedAt:       Date
  finishedAt:      Date
}

// The per-category result shape returned by every initial sync (brand + competitor).
export type ScrapeResult = Record<string, { count: number; error: string | null }>

// Collapse a per-category sync result into one aggregate row: 'failed' if any
// category errored (with the errors joined into error_message), else 'success';
// records_synced totals the successful categories' counts.
export function summarizeScrapeResult(result: ScrapeResult): {
  status: 'success' | 'failed'; recordsSynced: number; errorMessage: string | null
} {
  const cats   = Object.entries(result)
  const errors = cats.filter(([, v]) => v.error).map(([cat, v]) => `${cat}: ${v.error}`)
  const records = cats.reduce((sum, [, v]) => sum + (v.error ? 0 : v.count), 0)
  return {
    status:        errors.length ? 'failed' : 'success',
    recordsSynced: records,
    errorMessage:  errors.length ? errors.join('; ') : null,
  }
}

// Records the first scrape of a freshly-connected brand/competitor account into
// initial_scrape_logs — one aggregate row per account per initial scrape.
export async function logInitialScrape(e: InitialScrapeEntry): Promise<void> {
  await pool.query(
    `INSERT INTO initial_scrape_logs
       (social_account_id, platform, brand_id, org_id,
        status, records_synced, error_message, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.socialAccountId, e.platform, e.brandId, e.orgId,
     e.status, e.recordsSynced, e.errorMessage, e.startedAt, e.finishedAt],
  )
}
