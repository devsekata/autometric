import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import FeatureUnavailable from '@/components/discover/FeatureUnavailable'

type Props = { params: Promise<{ orgSlug: string; brandId: string }> }

/**
 * Switched off: a brand's settings reads the analytics warehouse, and the KOL product uses
 * the KOL database only.
 */
export default async function Page({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <div className="p-5">
      <FeatureUnavailable title="Brands"
        body="Modul ini masih membaca data analitik brand di luar database KOL, jadi dinonaktifkan dulu sampai datanya tersedia di KOL." />
    </div>
  )
}
