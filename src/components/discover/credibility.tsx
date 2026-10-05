'use client'

/**
 * Credibility affordances: the badge that travels with every modelled number,
 * and the data-source strip.
 *
 * The whole point is that a user can tell at a glance whether a figure was
 * measured, derived, or modelled — so the badge is deliberately not subtle, and
 * the tooltip always carries the metric's own `basis` string rather than a
 * generic blurb.
 */

import { useState } from 'react'
import { PJ } from './ui'
import type { Confidence, Metric } from '@/lib/discover/vocab'

const STYLE: Record<Confidence, { label: string; icon: string; bg: string; fg: string }> = {
  live: { label: 'Live', icon: 'sync', bg: '#eaf5ef', fg: '#3d8a5f' },
  calculated: { label: 'Calculated', icon: 'function', bg: '#f3f0fb', fg: '#6b5bb5' },
  estimated: { label: 'Estimated', icon: 'query_stats', bg: '#fdf3e7', fg: '#b5761f' },
}

export function ConfidenceBadge({
  confidence, basis, compact = false,
}: { confidence: Confidence; basis?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const s = STYLE[confidence]
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        style={{ ...PJ, background: s.bg, color: s.fg }}
        className={`inline-flex items-center gap-0.5 rounded font-extrabold uppercase tracking-wide cursor-help ${
          compact ? 'text-[8px] px-1 py-px' : 'text-[9px] px-1.5 py-0.5'
        }`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: compact ? 9 : 11 }}>{s.icon}</span>
        {!compact && s.label}
      </span>
      {open && basis && (
        <span className="absolute z-40 bottom-full left-0 mb-1 w-56 rounded-lg bg-[#111827] text-white text-[10.5px] leading-relaxed px-2.5 py-1.5 shadow-lg">
          <b className="block mb-0.5">{s.label}</b>
          {basis}
        </span>
      )}
    </span>
  )
}

/** A metric value with its badge attached — the default way to render numbers. */
export function MetricValue<T>({
  metric, format, className = '', compact = true,
}: { metric: Metric<T>; format?: (v: T) => string; className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span style={PJ} className="tabular-nums">
        {format ? format(metric.value) : String(metric.value)}
      </span>
      <ConfidenceBadge confidence={metric.confidence} basis={metric.basis} compact={compact} />
    </span>
  )
}

/** Data-source / last-sync / confidence strip shown on profile surfaces. */
export function DataSourceStrip({
  source, lastSyncAt, confidence, className = '',
}: { source: string; lastSyncAt: string | null; confidence: Confidence; className?: string }) {
  const synced = lastSyncAt
    ? new Date(lastSyncAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'belum pernah'
  return (
    <div className={`flex items-center gap-3 flex-wrap text-[10.5px] text-[#9ca3af] ${className}`}>
      <span className="inline-flex items-center gap-1">
        <span className="material-symbols-outlined text-[12px]">database</span>
        Sumber: <b className="text-[#6b7280]">{source}</b>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="material-symbols-outlined text-[12px]">schedule</span>
        Sinkron terakhir: <b className="text-[#6b7280]">{synced}</b>
      </span>
      <span className="inline-flex items-center gap-1">
        Keyakinan data: <ConfidenceBadge confidence={confidence} basis="Tingkat keyakinan gabungan untuk akun ini" />
      </span>
    </div>
  )
}

/** Legend explaining the three levels; shown once per screen, not per value. */
export function ConfidenceLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-[10.5px] text-[#9ca3af]">
      <span>Keterangan data:</span>
      {(['live', 'calculated', 'estimated'] as Confidence[]).map(c => (
        <span key={c} className="inline-flex items-center gap-1">
          <ConfidenceBadge confidence={c} />
          <span>
            {c === 'live' ? 'terukur dari post'
              : c === 'calculated' ? 'dihitung dari data terukur'
              : 'dimodelkan, sumber belum ada'}
          </span>
        </span>
      ))}
    </div>
  )
}
