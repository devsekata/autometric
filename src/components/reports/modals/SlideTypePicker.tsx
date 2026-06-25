'use client'

import { SlideType } from '@/lib/reports/data/slideModel'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Item {
  id: SlideType | string
  name: string
  desc: string
  icon: string
  enabled: boolean
}

// Modeled on report_2's LAYOUT_TEMPLATES. Three are built; the rest are listed
// (matching the reference) but disabled until their layouts exist.
const TEMPLATES: Item[] = [
  { id: 'section', name: 'Section Heading', desc: 'Centered section divider title', icon: 'title', enabled: true },
  { id: 'dashboard', name: 'Standard Dashboard', desc: 'Chart, Key Insights & Data Table', icon: 'dashboard', enabled: true },
  { id: 'kpi', name: 'KPI Overview', desc: 'Top Metrics with Deep Dive', icon: 'leaderboard', enabled: true },
  { id: 'comparison', name: 'Comparison View', desc: 'Side-by-side Metric Analysis', icon: 'compare_arrows', enabled: true },
  { id: 'visual', name: 'Visual Analysis', desc: 'Media / Screenshot & Analysis', icon: 'image', enabled: true },
  { id: 'overview', name: 'Overview Slide', desc: 'Full Visualization & Notes', icon: 'view_quilt', enabled: true },
  { id: 'custom', name: 'Custom Template', desc: 'Configurable Grid (2×2, 3×3)', icon: 'grid_view', enabled: false },
]

export default function SlideTypePicker({
  open, onClose, onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (type: SlideType) => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-[#0f172a]/40 backdrop-blur-sm" />
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-[760px] bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.30)] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f1f2]">
          <div>
            <h2 style={PJ} className="text-[16px] font-bold text-[#0f172a]">Choose a slide layout</h2>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">Pick a template — content fills with sample data you can edit.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              disabled={!t.enabled}
              onClick={() => t.enabled && onSelect(t.id as SlideType)}
              className={`group flex items-center gap-3.5 p-4 rounded-xl border text-left transition-all ${
                t.enabled
                  ? 'border-[#e5e7eb] hover:border-[#1e4f49] hover:bg-[#f2f8f5] hover:shadow-sm cursor-pointer'
                  : 'border-[#eef0f2] bg-[#fafbfb] opacity-70 cursor-not-allowed'
              }`}
            >
              <span
                className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  t.enabled ? 'bg-[#e6f0ee] text-[#1e4f49] group-hover:bg-[#1e4f49] group-hover:text-white' : 'bg-[#f1f3f5] text-[#cbd5e1]'
                } transition-colors`}
              >
                <span className="material-symbols-outlined text-[22px]">{t.icon}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p style={PJ} className="text-[13.5px] font-bold text-[#0f172a]">{t.name}</p>
                  {!t.enabled && (
                    <span style={PJ} className="text-[9px] font-bold uppercase tracking-wide text-[#94a3b8] bg-[#eef0f2] px-1.5 py-0.5 rounded-full">Soon</span>
                  )}
                </div>
                <p className="text-[12px] text-[#94a3b8] mt-0.5 truncate">{t.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
