import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import KolDirectoryPage from '@/components/discover/KolDirectoryPage'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * KOL Directory reference layout.
 *
 * Kept on its own route rather than replacing the Directory tab in the KOL
 * Intelligence workspace: this page renders a fixed creator set that does not
 * exist in the warehouse, so pointing it at the database would show different
 * people. The live Directory is untouched.
 */
export default async function KolDirectoryRoute({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <KolDirectoryPage />
}
