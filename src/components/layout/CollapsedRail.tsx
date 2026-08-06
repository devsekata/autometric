'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ORG_NAV_ITEMS } from '@/lib/organizations/nav'
import { logout } from '@/lib/auth/actions'
import { useSidebar } from './SidebarContext'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/**
 * Slim icon-only rail shown when the main sidebar is collapsed. Dark navy bar
 * with the nav-item icons (active item highlighted), an expand toggle on top
 * and sign-out at the bottom.
 */
export default function CollapsedRail({
  fallbackOrgSlug,
  hasOrgs,
}: {
  fallbackOrgSlug: string
  hasOrgs: boolean
}) {
  const { toggle } = useSidebar()
  const pathname = usePathname()
  const params = useParams()
  const { data: session } = useSession()

  const orgSlug = (params?.orgSlug as string | undefined) ?? fallbackOrgSlug
  const base = `/organizations/${orgSlug}`
  const isAppAdmin = session?.user?.role === 'ADMIN'
  const visibleItems = ORG_NAV_ITEMS.filter(item => !item.adminOnly || isAppAdmin)

  return (
    <aside className="h-screen w-[64px] flex flex-col items-center bg-white border-r-2 border-[#e2e8f0] py-3">
      {/* Expand */}
      <button
        onClick={toggle}
        title="Buka sidebar"
        style={PJ}
        className="w-10 h-10 rounded-xl flex items-center justify-center text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#374151] transition-colors"
      >
        <span className="material-symbols-outlined text-[22px]">menu</span>
      </button>

      <div className="w-7 h-px bg-[#e5e7eb] my-2" />

      {/* Nav icons */}
      <nav className="flex-1 flex flex-col items-center gap-1.5 mt-1 w-full px-2">
        {hasOrgs ? (
          visibleItems.map(item => {
            const href = `${base}/${item.path}`
            const active = pathname.startsWith(href)
            return (
              <Link
                key={item.path}
                href={href}
                title={item.label}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  active
                    ? 'bg-[#f0f7fa] text-[#285D6E]'
                    : 'text-[#9ca3af] hover:bg-[#f9fafb] hover:text-[#374151]'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              </Link>
            )
          })
        ) : (
          <Link
            href="/organizations"
            title="Organizations"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[#9ca3af] hover:bg-[#f9fafb] hover:text-[#374151] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">corporate_fare</span>
          </Link>
        )}
      </nav>

      {/* Sign out */}
      <form action={logout} className="mt-2 pt-2 border-t border-[#f0f0ee] w-full flex justify-center">
        <button
          type="submit"
          title="Sign out"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[#9ca3af] hover:bg-[#fef2f2] hover:text-[#dc2626] transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
        </button>
      </form>
    </aside>
  )
}
