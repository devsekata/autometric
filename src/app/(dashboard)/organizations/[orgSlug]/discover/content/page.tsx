import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import DiscoverContent from '@/components/discover/DiscoverContent'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DiscoverContentPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <DiscoverContent orgId={org.id} orgSlug={orgSlug} />
}
