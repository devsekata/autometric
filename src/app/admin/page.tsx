import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

/**
 * Switched off: sync monitoring reads and writes the analytics warehouse, and the KOL
 * product uses the KOL database only. The admin layout still requires an
 * application admin.
 */
export default function Page() {
  return (
    <div className="p-5">
      <FeatureUnavailable title="Monitoring sinkronisasi"
        body="Monitoring dan scheduler sinkronisasi brand membaca data di luar database KOL, jadi dinonaktifkan dulu." />
    </div>
  )
}
