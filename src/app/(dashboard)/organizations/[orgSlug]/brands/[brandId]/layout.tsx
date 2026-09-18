import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgSlug: string; brandId: string }>
}

/**
 * Switched off: brand detail (accounts, competitors, data sources, settings)
 * reads and writes the analytics warehouse; KOL public.brand has no rows and no
 * link to social accounts. The pages underneath are not rendered.
 */
export default async function BrandDetailLayout({ params }: Props) {
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
