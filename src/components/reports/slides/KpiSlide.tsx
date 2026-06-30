'use client'

import { useState } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, ConfigBlock } from '@/lib/reports/data/slideModel'
import { KpiMetric, deltaIsGood, getKpiMetric } from '@/lib/reports/data/kpiMetrics'
import { PJ, InsightsBlock } from './parts'
import { ChartBlock } from './charts'

const COUNTS = [3, 4, 5, 6]

// Font sizes scale with the number of scorecards (smaller when there are more).
function sizesFor(n: number) {
  if (n <= 4) return { value: '2.5cqw', label: '0.95cqw', trend: '0.95cqw', cap: '0.85cqw' }
  if (n === 5) return { value: '2.1cqw', label: '0.9cqw', trend: '0.9cqw', cap: '0.8cqw' }
  return { value: '1.8cqw', label: '0.85cqw', trend: '0.85cqw', cap: '0.78cqw' }
}

function Scorecard({ metric, accent, count, editable, onClick }: { metric: KpiMetric | undefined; accent: string; count: number; editable: boolean; onClick?: () => void }) {
  const s = sizesFor(count)
  if (!metric) {
    return (
      <button
        onClick={editable ? onClick : undefined}
        disabled={!editable}
        className={`w-full h-full flex flex-col items-center justify-center rounded-[1.2cqw] border-2 border-dashed transition-colors ${
          editable ? 'border-[#cbd5e1] text-[#94a3b8] hover:border-[#1e4f49] hover:text-[#1e4f49] hover:bg-[#f2f8f5] cursor-pointer' : 'border-[#dbe1e8] text-[#b6bcc4] cursor-default'
        }`}
        style={{ background: 'rgba(255,255,255,0.45)' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '2.2cqw' }}>add</span>
        <span style={{ fontSize: s.cap, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', ...PJ }}>Add metric</span>
      </button>
    )
  }
  const good = deltaIsGood(metric)
  return (
    <div
      onClick={editable ? onClick : undefined}
      className={`group relative w-full h-full rounded-[1.2cqw] bg-white border border-[#e8ebee] overflow-hidden flex flex-col justify-between ${editable ? 'cursor-pointer' : ''}`}
      style={{ padding: count >= 6 ? '1.4cqh 1cqw' : '1.6cqh 1.2cqw', boxShadow: '0 1cqh 2.4cqh -1.4cqh rgba(16,24,40,0.18)' }}
    >
      <div className="absolute top-0 left-0" style={{ width: '100%', height: '0.5cqh', background: accent }} />
      <div className="flex items-center justify-between" style={{ marginTop: '0.3cqh' }}>
        <span className="flex items-center min-w-0" style={{ gap: '0.5cqw', fontSize: s.label, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.03em', ...PJ }}>
          <span className="material-symbols-outlined" style={{ fontSize: `calc(${s.label} + 0.4cqw)`, color: accent }}>{metric.icon}</span>
          <span className="truncate">{metric.label}</span>
        </span>
        {editable && (
          <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity" style={{ fontSize: '1.4cqw', color: '#cbd5e1' }}>edit</span>
        )}
      </div>
      <div style={{ fontSize: s.value, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1, ...PJ }}>{metric.value}</div>
      <div className="flex items-center" style={{ gap: '0.6cqw' }}>
        <span className="flex items-center rounded-full" style={{ gap: '0.2cqw', fontSize: s.trend, fontWeight: 800, padding: '0.2cqh 0.7cqw', color: good ? '#16a34a' : '#dc2626', background: good ? '#f0fdf4' : '#fef2f2', ...PJ }}>
          <span className="material-symbols-outlined" style={{ fontSize: `calc(${s.trend} + 0.4cqw)` }}>{metric.delta >= 0 ? 'arrow_outward' : 'south_east'}</span>
          {Math.abs(metric.delta)}%
        </span>
        <span style={{ fontSize: s.cap, color: '#94a3b8', ...PJ }}>vs last period</span>
      </div>
    </div>
  )
}

/**
 * KPI Overview body — a row of metric scorecards over a deep-dive chart + summary.
 * Clicking a scorecard opens metric selection; the metric count is changed via the
 * edit button (modal). Header & footer come from the slide shell (SlidePreview).
 */
export default function KpiSlide({
  slide, colors, editable, onChange, onConfigure,
}: {
  slide: ContentSlide
  colors: CoverColors
  editable: boolean
  onChange?: (next: ContentSlide) => void
  onConfigure?: (block: ConfigBlock) => void
}) {
  const [countOpen, setCountOpen] = useState(false)
  const count = slide.metricCount

  return (
    <>
      {/* Scorecards */}
      <div style={{ height: '17cqh', flexShrink: 0, position: 'relative' }}>
        {editable && (
          <button
            onClick={() => setCountOpen(true)}
            title="Number of metrics"
            className="absolute z-10 flex items-center justify-center rounded-[0.5cqw] bg-white border border-[#e2e8f0] text-[#94a3b8] hover:text-[#1e4f49] hover:border-[#cbd5e1] shadow-sm transition-colors"
            style={{ top: '-3cqh', right: 0, width: '2.6cqw', height: '2.6cqw' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '1.5cqw' }}>tune</span>
          </button>
        )}
        <div className="flex h-full" style={{ gap: count >= 6 ? '1cqw' : '1.6cqw' }}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0 }}>
              <Scorecard
                metric={getKpiMetric(slide.kpiMetrics[i] ?? null)}
                accent={colors.primary}
                count={count}
                editable={editable}
                onClick={() => onConfigure?.(`kpi-${i}`)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Deep dive + summary */}
      <div className="flex-1 flex min-h-0" style={{ gap: '2cqw' }}>
        <div style={{ flex: 2, minWidth: 0 }}>
          <ChartBlock config={slide.chart} colors={colors} editable={editable} onConfigure={() => onConfigure?.('chart')} placeholderLabel="Deep dive analysis" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InsightsBlock value={slide.insights} editable={editable} onChange={v => onChange?.({ ...slide, insights: v })} label="Summary & actions" />
        </div>
      </div>

      {/* Number-of-metrics modal (fixed → uses px, not cq) */}
      {countOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCountOpen(false)}>
          <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[380px] bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.30)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 style={PJ} className="text-[16px] font-bold text-[#0f172a]">Number of metrics</h3>
                <p className="text-[12px] text-[#94a3b8] mt-0.5">How many scorecards to show.</p>
              </div>
              <button onClick={() => setCountOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {COUNTS.map(n => (
                <button
                  key={n}
                  onClick={() => { onChange?.({ ...slide, metricCount: n }); setCountOpen(false) }}
                  style={PJ}
                  className={`py-4 rounded-xl border flex flex-col items-center gap-1 transition-all ${count === n ? 'border-[#1e4f49] bg-[#f2f8f5] text-[#1e4f49] ring-1 ring-[#1e4f49]' : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#334155]'}`}
                >
                  <span className="material-symbols-outlined text-[22px] opacity-70">grid_view</span>
                  <span className="text-[17px] font-bold">{n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
