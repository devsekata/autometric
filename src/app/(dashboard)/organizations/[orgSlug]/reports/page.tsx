import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

type Props = { params: Promise<{ orgSlug: string }> }

/**
 * Switched off: report data, exports and templates live on the analytics warehouse; the KOL database has no source for them.
 */
export default async function ReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <div className="p-5">
      <FeatureUnavailable title="Reports" />
    </div>
  )
}
