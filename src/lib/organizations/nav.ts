export interface OrgNavItem {
  label: string
  path: string
  icon: string
  adminOnly?: boolean
  /**
   * Workspace tab this item selects. Several nav entries share one route and
   * differ only by `?tab=`, so the href is path + tab and "is this active"
   * has to compare both.
   */
  tab?: string
  children?: OrgNavItem[]
}

/**
 * KOL Detail — the sections of the selected creator. Injected under Discovery
 * at render time rather than declared here, because they only exist once a
 * creator is selected; a static list would show eight dead links on first visit.
 */
export const KOL_CREATOR_SECTIONS: OrgNavItem[] = [
  { label: 'Profile',           path: 'discover/kol', tab: 'profile',          icon: 'person' },
  { label: 'Performance',       path: 'discover/kol', tab: 'analytics',        icon: 'insights' },
  { label: 'Content Analytics', path: 'discover/kol', tab: 'content',          icon: 'summarize' },
  { label: 'Audience Insights', path: 'discover/kol', tab: 'audience',         icon: 'group' },
  { label: 'Campaign History',  path: 'discover/kol', tab: 'campaignHistory',  icon: 'campaign' },
  { label: 'Brand Fit',         path: 'discover/kol', tab: 'brandfit',         icon: 'handshake' },
  { label: 'AI Insights',       path: 'discover/kol', tab: 'ai',               icon: 'auto_awesome' },
  { label: 'Individual Report', path: 'discover/kol', tab: 'kolreport',        icon: 'lab_profile' },
  { label: 'Rate Card',         path: 'discover/kol', tab: 'ratecard',         icon: 'payments' },
]

/**
 * KOL Intelligence — the end-to-end selection and ordering module.
 *
 * Lives inside the Discover group, as a sibling of Discovery Content rather than
 * a child of it — the same shape the source platform uses, where the "Discover"
 * nav group holds KOL Intelligence and Discovery Content side by side.
 *
 * What matters structurally is one level down: its stages are siblings of
 * Discovery, not children of it. An earlier shape nested Compare, Ordering and
 * everything downstream *inside* Directory, which read as though the whole
 * commercial flow were a detail view of a list. It isn't — Discovery is the
 * first stage of the journey, not its container.
 *
 * The stages mirror the flow exactly — find, analyse, compare, select, order,
 * run, measure — so the sidebar doubles as a map of where you are in it.
 */
export const KOL_INTELLIGENCE: OrgNavItem = {
  label: 'KOL Intelligence', path: 'discover/kol', icon: 'badge',
  children: [
    // Directory · Compare · Reports · Settings — the source platform's own
    // submenu for this module, in its order. KOL_CREATOR_SECTIONS are spliced
    // under Directory by OrgNav once a creator is active; that is the KOL Detail
    // node, and it belongs to Directory because that is where you found them.
    { label: 'Directory', path: 'discover/kol', tab: 'directory', icon: 'grid_view' },
    // Two rosters, two entries. Directory browses the commercial KOL platform's
    // creators; this one lists the accounts the org already tracks in the
    // warehouse, which is where the per-creator analysis views come from.
    { label: 'Akun Saya', path: 'discover/kol', tab: 'accounts', icon: 'inventory_2' },
    { label: 'Compare',   path: 'discover/kol', tab: 'compare',   icon: 'compare' },
    // Cart, Ordering Flow and Purchase History are deliberately NOT nav entries.
    // They are steps you fall into from a creator — add to cart, check out, look
    // up what you bought — not places you navigate to cold. Listing them in the
    // sidebar advertised an empty cart as a destination; they are reached from
    // the cart bar inside the workspace instead.
    // Discover Reports sits in the module's Reports slot. It summarises brand and
    // competitor content performance; per-campaign reporting is the Campaign
    // Dashboard, reached from Campaign Management.
    { label: 'Discover Reports', path: 'discover/reports',  icon: 'summarize' },
    { label: 'Settings',         path: 'discover/settings', icon: 'tune' },
  ],
}

export const ORG_NAV_ITEMS: OrgNavItem[] = [
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
  // Discover — content research, the KOL module, and the analytics beside them,
  // all at one level. Discovery Content feeds KOL Intelligence (campaign briefs
  // attach posts saved there) but browsing content is not a step inside the
  // ordering flow, so the two are siblings.
  {
    label: 'Discover', path: 'discover/kol', icon: 'travel_explore',
    children: [
      KOL_INTELLIGENCE,
      // Below KOL Intelligence and at the same level. Content research feeds a
      // brief — the campaign brief attaches posts saved here — but browsing what
      // is being posted is not a step inside the ordering flow, so it is a
      // sibling rather than a child.
      { label: 'Discovery Content', path: 'discover/content', icon: 'grid_view' },
      // Sibling of KOL Intelligence, not a child of it: selecting creators and
      // running the campaigns you already bought are two different jobs, done on
      // different days, usually by different people. It has its own route rather
      // than a ?tab= inside the KOL workspace so the sidebar highlight and the
      // URL agree about which of the two you are in.
      { label: 'Campaign Management', path: 'discover/campaign-management', icon: 'campaign' },
      { label: 'Audience',          path: 'discover/audience',  icon: 'group' },
      // Last of the Discover pages, as in the source platform's nav.
      { label: 'AI Assistant',      path: 'discover/assistant', icon: 'auto_awesome' },
      // Workspace — the source platform's third nav group, which held exactly
      // Reports and Settings, and these are ports of those two pages.
      //
      // They are not the same thing as the org-level /reports and /settings.
      // Org Reports builds slide decks from dashboard data; this one reports on
      // the KOL side — creators, campaigns bought through Ordering Flow, and
      // purchase history. Org Settings owns members and brands; this one is the
      // workspace's configuration read-out, and links to the pages that write it.
      {
        label: 'Workspace', path: 'discover/workspace/reports', icon: 'workspaces',
        children: [
          { label: 'Reports',  path: 'discover/workspace/reports',  icon: 'summarize' },
          { label: 'Settings', path: 'discover/workspace/settings', icon: 'settings' },
        ],
      },
    ],
  },
  { label: 'Brands',     path: 'brands',     icon: 'store' },
  { label: 'Reports',    path: 'reports',    icon: 'bar_chart' },
  { label: 'Members',    path: 'members',    icon: 'group' },
  { label: 'Settings',   path: 'settings',   icon: 'settings' },
  { label: 'Monitoring', path: 'monitoring', icon: 'monitor_heart', adminOnly: true },
]
