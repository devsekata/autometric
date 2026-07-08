import { notFound } from 'next/navigation'
import { getOrgBasicBySlug } from '@/lib/organizations/queries'
import { getDashboardBrands } from '@/lib/dashboard/brands'
import { listReportExports, listReportTemplates } from '@/lib/reports/queries'
import type { ReportRecord } from '@/lib/reports/data/history'
import type { ReportTemplateRecord } from '@/lib/reports/data/slideModel'
import type { DashBrand } from '@/components/dashboard/data'
import ReportsView from '@/components/reports/ReportsView'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function ReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const org = await getOrgBasicBySlug(orgSlug)
  if (!org) notFound()

  // Real brands for this org (setup dropdown + history brand chips). Tolerate
  // failure by falling back to an empty list.
  let brands: DashBrand[] = []
  try {
    brands = await getDashboardBrands(org.id)
  } catch (e) {
    console.error('[reports] failed to load brands:', e)
  }

  // Tolerate a missing table (migration not run yet) by falling back to empty.
  let history: ReportRecord[] = []
  try {
    history = await listReportExports(org.id)
  } catch (e) {
    console.error('[reports] failed to load export history:', e)
  }

  let templates: ReportTemplateRecord[] = []
  try {
    templates = await listReportTemplates(org.id)
  } catch (e) {
    console.error('[reports] failed to load templates:', e)
  }

  return <ReportsView orgName={org.name} orgId={org.id} brands={brands} history={history} templates={templates} />
}
