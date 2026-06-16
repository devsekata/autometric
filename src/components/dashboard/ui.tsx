'use client'

import { Sparkline } from './charts'
import type { Kpi, OverviewKpi } from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/* Card shell — the building block of the dense grid. */
export function Card({ children, className = '', span }: {
  children: React.ReactNode; className?: string; span?: string
}) {
  return (
    <div className={`bg-white border border-[#e5e7eb] rounded-xl ${span ?? ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between px-4 pt-3.5 pb-2">
      <div>
        <h3 style={PJ} className="text-[12.5px] font-bold text-[#111827] tracking-[-0.01em]">{title}</h3>
        {sub && <p className="text-[11px] text-[#9ca3af] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{children}</span>
  )
}

export function SectionHeader({ icon, children, first = false }: { icon: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={`mb-2 ${first ? 'mt-1' : 'mt-7'} flex items-center gap-2`}>
      <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">{icon}</span>
      <SectionLabel>{children}</SectionLabel>
    </div>
  )
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6b7280]">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  )
}

export function Delta({ delta, good, bare = false }: { delta: number; good: boolean; bare?: boolean }) {
  const up = delta >= 0
  const positive = up === good
  const color = delta === 0 ? '#9ca3af' : positive ? '#3d8a5f' : '#c2553f'
  const bg = delta === 0 ? '#f3f4f6' : positive ? '#eaf5ef' : '#fcefec'
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold ${bare ? 'text-[10px]' : 'px-1.5 py-0.5 rounded-md text-[10.5px]'}`}
      style={bare ? { color } : { color, background: bg }}>
      <span className="material-symbols-outlined text-[12px] leading-none">
        {delta === 0 ? 'remove' : up ? 'arrow_upward' : 'arrow_downward'}
      </span>
      {Math.abs(delta)}%
    </span>
  )
}

/* KPI card with a free-form delta string (mixed units: %, pts, notes). */
export function FlexKpiCard({ kpi, color }: { kpi: OverviewKpi; color: string }) {
  const c = kpi.flat ? '#6b7280' : kpi.good ? '#3d8a5f' : '#c2553f'
  const bg = kpi.flat ? '#f3f4f6' : kpi.good ? '#eaf5ef' : '#fcefec'
  const dir = kpi.dir ?? (kpi.good ? 'up' : 'down')
  const icon = kpi.flat ? 'remove' : dir === 'up' ? 'arrow_upward' : 'arrow_downward'
  return (
    <Card className="px-4 py-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">{kpi.icon}</span>
        <span style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] truncate">{kpi.label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span style={PJ} className="text-[24px] font-bold text-[#111827] leading-none tracking-[-0.02em]">{kpi.value}</span>
        <div className="mb-0.5"><Sparkline data={kpi.spark} color={color} /></div>
      </div>
      <span className="inline-flex items-center gap-0.5 self-start font-bold px-1.5 py-0.5 rounded-md text-[10.5px]"
        style={{ color: c, background: bg }}>
        <span className="material-symbols-outlined text-[12px] leading-none">{icon}</span>
        {kpi.delta}
      </span>
    </Card>
  )
}

const CALLOUT_TONES = {
  success: { bg: '#edf6ef', border: '#d7ebdb', label: '#3d8a5f', icon: 'check_circle' },
  warning: { bg: '#fbf4e8', border: '#f0e2c8', label: '#b8915a', icon: 'warning' },
  danger:  { bg: '#fcefec', border: '#f3d6d0', label: '#c2553f', icon: 'error' },
  info:    { bg: '#f3f1fb', border: '#e7e3f7', label: '#7a6fb5', icon: 'lightbulb' },
} as const

/* Tinted insight box (Key Finding / Top Windows / Sweet Spot …). */
export function Callout({ tone = 'info', emoji, title, children, className = '' }: {
  tone?: keyof typeof CALLOUT_TONES; emoji?: string; title: string
  children: React.ReactNode; className?: string
}) {
  const t = CALLOUT_TONES[tone]
  return (
    <div className={`flex items-start gap-2.5 px-4 py-3.5 rounded-xl border ${className}`}
      style={{ background: t.bg, borderColor: t.border }}>
      {emoji
        ? <span className="text-[15px] leading-none mt-0.5">{emoji}</span>
        : <span className="material-symbols-outlined text-[18px] mt-0.5" style={{ color: t.label }}>{t.icon}</span>}
      <div>
        <p style={{ ...PJ, color: t.label }} className="text-[11px] font-bold uppercase tracking-wide mb-1">{title}</p>
        <p className="text-[13px] leading-relaxed text-[#4b5563]">{children}</p>
      </div>
    </div>
  )
}

export function KpiCard({ kpi, color }: { kpi: Kpi; color: string }) {
  return (
    <Card className="px-4 py-3.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">{kpi.icon}</span>
          <span style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] truncate">{kpi.label}</span>
        </div>
        {kpi.ownAccountOnly && (
          <span className="text-[8.5px] font-bold uppercase tracking-wide text-[#b8915a] bg-[#fbf4e8] px-1 py-0.5 rounded">own</span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span style={PJ} className="text-[24px] font-bold text-[#111827] leading-none tracking-[-0.02em]">{kpi.value}</span>
        <div className="mb-0.5"><Sparkline data={kpi.spark} color={color} /></div>
      </div>
      <Delta delta={kpi.delta} good={kpi.positiveIsGood} />
    </Card>
  )
}

