import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import DiscoverSettings from '@/components/discover/DiscoverSettings'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DiscoverSettingsPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <DiscoverSettings orgId={org.id} orgSlug={orgSlug} />
}
