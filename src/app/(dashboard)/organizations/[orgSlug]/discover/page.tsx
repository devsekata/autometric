import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { resolveTabParams } from '@/lib/discover/tabs'
import { getWorkspaceSettingsData } from '@/lib/discover/workspaceSettings'
import DiscoverWorkspace from '@/components/discover/DiscoverWorkspace'
import type { WorkspaceSettingsData } from '@/components/discover/WorkspaceSettings'

interface Props {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{
    tab?: string; view?: string; creator?: string; add?: string; q?: string; url?: string
  }>
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
  const {
    tab: rawTab, view: rawView, creator: rawCreator, add, q: rawQuery, url: rawUrl,
  } = await searchParams

  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  const { tab, view } = resolveTabParams(rawTab, rawView)

  // Shape-checked here rather than in the client: the id goes straight into an
  // API path, and a malformed one should resolve to the roster, not to a 404
  // rendered inside the profiling screen.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const creatorId = rawCreator && UUID.test(rawCreator) ? rawCreator : null

  /**
   * What the hub's search box was submitted with. Both are free text a user
   * typed, so both are trimmed and capped here rather than passed through: they
   * reach a query string and an input field, and neither has any use for a
   * kilobyte of it.
   */
  const seed = (raw: string | undefined) => {
    const value = (raw ?? '').trim().slice(0, 200)
    return value || null
  }

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
      creatorId={creatorId}
      openAddCreator={add === '1'}
      searchQuery={seed(rawQuery)}
      addInput={seed(rawUrl)}
      workspaceSettings={workspaceSettings}
    />
  )
}
