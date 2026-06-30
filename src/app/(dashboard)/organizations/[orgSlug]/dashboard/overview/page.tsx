import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import OverviewDashboard from '@/components/dashboard/OverviewDashboard'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DashboardOverviewPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) return notFound()

  return <OverviewDashboard orgId={org.id} />
}
