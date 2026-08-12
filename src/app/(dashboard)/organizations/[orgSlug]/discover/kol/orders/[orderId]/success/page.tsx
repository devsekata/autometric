import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { getOrder } from '@/lib/discover/orders'
import PaymentSuccess from '@/components/discover/PaymentSuccess'

interface Props { params: Promise<{ orgSlug: string; orderId: string }> }

/**
 * Where the payment provider returns the browser after checkout. It is a real
 * route rather than a workspace tab because the redirect comes from an external
 * host, which cannot preserve client-side state.
 */
export default async function PaymentSuccessPage({ params }: Props) {
  const { orgSlug, orderId } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  const id = Number(orderId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  // Fetched server-side so the confirmation is in the first paint. Arriving
  // from an external redirect and being shown a spinner where the answer to
  // "did my payment work?" should be is the one flash worth engineering away.
  const order = await getOrder(org.id, id)
  if (!order) notFound()

  return <PaymentSuccess orgId={org.id} orgSlug={orgSlug} orderId={id} initialOrder={order} />
}
