import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import CampaignDashboard from '@/components/discover/CampaignDashboard'

interface Props { params: Promise<{ orgSlug: string; orderId: string }> }

/**
 * Campaign Dashboard. Sits under /discover/kol alongside the order detail so the
 * whole commercial flow keeps one nav home; `campaigns` is a static segment and
 * therefore wins over the sibling `[accountId]` route.
 */
export default async function CampaignDashboardPage({ params }: Props) {
  const { orgSlug, orderId } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  const id = Number(orderId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  return <CampaignDashboard orgId={org.id} orgSlug={orgSlug} orderId={id} />
}
