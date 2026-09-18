import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

/**
 * Switched off: platform sync status and scheduler logs are read from the analytics warehouse.
 * Access is still limited to admins by app/admin/layout.tsx.
 */
export default function AdminPage() {
  return <FeatureUnavailable title="Monitoring" />
}
