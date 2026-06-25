'use client'

import { useSidebar } from './SidebarContext'
import CollapsedRail from './CollapsedRail'

/**
 * Client shell for the main app sidebar. When expanded it shows the full
 * sidebar (passed in from the layout) at 280px; when collapsed it swaps to a
 * slim dark icon rail at 64px. The main content margin animates in step.
 */
export default function DashboardShell({
  sidebar,
  fallbackOrgSlug,
  hasOrgs,
  children,
}: {
  sidebar: React.ReactNode
  fallbackOrgSlug: string
  hasOrgs: boolean
  children: React.ReactNode
}) {
  const { collapsed } = useSidebar()

  return (
    <div className="flex min-h-screen bg-[#f9fafb]">
      {/* Sidebar region — full sidebar or slim rail */}
      <div
        className={`fixed inset-y-0 left-0 z-20 transition-[width] duration-200 ease-in-out overflow-hidden ${
          collapsed ? 'w-[64px]' : 'w-[280px]'
        }`}
      >
        {collapsed ? <CollapsedRail fallbackOrgSlug={fallbackOrgSlug} hasOrgs={hasOrgs} /> : sidebar}
      </div>

      <main
        className={`flex-1 min-w-0 transition-[margin] duration-200 ease-in-out ${
          collapsed ? 'ml-[64px]' : 'ml-[280px]'
        }`}
      >
        {children}
      </main>
    </div>
  )
}
