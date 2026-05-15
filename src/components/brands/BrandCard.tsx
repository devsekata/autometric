'use client'

import { useState, useRef, useEffect } from 'react'
import { Brand, SocialAccount, Competitor, PLATFORM_CONFIG } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function BrandAvatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div
      style={{ width: size, height: size, background: color, borderRadius: Math.round(size * 0.26), fontSize: Math.round(size * 0.38) }}
      className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none"
    >
      {initials}
    </div>
  )
}

function PlatformIcon({ platform, size = 22 }: { platform: Brand['accounts'][0]['platform']; size?: number }) {
  const cfg = PLATFORM_CONFIG[platform]
  return (
    <div
      style={{
        width: size, height: size,
        borderRadius: Math.round(size * 0.28),
        background: cfg.bg,
        fontSize: Math.round(size * 0.42),
        color: cfg.textColor,
        fontWeight: 900,
        flexShrink: 0,
      }}
      className="flex items-center justify-center leading-none select-none"
    >
      {cfg.short}
    </div>
  )
}

function CompetitorAvatar({ name, color, size = 24 }: { name: string; color: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div
      title={name}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.38) }}
      className="rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none border-2 border-white"
    >
      {initials}
    </div>
  )
}

interface Props {
  brand: Brand
  onConnectAccount: (brandId: string) => void
  onDisconnectAccount: (brandId: string, accountId: string) => void
  onAddCompetitor: (brandId: string) => void
  onRemoveCompetitor: (brandId: string, competitorId: string) => void
  onDelete: (brandId: string) => void
}

export default function BrandCard({
  brand,
  onConnectAccount,
  onDisconnectAccount,
  onAddCompetitor,
  onRemoveCompetitor,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl p-5 flex flex-col gap-0 hover:border-[#c5dce5] hover:shadow-md hover:shadow-[#3d7e96]/8 transition-all">

      {/* ── Brand header ── */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <BrandAvatar name={brand.name} color={brand.color} size={40} />
          <div className="min-w-0">
            <h3 style={PJB} className="text-[15px] font-bold text-[#111827] truncate leading-tight">
              {brand.name}
            </h3>
            <p className="text-[11px] text-[#b0b8c4] mt-0.5">{formatDate(brand.created_at)}</p>
          </div>
        </div>

        {/* Kebab menu */}
        <div ref={menuRef} className="relative flex-shrink-0 ml-2">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#f3f4f6] transition-colors"
          >
            <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">more_horiz</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 w-44 bg-white border border-[#e5e7eb] rounded-lg shadow-lg shadow-black/5 z-20 py-1">
              <button
                onClick={() => { setMenuOpen(false); onDelete(brand.id) }}
                className="w-full flex items-center gap-2.5 px-3.5 h-9 text-[13px] text-[#ef4444] hover:bg-[#fef2f2] transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">delete</span>
                Delete brand
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Connected accounts ── */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span style={PJB} className="text-[10.5px] font-bold uppercase tracking-widest text-[#b0b8c4]">
            Accounts {brand.accounts.length > 0 && `(${brand.accounts.length})`}
          </span>
          {brand.accounts.length > 0 && (
            <button
              onClick={() => onConnectAccount(brand.id)}
              className="flex items-center gap-1 text-[11.5px] font-semibold text-[#3d7e96] hover:text-[#2d6e85] transition-colors"
              style={PJB}
            >
              <span className="material-symbols-outlined text-[13px]">add</span>
              Connect
            </button>
          )}
        </div>

        {brand.accounts.length === 0 ? (
          <button
            onClick={() => onConnectAccount(brand.id)}
            className="w-full flex items-center justify-center gap-2 h-[52px] border-2 border-dashed border-[#e5e7eb] rounded-lg text-[12.5px] font-semibold text-[#9ca3af] hover:border-[#3d7e96] hover:text-[#3d7e96] transition-colors"
            style={PJB}
          >
            <span className="material-symbols-outlined text-[16px]">add_link</span>
            Connect an account
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            {brand.accounts.map(acc => (
              <div key={acc.id} className="flex items-center gap-2.5 group/row">
                <PlatformIcon platform={acc.platform} size={22} />
                <span className="flex-1 text-[12.5px] text-[#374151] truncate min-w-0">{acc.handle}</span>
                <span style={PJB} className="text-[11.5px] font-bold text-[#9ca3af] tabular-nums flex-shrink-0">
                  {fmt(acc.followers)}
                </span>
                <button
                  onClick={() => onDisconnectAccount(brand.id, acc.id)}
                  className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover/row:opacity-100 hover:bg-[#fee2e2] transition-all flex-shrink-0"
                  title="Disconnect"
                >
                  <span className="material-symbols-outlined text-[13px] text-[#ef4444]">close</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="border-t-2 border-[#e5e7eb] mb-3.5" />

      {/* ── Competitors ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {brand.competitors.length === 0 ? (
            <span className="text-[12px] text-[#c4c9d0]">No competitors set</span>
          ) : (
            <>
              <div className="flex -space-x-1.5">
                {brand.competitors.slice(0, 4).map(c => (
                  <CompetitorAvatar key={c.id} name={c.name} color={c.color} size={24} />
                ))}
                {brand.competitors.length > 4 && (
                  <div
                    style={{ fontSize: 9 }}
                    className="w-6 h-6 rounded-full bg-[#f3f4f6] border-2 border-white flex items-center justify-center font-bold text-[#6b7280] z-0"
                  >
                    +{brand.competitors.length - 4}
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#9ca3af]">
                {brand.competitors.length} competitor{brand.competitors.length !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        <button
          onClick={() => onAddCompetitor(brand.id)}
          className="flex items-center gap-1 text-[11.5px] font-semibold text-[#6b7280] hover:text-[#3d7e96] transition-colors flex-shrink-0"
          style={PJB}
        >
          <span className="material-symbols-outlined text-[13px]">add</span>
          Add
        </button>
      </div>

    </div>
  )
}
