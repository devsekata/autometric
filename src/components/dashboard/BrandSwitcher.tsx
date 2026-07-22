'use client'

import { useEffect, useRef, useState } from 'react'
import { fmtNum, PLATFORM_META, type DashBrand } from './data'
import BrandAvatar from './BrandAvatar'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function BrandSwitcher({ value, brands, onChange, children }: {
  value: DashBrand
  brands: DashBrand[]
  onChange: (b: DashBrand) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="text-left rounded-xl transition-colors hover:bg-black/[0.015]">
        {children}
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] w-[300px] bg-white border border-[#e5e7eb] rounded-xl shadow-xl shadow-black/[0.07] py-1.5 z-30">
          <div className="px-3 pt-1.5 pb-2">
            <span style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af]">Switch brand</span>
          </div>
          {brands.map(b => {
            const active = b.id === value.id
            return (
              <button key={b.id}
                onClick={() => { onChange(b); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[#f0f7f5]' : 'hover:bg-[#fafbfb]'
                }`}>
                <BrandAvatar logo={b.logo} initials={b.initials} color={b.color} name={b.name}
                  className="w-8 h-8 rounded-lg" textClass="text-[11px]" />
                <div className="flex-1 min-w-0">
                  <span style={PJ} className={`block text-[13px] font-bold truncate ${active ? 'text-[#2C3079]' : 'text-[#111827]'}`}>{b.name}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-[#9ca3af]">{b.handle}</span>
                    <span className="text-[#d1d5db]">·</span>
                    <span className="text-[11px] text-[#9ca3af]">{fmtNum(b.followers)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {b.platforms.map(p => (
                    <img key={p} src={PLATFORM_META[p].logo} alt={PLATFORM_META[p].label}
                      className="w-4 h-4 object-contain" title={PLATFORM_META[p].label} />
                  ))}
                </div>
                {active && <span className="material-symbols-outlined text-[18px] text-[#1B8A80] flex-shrink-0">check</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
