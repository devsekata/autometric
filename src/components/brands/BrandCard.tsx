'use client'

import { useState, useRef, useEffect } from 'react'
import { Brand } from '@/lib/brands/types'
import PlatformIcon from './PlatformIcon'
import BrandAvatar from './BrandAvatar'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

interface Props {
  brand: Brand
  onDelete: (brandId: string) => void
}

export default function BrandCard({ brand, onDelete }: Props) {
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
    <div className="bg-white border border-[#e5e7eb] rounded-xl p-5 flex flex-col gap-0 hover:border-[#c5dce5] hover:shadow-md hover:shadow-[#285D6E]/8 transition-all">

      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <BrandAvatar brand={brand} size={40} />
          <div className="min-w-0">
            <h3 style={PJB} className="text-[15px] font-bold text-[#111827] truncate leading-tight">{brand.name}</h3>
            <p className="text-[11px] text-[#b0b8c4] mt-0.5">{formatDate(brand.created_at)}</p>
          </div>
        </div>

        <div ref={menuRef} className="relative flex-shrink-0 ml-2">
          <button onClick={() => setMenuOpen(v => !v)}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#f3f4f6] transition-colors">
            <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">more_horiz</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 w-44 bg-white border border-[#e5e7eb] rounded-lg shadow-lg shadow-black/5 z-20 py-1">
              <button onClick={() => { setMenuOpen(false); onDelete(brand.id) }}
                className="w-full flex items-center gap-2.5 px-3.5 h-9 text-[13px] text-[#ef4444] hover:bg-[#fef2f2] transition-colors">
                <span className="material-symbols-outlined text-[15px]">delete</span>
                Delete brand
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Accounts */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span style={PJB} className="text-[10.5px] font-bold uppercase tracking-widest text-[#b0b8c4]">
            Accounts {brand.accounts.length > 0 && `(${brand.accounts.length})`}
          </span>
        </div>

        {brand.accounts.length === 0 ? (
          <div className="w-full flex items-center justify-center gap-2 h-[52px] border-2 border-dashed border-[#e5e7eb] rounded-lg text-[12.5px] font-semibold text-[#9ca3af]" style={PJB}>
            No accounts connected
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {brand.accounts.map(acc => (
              <div key={acc.id} className="flex items-center gap-2.5">
                <PlatformIcon platform={acc.platform} size={22} />
                <span className="flex-1 text-[12.5px] text-[#374151] truncate min-w-0">{acc.username}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t-2 border-[#e5e7eb] mb-3.5" />

      {/* Competitors */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {brand.competitors.length === 0 ? (
            <span className="text-[12px] text-[#c4c9d0]">No competitors set</span>
          ) : (
            <span className="text-[12px] text-[#9ca3af]">
              {brand.competitors.length} competitor{brand.competitors.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

    </div>
  )
}
