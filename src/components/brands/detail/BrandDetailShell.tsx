'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useBrandDetail } from './BrandDetailContext'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const TABS = [
  { label: 'Overview',    path: 'overview',    icon: 'bar_chart' },
  { label: 'Accounts',    path: 'accounts',    icon: 'add_link' },
  { label: 'Competitors', path: 'competitors', icon: 'flag' },
]

interface Props {
  orgSlug: string
  children: React.ReactNode
}

export default function BrandDetailShell({ orgSlug, children }: Props) {
  const { brand } = useBrandDetail()
  const pathname = usePathname()

  const initials = brand.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div>
      {/* ── Header ── */}
      <div className="bg-white px-8 pt-7 pb-0 border-b border-[#e5e7eb]">

        {/* Back breadcrumb */}
        <Link
          href={`/organizations/${orgSlug}/brands`}
          style={PJB}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#6b7280] hover:text-[#3d7e96] transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          All Brands
        </Link>

        {/* Brand identity */}
        <div className="flex items-center gap-4 mb-5">
          <div
            style={{ width: 44, height: 44, background: brand.color, borderRadius: 12, fontSize: 15 }}
            className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none"
          >
            {initials}
          </div>
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

        {/* Tab nav */}
        <nav className="flex items-end gap-0 -mb-px">
          {TABS.map(tab => {
            const href = `/organizations/${orgSlug}/brands/${brand.id}/${tab.path}`
            const active = pathname.endsWith(`/${tab.path}`)
            return (
              <Link
                key={tab.path}
                href={href}
                style={PJB}
                className={`flex items-center gap-1.5 px-4 pb-3 pt-1 text-[13px] font-semibold border-b-2 transition-colors ${
                  active
                    ? 'border-b-[#3d7e96] text-[#3d7e96]'
                    : 'border-b-transparent text-[#6b7280] hover:text-[#374151] hover:border-b-[#e5e7eb]'
                }`}
              >
                <span className={`material-symbols-outlined text-[15px] ${active ? 'text-[#3d7e96]' : 'text-[#9ca3af]'}`}>
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* ── Tab content ── */}
      <div className="px-8 py-7">
        {children}
      </div>
    </div>
  )
}
