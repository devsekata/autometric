import cron from 'node-cron'
import { getSchedulerConfig, shouldRunNow } from './scheduler-config'
import { runScheduler } from './scheduler'
import {
  getCompetitorSchedulerConfig,
  shouldRunNow as shouldRunCompetitorNow,
  shouldSyncPosts,
} from '@/lib/competitors/scheduler-config'
import { runCompetitorScheduler } from '@/lib/competitors/scheduler'

// Global flag to prevent duplicate cron instances in Next.js dev hot-reload
const g = global as typeof globalThis & { __autometricCronStarted?: boolean }

export function startCron() {
  if (g.__autometricCronStarted) return
  g.__autometricCronStarted = true

  // Run every minute — shouldRunNow() gates actual execution to configured times
  cron.schedule('* * * * *', async () => {
    // Owned-account sync
    try {
      const config = await getSchedulerConfig()
      if (shouldRunNow(config)) {
        console.log('[Cron] Scheduler triggered at', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), 'WIB')
        await runScheduler('daily-sync')
      }
    } catch (err) {
      console.error('[Cron] Error running scheduler:', err)
    }

    // Competitor sync (profile daily; posts on configured day-of-month)
    try {
      const cConfig = await getCompetitorSchedulerConfig()
      if (shouldRunCompetitorNow(cConfig)) {
        const syncPosts = shouldSyncPosts(cConfig)
        console.log('[Cron] Competitor scheduler triggered at', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), 'WIB · syncPosts=', syncPosts)
        await runCompetitorScheduler('competitor-daily', { syncPosts })
      }
    } catch (err) {
      console.error('[Cron] Error running competitor scheduler:', err)
    }
  })

  console.log('[Cron] Kepiai scheduler started')
}
