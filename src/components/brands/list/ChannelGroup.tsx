'use client'

import { useState } from 'react'
import { Brand, Platform, PLATFORM_CONFIG } from '@/lib/brands/types'
import BrandInChannelRow from './BrandInChannelRow'

type StatusFilter = 'all' | 'connected' | 'disconnected'

const COL_HEADERS = ['BRAND', 'USERNAME', 'COMPETITORS', 'STATUS', 'CONNECTED AT', 'CREATED AT']
const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const PLATFORM_LOGO: Partial<Record<Platform, string>> = {
  instagram: '/instagram.png',
  facebook:  '/facebook.png',
  tiktok:    '/tiktok.png',
}

interface Props {
  platform: Platform
  brands: Brand[]
  orgSlug: string
  statusFilter: StatusFilter
  defaultOpen?: boolean
}

export default function ChannelGroup({ platform, brands, orgSlug, statusFilter, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const cfg  = PLATFORM_CONFIG[platform]
  const logo = PLATFORM_LOGO[platform]

  const filteredBrands = brands.filter(b => {
    const acc = b.accounts.find(a => a.platform === platform)
    if (!acc) return false
    if (statusFilter === 'connected')    return acc.connected
    if (statusFilter === 'disconnected') return !acc.connected
    return true
  })

  return (
    <div className="border-b border-[#e5e7eb] last:border-0">

      {/* Channel header */}
      <div
        className="flex items-center gap-2.5 px-6 py-2.5 cursor-pointer select-none bg-[#f9fafb]"
        onClick={() => setOpen(o => !o)}
      >
        <span
          className="material-symbols-outlined text-[17px] text-[#9ca3af] transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>

        {logo
          ? <img src={logo} alt={cfg.label} style={{ width: 20, height: 20, objectFit: 'contain' }} className="rounded-md flex-shrink-0" />
          : <div style={{ background: cfg.bg, width: 20, height: 20, borderRadius: 5, fontSize: 7.5, fontWeight: 900, color: cfg.textColor }}
              className="flex items-center justify-center select-none flex-shrink-0 leading-none">{cfg.short}</div>
        }

        <span style={PJB} className="text-[13.5px] font-bold text-[#111827]">{cfg.label}</span>
        <span style={PJB} className="text-[12.5px] font-semibold text-[#9ca3af]">{filteredBrands.length}</span>
      </div>

      {open && (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-[1.6fr_1.4fr_1.2fr_1fr_1.3fr_1.3fr] px-6 py-2 bg-white border-b border-[#e5e7eb]">
            {COL_HEADERS.map(h => (
              <span key={h} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
            ))}
          </div>

          {filteredBrands.length === 0 ? (
            <div className="px-6 py-4 text-[13px] text-[#9ca3af] border-b border-[#f3f4f6]" style={PJB}>No brands match this filter</div>
          ) : (
            filteredBrands.map(brand => (
              <BrandInChannelRow key={brand.id} brand={brand} platform={platform} orgSlug={orgSlug} />
            ))
          )}

          <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-[#f3f4f6]">
            <span className="material-symbols-outlined text-[14px] text-[#d1d5db]">add</span>
            <span style={PJB} className="text-[12px] text-[#d1d5db]">Add brand</span>
          </div>
        </div>
      )}

    </div>
  )
}
