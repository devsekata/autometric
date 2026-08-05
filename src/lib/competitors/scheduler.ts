import { randomUUID } from 'crypto'
import {
  listAllCompetitorAccounts, CompetitorSyncAccount,
  markCompetitorVerified, deleteCompetitorLinks,
} from './queries'
import { syncCompetitorProfile, syncCompetitorPosts } from './sync'
import { isAccountNotFound, cleanErrorMessage } from './verify'
import { markPostsSynced } from './scheduler-config'
import { logSyncEntries, SyncEntry } from '@/lib/monitoring/logger'
import type { SchedulerSummary } from '@/lib/monitoring/scheduler'

export type CompetitorJobName = 'competitor-daily' | 'competitor-manual'

function buildEntry(
  runId: string,
  jobName: string,
  acct: CompetitorSyncAccount,
  category: 'competitor_profile' | 'competitor_posts',
  status: 'success' | 'failed',
  recordsSynced: number | null,
  errorMessage: string | null,
  startedAt: Date,
): SyncEntry {
  return {
    runId,
    jobName,
    platform:        acct.platform,
    category,
    socialAccountId: acct.socialAccountId,
    brandId:         acct.brandId,
    orgId:           acct.orgId,
    status,
    recordsSynced,
    errorMessage,
    startedAt,
    finishedAt:      new Date(),
  }
}

// Recurring competitor sync. Always snapshots PROFILE for every competitor; also
// syncs POSTS when opts.syncPosts is true (the configured day-of-month, or a
// manual full run). Each competitor account is synced once (deduped across brands).
export async function runCompetitorScheduler(
  jobName: CompetitorJobName = 'competitor-daily',
  opts: { syncPosts: boolean } = { syncPosts: false },
): Promise<SchedulerSummary> {
  const runId      = randomUUID()
  const allEntries: SyncEntry[] = []
  const errors:     string[]    = []

  const accounts = await listAllCompetitorAccounts()
  console.log(`[competitor-scheduler] START job=${jobName} run_id=${runId} accounts=${accounts.length} syncPosts=${opts.syncPosts}`)

  const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e))

  let removed = 0

  for (const acct of accounts) {
    // 1. Profile (daily)
    const profStart = new Date()
    try {
      const count = await syncCompetitorProfile(acct)
      allEntries.push(buildEntry(runId, jobName, acct, 'competitor_profile', 'success', count, null, profStart))
      // Sekaligus jadi mekanisme retry verifikasi: competitor yang tersangkut
      // 'pending' karena Apify sempat error naik ke 'verified' di sini.
      await markCompetitorVerified(acct.socialAccountId)
        .catch(e => console.error(`[competitor-scheduler] mark verified @${acct.username} failed:`, e))
    } catch (err) {
      const msg = errStr(err)
      errors.push(`${acct.platform}/profile/@${acct.username}: ${cleanErrorMessage(msg)}`)
      console.error(`[competitor-scheduler] profile @${acct.username} (${acct.platform}) failed:`, err)
      allEntries.push(buildEntry(runId, jobName, acct, 'competitor_profile', 'failed', null, msg, profStart))

      // Akun terbukti hilang (dihapus/di-rename setelah ditambahkan) → lepaskan
      // dari semua brand. Tanpa ini, akun seperti itu gagal tiap hari selamanya
      // tanpa terlihat di UI mana pun.
      if (isAccountNotFound(msg)) {
        const n = await deleteCompetitorLinks(acct.socialAccountId)
          .catch(e => { console.error(`[competitor-scheduler] unlink @${acct.username} failed:`, e); return 0 })
        removed += n
        console.warn(`[competitor-scheduler] @${acct.username} (${acct.platform}) tidak ada — ${n} link dilepas`)
        continue // jangan buang satu Apify run lagi untuk posts akun yang sudah hilang
      }
    }

    // 2. Posts (berkala / manual)
    if (opts.syncPosts) {
      const postStart = new Date()
      try {
        const count = await syncCompetitorPosts(acct)
        allEntries.push(buildEntry(runId, jobName, acct, 'competitor_posts', 'success', count, null, postStart))
      } catch (err) {
        const msg = errStr(err)
        errors.push(`${acct.platform}/posts/@${acct.username}: ${cleanErrorMessage(msg)}`)
        console.error(`[competitor-scheduler] posts @${acct.username} (${acct.platform}) failed:`, err)
        allEntries.push(buildEntry(runId, jobName, acct, 'competitor_posts', 'failed', null, msg, postStart))
      }
    }
  }

  // Catat selang waktu HANYA setelah leg posts benar-benar dijalankan. Ditulis
  // meski sebagian akun gagal — kalau tidak, satu akun bermasalah membuat seluruh
  // fleet mengulang scrape posts tiap hari.
  if (opts.syncPosts) {
    await markPostsSynced().catch(e =>
      console.error('[competitor-scheduler] markPostsSynced failed:', e))
  }

  if (allEntries.length > 0) {
    await logSyncEntries(allEntries).catch(e => console.error('[competitor-scheduler] log failed:', e))
  }

  const summary: SchedulerSummary = {
    runId,
    accounts:  accounts.length,
    entries:   allEntries.length,
    success:   allEntries.filter(e => e.status === 'success').length,
    failed:    allEntries.filter(e => e.status === 'failed').length,
    errors:    errors.length > 0 ? errors : undefined,
    removed:   removed > 0 ? removed : undefined,
  }

  console.log('[competitor-scheduler] DONE', summary)
  return summary
}
