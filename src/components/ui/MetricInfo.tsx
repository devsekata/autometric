'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { lookupMetric } from '@/lib/metrics/glossary'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const WIDTH = 270
const GAP   = 8
const EDGE  = 8

interface Props {
  /** Any UI metric key — dashboard KPI key, report column id, or a canonical
   *  glossary key. Unknown keys render nothing at all. */
  metricKey?: string | null
  /** Disambiguates ids shared by several surfaces. Dashboard KPIs pass 'kpi'. */
  scope?: string
  /** Icon size in px; match it to the surrounding text. */
  size?: number
  className?: string
}

/**
 * Small (i) affordance next to a metric label. Hover reveals the glossary text;
 * clicking pins it open so it survives moving the pointer away — which is also
 * what makes it usable on touch, where there is no hover.
 */
export default function MetricInfo({ metricKey, scope, size = 13, className = '' }: Props) {
  const entry = lookupMetric(metricKey, scope)

  const [open,   setOpen]   = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos,    setPos]    = useState<{ top: number; left: number; above: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Estimate height so the flip decision is made before paint; the tooltip is
    // short enough that a fixed estimate is accurate in practice.
    const estimated = 132
    const above = r.bottom + GAP + estimated > window.innerHeight && r.top > estimated + GAP
    const left  = Math.min(
      Math.max(EDGE, r.left + r.width / 2 - WIDTH / 2),
      window.innerWidth - WIDTH - EDGE,
    )
    setPos({ top: above ? r.top - GAP : r.bottom + GAP, left, above })
  }, [])

  const show = useCallback(() => { place(); setOpen(true) },  [place])
  const hide = useCallback(() => { if (!pinned) setOpen(false) }, [pinned])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinned(false); setOpen(false) }
    }
    const onDocClick = (e: MouseEvent) => {
      if (pinned && btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setPinned(false); setOpen(false)
      }
    }
    // Reposition rather than follow: the panel is fixed, so a scroll would
    // otherwise leave it detached from its icon.
    const onScroll = () => { setPinned(false); setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, pinned])

  if (!entry) return null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Penjelasan metrik ${entry.label}`}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => { setPinned(false); setOpen(false) }}
        onClick={e => {
          e.stopPropagation()
          if (pinned) { setPinned(false); setOpen(false) }
          else        { setPinned(true);  show() }
        }}
        className={`inline-flex items-center justify-center flex-shrink-0 rounded-full text-[#c4c9d4] hover:text-[#6b7280] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#285D6E]/30 transition-colors ${className}`}
        style={{ width: size + 2, height: size + 2 }}
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: size }}>info</span>
      </button>

      {open && pos && (
        <div
          role="tooltip"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={hide}
          style={{
            position:  'fixed',
            top:       pos.top,
            left:      pos.left,
            width:     WIDTH,
            transform: pos.above ? 'translateY(-100%)' : undefined,
            zIndex:    70,
          }}
          className="rounded-lg border border-[#e5e7eb] bg-white shadow-lg shadow-black/8 px-3.5 py-3"
        >
          <p style={PJ} className="text-[11.5px] font-bold text-[#111827] mb-1">{entry.label}</p>
          <p className="text-[12px] leading-relaxed text-[#4b5563]">{entry.description}</p>
          {entry.caveat && (
            <p className="text-[11.5px] leading-relaxed text-[#9ca3af] mt-1.5 pt-1.5 border-t border-[#f3f4f6]">
              {entry.caveat}
            </p>
          )}
        </div>
      )}
    </>
  )
}
