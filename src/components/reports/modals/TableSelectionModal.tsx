'use client'

import { useEffect, useState } from 'react'
import {
  TABLE_TYPES, TableConfig,
  columnsForChannel, defaultColumnsFor, isTypeEnabledForChannel, typeChannelHint,
} from '@/lib/reports/data/tableTypes'
import type { CustomMetricDef } from '@/lib/reports/data/customMetrics'
import MetricInfo from '@/components/ui/MetricInfo'
import { listCustomMetrics } from '@/lib/reports/data/customMetricsApi'
import CustomMetricModal from './CustomMetricModal'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

// content_level now carries a proper all-channel layout (Content Performance spec),
// so it's the sensible default on every channel including "all".
const defaultTypeFor = (_channel: string) => 'content_level'

/**
 * Two-pane table configurator: type list (left) + channel-scoped column picker
 * (right). Content/Channel Level metric tables are channel-specific, so their
 * columns are filtered by the slide's channel and they're disabled on "all".
 */
export default function TableSelectionModal({
  open, orgId, initial, channel, availableCompetitors = [], onClose, onConfirm, onCustomMetricsChanged,
}: {
  open: boolean
  orgId: string
  initial: TableConfig | null
  channel: string
  availableCompetitors?: { id: string; label: string }[]
  onClose: () => void
  onConfirm: (config: TableConfig) => void
  onCustomMetricsChanged?: () => void
}) {
  const [type, setType] = useState(initial?.type ?? defaultTypeFor(channel))
  const [columns, setColumns] = useState<string[]>(
    initial?.columns ?? defaultColumnsFor(initial?.type ?? defaultTypeFor(channel), channel),
  )
  // Chosen competitors (Brand-vs-Competitor table only). Default = all available.
  const allCompIds = availableCompetitors.map(c => c.id)
  const [competitorIds, setCompetitorIds] = useState<string[]>(initial?.competitorIds ?? allCompIds)

  // Org custom-metric library (loaded from the per-organization store). The builder modal
  // creates/edits these; selected ones ride in `columns` like any other column.
  const [customMetrics, setCustomMetrics] = useState<CustomMetricDef[]>([])
  const [cmOpen, setCmOpen] = useState(false)
  const loadCustom = () => { listCustomMetrics(orgId).then(setCustomMetrics).catch(() => setCustomMetrics([])) }

  // Re-sync when the modal (re)opens — the slide/channel may have changed.
  useEffect(() => {
    if (!open) return
    loadCustom()
    const valid = initial && TABLE_TYPES[initial.type] && isTypeEnabledForChannel(initial.type, channel) && !TABLE_TYPES[initial.type].disabled
    const t = valid ? initial!.type : defaultTypeFor(channel)
    setType(t)
    setColumns(valid ? initial!.columns : defaultColumnsFor(t, channel))
    // Default all competitors checked (or the saved selection intersected with what's available).
    setCompetitorIds(
      valid && initial!.competitorIds
        ? initial!.competitorIds.filter(id => allCompIds.includes(id))
        : allCompIds,
    )
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const isCompetitor = type === 'brand_vs_competitor'
  const changeType = (id: string) => {
    setType(id)
    setColumns(defaultColumnsFor(id, channel))
    if (id === 'brand_vs_competitor') setCompetitorIds(allCompIds)
  }
  const toggle = (id: string) => setColumns(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]))
  const toggleComp = (id: string) => setCompetitorIds(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]))

  const visibleColumns = columnsForChannel(type, channel)
  // Custom metrics attach to the per-post / channel-level comparison tables (they render
  // as extra columns). Selection lives in `columns` alongside the built-in column ids.
  const showCustom = TABLE_TYPES[type]?.rowType === 'comparison'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[720px] h-[520px] rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.30)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#f0f1f2] flex justify-between items-center">
          <div>
            <h3 style={PJ} className="font-bold text-[16px] text-[#0f172a]">Configure Data Table</h3>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">Select a template and customize metrics.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Type list */}
          <div className="w-[40%] border-r border-[#f0f1f2] bg-[#fafbfb] overflow-y-auto p-2 space-y-1.5">
            {Object.values(TABLE_TYPES).map(t => {
              const active = type === t.id
              const enabled = isTypeEnabledForChannel(t.id, channel) && !t.disabled
              return (
                <button
                  key={t.id}
                  disabled={!enabled}
                  onClick={() => enabled && changeType(t.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    !enabled
                      ? 'border-transparent opacity-45 cursor-not-allowed'
                      : active
                        ? 'bg-[#EAF2F6] border-[#327488] ring-1 ring-[#327488]'
                        : 'border-transparent hover:bg-white hover:border-[#e5e7eb]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`material-symbols-outlined text-[17px] ${active ? 'text-[#327488]' : 'text-[#9ca3af]'}`}>{t.icon}</span>
                    <span style={PJ} className={`text-[13px] font-bold ${active ? 'text-[#327488]' : 'text-[#475569]'}`}>{t.label}</span>
                  </div>
                  <p className="text-[10.5px] text-[#94a3b8] leading-tight">
                    {t.disabled
                      ? 'Competitor data isn’t available in reports yet.'
                      : !enabled
                        ? typeChannelHint(t.id)
                        : t.description}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Columns (+ competitor picker for the competitor table) */}
          <div className="flex-1 p-4 overflow-y-auto">
            {isCompetitor && (
              <div className="mb-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Competitors</h4>
                  {availableCompetitors.length > 0 && (
                    <button
                      onClick={() => setCompetitorIds(competitorIds.length === allCompIds.length ? [] : allCompIds)}
                      className="text-[10.5px] text-[#327488] hover:underline font-semibold"
                    >
                      {competitorIds.length === allCompIds.length ? 'Clear all' : 'Select all'}
                    </button>
                  )}
                </div>
                {availableCompetitors.length === 0 ? (
                  <p className="text-[11px] text-[#94a3b8] leading-snug">
                    Belum ada competitor dengan data untuk channel/periode ini. Tambah competitor & tunggu sync, atau jalankan medallion.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {availableCompetitors.map(c => {
                      const on = competitorIds.includes(c.id)
                      return (
                        <label key={c.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer select-none transition-all ${on ? 'bg-[#EAF2F6] border-[#bcd9cf]' : 'border-[#eef0f2] hover:bg-[#f9fafb]'}`}>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-[#327488] border-[#327488]' : 'border-[#cbd5e1] bg-white'}`}>
                            {on && <span className="material-symbols-outlined text-[12px] text-white">check</span>}
                          </span>
                          <input type="checkbox" className="hidden" checked={on} onChange={() => toggleComp(c.id)} />
                          <span style={PJ} className={`text-[12px] font-medium truncate ${on ? 'text-[#327488]' : 'text-[#64748b]'}`} title={c.label}>{c.label}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between items-center mb-3">
              <h4 style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Visible Columns</h4>
              <button onClick={() => setColumns(defaultColumnsFor(type, channel))} className="text-[10.5px] text-[#327488] hover:underline font-semibold">
                Reset to Default
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {visibleColumns.map(col => {
                const on = columns.includes(col.id)
                return (
                  <label key={col.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer select-none transition-all ${on ? 'bg-[#EAF2F6] border-[#bcd9cf]' : 'border-[#eef0f2] hover:bg-[#f9fafb]'}`}>
                    <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-[#327488] border-[#327488]' : 'border-[#cbd5e1] bg-white'}`}>
                      {on && <span className="material-symbols-outlined text-[12px] text-white">check</span>}
                    </span>
                    <input type="checkbox" className="hidden" checked={on} onChange={() => toggle(col.id)} />
                    <span style={PJ} className={`text-[12px] font-medium ${on ? 'text-[#327488]' : 'text-[#64748b]'}`}>{col.label}</span>
                    <span className="ml-auto"><MetricInfo metricKey={col.id} size={13} /></span>
                  </label>
                )
              })}
            </div>

            {/* Custom metrics (org library) — selectable like built-in columns. */}
            {showCustom && (
              <div className="mt-5">
                <div className="flex justify-between items-center mb-3">
                  <h4 style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Custom Metrics</h4>
                  <button onClick={() => setCmOpen(true)} className="flex items-center gap-1 text-[10.5px] text-[#327488] hover:underline font-semibold">
                    <span className="material-symbols-outlined text-[14px]">tune</span>
                    {customMetrics.length ? 'Manage' : 'Create'}
                  </button>
                </div>
                {customMetrics.length === 0 ? (
                  <button
                    onClick={() => setCmOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-3 rounded-lg border border-dashed border-[#d7dde3] text-[11.5px] font-semibold text-[#94a3b8] hover:border-[#327488] hover:text-[#327488] hover:bg-[#EAF2F6] transition-all"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Create a custom metric
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {customMetrics.map(cm => {
                      const on = columns.includes(cm.id)
                      return (
                        <label key={cm.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer select-none transition-all ${on ? 'bg-[#EAF2F6] border-[#bcd9cf]' : 'border-[#eef0f2] hover:bg-[#f9fafb]'}`}>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-[#327488] border-[#327488]' : 'border-[#cbd5e1] bg-white'}`}>
                            {on && <span className="material-symbols-outlined text-[12px] text-white">check</span>}
                          </span>
                          <input type="checkbox" className="hidden" checked={on} onChange={() => toggle(cm.id)} />
                          <span style={PJ} className={`text-[12px] font-medium truncate ${on ? 'text-[#327488]' : 'text-[#64748b]'}`} title={cm.name}>{cm.name}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 px-6 border-t border-[#f0f1f2] flex justify-end gap-2">
          <button onClick={onClose} style={PJ} className="px-4 py-2.5 text-[12.5px] font-semibold text-[#6b7280] hover:bg-[#f3f4f6] rounded-lg transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(isCompetitor ? { type, columns, competitorIds } : { type, columns })}
            disabled={columns.length === 0}
            style={PJ}
            className="px-5 py-2.5 bg-[#327488] text-white text-[12.5px] font-bold rounded-lg hover:bg-[#285D6E] disabled:opacity-50 transition-colors"
          >
            Insert Table
          </button>
        </div>
      </div>

      <CustomMetricModal
        open={cmOpen}
        orgId={orgId}
        metrics={customMetrics}
        onClose={() => setCmOpen(false)}
        onChanged={() => {
          // Reload the library, then drop any selected column whose metric no longer exists.
          listCustomMetrics(orgId)
            .then(next => {
              setCustomMetrics(next)
              const ids = new Set(next.map(m => m.id))
              setColumns(prev => prev.filter(id => visibleColumns.some(c => c.id === id) || ids.has(id)))
            })
            .catch(() => {})
          // Refresh the report's table metrics so new/edited custom columns get defs + values.
          onCustomMetricsChanged?.()
        }}
      />
    </div>
  )
}
