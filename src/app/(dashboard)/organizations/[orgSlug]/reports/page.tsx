import { notFound } from 'next/navigation'
import { getOrgBasicBySlug } from '@/lib/organizations/queries'
import ReportsView from '@/components/reports/ReportsView'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function ReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const org = await getOrgBasicBySlug(orgSlug)
  if (!org) notFound()

  return <ReportsView orgName={org.name} />
}
