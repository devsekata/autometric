import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import ContentDashboard from '@/components/dashboard/ContentDashboard'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DashboardContentPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) return notFound()

  return <ContentDashboard orgId={org.id} />
}
