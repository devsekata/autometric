import { getMembersByOrgId } from '@/lib/organizations/members'
import { listDirectory } from './directory'
import { isPaymentConfigured } from './payment'
import type { WorkspaceSettingsData } from '@/components/discover/WorkspaceSettings'

/**
 * Reads the Workspace half of Discover › Settings.
 *
 * Server-only, and deliberately not an API route: everything here is either
 * already on the org record or a straight count, and two of the three answers
 * (`paymentConfigured`, `aiConfigured`) are derived from env vars that must not
 * cross to the client. Only the booleans travel — never the keys.
 *
 * Lifted out of the old `discover/workspace/settings` page when Discover became
 * one route, so the tab can be served without a second page owning the query.
 */

export interface OrgForSettings {
  id: string
  name: string
  slug: string
  created_at?: string | Date | null
  brand_count?: number | null
  member_count?: number | null
  role: 'ADMIN' | 'MEMBER'
}

export async function getWorkspaceSettingsData(
  org: OrgForSettings,
  viewer: { name?: string | null; email?: string | null },
): Promise<WorkspaceSettingsData> {
  // Members and the account roster are non-essential to the page rendering, so
  // a failure in either degrades to an empty tab rather than a 500.
  let members: WorkspaceSettingsData['members'] = []
  try {
    members = await getMembersByOrgId(org.id)
  } catch (e) {
    console.error('[discover/settings] members failed:', e)
  }

  const platformCounts = new Map<string, number>()
  try {
    const dir = await listDirectory(org.id)
    for (const a of dir.accounts) {
      platformCounts.set(a.platform, (platformCounts.get(a.platform) ?? 0) + 1)
    }
  } catch (e) {
    console.error('[discover/settings] directory failed:', e)
  }

  return {
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
    viewer: { name: viewer.name ?? null, email: viewer.email ?? null },
    platforms: [...platformCounts.entries()]
      .map(([platform, accounts]) => ({ platform, accounts }))
      .sort((a, b) => b.accounts - a.accounts),
    paymentConfigured: isPaymentConfigured(),
    // Read on the server only — the key itself never reaches the client, just
    // whether one is set.
    aiConfigured: !!process.env.GEMINI_API_KEY,
  }
}
