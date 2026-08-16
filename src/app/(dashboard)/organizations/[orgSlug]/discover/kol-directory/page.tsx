import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import KolDirectoryPage from '@/components/discover/KolDirectoryPage'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * KOL Directory.
 *
 * Kept on its own route rather than replacing the Directory tab in the KOL
 * Intelligence workspace: the two read different sources. That tab lists the
 * accounts this org already tracks in the warehouse; this page browses the
 * commercial KOL platform's roster (`public.kol_directory` in the KOL database).
 */
export default async function KolDirectoryRoute({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <KolDirectoryPage orgId={org.id} orgSlug={orgSlug} />
}
