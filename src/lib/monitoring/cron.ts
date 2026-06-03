import cron from 'node-cron'
import { getSchedulerConfig, shouldRunNow } from './scheduler-config'
import { runScheduler } from './scheduler'

// Global flag to prevent duplicate cron instances in Next.js dev hot-reload
const g = global as typeof globalThis & { __autometricCronStarted?: boolean }

export function startCron() {
  if (g.__autometricCronStarted) return
  g.__autometricCronStarted = true

  // Run every minute — shouldRunNow() gates actual execution to configured times
  cron.schedule('* * * * *', async () => {
    try {
      const config = await getSchedulerConfig()
      if (!shouldRunNow(config)) return
      console.log('[Cron] Scheduler triggered at', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), 'WIB')
      await runScheduler('daily-sync')
    } catch (err) {
      console.error('[Cron] Error running scheduler:', err)
    }
  })

  console.log('[Cron] Autometric scheduler started')
}
