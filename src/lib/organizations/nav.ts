export interface OrgNavItem {
  label: string
  path: string
  icon: string
  adminOnly?: boolean
  children?: OrgNavItem[]
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
  { label: 'Brands',     path: 'brands',     icon: 'store' },
  { label: 'Reports',    path: 'reports',    icon: 'bar_chart' },
  { label: 'Members',    path: 'members',    icon: 'group' },
  { label: 'Settings',   path: 'settings',   icon: 'settings' },
  { label: 'Monitoring', path: 'monitoring', icon: 'monitor_heart', adminOnly: true },
]
