import { notFound } from 'next/navigation'
import { getOrgBasicBySlug } from '@/lib/organizations/queries'
import { listReportExports } from '@/lib/reports/queries'
import type { ReportRecord } from '@/lib/reports/data/history'
import ReportsView from '@/components/reports/ReportsView'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function ReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const org = await getOrgBasicBySlug(orgSlug)
  if (!org) notFound()

  // Tolerate a missing table (migration not run yet) by falling back to empty.
  let history: ReportRecord[] = []
  try {
    history = await listReportExports(org.id)
  } catch (e) {
    console.error('[reports] failed to load export history:', e)
  }

  return <ReportsView orgName={org.name} orgId={org.id} history={history} />
}
