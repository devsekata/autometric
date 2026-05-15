'use client'

import { useState, useRef, useEffect } from 'react'
import { Brand, BRAND_COLORS } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  orgId: string
  onClose: () => void
  onCreated: (brand: Brand) => void
}

export default function CreateBrandModal({ orgId, onClose, onCreated }: Props) {
  const [name, setName]   = useState('')
  const [color, setColor] = useState(BRAND_COLORS[0])
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Brand name is required.'); return }

    const newBrand: Brand = {
      id: crypto.randomUUID(),
      org_id: orgId,
      name: trimmed,
      color,
      created_at: new Date().toISOString(),
      accounts: [],
      competitors: [],
    }
    onCreated(newBrand)
    onClose()
  }

  const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[440px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        {/* Header */}
        <div className="px-6 pt-5 pb-4">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">New Brand</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">Add a brand to track and monitor.</p>
        </div>
        <div className="border-t border-[#f3f4f6]" />

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Brand name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g. Nike Indonesia"
              maxLength={80}
              className={`h-9 px-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                error
                  ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                  : 'border-[#e5e7eb] focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10'
              }`}
            />
            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>

          {/* Color */}
          <div className="flex flex-col gap-2">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Brand color
            </label>
            <div className="flex items-center gap-3">
              {/* Preview */}
              <div
                style={{ background: color, width: 36, height: 36, borderRadius: 10, fontSize: 13 }}
                className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none"
              >
                {initials}
              </div>
              {/* Swatches */}
              <div className="flex items-center gap-2 flex-wrap">
                {BRAND_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ background: c, width: 24, height: 24, borderRadius: 6 }}
                    className={`transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-[#3d7e96]' : ''}`}
                  />
                ))}
              </div>
            </div>
          </div>

        </form>

        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={PJB}
            className="h-8 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            Create Brand
          </button>
        </div>
      </div>
    </div>
  )
}
