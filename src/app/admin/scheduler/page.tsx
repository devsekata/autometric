import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

/**
 * Switched off: the scheduler syncs brand-owned accounts on the analytics warehouse; the KOL database has none.
 * Access is still limited to admins by app/admin/layout.tsx.
 */
export default function SchedulerSettingsPage() {
  return <FeatureUnavailable title="Scheduler" />
}
