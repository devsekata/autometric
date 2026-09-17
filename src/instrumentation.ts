export async function register() {
  // The Autometric scheduler reads and writes the analytics warehouse (TSDB).
  // The KOL product must never touch it, so the cron is off unless explicitly
  // enabled — and its module is not even imported otherwise.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.AUTOMETRIC_CRON_ENABLED === 'true') {
    const { startCron } = await import('@/lib/monitoring/cron')
    startCron()
  }
}
