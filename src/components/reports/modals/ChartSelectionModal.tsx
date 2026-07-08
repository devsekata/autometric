'use client'

import { useState } from 'react'
import {
  BAR_CATEGORIES, ChartConfig, LINE_DIMENSIONS, LINE_METRICS, MAX_LINE_METRICS,
  WORDCLOUD_SENTIMENTS, type BarOrientation, type ChartCategory, type LineDimension,
} from '@/lib/reports/data/chartData'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/**
 * Multi-step chart picker — replicates report_2's ChartSelectionModal exactly:
 *   Line  → dimension → metrics (max 2, sentiments exclusive)
 *   Bar   → orientation → category → metrics
 *   Cloud → sentiment
 */
export default function ChartSelectionModal({
  open, allowWordCloud = false, onClose, onSelect,
}: {
  open: boolean
  allowWordCloud?: boolean
  onClose: () => void
  onSelect: (config: ChartConfig) => void
}) {
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState<ChartCategory | null>(null)
  const [dimension, setDimension] = useState<LineDimension | null>(null)
  const [lineMetrics, setLineMetrics] = useState<string[]>([])
  const [orientation, setOrientation] = useState<BarOrientation>('vertical')
  const [barCategory, setBarCategory] = useState<string | null>(null)
  const [barMetrics, setBarMetrics] = useState<string[]>([])

  if (!open) return null

  const reset = () => {
    setStep(1); setCategory(null); setDimension(null); setLineMetrics([])
    setOrientation('vertical'); setBarCategory(null); setBarMetrics([])
  }
  const close = () => { reset(); onClose() }

  const back = () => {
    if (step === 4) { setStep(3); setBarMetrics([]) }
    else if (step === 3) {
      if (category === 'bar') { setStep(2); setBarCategory(null) }
      else { setStep(2); setLineMetrics([]) }
    } else if (step === 2) { setStep(1); setDimension(null); setOrientation('vertical') }
  }

  const toggleLine = (id: string) => {
    setLineMetrics(prev => {
      if (prev.includes(id)) return prev.filter(m => m !== id)
      if (id === 'sentiments') return ['sentiments']
      if (prev.includes('sentiments')) return [id]
      if (prev.length >= MAX_LINE_METRICS) return prev
      return [...prev, id]
    })
  }
  const toggleBar = (id: string) =>
    setBarMetrics(prev => (prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]))

  const confirm = () => {
    if (category === 'line') onSelect({ chartType: 'line', dimension: dimension ?? 'daymonth', metrics: lineMetrics })
    else if (category === 'bar') onSelect({ chartType: 'bar', barOrientation: orientation, barCategory: barCategory ?? undefined, barMetrics })
    close()
  }

  const totalSteps = category === 'bar' ? 4 : category === 'wordcloud' ? 2 : 3
  const base = 'p-4 rounded-xl border border-[#e5e7eb] flex flex-col items-center justify-center gap-2 text-[#475569] hover:bg-[#f9fafb] hover:border-[#cbd5e1] transition-all hover:scale-[1.02]'
  const selected = 'border-[#1e4f49] bg-[#f2f8f5] text-[#1e4f49] ring-1 ring-[#1e4f49]'

  const heading =
    step === 1 ? 'Select Chart Type'
    : step === 2 && category === 'line' ? 'Select Dimension'
    : step === 2 && category === 'bar' ? 'Select Orientation'
    : step === 2 && category === 'wordcloud' ? 'Select Sentiment'
    : step === 3 && category === 'line' ? 'Select Metrics'
    : step === 3 && category === 'bar' ? 'Select Category'
    : 'Select Metrics'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[680px] p-8 rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.30)]">
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button onClick={back} className="p-1.5 rounded-lg hover:bg-[#f1f5f9] transition-colors">
                <span className="material-symbols-outlined text-[18px] text-[#94a3b8]">arrow_back</span>
              </button>
            )}
            <div>
              <h3 style={PJ} className="font-bold text-[18px] text-[#0f172a]">{heading}</h3>
              <p className="text-[12px] text-[#94a3b8]">Step {step} of {totalSteps}</p>
            </div>
          </div>
          <button onClick={close}>
            <span className="material-symbols-outlined text-[20px] text-[#94a3b8]">close</span>
          </button>
        </div>

        {/* Step 1: chart type */}
        {step === 1 && (
          <div className={`grid ${allowWordCloud ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
            <button onClick={() => { setCategory('line'); setStep(2) }} style={PJ} className={base}>
              <span className="material-symbols-outlined text-[32px] opacity-70">show_chart</span>
              <span className="text-[14px] font-bold">Line Chart</span>
              <span className="text-[10px] text-[#94a3b8]">Trends over time</span>
            </button>
            <button onClick={() => { setCategory('bar'); setStep(2) }} style={PJ} className={base}>
              <span className="material-symbols-outlined text-[32px] opacity-70">bar_chart</span>
              <span className="text-[14px] font-bold">Bar Chart</span>
              <span className="text-[10px] text-[#94a3b8]">Compare values</span>
            </button>
            {allowWordCloud && (
              <button onClick={() => { setCategory('wordcloud'); setStep(2) }} style={PJ} className={base}>
                <span className="material-symbols-outlined text-[32px] opacity-70">cloud</span>
                <span className="text-[14px] font-bold">Word Cloud</span>
                <span className="text-[10px] text-[#94a3b8]">Keyword visualization</span>
              </button>
            )}
          </div>
        )}

        {/* Step 2: word cloud sentiment */}
        {step === 2 && category === 'wordcloud' && (
          <div className="grid grid-cols-2 gap-3">
            {WORDCLOUD_SENTIMENTS.map(s => (
              <button key={s.id} onClick={() => { onSelect({ chartType: 'wordcloud', sentiment: s.id }); close() }} style={PJ} className={`${base} items-start text-left`}>
                <div className="flex items-center gap-2 w-full">
                  <span className="material-symbols-outlined text-[18px] opacity-60">favorite</span>
                  <span className="text-[14px] font-bold">{s.label}</span>
                </div>
                <span className="text-[10px] text-[#94a3b8] w-full">{s.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Step 2: bar orientation */}
        {step === 2 && category === 'bar' && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => { setOrientation('vertical'); setStep(3) }} style={PJ} className={base}>
              <span className="material-symbols-outlined text-[32px] opacity-70">bar_chart</span>
              <span className="text-[14px] font-bold">Vertical</span>
              <span className="text-[10px] text-[#94a3b8]">Standard bar chart</span>
            </button>
            <button onClick={() => { setOrientation('horizontal'); setStep(3) }} style={PJ} className={base}>
              <span className="material-symbols-outlined text-[32px] opacity-70 rotate-90">bar_chart</span>
              <span className="text-[14px] font-bold">Horizontal</span>
              <span className="text-[10px] text-[#94a3b8]">Horizontal bar chart</span>
            </button>
          </div>
        )}

        {/* Step 2: line dimension */}
        {step === 2 && category === 'line' && (
          <div className="grid grid-cols-2 gap-3">
            {LINE_DIMENSIONS.map(dim => (
              <button key={dim.id} onClick={() => { setDimension(dim.id as LineDimension); setStep(3) }} style={PJ} className={`${base} items-start text-left`}>
                <div className="flex items-center gap-2 w-full">
                  <span className="material-symbols-outlined text-[18px] opacity-60">{dim.icon}</span>
                  <span className="text-[14px] font-bold">{dim.label}</span>
                </div>
                <span className="text-[10px] text-[#94a3b8] w-full">{dim.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Step 3: bar category */}
        {step === 3 && category === 'bar' && (
          <div className="grid grid-cols-2 gap-3">
            {BAR_CATEGORIES.map(cat => {
              const disabled = cat.id === 'competitors'   // competitor data isn't wired into reports
              return (
                <button
                  key={cat.id}
                  disabled={disabled}
                  onClick={() => { if (!disabled) { setBarCategory(cat.id); setStep(4) } }}
                  style={PJ}
                  className={`${base} items-start text-left ${disabled ? 'opacity-45 cursor-not-allowed pointer-events-none' : ''}`}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="material-symbols-outlined text-[18px] opacity-60">stacked_bar_chart</span>
                    <span className="text-[13px] font-bold">{cat.label}</span>
                  </div>
                  <span className="text-[10px] text-[#94a3b8] w-full">{disabled ? 'Competitor data isn’t available in reports yet.' : cat.desc}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Step 3: line metrics */}
        {step === 3 && category === 'line' && (
          <div className="space-y-4">
            <p className="text-[12px] text-[#94a3b8]">Select up to {MAX_LINE_METRICS} metrics</p>
            <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto">
              {LINE_METRICS.map(metric => {
                const isSel = lineMetrics.includes(metric.id)
                const sentSel = lineMetrics.includes('sentiments')
                const disabled = !isSel && (
                  lineMetrics.length >= MAX_LINE_METRICS ||
                  (sentSel && metric.id !== 'sentiments') ||
                  (lineMetrics.length > 0 && !sentSel && metric.id === 'sentiments')
                )
                return (
                  <button
                    key={metric.id}
                    onClick={() => !disabled && toggleLine(metric.id)}
                    disabled={disabled}
                    style={PJ}
                    className={`p-3 rounded-lg border flex items-center gap-2 text-left transition-all ${
                      isSel ? selected : disabled ? 'border-[#e5e7eb] bg-[#f1f3f5] text-[#b6bcc4] cursor-not-allowed opacity-60' : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#475569]'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${isSel ? 'bg-[#1e4f49] border-[#1e4f49] text-white' : 'border-[#cbd5e1]'}`}>
                      {isSel && '✓'}
                    </span>
                    <span className={`material-symbols-outlined text-[15px] ${disabled ? 'opacity-30' : 'opacity-60'}`}>{metric.icon}</span>
                    <span className="text-[12px] font-medium">{metric.label}</span>
                  </button>
                )
              })}
            </div>
            <button onClick={confirm} disabled={lineMetrics.length === 0} style={PJ}
              className={`w-full py-3 rounded-xl font-bold text-[13px] transition-all ${lineMetrics.length > 0 ? 'bg-[#1e4f49] text-white hover:bg-[#163a35]' : 'bg-[#f1f3f5] text-[#b6bcc4] cursor-not-allowed'}`}>
              Apply ({lineMetrics.length} selected)
            </button>
          </div>
        )}

        {/* Step 4: bar metrics */}
        {step === 4 && category === 'bar' && barCategory && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto">
              {BAR_CATEGORIES.find(c => c.id === barCategory)?.metrics.map(metric => {
                const isSel = barMetrics.includes(metric.id)
                return (
                  <button key={metric.id} onClick={() => toggleBar(metric.id)} style={PJ}
                    className={`p-3 rounded-lg border flex items-center gap-2 text-left transition-all ${isSel ? selected : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#475569]'}`}>
                    <span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${isSel ? 'bg-[#1e4f49] border-[#1e4f49] text-white' : 'border-[#cbd5e1]'}`}>
                      {isSel && '✓'}
                    </span>
                    <span className="text-[12px] font-medium">{metric.label}</span>
                  </button>
                )
              })}
            </div>
            <button onClick={confirm} disabled={barMetrics.length === 0} style={PJ}
              className={`w-full py-3 rounded-xl font-bold text-[13px] transition-all ${barMetrics.length > 0 ? 'bg-[#1e4f49] text-white hover:bg-[#163a35]' : 'bg-[#f1f3f5] text-[#b6bcc4] cursor-not-allowed'}`}>
              Apply ({barMetrics.length} selected)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
