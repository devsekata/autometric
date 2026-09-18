import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

/**
 * Switched off: competitor accounts and their snapshots live on the analytics warehouse; the KOL database has none.
 * Access is still limited to admins by app/admin/layout.tsx.
 */
export default function CompetitorSchedulerPage() {
  return <FeatureUnavailable title="Competitor Scheduler" />
}
