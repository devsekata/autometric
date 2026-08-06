'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useBrandDetail } from './BrandDetailContext'
import BrandAvatar from '../BrandAvatar'
import BrandDetailRightPanel from './BrandDetailRightPanel'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const TABS = [
  { label: 'Overview',     path: 'overview',     icon: 'bar_chart'   },
  { label: 'Accounts',     path: 'accounts',     icon: 'add_link'    },
  { label: 'Data Sources', path: 'data-sources', icon: 'upload_file' },
  { label: 'Competitors',  path: 'competitors',  icon: 'flag'        },
  { label: 'Settings',     path: 'settings',     icon: 'settings'    },
]

interface Props {
  orgSlug: string
  children: React.ReactNode
}

export default function BrandDetailShell({ orgSlug, children }: Props) {
  const { brand } = useBrandDetail()
  const pathname  = usePathname()

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="bg-white px-8 pt-7 pb-0 border-b border-[#e5e7eb] flex-shrink-0">

        <Link href={`/organizations/${orgSlug}/brands`} style={PJB}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#6b7280] hover:text-[#285D6E] transition-colors mb-4">
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          All Brands
        </Link>

        <div className="flex items-center gap-4 mb-5">
          <BrandAvatar brand={brand} size={44} />
          <div>
            <h1 style={PJB} className="text-[22px] font-bold text-[#111827] tracking-[-0.03em] leading-none">
              {brand.name}
            </h1>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[12px] text-[#6b7280]">
                <span style={PJB} className="font-semibold text-[#374151]">{brand.accounts.length}</span> accounts
              </span>
              <span className="text-[#d1d5db]">·</span>
              <span className="text-[12px] text-[#6b7280]">
                <span style={PJB} className="font-semibold text-[#374151]">{brand.competitors.length}</span> competitors
              </span>
            </div>
          </div>
        </div>

        <nav className="flex items-end gap-0 -mb-px">
          {TABS.map(tab => {
            const href   = `/organizations/${orgSlug}/brands/${brand.id}/${tab.path}`
            const active = pathname.endsWith(`/${tab.path}`)
            return (
              <Link key={tab.path} href={href} style={PJB}
                className={`flex items-center gap-1.5 px-4 pb-3 pt-1 text-[13px] font-semibold border-b-2 transition-colors ${
                  active
                    ? 'border-b-[#285D6E] text-[#285D6E]'
                    : 'border-b-transparent text-[#6b7280] hover:text-[#374151] hover:border-b-[#e5e7eb]'
                }`}>
                <span className={`material-symbols-outlined text-[15px] ${active ? 'text-[#285D6E]' : 'text-[#9ca3af]'}`}>
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex flex-1">
        <div className="flex-1 min-w-0 px-8 pt-6">{children}</div>
        <div className="w-[260px] flex-shrink-0 border-l border-[#e5e7eb] px-5 pt-6">
          <BrandDetailRightPanel />
        </div>
      </div>
    </div>
  )
}
