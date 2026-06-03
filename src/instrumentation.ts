export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCron } = await import('@/lib/monitoring/cron')
    startCron()
  }
}
