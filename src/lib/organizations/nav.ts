export interface OrgNavItem {
  label: string
  path: string
  icon: string
  adminOnly?: boolean
}

export const ORG_NAV_ITEMS: OrgNavItem[] = [
  { label: 'Dashboard',  path: 'dashboard',  icon: 'dashboard' },
  { label: 'Brands',     path: 'brands',     icon: 'store' },
  { label: 'Reports',    path: 'reports',    icon: 'bar_chart' },
  { label: 'Members',    path: 'members',    icon: 'group' },
  { label: 'Settings',   path: 'settings',   icon: 'settings' },
  { label: 'Monitoring', path: 'monitoring', icon: 'monitor_heart', adminOnly: true },
]
