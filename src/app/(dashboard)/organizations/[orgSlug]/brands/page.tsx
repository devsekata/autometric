import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

type Props = { params: Promise<{ orgSlug: string }> }

/**
 * Switched off: brands, their social accounts and competitors live on the analytics warehouse; KOL public.brand has no rows and no link to social accounts.
 */
export default async function BrandsRoute({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <div className="p-5">
      <FeatureUnavailable title="Brands" />
    </div>
  )
}
