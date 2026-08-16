import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import KolCreatorWorkspace from '@/components/discover/KolCreatorWorkspace'

interface Props { params: Promise<{ orgSlug: string; kolId: string }> }

/**
 * Creator Intelligence Workspace for one roster creator.
 *
 * Its own route rather than a tab inside the KOL Intelligence workspace: the
 * per-creator views there belong to accounts tracked in the warehouse, which
 * have post history behind them. A roster creator has none of that, so it gets
 * its own page and its own breadcrumb back to Directory.
 */
export default async function KolCreatorRoute({ params }: Props) {
  const { orgSlug, kolId } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <KolCreatorWorkspace orgId={org.id} orgSlug={orgSlug} kolId={kolId} />
}
