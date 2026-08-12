import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { DiscoverReports } from '@/components/discover/DiscoverAnalytics'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DiscoverReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <DiscoverReports orgId={org.id} />
}
