'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ORG_NAV_ITEMS, type OrgNavItem } from '@/lib/organizations/nav'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function OrgNav({ fallbackOrgSlug }: { fallbackOrgSlug: string }) {
  const pathname = usePathname()
  const params = useParams()
  const orgSlug = (params?.orgSlug as string | undefined) ?? fallbackOrgSlug
  const { data: session } = useSession()

  const isAppAdmin = session?.user?.role === 'ADMIN'
  const visibleItems = ORG_NAV_ITEMS.filter(item => !item.adminOnly || isAppAdmin)

  const base = `/organizations/${orgSlug}`

  return (
    <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
      {visibleItems.map(item => {
        const href = `${base}/${item.path}`
        const sectionActive = pathname.startsWith(href)
        const hasChildren = !!item.children?.length

        return (
          <div key={item.path}>
            <Link
              href={href}
              style={PJ}
              className={`flex items-center gap-2.5 h-9 rounded-md text-[13px] font-semibold transition-colors border-l-[3px] pl-[9px] pr-3 ${
                sectionActive
                  ? hasChildren
                    ? 'border-l-transparent text-[#111827]'
                    : 'border-l-[#1B8A80] bg-[#f0f7fa] text-[#111827]'
                  : 'border-l-transparent text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#374151]'
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] flex-shrink-0 ${
                sectionActive ? 'text-[#1B8A80]' : 'text-[#9ca3af]'
              }`}>
                {item.icon}
              </span>
              {item.label}
            </Link>

            {hasChildren && sectionActive && (
              <div className="mt-0.5 mb-1 flex flex-col gap-0.5">
                {item.children!.map(child => (
                  <SubLink key={child.path} item={child} base={base} pathname={pathname} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function SubLink({ item, base, pathname }: { item: OrgNavItem; base: string; pathname: string }) {
  const href = `${base}/${item.path}`
  const active = pathname.startsWith(href)
  return (
    <Link
      href={href}
      style={PJ}
      className={`flex items-center gap-2.5 h-8 rounded-md text-[12.5px] font-semibold transition-colors border-l-[3px] ml-[18px] pl-[10px] pr-3 ${
        active
          ? 'border-l-[#1B8A80] bg-[#f0f7fa] text-[#111827]'
          : 'border-l-[#eef0f2] text-[#9ca3af] hover:bg-[#f9fafb] hover:text-[#374151] hover:border-l-[#d1d5db]'
      }`}
    >
      <span className={`material-symbols-outlined text-[16px] flex-shrink-0 ${
        active ? 'text-[#1B8A80]' : 'text-[#b6bcc4]'
      }`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  )
}
