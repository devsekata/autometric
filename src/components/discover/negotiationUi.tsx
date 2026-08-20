'use client'

/**
 * Shared pieces for the Negotiation screens.
 *
 * The source platform drew these with its own CSS classes (`.st`, `.sum-row`,
 * `.fchip`). Rebuilt here on autometric's teal and type scale so the deal
 * screens read as part of Discover rather than a transplant — same status pills
 * as the rest of the module, same money rows as the cart summary.
 */

import { useEffect, useState } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, PJ } from './ui'
import { TONE_CLASS } from './useNegotiations'
import { GLOSSARY, idr, type StageTone } from '@/lib/discover/negotiation'

export function StatusPill({
  label, tone, size = 'md',
}: { label: string; tone: StageTone; size?: 'sm' | 'md' }) {
  return (
    <span
      style={PJ}
      className={`inline-flex items-center gap-1 rounded-full border font-bold whitespace-nowrap ${
        size === 'sm' ? 'text-[9px] px-1.5 h-[18px]' : 'text-[10px] px-2 h-[22px]'
      } ${TONE_CLASS[tone]}`}
    >
      <span className={`rounded-full ${size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'} bg-current opacity-70`} />
      {label}
    </span>
  )
}

/** One line of a money breakdown — label left, amount right. */
export function MoneyRow({
  label, amount, note, tone, strong, strike,
}: {
  label: string
  amount: number | string
  note?: string
  tone?: 'good' | 'bad'
  strong?: boolean
  strike?: boolean
}) {
  const colour = tone === 'good' ? 'text-[#2f7d63]' : tone === 'bad' ? 'text-[#c2553f]' : 'text-[#111827]'
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-[#e5e7eb] mt-1 pt-2' : ''}`}>
      <div className="min-w-0">
        <span className={`text-[11.5px] ${strong ? 'font-bold text-[#111827]' : 'text-[#6b7280]'}`}>{label}</span>
        {note && <p className="text-[10px] text-[#9ca3af] mt-0.5 max-w-[52ch]">{note}</p>}
      </div>
      <span
        style={PJ}
        className={`text-[12px] font-extrabold tabular-nums whitespace-nowrap ${colour} ${
          strike ? 'line-through text-[#9ca3af]' : ''
        }`}
      >
        {typeof amount === 'number' ? idr(amount) : amount}
      </span>
    </div>
  )
}

/** Rupiah input that keeps a raw string while typing so backspacing works. */
export function MoneyField({
  value, onChange, placeholder, disabled, id,
}: {
  value: string
  onChange: (raw: string) => void
  placeholder?: string
  disabled?: boolean
  id?: string
}) {
  const parsed = Number(value.replace(/\D/g, ''))
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-[#9ca3af]">Rp</span>
      <input
        id={id}
        inputMode="numeric"
        value={value ? parsed.toLocaleString('id-ID') : ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        style={PJ}
        className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[#e5e7eb] text-[12px] font-bold text-[#111827] tabular-nums bg-white focus:outline-none focus:border-[#327488] disabled:bg-[#f9fafb] disabled:text-[#9ca3af]"
      />
    </div>
  )
}

export function NumberField({
  value, onChange, disabled, suffix,
}: { value: number; onChange: (n: number) => void; disabled?: boolean; suffix?: string }) {
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        value={value.toLocaleString('id-ID')}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
        style={PJ}
        className={`w-full h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[11.5px] font-bold text-[#111827] tabular-nums bg-white focus:outline-none focus:border-[#327488] disabled:bg-[#f9fafb] disabled:text-[#9ca3af] ${suffix ? 'pr-8' : ''}`}
      />
      {suffix && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#9ca3af]">{suffix}</span>
      )}
    </div>
  )
}

export function TextField({
  value, onChange, placeholder, disabled, rows = 2,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  rows?: number
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-2 rounded-lg border border-[#e5e7eb] text-[11.5px] text-[#374151] bg-white resize-y focus:outline-none focus:border-[#327488] disabled:bg-[#f9fafb] disabled:text-[#9ca3af]"
    />
  )
}

/** Small caps label above a control group. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={PJ} className="block text-[10px] font-bold uppercase tracking-widest text-[#9ca3af] mb-1.5">
      {children}
    </span>
  )
}

export function Note({
  tone = 'info', children,
}: { tone?: 'info' | 'warn' | 'good'; children: React.ReactNode }) {
  const skin = {
    info: 'bg-[#f0f7fa] border-[#A7C8D4] text-[#285D6E]',
    warn: 'bg-[#fcefec] border-[#f0c8bf] text-[#8a3a2a]',
    good: 'bg-[#eaf6f1] border-[#b6e0cd] text-[#2f7d63]',
  }[tone]
  const icon = { info: 'info', warn: 'warning', good: 'task_alt' }[tone]
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${skin}`}>
      <span className="material-symbols-outlined text-[15px] mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Progress rail for a staged journey — the deal's, or the content's. */
export function StepRail({
  steps, activeIndex, failed,
}: {
  steps: { label: string; icon: string }[]
  activeIndex: number
  /** The journey ended early: everything past `activeIndex` reads as stopped. */
  failed?: boolean
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {steps.map((s, i) => {
        const done = i < activeIndex
        const on = i === activeIndex
        const skin = failed && i >= activeIndex
          ? 'bg-[#fcefec] text-[#c2553f] border-[#f0c8bf]'
          : on
            ? 'bg-[#327488] text-white border-[#327488]'
            : done
              ? 'bg-[#eaf6f1] text-[#2f7d63] border-[#b6e0cd]'
              : 'bg-white text-[#9ca3af] border-[#e5e7eb]'
        return (
          <div key={s.label} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && (
              <span className={`w-3 h-[2px] rounded-full ${done || on ? 'bg-[#4E96AC]' : 'bg-[#e5e7eb]'}`} />
            )}
            <span
              style={PJ}
              className={`inline-flex items-center gap-1 rounded-full border px-2 h-[22px] text-[9.5px] font-bold whitespace-nowrap ${skin}`}
            >
              <span className="material-symbols-outlined text-[12px]">{done ? 'check' : s.icon}</span>
              {s.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** A labelled figure — used for the fee split and the KPI matrix. */
export function Stat({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  const colour = tone === 'good' ? 'text-[#2f7d63]' : tone === 'warn' ? 'text-[#a4713a]' : 'text-[#111827]'
  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white px-3 py-2.5">
      <span style={PJ} className="block text-[9.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</span>
      <span style={PJ} className={`block text-[15px] font-extrabold tabular-nums mt-0.5 ${colour}`}>{value}</span>
      {sub && <span className="block text-[10px] text-[#9ca3af] mt-0.5">{sub}</span>}
    </div>
  )
}

/* ── glossary ─────────────────────────────────────────────────────────────── */

export function GlossaryButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(true)}
        title="Penjelasan setiap istilah yang dipakai di layar ini">
        <span className="material-symbols-outlined text-[15px]">help</span>
        Istilah
      </Btn>
      {open && <Modal title="Apa arti istilah-istilah ini?" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3">
          {GLOSSARY.map(g => (
            <div key={g.term}>
              <span style={PJ} className="block text-[12px] font-extrabold text-[#111827]">{g.term}</span>
              <p className="text-[11px] text-[#6b7280] leading-relaxed mt-0.5">{g.body}</p>
            </div>
          ))}
        </div>
      </Modal>}
    </>
  )
}

/**
 * Modal shell. Closes on Escape and on backdrop click, because a dialog that
 * only closes by one route is a dialog people get stuck in.
 */
export function Modal({
  title, onClose, children, footer, wide,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(17,24,39,.45)]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-[720px]' : 'max-w-[480px]'} max-h-[85vh] flex flex-col rounded-2xl bg-white border border-[#e5e7eb] shadow-[0_26px_56px_rgba(30,74,88,.18)]`}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#e5e7eb]">
          <span style={PJ} className="text-[13px] font-extrabold text-[#111827]">{title}</span>
          <button type="button" onClick={onClose} aria-label="Tutup"
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#374151]">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="px-4 py-3.5 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e5e7eb] bg-[#f9fafb] rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Toast. The source had a global one; here it is local to the negotiation tree,
 * which is the only part of Discover that narrates its own state changes.
 */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-xl bg-[#1E4A58] text-white px-3.5 py-2.5 shadow-[0_12px_32px_rgba(40,93,110,.3)]"
    >
      <span style={PJ} className="text-[11.5px] font-semibold">{message}</span>
    </div>
  )
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 3200)
    return () => window.clearTimeout(t)
  }, [message])
  return { message, notify: setMessage }
}

/**
 * Card + header + padded body, as one component.
 *
 * `Card` from the dashboard kit deliberately carries no padding — `CardHead`
 * supplies its own, and callers wrap the body. Every panel on the negotiation
 * screens wants exactly that pairing, so it lives here once instead of being
 * re-typed a dozen times and drifting by a pixel each time.
 */
export function Panel({
  title, sub, action, children, className = '',
}: {
  title?: string
  sub?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      {title ? <CardHead title={title} sub={sub} action={action} /> : null}
      <div className={title ? 'px-4 pb-4' : 'p-4'}>{children}</div>
    </Card>
  )
}

/**
 * A panel that starts folded.
 *
 * For content that has to be in the agreement but is read once and then in the
 * way — the responsibilities boilerplate, mostly. Built on `<details>` so the
 * keyboard and screen-reader behaviour comes for free, and so it stays open
 * across re-renders without state of its own.
 */
export function Collapsible({
  title, icon, children, defaultOpen = false,
}: {
  title: string
  icon?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details open={defaultOpen} className="group bg-white border border-[#e5e7eb] rounded-xl">
      <summary className="flex items-center gap-2 px-4 h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {icon && <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">{icon}</span>}
        <span style={PJ} className="flex-1 text-[12.5px] font-bold text-[#111827] tracking-[-0.01em]">
          {title}
        </span>
        <span className="material-symbols-outlined text-[18px] text-[#9ca3af] transition-transform group-open:rotate-180">
          expand_more
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  )
}
