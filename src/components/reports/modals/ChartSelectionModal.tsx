'use client'

import { useEffect, useState } from 'react'
import {
  BAR_CATEGORIES, ChartConfig, LINE_DIMENSIONS, LINE_METRICS, MAX_LINE_METRICS,
  WORDCLOUD_SENTIMENTS, type BarOrientation, type ChartCategory, type LineDimension,
} from '@/lib/reports/data/chartData'
import type { CustomMetricDef } from '@/lib/reports/data/customMetrics'
import { listCustomMetrics } from '@/lib/reports/data/customMetricsApi'
import CustomMetricModal from './CustomMetricModal'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/**
 * Multi-step chart picker — replicates report_2's ChartSelectionModal exactly:
 *   Line  → dimension → metrics (max 2, sentiments exclusive)
 *   Bar   → orientation → category → metrics
 *   Cloud → sentiment
 */
export default function ChartSelectionModal({
  open, orgId, allowWordCloud = false, availableCompetitors = [], onClose, onSelect, onCustomMetricsChanged,
}: {
  open: boolean
  orgId: string
  allowWordCloud?: boolean
  availableCompetitors?: { id: string; label: string }[]
  onClose: () => void
  onSelect: (config: ChartConfig) => void
  onCustomMetricsChanged?: () => void
}) {
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState<ChartCategory | null>(null)
  const [dimension, setDimension] = useState<LineDimension | null>(null)
  const [lineMetrics, setLineMetrics] = useState<string[]>([])
  const [orientation, setOrientation] = useState<BarOrientation>('vertical')
  const [barCategory, setBarCategory] = useState<string | null>(null)
  const [barMetrics, setBarMetrics] = useState<string[]>([])
  const [competitorIds, setCompetitorIds] = useState<string[]>([])
  // Org custom metrics — selectable as line series (created/managed via CustomMetricModal).
  const [customMetrics, setCustomMetrics] = useState<CustomMetricDef[]>([])
  const [cmOpen, setCmOpen] = useState(false)
  const loadCustom = () => { listCustomMetrics(orgId).then(setCustomMetrics).catch(() => setCustomMetrics([])) }
  useEffect(() => { if (open) loadCustom() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const allCompIds = availableCompetitors.map(c => c.id)
  const reset = () => {
    setStep(1); setCategory(null); setDimension(null); setLineMetrics([])
    setOrientation('vertical'); setBarCategory(null); setBarMetrics([]); setCompetitorIds([])
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
  const toggleComp = (id: string) =>
    setCompetitorIds(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]))

  const confirm = () => {
    if (category === 'line') onSelect({ chartType: 'line', dimension: dimension ?? 'daymonth', metrics: lineMetrics })
    else if (category === 'bar') onSelect({
      chartType: 'bar', barOrientation: orientation, barCategory: barCategory ?? undefined, barMetrics,
      ...(barCategory === 'competitors' ? { competitorIds } : {}),
    })
    close()
  }

  const totalSteps = category === 'bar' ? 4 : category === 'wordcloud' ? 2 : 3
  const base = 'p-4 rounded-xl border border-[#e5e7eb] flex flex-col items-center justify-center gap-2 text-[#475569] hover:bg-[#f9fafb] hover:border-[#cbd5e1] transition-all hover:scale-[1.02]'
  const selected = 'border-[#2C3079] bg-[#F1F2FB] text-[#2C3079] ring-1 ring-[#2C3079]'

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
            {BAR_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  setBarCategory(cat.id)
                  if (cat.id === 'competitors') setCompetitorIds(allCompIds)  // default all checked
                  setStep(4)
                }}
                style={PJ}
                className={`${base} items-start text-left`}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className="material-symbols-outlined text-[18px] opacity-60">stacked_bar_chart</span>
                  <span className="text-[13px] font-bold">{cat.label}</span>
                </div>
                <span className="text-[10px] text-[#94a3b8] w-full">{cat.desc}</span>
              </button>
            ))}
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
                    <span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${isSel ? 'bg-[#2C3079] border-[#2C3079] text-white' : 'border-[#cbd5e1]'}`}>
                      {isSel && '✓'}
                    </span>
                    <span className={`material-symbols-outlined text-[15px] ${disabled ? 'opacity-30' : 'opacity-60'}`}>{metric.icon}</span>
                    <span className="text-[12px] font-medium">{metric.label}</span>
                  </button>
                )
              })}
            </div>
            {/* Custom metrics (org library) — selectable like a line metric. */}
            {customMetrics.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Custom Metrics</span>
                  <button onClick={() => setCmOpen(true)} className="flex items-center gap-1 text-[10.5px] text-[#2C3079] hover:underline font-semibold">
                    <span className="material-symbols-outlined text-[14px]">tune</span>Manage
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto">
                  {customMetrics.map(cm => {
                    const isSel = lineMetrics.includes(cm.id)
                    const sentSel = lineMetrics.includes('sentiments')
                    const disabled = !isSel && (lineMetrics.length >= MAX_LINE_METRICS || sentSel)
                    return (
                      <button key={cm.id} onClick={() => !disabled && toggleLine(cm.id)} disabled={disabled} style={PJ}
                        className={`p-3 rounded-lg border flex items-center gap-2 text-left transition-all ${isSel ? selected : disabled ? 'border-[#e5e7eb] bg-[#f1f3f5] text-[#b6bcc4] cursor-not-allowed opacity-60' : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#475569]'}`}>
                        <span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${isSel ? 'bg-[#2C3079] border-[#2C3079] text-white' : 'border-[#cbd5e1]'}`}>{isSel && '✓'}</span>
                        <span className={`material-symbols-outlined text-[15px] ${disabled ? 'opacity-30' : 'opacity-60'}`}>calculate</span>
                        <span className="text-[12px] font-medium truncate" title={cm.name}>{cm.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <button onClick={() => setCmOpen(true)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-[#d7dde3] text-[11.5px] font-semibold text-[#94a3b8] hover:border-[#2C3079] hover:text-[#2C3079] hover:bg-[#F1F2FB] transition-all">
                <span className="material-symbols-outlined text-[16px]">add</span>Create a custom metric
              </button>
            )}
            <button onClick={confirm} disabled={lineMetrics.length === 0} style={PJ}
              className={`w-full py-3 rounded-xl font-bold text-[13px] transition-all ${lineMetrics.length > 0 ? 'bg-[#2C3079] text-white hover:bg-[#20224F]' : 'bg-[#f1f3f5] text-[#b6bcc4] cursor-not-allowed'}`}>
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
                    <span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${isSel ? 'bg-[#2C3079] border-[#2C3079] text-white' : 'border-[#cbd5e1]'}`}>
                      {isSel && '✓'}
                    </span>
                    <span className="text-[12px] font-medium">{metric.label}</span>
                  </button>
                )
              })}
            </div>
            {/* Custom metrics — only for the time-bucketed bar categories (data available). */}
            {(barCategory === 'daily_performance' || barCategory === 'last3months_performance') && (
              customMetrics.length > 0 ? (
                <div className="border-t border-[#f0f1f2] pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Custom Metrics</span>
                    <button onClick={() => setCmOpen(true)} className="flex items-center gap-1 text-[10.5px] text-[#2C3079] hover:underline font-semibold">
                      <span className="material-symbols-outlined text-[14px]">tune</span>Manage
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-[140px] overflow-y-auto">
                    {customMetrics.map(cm => {
                      const isSel = barMetrics.includes(cm.id)
                      return (
                        <button key={cm.id} onClick={() => toggleBar(cm.id)} style={PJ}
                          className={`p-3 rounded-lg border flex items-center gap-2 text-left transition-all ${isSel ? selected : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#475569]'}`}>
                          <span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${isSel ? 'bg-[#2C3079] border-[#2C3079] text-white' : 'border-[#cbd5e1]'}`}>{isSel && '✓'}</span>
                          <span className="material-symbols-outlined text-[15px] opacity-60">calculate</span>
                          <span className="text-[12px] font-medium truncate" title={cm.name}>{cm.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <button onClick={() => setCmOpen(true)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-[#d7dde3] text-[11.5px] font-semibold text-[#94a3b8] hover:border-[#2C3079] hover:text-[#2C3079] hover:bg-[#F1F2FB] transition-all">
                  <span className="material-symbols-outlined text-[16px]">add</span>Create a custom metric
                </button>
              )
            )}
            {barCategory === 'competitors' && (
              <div className="border-t border-[#f0f1f2] pt-3">
                <div className="flex justify-between items-center mb-2">
                  <span style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Competitors</span>
                  {availableCompetitors.length > 0 && (
                    <button
                      onClick={() => setCompetitorIds(competitorIds.length === allCompIds.length ? [] : allCompIds)}
                      className="text-[10.5px] text-[#2C3079] hover:underline font-semibold"
                    >
                      {competitorIds.length === allCompIds.length ? 'Clear all' : 'Select all'}
                    </button>
                  )}
                </div>
                {availableCompetitors.length === 0 ? (
                  <p className="text-[11px] text-[#94a3b8]">Belum ada competitor dengan data untuk channel/periode ini.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-[140px] overflow-y-auto">
                    {availableCompetitors.map(c => {
                      const on = competitorIds.includes(c.id)
                      return (
                        <button key={c.id} onClick={() => toggleComp(c.id)} style={PJ}
                          className={`p-2.5 rounded-lg border flex items-center gap-2 text-left transition-all ${on ? selected : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#475569]'}`}>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-[#2C3079] border-[#2C3079] text-white' : 'border-[#cbd5e1]'}`}>
                            {on && '✓'}
                          </span>
                          <span className="text-[12px] font-medium truncate" title={c.label}>{c.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <button onClick={confirm} disabled={barMetrics.length === 0} style={PJ}
              className={`w-full py-3 rounded-xl font-bold text-[13px] transition-all ${barMetrics.length > 0 ? 'bg-[#2C3079] text-white hover:bg-[#20224F]' : 'bg-[#f1f3f5] text-[#b6bcc4] cursor-not-allowed'}`}>
              Apply ({barMetrics.length} selected)
            </button>
          </div>
        )}
      </div>

      <CustomMetricModal
        open={cmOpen}
        orgId={orgId}
        metrics={customMetrics}
        onClose={() => setCmOpen(false)}
        onChanged={() => { loadCustom(); onCustomMetricsChanged?.() }}
      />
    </div>
  )
}
