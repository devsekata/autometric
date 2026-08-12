import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { getMembersByOrgId } from '@/lib/organizations/members'
import { listDirectory } from '@/lib/discover/directory'
import { isPaymentConfigured } from '@/lib/discover/payment'
import WorkspaceSettings, { type WorkspaceSettingsData } from '@/components/discover/WorkspaceSettings'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * Discover › Workspace › Settings — the source platform's `pages/settings.js`.
 *
 * Everything is read here on the server and handed down read-only. The tabs
 * report the real configuration; the pages that own each setting are linked
 * from within, rather than duplicated as a second set of controls that would
 * then have to be kept in step.
 */
export default async function WorkspaceSettingsPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  // Members and the account roster are non-essential to the page rendering, so
  // a failure in either degrades to an empty tab rather than a 500.
  let members: WorkspaceSettingsData['members'] = []
  try {
    members = await getMembersByOrgId(org.id)
  } catch (e) {
    console.error('[workspace/settings] members failed:', e)
  }

  const platformCounts = new Map<string, number>()
  try {
    const dir = await listDirectory(org.id)
    for (const a of dir.accounts) {
      platformCounts.set(a.platform, (platformCounts.get(a.platform) ?? 0) + 1)
    }
  } catch (e) {
    console.error('[workspace/settings] directory failed:', e)
  }

  const data: WorkspaceSettingsData = {
    orgName: org.name,
    orgSlug: org.slug,
    // `Organization.created_at` is typed string but node-pg hands back a Date
    // for a timestamptz. Normalise here so the client gets what the type claims
    // and a Date never crosses the server/client boundary.
    createdAt: org.created_at ? new Date(org.created_at).toISOString() : null,
    brandCount: org.brand_count ?? 0,
    memberCount: org.member_count ?? members.length,
    myRole: org.role,
    members,
    viewer: { name: session?.user?.name ?? null, email: session?.user?.email ?? null },
    platforms: [...platformCounts.entries()]
      .map(([platform, accounts]) => ({ platform, accounts }))
      .sort((a, b) => b.accounts - a.accounts),
    paymentConfigured: isPaymentConfigured(),
    // Read on the server only — the key itself never reaches the client, just
    // whether one is set.
    aiConfigured: !!process.env.GEMINI_API_KEY,
  }

  return <WorkspaceSettings data={data} orgSlug={orgSlug} />
}
