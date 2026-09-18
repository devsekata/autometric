export async function register() {
  // Nothing to start. The Autometric cron (src/lib/monitoring/cron.ts) synced
  // brand accounts on the analytics warehouse; the KOL product reads the KOL
  // database only, so it is no longer started from here in any environment.
}
