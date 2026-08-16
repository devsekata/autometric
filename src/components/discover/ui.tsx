'use client'

/**
 * Shared primitives for the Discover module.
 *
 * The source platform styled these inline with its own blue palette
 * (#5d95c8 / #3d7e96) and a bespoke CSS file. Here they are rebuilt on
 * autometric's teal (#327488 / #285D6E), Tailwind classes and the same type
 * scale the Dashboard cards use, so Discover reads as part of the app rather
 * than a transplant.
 */

import { useEffect, useRef, useState } from 'react'

export const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export const TEAL = {
  base: '#327488',
  deep: '#285D6E',
  light: '#4E96AC',
  wash: '#f0f7fa',
} as const

/**
 * The full token set for surfaces that are painted with inline styles rather
 * than Tailwind classes — the KOL Directory and its filter sidebar, which are
 * ports of a design built on CSS variables. Same values as globals.css: the
 * teal ramp, the neutral greys, and the text steps t1…t4 the source called
 * --t1…--t4, so a rule from the original translates one-to-one.
 */
export const TOKENS = {
  primary: '#327488',
  primaryDeep: '#285D6E',
  accent: '#4E96AC',
  ink: '#1E4A58',
  gradient: 'linear-gradient(135deg,#4E96AC,#327488)',
  surface: '#ffffff',
  surfaceLow: '#f9fafb',
  surfaceVariant: '#EDF4F7',
  outline: '#e5e7eb',
  outlineSoft: '#f3f4f6',
  t1: '#111827',
  t2: '#374151',
  t3: '#6b7280',
  t4: '#9ca3af',
  shadow: '0 1px 2px rgba(17,24,39,.05),0 4px 14px rgba(17,24,39,.05)',
  shadowMd: '0 12px 32px rgba(40,93,110,.14)',
  shadowLg: '0 26px 56px rgba(30,74,88,.18)',
} as const

/* ── formatting ───────────────────────────────────────────────────────────── */

export function fmtNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

/** "3d ago" / "5w ago" — the grid shows relative age like the source did. */
export function fmtAge(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Deterministic thumbnail gradient. Competitor posts carry no cover image and
 * brand cover URLs can 404, so every card needs a stable fallback — keyed off
 * the post id so a given post always gets the same colour.
 */
export function gradientFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const ramps = [
    ['#285D6E', '#4E96AC'], ['#327488', '#7DB4C6'], ['#3d7e96', '#A7C8D4'],
    ['#1E4A58', '#4E96AC'], ['#4E96AC', '#A7C8D4'], ['#285D6E', '#327488'],
  ]
  const [a, b] = ramps[Math.abs(h) % ramps.length]
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`
}

export const PLATFORM_ICON: Record<string, string> = {
  instagram: 'photo_camera',
  tiktok: 'music_note',
  facebook: 'thumb_up',
}

export const FORMAT_ICON: Record<string, string> = {
  Reel: 'movie', Carousel: 'collections', Image: 'image', Video: 'smart_display', Post: 'article',
}

/* ── page chrome ──────────────────────────────────────────────────────────── */

export function DiscoverHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
      <div>
        <h1 style={PJ} className="text-[19px] font-extrabold text-[#111827] tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="text-[12px] text-[#6b7280] mt-1 max-w-[70ch]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export function Btn({
  children, onClick, variant = 'secondary', size = 'md', disabled, title,
}: {
  children: React.ReactNode; onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'
  disabled?: boolean; title?: string
}) {
  const base = `inline-flex items-center gap-1.5 rounded-lg font-bold transition-colors border ${
    size === 'sm' ? 'text-[11px] px-2.5 h-7' : 'text-[12px] px-3 h-8'
  } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`
  const skin = {
    primary: 'bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E]',
    secondary: 'bg-white border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb] hover:border-[#d1d5db]',
    ghost: 'bg-transparent border-transparent text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#374151]',
  }[variant]
  return (
    <button type="button" style={PJ} className={`${base} ${skin}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

/** Filter chip — the source's `.fchip`. */
export function Chip({
  label, on, onClick, icon,
}: { label: string; on: boolean; onClick: () => void; icon?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={PJ}
      className={`inline-flex items-center gap-1 rounded-full text-[11px] font-bold px-2.5 h-[26px] border transition-colors ${
        on
          ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
          : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4] hover:text-[#374151]'
      }`}
    >
      {icon && <span className="material-symbols-outlined text-[13px]">{icon}</span>}
      {label}
    </button>
  )
}

/** Horizontal tab strip — the source's `.anav`. */
export function TabStrip<T extends string>({
  tabs, value, onChange,
}: { tabs: { id: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-[#e5e7eb] overflow-x-auto">
      {tabs.map(t => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={PJ}
            className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-3 h-9 whitespace-nowrap border-b-2 -mb-px transition-colors ${
              on
                ? 'border-b-[#327488] text-[#285D6E]'
                : 'border-b-transparent text-[#9ca3af] hover:text-[#374151]'
            }`}
          >
            {t.icon && <span className="material-symbols-outlined text-[15px]">{t.icon}</span>}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function FilterGroup({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">{icon}</span>
        <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{title}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** Dropdown "pill" for threshold filters — the source's `.pill` + `showPop`. */
export function SelectPill<T extends string | number>({
  icon, label, value, options, onChange,
}: {
  icon: string; label: string; value: T
  options: { label: string; value: T }[]; onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const current = options.find(o => o.value === value)
  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={PJ}
        className={`w-full inline-flex items-center gap-1.5 rounded-lg text-[11.5px] font-semibold px-2.5 h-8 border transition-colors ${
          current && current.value !== options[0].value
            ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
            : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#d1d5db]'
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span className="flex-1 text-left truncate">{current?.label ?? label}</span>
        <span className="material-symbols-outlined text-[14px]">expand_more</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-[#e5e7eb] rounded-lg shadow-lg py-1">
          {options.map(o => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left text-[11.5px] px-2.5 py-1.5 hover:bg-[#f9fafb] ${
                o.value === value ? 'text-[#285D6E] font-bold' : 'text-[#6b7280]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function EmptyState({
  icon = 'search_off', title, body, action,
}: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="material-symbols-outlined text-[44px] text-[#cfe0f1]">{icon}</span>
      <h4 style={PJ} className="text-[14px] font-bold text-[#374151] mt-2">{title}</h4>
      {body && <p className="text-[12px] text-[#9ca3af] mt-1 max-w-[46ch]">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-2">
      <span className="material-symbols-outlined text-[26px] text-[#A7C8D4] animate-spin">progress_activity</span>
      <span className="text-[12px] text-[#9ca3af]">{label}</span>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="material-symbols-outlined text-[40px] text-[#d1d5db]">error</span>
      <p className="text-[13px] text-[#6b7280] mt-2">Gagal memuat data: {message}</p>
    </div>
  )
}

/** Source badge — Discover mixes owned and competitor rows in one surface. */
export function SourceTag({ source }: { source: 'brand' | 'competitor' }) {
  const owned = source === 'brand'
  return (
    <span
      style={PJ}
      className={`inline-flex items-center gap-1 rounded-md text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 ${
        owned ? 'bg-[#eaf5ef] text-[#3d8a5f]' : 'bg-[#f3f0fb] text-[#6b5bb5]'
      }`}
    >
      {owned ? 'Brand' : 'Competitor'}
    </span>
  )
}

/** Brand vs competitor tag, used across the KOL surfaces. */
export function RelationTag({ relation }: { relation: 'owned' | 'competitor' }) {
  const owned = relation === 'owned'
  return (
    <span style={PJ} className={`inline-flex rounded-md text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 ${
      owned ? 'bg-[#eaf5ef] text-[#3d8a5f]' : 'bg-[#f3f0fb] text-[#6b5bb5]'
    }`}>
      {owned ? 'Brand' : 'Competitor'}
    </span>
  )
}
