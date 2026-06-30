'use client'

import { KPI_METRICS } from '@/lib/reports/data/kpiMetrics'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function MetricPickerModal({
  open, current, onClose, onSelect,
}: {
  open: boolean
  current: string | null
  onClose: () => void
  onSelect: (key: string) => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[520px] bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.30)] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f1f2]">
          <div>
            <h2 style={PJ} className="text-[16px] font-bold text-[#0f172a]">Select metric</h2>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">Pick a top-line metric for this scorecard.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto">
          {KPI_METRICS.map(m => {
            const active = current === m.key
            return (
              <button
                key={m.key}
                onClick={() => onSelect(m.key)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${active ? 'border-[#1e4f49] bg-[#f2f8f5] ring-1 ring-[#1e4f49]' : 'border-[#e5e7eb] hover:border-[#cbd5e1] hover:bg-[#f9fafb]'}`}
              >
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-[#1e4f49] text-white' : 'bg-[#eef0f2] text-[#9ca3af]'}`}>
                  <span className="material-symbols-outlined text-[19px]">{m.icon}</span>
                </span>
                <div className="min-w-0">
                  <p style={PJ} className="text-[13px] font-bold text-[#0f172a] truncate">{m.label}</p>
                  <p className="text-[11.5px] text-[#94a3b8]">{m.value} · {m.delta >= 0 ? '+' : ''}{m.delta}%</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
