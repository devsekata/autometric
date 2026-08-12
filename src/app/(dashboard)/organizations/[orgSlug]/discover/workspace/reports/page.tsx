import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import WorkspaceReports from '@/components/discover/WorkspaceReports'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * Discover › Workspace › Reports — the source platform's `pages/reports.js`.
 *
 * Distinct from the org-level Reports module at /reports, which builds slide
 * decks from dashboard data. This one reports on the KOL side: creators,
 * campaigns bought through Ordering Flow, and the workspace's purchase history.
 */
export default async function WorkspaceReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  return <WorkspaceReports orgId={org.id} orgSlug={orgSlug} />
}
