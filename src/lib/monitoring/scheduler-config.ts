import pool from '@/lib/db'

export type ScheduleTime = {
  hour:   number  // 0-23 WIB
  minute: number  // 0-59
}

export type SchedulerConfig = {
  scheduleTimes: ScheduleTime[]
  isActive:      boolean
}

const DEFAULT: SchedulerConfig = { scheduleTimes: [{ hour: 2, minute: 0 }], isActive: true }

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  try {
    const { rows } = await pool.query<{ schedule_times: ScheduleTime[]; is_active: boolean }>(
      `SELECT schedule_times, is_active FROM scheduler_config LIMIT 1`
    )
    if (!rows[0]) return DEFAULT
    return {
      scheduleTimes: rows[0].schedule_times ?? [{ hour: 2, minute: 0 }],
      isActive:      rows[0].is_active,
    }
  } catch {
    return DEFAULT
  }
}

export async function saveSchedulerConfig(scheduleTimes: ScheduleTime[], isActive: boolean): Promise<void> {
  await pool.query(
    `UPDATE scheduler_config SET schedule_times = $1, is_active = $2, updated_at = now()`,
    [JSON.stringify(scheduleTimes), isActive]
  )
}

export function shouldRunNow(config: SchedulerConfig): boolean {
  if (!config.isActive || config.scheduleTimes.length === 0) return false
  const wib    = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = wib.split(':').map(Number)
  return config.scheduleTimes.some(t => t.hour === h && t.minute === m)
}
