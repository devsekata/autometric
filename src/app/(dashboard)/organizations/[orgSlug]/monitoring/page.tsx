import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

type Props = { params: Promise<{ orgSlug: string }> }

/**
 * Switched off: Monitoring reads the analytics warehouse, and the KOL product uses
 * the KOL database only.
 */
export default async function Page({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  // Admin-only page, as before it was switched off.
  if (session?.user?.role !== 'ADMIN') notFound()
  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <div className="p-5">
      <FeatureUnavailable title="Monitoring"
        body="Modul ini masih membaca data analitik brand di luar database KOL, jadi dinonaktifkan dulu sampai datanya tersedia di KOL." />
    </div>
  )
}
