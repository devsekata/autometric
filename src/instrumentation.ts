/**
 * Next.js boot hook.
 *
 * It used to start the node-cron brand-sync scheduler (`@/lib/monitoring/cron`),
 * which reads and writes the analytics warehouse on a timer. The KOL product
 * uses the KOL database only, so the app no longer starts it: booting the app
 * must not open a single warehouse connection. The KOL creator pipeline runs in
 * scrapper-project, not here.
 */
export async function register() {
  // Intentionally empty.
}
