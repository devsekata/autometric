import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

/**
 * Switched off: the brand sync scheduler reads and writes the analytics warehouse, and the KOL
 * product uses the KOL database only. The admin layout still requires an
 * application admin.
 */
export default function Page() {
  return (
    <div className="p-5">
      <FeatureUnavailable title="Scheduler"
        body="Monitoring dan scheduler sinkronisasi brand membaca data di luar database KOL, jadi dinonaktifkan dulu." />
    </div>
  )
}
