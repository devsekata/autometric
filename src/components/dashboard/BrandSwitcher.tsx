'use client'

import { useEffect, useRef, useState } from 'react'
import { BRANDS, fmtNum, PLATFORM_META, type DashBrand } from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function BrandSwitcher({ value, onChange, children }: {
  value: DashBrand
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
          {BRANDS.map(b => {
            const active = b.id === value.id
            return (
              <button key={b.id}
                onClick={() => { onChange(b); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[#f0f7f5]' : 'hover:bg-[#fafbfb]'
                }`}>
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                  style={{ background: b.color }}>{b.initials}</span>
                <div className="flex-1 min-w-0">
                  <span style={PJ} className={`block text-[13px] font-bold truncate ${active ? 'text-[#1e4f49]' : 'text-[#111827]'}`}>{b.name}</span>
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
                {active && <span className="material-symbols-outlined text-[18px] text-[#3d7e96] flex-shrink-0">check</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
