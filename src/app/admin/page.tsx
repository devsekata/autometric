import { getAllMonitoringData, getAllCategoryData, getRecentSchedulerLogs } from '@/lib/monitoring/queries'
import AdminMonitoringPage from '@/components/admin/AdminMonitoringPage'

export default async function AdminPage() {
  const [data, categories, logs] = await Promise.all([
    getAllMonitoringData(),
    getAllCategoryData(),
    getRecentSchedulerLogs(),
  ])

  return <AdminMonitoringPage data={data} categories={categories} logs={logs} />
}
