import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import DiscoverAssistant from '@/components/discover/DiscoverAssistant'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DiscoverAssistantPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <DiscoverAssistant orgId={org.id} />
}
