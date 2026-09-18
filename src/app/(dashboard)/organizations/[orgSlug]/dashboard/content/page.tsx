import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

type Props = { params: Promise<{ orgSlug: string }> }

/**
 * Switched off: brand analytics are read from the analytics warehouse (l2_gold/l1_silver) and the KOL database has no brand-level source for them.
 */
export default async function DashboardContentPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <div className="p-5">
      <FeatureUnavailable title="Dashboard Content Overview" />
    </div>
  )
}
