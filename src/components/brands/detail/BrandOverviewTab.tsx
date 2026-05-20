'use client'

import { useBrandDetail } from './BrandDetailContext'
import { PLATFORM_CONFIG, getColorFromId } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrandOverviewTab() {
  const { brand } = useBrandDetail()

  return (
    <div className="flex flex-col max-w-3xl">

      {/* Stats row */}
      <div className="grid grid-cols-2 border-b border-[#e5e7eb]">
        {[
          { label: 'Connected Accounts', value: brand.accounts.length,   icon: 'add_link' },
          { label: 'Competitors',        value: brand.competitors.length, icon: 'flag'     },
        ].map((s, i) => (
          <div key={s.label} className={`px-6 py-5 ${i < 1 ? 'border-r border-[#e5e7eb]' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">{s.icon}</span>
              <span style={PJB} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{s.label}</span>
            </div>
            <p style={PJB} className="text-[28px] font-bold text-[#111827] leading-none mt-2">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Connected Accounts */}
      <div className="border-b border-[#e5e7eb]">
        <div className="px-6 py-4 border-b border-[#e5e7eb]">
          <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">Connected Accounts</span>
        </div>
        {brand.accounts.length === 0 ? (
          <div className="px-6 py-10 flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-[32px] text-[#d1d5db]">add_link</span>
            <p className="text-[13px] text-[#9ca3af]">No accounts connected yet</p>
          </div>
        ) : (
          brand.accounts.map(acc => (
            <div key={acc.id} className="flex items-center gap-3 px-6 py-3 hover:bg-[#fafafa] transition-colors">
              <PlatformIcon platform={acc.platform} size={26} />
              <span className="flex-1 text-[13px] text-[#374151] font-medium">{acc.username}</span>
              {acc.connected_at && (
                <span className="text-[11.5px] text-[#9ca3af]">Connected {formatDate(acc.connected_at)}</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Competitors */}
      <div className="border-b border-[#e5e7eb]">
        <div className="px-6 py-4 border-b border-[#e5e7eb]">
          <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">Competitors</span>
        </div>
        {brand.competitors.length === 0 ? (
          <div className="px-6 py-10 flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-[32px] text-[#d1d5db]">flag</span>
            <p className="text-[13px] text-[#9ca3af]">No competitors tracked yet</p>
          </div>
        ) : (
          brand.competitors.map(comp => (
            <div key={comp.social_account_id} className="flex items-center gap-3 px-6 py-3 hover:bg-[#fafafa] transition-colors">
              <PlatformIcon platform={comp.platform} size={26} />
              <span className="flex-1 text-[13px] text-[#374151] font-medium">{comp.username}</span>
              <span style={PJB} className="text-[11px] text-[#9ca3af] uppercase tracking-wide">
                {PLATFORM_CONFIG[comp.platform].short}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Brand Info */}
      <div>
        <div className="px-6 py-4 border-b border-[#e5e7eb]">
          <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">Brand Info</span>
        </div>
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <span style={PJB} className="text-[12px] font-medium text-[#9ca3af] w-24 flex-shrink-0">Created</span>
            <span className="text-[13px] text-[#374151]">{formatDate(brand.created_at)}</span>
          </div>
        </div>
      </div>

    </div>
  )
}
