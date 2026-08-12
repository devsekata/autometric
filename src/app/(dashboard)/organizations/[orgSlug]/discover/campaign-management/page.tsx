import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import CampaignsWorkspace from '@/components/discover/CampaignsWorkspace'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * Campaign Management — a sibling of KOL Intelligence, not a tab inside it.
 *
 * Choosing creators and running the campaigns you already bought are different
 * jobs done on different days. Its own route means the URL and the sidebar
 * highlight agree about which of the two you are in; as a `?tab=` on the KOL
 * workspace route, the KOL Intelligence entry lit up for a page that no longer
 * belongs to it.
 *
 */
export default async function CampaignManagementPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <CampaignsWorkspace orgId={org.id} orgSlug={orgSlug} />
}
