'use client'

import { useState } from 'react'
import { Competitor, BRAND_COLORS, Platform, PLATFORM_CONFIG, PLATFORM_LIST } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  brandName: string
  onClose: () => void
  onAdded: (competitor: Competitor) => void
}

export default function CompetitorModal({ brandName, onClose, onAdded }: Props) {
  const [name, setName]     = useState('')
  const [color, setColor]   = useState(BRAND_COLORS[4])
  const [handles, setHandles] = useState<Partial<Record<Platform, string>>>({})
  const [error, setError]   = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Competitor name is required.'); return }

    const accounts = PLATFORM_LIST
      .filter(p => handles[p]?.trim())
      .map(p => ({ platform: p, handle: handles[p]!.trim().startsWith('@') ? handles[p]!.trim() : `@${handles[p]!.trim()}` }))

    onAdded({ id: crypto.randomUUID(), name: trimmed, color, accounts })
    onClose()
  }

  const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb] max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 sticky top-0 bg-white border-b border-[#f3f4f6] z-10">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Add Competitor</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Track a competitor for <span className="font-medium text-[#374151]">{brandName}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">

          {/* Name + Color */}
          <div className="flex flex-col gap-1.5">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Competitor name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g. Adidas Indonesia"
              maxLength={80}
              className={`h-9 px-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                error ? 'border-red-400 focus:ring-2 focus:ring-red-100' : 'border-[#e5e7eb] focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10'
              }`}
            />
            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>

          {/* Color */}
          <div className="flex flex-col gap-2">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">Color</label>
            <div className="flex items-center gap-3">
              <div
                style={{ background: color, width: 32, height: 32, fontSize: 11 }}
                className="rounded-full flex items-center justify-center font-bold text-white leading-none flex-shrink-0"
              >
                {initials}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {BRAND_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ background: c, width: 22, height: 22, borderRadius: 6 }}
                    className={`transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-[#3d7e96]' : ''}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Platform handles (optional) */}
          <div className="flex flex-col gap-2">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Their accounts <span className="normal-case font-normal text-[#9ca3af]">(optional)</span>
            </label>
            <div className="flex flex-col gap-2">
              {PLATFORM_LIST.map(p => {
                const cfg = PLATFORM_CONFIG[p]
                return (
                  <div key={p} className="flex items-center gap-2.5">
                    <div
                      style={{ width: 26, height: 26, borderRadius: 7, background: cfg.bg, fontSize: 9, fontWeight: 900, color: cfg.textColor, flexShrink: 0 }}
                      className="flex items-center justify-center leading-none"
                    >
                      {cfg.short}
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[#9ca3af]">@</span>
                      <input
                        type="text"
                        value={(handles[p] || '').replace(/^@/, '')}
                        onChange={e => setHandles(prev => ({ ...prev, [p]: e.target.value }))}
                        placeholder={cfg.label.replace(' (Twitter)', '')}
                        maxLength={60}
                        className="w-full h-8 pl-6 pr-3 text-[12.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10 transition-all"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </form>

        <div className="border-t border-[#f3f4f6] sticky bottom-0 bg-white" />
        <div className="px-6 py-4 flex items-center justify-end gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={PJB}
            className="h-8 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            Add Competitor
          </button>
        </div>
      </div>
    </div>
  )
}
