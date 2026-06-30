import pool from '@/lib/db'
import type { ScheduleTime } from '@/lib/monitoring/scheduler-config'

export type { ScheduleTime }

export type CompetitorSchedulerConfig = {
  scheduleTimes:   ScheduleTime[]  // WIB times the daily profile snapshot runs
  postsDayOfMonth: number          // 1-28: date posts are also synced for all competitors
  isActive:        boolean
}

const DEFAULT: CompetitorSchedulerConfig = {
  scheduleTimes:   [{ hour: 3, minute: 0 }],
  postsDayOfMonth: 1,
  isActive:        true,
}

export async function getCompetitorSchedulerConfig(): Promise<CompetitorSchedulerConfig> {
  try {
    const { rows } = await pool.query<{ schedule_times: ScheduleTime[]; posts_day_of_month: number; is_active: boolean }>(
      `SELECT schedule_times, posts_day_of_month, is_active FROM competitor_scheduler_config LIMIT 1`
    )
    if (!rows[0]) return DEFAULT
    return {
      scheduleTimes:   rows[0].schedule_times ?? DEFAULT.scheduleTimes,
      postsDayOfMonth: rows[0].posts_day_of_month ?? DEFAULT.postsDayOfMonth,
      isActive:        rows[0].is_active,
    }
  } catch {
    return DEFAULT
  }
}

export async function saveCompetitorSchedulerConfig(
  scheduleTimes: ScheduleTime[],
  postsDayOfMonth: number,
  isActive: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE competitor_scheduler_config
        SET schedule_times = $1, posts_day_of_month = $2, is_active = $3, updated_at = now()`,
    [JSON.stringify(scheduleTimes), postsDayOfMonth, isActive]
  )
}

// True if the current WIB minute matches one of the configured schedule times.
export function shouldRunNow(config: CompetitorSchedulerConfig): boolean {
  if (!config.isActive || config.scheduleTimes.length === 0) return false
  const wib    = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = wib.split(':').map(Number)
  return config.scheduleTimes.some(t => t.hour === h && t.minute === m)
}

// True if today's WIB date-of-month is the configured posts day (→ also sync posts).
export function isPostsDay(config: CompetitorSchedulerConfig): boolean {
  const day = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', day: 'numeric' }))
  return day === config.postsDayOfMonth
}
