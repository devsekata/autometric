'use client'

import { useBrandDetail } from './BrandDetailContext'
import { PLATFORM_CONFIG } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrandOverviewTab() {
  const { brand } = useBrandDetail()

  const totalFollowers = brand.accounts.reduce((s, a) => s + a.followers, 0)

  return (
    <div className="flex flex-col gap-6 max-w-3xl">

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Connected Accounts', value: brand.accounts.length,    icon: 'add_link' },
          { label: 'Total Followers',    value: fmt(totalFollowers),       icon: 'group' },
          { label: 'Competitors',        value: brand.competitors.length,  icon: 'flag' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#e5e7eb] rounded-xl px-5 py-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">{s.icon}</span>
              <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">{s.label}</span>
            </div>
            <p style={PJB} className="text-[26px] font-bold text-[#111827] leading-none mt-2">{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Accounts preview ── */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#f3f4f6]">
          <span style={PJB} className="text-[12px] font-bold text-[#374151]">Connected Accounts</span>
        </div>
        {brand.accounts.length === 0 ? (
          <div className="px-5 py-8 flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-[32px] text-[#d1d5db]">add_link</span>
            <p className="text-[13px] text-[#6b7280]">No accounts connected yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f3f4f6]">
            {brand.accounts.map(acc => {
              const cfg = PLATFORM_CONFIG[acc.platform]
              return (
                <div key={acc.id} className="flex items-center gap-3 px-5 py-3">
                  <div
                    style={{ width: 28, height: 28, borderRadius: 7, background: cfg.bg, fontSize: 9, fontWeight: 900, color: cfg.textColor, flexShrink: 0 }}
                    className="flex items-center justify-center leading-none"
                  >
                    {cfg.short}
                  </div>
                  <span className="flex-1 text-[13px] text-[#374151] font-medium">{acc.handle}</span>
                  <span style={PJB} className="text-[13px] font-bold text-[#374151] tabular-nums">{fmt(acc.followers)}</span>
                  <span className="text-[11.5px] text-[#6b7280]">Connected {formatDate(acc.connected_at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Competitors preview ── */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#f3f4f6]">
          <span style={PJB} className="text-[12px] font-bold text-[#374151]">Competitors</span>
        </div>
        {brand.competitors.length === 0 ? (
          <div className="px-5 py-8 flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-[32px] text-[#d1d5db]">flag</span>
            <p className="text-[13px] text-[#6b7280]">No competitors tracked yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f3f4f6]">
            {brand.competitors.map(comp => (
              <div key={comp.id} className="flex items-center gap-3 px-5 py-3">
                <div
                  style={{ width: 28, height: 28, background: comp.color, fontSize: 10, flexShrink: 0 }}
                  className="rounded-full flex items-center justify-center font-bold text-white leading-none"
                >
                  {comp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <span className="flex-1 text-[13px] text-[#374151] font-medium">{comp.name}</span>
                <span className="text-[12px] text-[#6b7280]">
                  {comp.accounts.length === 0 ? 'No accounts' : `${comp.accounts.length} account${comp.accounts.length !== 1 ? 's' : ''}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Brand Info ── */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl px-5 py-4">
        <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">Brand Info</span>
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <span style={PJB} className="text-[12px] font-medium text-[#6b7280] w-24 flex-shrink-0">Created</span>
            <span className="text-[13px] font-medium text-[#374151]">{formatDate(brand.created_at)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span style={PJB} className="text-[12px] font-medium text-[#6b7280] w-24 flex-shrink-0">Brand color</span>
            <div className="flex items-center gap-2">
              <div style={{ width: 16, height: 16, background: brand.color, borderRadius: 4 }} />
              <span className="text-[13px] text-[#374151] font-mono">{brand.color}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
