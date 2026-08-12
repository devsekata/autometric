import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { DiscoverOrderDetail } from '@/components/discover/DiscoverOrders'

interface Props { params: Promise<{ orgSlug: string; orderId: string }> }

/**
 * Order detail lives under /discover/kol so the whole commercial flow stays
 * inside KOL Intelligence — including nav highlighting, which matches on the
 * pathname prefix. The static `orders` segment takes precedence over the
 * sibling `[accountId]` route, and account ids are UUIDs so the two can never
 * collide.
 */
export default async function DiscoverOrderDetailPage({ params }: Props) {
  const { orgSlug, orderId } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  const id = Number(orderId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  return <DiscoverOrderDetail orgId={org.id} orgSlug={orgSlug} orderId={id} />
}
