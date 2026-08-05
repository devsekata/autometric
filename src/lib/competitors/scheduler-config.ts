import pool from '@/lib/db'
import type { ScheduleTime } from '@/lib/monitoring/scheduler-config'

export type { ScheduleTime }

export type CompetitorSchedulerConfig = {
  scheduleTimes:     ScheduleTime[]  // WIB times the daily profile snapshot runs
  postsIntervalDays: number          // 1-90: minimum days between posts syncs
  lastPostsSyncAt:   Date | null     // when posts were last synced (null = never)
  isActive:          boolean
}

const DEFAULT: CompetitorSchedulerConfig = {
  scheduleTimes:     [{ hour: 0, minute: 5 }],
  postsIntervalDays: 28,
  lastPostsSyncAt:   null,
  isActive:          true,
}

export async function getCompetitorSchedulerConfig(): Promise<CompetitorSchedulerConfig> {
  try {
    const { rows } = await pool.query<{
      schedule_times: ScheduleTime[]; posts_interval_days: number
      last_posts_sync_at: Date | null; is_active: boolean
    }>(
      `SELECT schedule_times, posts_interval_days, last_posts_sync_at, is_active
         FROM competitor_scheduler_config LIMIT 1`
    )
    if (!rows[0]) return DEFAULT
    return {
      scheduleTimes:     rows[0].schedule_times ?? DEFAULT.scheduleTimes,
      postsIntervalDays: rows[0].posts_interval_days ?? DEFAULT.postsIntervalDays,
      lastPostsSyncAt:   rows[0].last_posts_sync_at ?? null,
      isActive:          rows[0].is_active,
    }
  } catch {
    return DEFAULT
  }
}

export async function saveCompetitorSchedulerConfig(
  scheduleTimes: ScheduleTime[],
  postsIntervalDays: number,
  isActive: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE competitor_scheduler_config
        SET schedule_times = $1, posts_interval_days = $2, is_active = $3, updated_at = now()`,
    [JSON.stringify(scheduleTimes), postsIntervalDays, isActive]
  )
}

/**
 * Tandai posts baru saja di-sync.
 *
 * Dipanggil SETELAH run yang menyertakan posts selesai, bukan sebelum: kalau
 * dicatat di depan lalu run-nya gagal, selang waktunya ter-reset dan posts baru
 * dicoba lagi sebulan kemudian.
 */
export async function markPostsSynced(at: Date = new Date()): Promise<void> {
  await pool.query(
    `UPDATE competitor_scheduler_config SET last_posts_sync_at = $1, updated_at = now()`,
    [at],
  )
}

// True if the current WIB minute matches one of the configured schedule times.
export function shouldRunNow(config: CompetitorSchedulerConfig): boolean {
  if (!config.isActive || config.scheduleTimes.length === 0) return false
  const wib    = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = wib.split(':').map(Number)
  return config.scheduleTimes.some(t => t.hour === h && t.minute === m)
}

/**
 * Apakah run ini harus menyertakan posts?
 *
 * Berbasis "sudah berapa lama sejak terakhir", bukan tanggal kalender. Versi
 * sebelumnya (`posts_day_of_month`) menuntut tanggal WIB DAN menit WIB cocok
 * persis; sekali terlewat — deploy, restart, host mati — posts competitor tidak
 * ter-sync sebulan penuh tanpa catch-up dan tanpa satu baris log. Itu bukan
 * kekhawatiran teoretis: `scheduler_logs` belum pernah punya satu pun entri
 * `competitor_posts`. Dengan basis selang waktu, run yang terlewat cukup diambil
 * oleh run terjadwal berikutnya.
 */
export function shouldSyncPosts(config: CompetitorSchedulerConfig, now: Date = new Date()): boolean {
  if (!config.lastPostsSyncAt) return true // belum pernah — kejar sekarang
  const elapsedDays = (now.getTime() - config.lastPostsSyncAt.getTime()) / 86_400_000
  return elapsedDays >= config.postsIntervalDays
}
