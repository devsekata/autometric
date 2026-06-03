'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ORG_NAV_ITEMS } from '@/lib/organizations/nav'

export default function OrgNav({ fallbackOrgSlug }: { fallbackOrgSlug: string }) {
  const pathname = usePathname()
  const params = useParams()
  const orgSlug = (params?.orgSlug as string | undefined) ?? fallbackOrgSlug
  const { data: session } = useSession()

  const isAppAdmin = session?.user?.role === 'ADMIN'
  const visibleItems = ORG_NAV_ITEMS.filter(item => !item.adminOnly || isAppAdmin)

  return (
    <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
      {visibleItems.map(item => {
        const href = `/organizations/${orgSlug}/${item.path}`
        const active = pathname.startsWith(href)
        return (
          <Link
            key={item.path}
            href={href}
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            className={`flex items-center gap-2.5 h-9 rounded-md text-[13px] font-semibold transition-colors border-l-[3px] pl-[9px] pr-3 ${
              active
                ? 'border-l-[#3d7e96] bg-[#f0f7fa] text-[#111827]'
                : 'border-l-transparent text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#374151]'
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] flex-shrink-0 ${
              active ? 'text-[#3d7e96]' : 'text-[#9ca3af]'
            }`}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
