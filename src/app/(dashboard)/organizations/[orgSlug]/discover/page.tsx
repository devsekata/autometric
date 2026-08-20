import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { resolveTabParams } from '@/lib/discover/tabs'
import { getWorkspaceSettingsData } from '@/lib/discover/workspaceSettings'
import DiscoverWorkspace from '@/components/discover/DiscoverWorkspace'
import type { WorkspaceSettingsData } from '@/components/discover/WorkspaceSettings'

interface Props {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ tab?: string; view?: string }>
}

/**
 * Discover — the module's single route. `?tab=` and `?view=` select the panel.
 *
 * The tab is resolved here as well as in the client shell, for one reason: the
 * Workspace half of Settings needs data only the server can read, and reading it
 * on every Discover visit would make ten tabs pay for the eleventh. So the server
 * resolves the same params, fetches that payload only when it is the tab being
 * asked for, and hands down `null` otherwise. `resolveTabParams` is shared, so
 * the two resolutions cannot drift.
 */
export default async function DiscoverPage({ params, searchParams }: Props) {
  const { orgSlug } = await params
  const { tab: rawTab, view: rawView } = await searchParams

  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  const { tab, view } = resolveTabParams(rawTab, rawView)

  let workspaceSettings: WorkspaceSettingsData | null = null
  if (tab === 'settings' && view === 'workspace') {
    workspaceSettings = await getWorkspaceSettingsData(org, {
      name: session?.user?.name,
      email: session?.user?.email,
    })
  }

  return (
    <DiscoverWorkspace
      orgId={org.id}
      orgSlug={orgSlug}
      tab={tab}
      view={view}
      workspaceSettings={workspaceSettings}
    />
  )
}
