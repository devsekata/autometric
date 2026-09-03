import { GROUP_LABEL, tabsFor, visibleViews, type TabRole } from '@/lib/discover/tabs'

export interface OrgNavItem {
  label: string
  path: string
  icon: string
  /** Only for autometric staff — gated on the *account* role, not the workspace one. */
  adminOnly?: boolean
  /**
   * Only for a workspace Admin, and gated on the role the sidebar is being drawn
   * for — which is what the "Viewing as" switch changes.
   *
   * Distinct from `adminOnly` above, which is about who works at autometric.
   * This one is about who administers *this workspace*, and it is why the
   * top-level `Settings` entry disappears for a Member alongside Discover's own:
   * the requirement is that Settings is not reachable from anywhere, and a
   * second entry with the same name would be exactly the "other location" it
   * rules out.
   */
  workspaceAdminOnly?: boolean
  /**
   * Discover selects its panel with `?tab=`, so its entries share one route and
   * differ only by the query. `tab` is what "is this the active entry" compares;
   * `view` only seeds the link, because which section of a tab you are on is the
   * in-page strip's business, not the sidebar's.
   */
  tab?: string
  view?: string | null
  /**
   * Small-caps separator printed above this entry. Set on the first entry of each
   * group; the sidebar renders it as a label row, not as something clickable.
   */
  groupLabel?: string
  children?: OrgNavItem[]
}

/**
 * Discover's children, derived from the tab registry rather than restated here.
 *
 * The module's list of destinations, their labels and their icons already live in
 * `@/lib/discover/tabs` — the workspace needs them to render headings and
 * breadcrumbs. Deriving the sidebar from the same array means adding a tab puts it
 * in the sidebar automatically, and the two can never disagree about what Discover
 * contains.
 *
 * One level deep, like Dashboard, but grouped the way the source platform groups
 * it: the six entries of its `KOL Intelligence` branch first, then the entries
 * that sit beside that branch under the same Discover heading. The registry marks
 * each entry with its half and the first of each carries the label that prints
 * above it.
 *
 * The sub-sections a few tabs have (Directory's two rosters, Ordering's
 * `[ Rate Cards | Cart | Orders ]` segments, Discover/Workspace for Reports and
 * Settings, the seven per-creator views reached by opening a tracked account)
 * stay as strips inside the page: they are steps within a screen, and hanging
 * them off the sidebar is what made this module three levels deep before.
 */
const discoverChildren = (role: TabRole): OrgNavItem[] => {
  // Filtered *before* the group labels are computed, so a group whose first
  // entry is Admin-only still gets its heading from whichever entry a Member
  // does have — and a group that empties out prints no heading at all. That is
  // what makes the list close up cleanly instead of leaving a labelled gap.
  const tabs = tabsFor(role)
  return tabs.map((t, i) => ({
    label: t.label,
    path: 'discover',
    icon: t.icon,
    tab: t.id,
    // Land on the tab's first section when it has an always-visible strip.
    view: visibleViews(t)[0]?.id ?? null,
    groupLabel: tabs[i - 1]?.group === t.group ? undefined : GROUP_LABEL[t.group],
  }))
}

const ORG_NAV_BASE: OrgNavItem[] = [
  {
    label: 'Dashboard', path: 'dashboard', icon: 'dashboard',
    children: [
      { label: 'Overview',           path: 'dashboard/overview',  icon: 'grid_view' },
      { label: 'Content Overview',   path: 'dashboard/content',   icon: 'stacked_bar_chart' },
      { label: 'Audience Deep Dive', path: 'dashboard/audience',  icon: 'groups' },
      { label: 'Stories',            path: 'dashboard/stories',   icon: 'amp_stories' },
      { label: 'TikTok Deep',        path: 'dashboard/tiktok',    icon: 'music_note' },
      { label: 'Community',          path: 'dashboard/community', icon: 'diversity_3' },
      { label: 'Campaign Analysis',  path: 'dashboard/campaign',  icon: 'campaign' },
      { label: 'Content Pillars',    path: 'dashboard/pillars',   icon: 'dashboard_customize' },
    ],
  },
  // Discover — one branch of ten, the same shape as Dashboard above it.
  //
  // It is still one route (`discover`, with `?tab=`); only the navigation moved.
  // An in-page strip of eleven pills competed with the sidebar for the same job
  // and scrolled sideways on a laptop, so the sidebar does the navigating and the
  // page keeps only its heading and whatever sub-strip that tab needs.
  // No `tab` on the branch itself: like Dashboard, it prefix-matches the route so
  // it reads as on-path for every tab and for the detail pages underneath, and
  // yields the highlight to whichever child is actually active.
  // `children` is filled in per role by `orgNavItems` below.
  {
    label: 'Discover', path: 'discover', icon: 'travel_explore',
  },
  { label: 'Brands',     path: 'brands',     icon: 'store' },
  { label: 'Reports',    path: 'reports',    icon: 'bar_chart' },
  { label: 'Members',    path: 'members',    icon: 'group' },
  { label: 'Settings',   path: 'settings',   icon: 'settings', workspaceAdminOnly: true },
  { label: 'Monitoring', path: 'monitoring', icon: 'monitor_heart', adminOnly: true },
]

/**
 * The sidebar, as one role sees it.
 *
 * A function rather than a constant because the two roles do not have the same
 * tree: a Member has no Ordering and no Settings, in Discover or at the top
 * level. Building it per role — rather than rendering everything and hiding two
 * entries with CSS — is what guarantees there is nothing left behind to leave a
 * gap, no invisible clickable row, and no disabled item to explain.
 *
 * Both the expanded sidebar and the collapsed rail read this, so the rule holds
 * at every width.
 */
export function orgNavItems(role: TabRole): OrgNavItem[] {
  const children = discoverChildren(role)
  return ORG_NAV_BASE
    .filter(i => !i.workspaceAdminOnly || role !== 'MEMBER')
    .map(i => (i.path === 'discover' && !i.children ? { ...i, children } : i))
}

/** The Admin tree, for callers with no role to hand. */
export const ORG_NAV_ITEMS: OrgNavItem[] = orgNavItems('ADMIN')
