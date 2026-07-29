'use client'

import { useEffect, useState } from 'react'
import { kpiDefsForChannel, buildKpiMetric, kpiPairFor, customKpiMetricsList, KpiMetric } from '@/lib/reports/data/kpiMetrics'
import { useReportKpi, useReportMetrics } from '@/lib/reports/data/metricsContext'
import type { CustomMetricDef } from '@/lib/reports/data/customMetrics'
import { listCustomMetrics } from '@/lib/reports/data/customMetricsApi'
import CustomMetricModal from './CustomMetricModal'
import MetricInfo from '@/components/ui/MetricInfo'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function MetricPickerModal({
  open, orgId, current, channel, onClose, onSelect, onCustomMetricsChanged,
}: {
  open: boolean
  orgId: string
  current: string | null
  channel: string
  onClose: () => void
  onSelect: (key: string) => void
  onCustomMetricsChanged?: () => void
}) {
  const kpi = useReportKpi()
  const table = useReportMetrics()
  // Full custom-metric defs (with terms) for the builder; the picker OPTIONS + values come
  // from the table payload (customKpiMetricsList) so they show real numbers.
  const [customDefs, setCustomDefs] = useState<CustomMetricDef[]>([])
  const [cmOpen, setCmOpen] = useState(false)
  const loadCustom = () => { listCustomMetrics(orgId).then(setCustomDefs).catch(() => setCustomDefs([])) }
  useEffect(() => { if (open) loadCustom() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  // Built-in KPIs (value/delta live from the DB — "—" while loading / no data) plus any
  // org custom metrics (sourced from the table payload so their value matches the table).
  const metrics: KpiMetric[] = [
    ...kpiDefsForChannel(channel).map(def => buildKpiMetric(def, kpiPairFor(kpi, channel, def.key))),
    ...customKpiMetricsList(table, channel),
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[520px] bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.30)] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f1f2]">
          <div>
            <h2 style={PJ} className="text-[16px] font-bold text-[#0f172a]">Select metric</h2>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">Metrics available for {channel} — live from your data.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto">
          {metrics.map(m => {
            const active = current === m.key
            return (
              <button
                key={m.key}
                onClick={() => onSelect(m.key)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${active ? 'border-[#2C3079] bg-[#F1F2FB] ring-1 ring-[#2C3079]' : 'border-[#e5e7eb] hover:border-[#cbd5e1] hover:bg-[#f9fafb]'}`}
              >
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-[#2C3079] text-white' : 'bg-[#eef0f2] text-[#9ca3af]'}`}>
                  <span className="material-symbols-outlined text-[19px]">{m.icon}</span>
                </span>
                <div className="min-w-0">
                  <p style={PJ} className="flex items-center gap-1 text-[13px] font-bold text-[#0f172a]">
                    <span className="truncate">{m.label}</span>
                    <MetricInfo metricKey={m.key} scope="rkpi" size={13} />
                  </p>
                  <p className="text-[11.5px] text-[#94a3b8]">{m.value}{m.hasDelta ? ` · ${m.delta >= 0 ? '+' : ''}${m.delta}%` : ''}</p>
                </div>
              </button>
            )
          })}
        </div>
        <div className="px-6 py-3 border-t border-[#f0f1f2] flex items-center">
          <button onClick={() => setCmOpen(true)} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#2C3079] hover:underline">
            <span className="material-symbols-outlined text-[16px]">{customDefs.length ? 'tune' : 'add'}</span>
            {customDefs.length ? 'Manage custom metrics' : 'Create custom metric'}
          </button>
        </div>
      </div>

      <CustomMetricModal
        open={cmOpen}
        orgId={orgId}
        metrics={customDefs}
        onClose={() => setCmOpen(false)}
        onChanged={() => { loadCustom(); onCustomMetricsChanged?.() }}
      />
    </div>
  )
}
