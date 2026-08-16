'use client'

/**
 * Chart primitives for the Creator Intelligence Workspace.
 *
 * Hand-built SVG rather than a charting library: these are five simple forms on
 * a handful of points each, and the app ships no chart dependency today — adding
 * one for this would cost more than it saves.
 *
 * ── Palette ──────────────────────────────────────────────────────────────────
 * Validated with the data-viz validator against this app's white card surface,
 * not eyeballed:
 *
 *   series (single series, nominal bars)  #0e86a6
 *     The brand teal #327488 itself FAILS the chroma floor as a mark (OKLCH
 *     C 0.073 < 0.10 — it reads gray at chart scale), so the series step is a
 *     more saturated teal from the same family. Brand teal stays on the chrome:
 *     headings, buttons, chips.
 *   categorical (3 slots, donut)          #0e86a6 · #eb6834 · #4a3aa7
 *     worst all-pairs ΔE 16.1 CVD / 20.5 normal vision — clear of both floors.
 *   ordinal ramp (5 steps, age bands)     #8CB9C8 → #5E9EB4 → #357F97 → #2A6275 → #1E4A58
 *     monotone lightness, every adjacent ΔL ≥ 0.06, light end 2.12:1 on white.
 *   status                                good #0ca30c · warning #fab219 · critical #d03b3b
 *     always shipped with an icon and a label, never colour alone.
 *
 * Age bands are an *ordinal* scale, not a categorical one — swapping 18–24 with
 * 45–54 would change the meaning — so they take the one-hue ramp and the reader
 * sees the order in the colour. Cities and content formats are nominal, so every
 * bar takes the same slot-1 hue: bar length already encodes the value, and
 * spending the identity channel on it would say something untrue.
 *
 * The app renders light-only, so no dark steps are declared here.
 */

import { useState } from 'react'
import { PJ, TOKENS as T, fmtNum } from './ui'

export const VIZ = {
  series: '#0e86a6',
  categorical: ['#0e86a6', '#eb6834', '#4a3aa7'],
  ordinal: ['#8CB9C8', '#5E9EB4', '#357F97', '#2A6275', '#1E4A58'],
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  /** Success text is a darker step than the mark — 4.5:1 for small type. */
  goodInk: '#006300',
  grid: '#eef0f2',
  axis: '#9ca3af',
  surface: '#ffffff',
} as const

/* ── sample-data marker ───────────────────────────────────────────────────── */

/**
 * Every figure the roster cannot back is stamped with this. It is deliberately
 * plain and always adjacent to the number it qualifies — a legend somewhere else
 * on the page would not travel with a screenshot.
 */
export function SampleTag({ compact }: { compact?: boolean }) {
  return (
    <span
      title="Angka contoh — belum ada sumber datanya di database KOL"
      style={{ ...PJ, background: '#fdf3e7', color: '#b5761f', borderColor: '#f6e3c9' }}
      className={`inline-flex items-center gap-[3px] rounded-md border font-extrabold align-middle ${
        compact ? 'text-[8.5px] px-1 py-px' : 'text-[9px] px-1.5 py-0.5'}`}>
      <span className="material-symbols-outlined" style={{ fontSize: compact ? 9 : 10 }}>science</span>
      contoh
    </span>
  )
}

/** The page-level statement, so the marker never has to carry the whole message. */
export function SampleBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border px-3 py-2.5 mb-4"
      style={{ background: '#fdf9f2', borderColor: '#f6e3c9' }}>
      <span className="material-symbols-outlined text-[17px] mt-px" style={{ color: '#b5761f' }}>science</span>
      <p className="text-[11.5px] leading-[1.5]" style={{ color: '#7a5312' }}>{children}</p>
    </div>
  )
}

/* ── stat tile ────────────────────────────────────────────────────────────── */

export function StatTile({
  label, value, delta, deltaSuffix = '%', sample, hint, upIsGood = true,
}: {
  label: string
  value: string
  delta?: number | null
  deltaSuffix?: string
  sample?: boolean
  hint?: string
  upIsGood?: boolean
}) {
  const up = (delta ?? 0) >= 0
  const good = up === upIsGood
  return (
    <div className="rounded-[14px] border px-3.5 py-3" style={{ borderColor: T.outline, background: VIZ.surface }}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px]" style={{ color: T.t3 }}>{label}</span>
        {sample && <SampleTag compact />}
      </div>
      {/* Proportional figures: a standalone value, not a column. */}
      <div style={{ ...PJ, color: T.t1 }} className="text-[19px] font-extrabold mt-1 tracking-[-0.02em]">
        {value}
      </div>
      {delta !== undefined && delta !== null && (
        <div className="flex items-center gap-1 mt-0.5">
          <span className="material-symbols-outlined text-[13px]"
            style={{ color: good ? VIZ.goodInk : VIZ.critical }}>
            {up ? 'trending_up' : 'trending_down'}
          </span>
          <span className="text-[10.5px] font-bold" style={{ color: good ? VIZ.goodInk : VIZ.critical }}>
            {up ? '+' : ''}{delta}{deltaSuffix}
          </span>
          <span className="text-[9.5px]" style={{ color: T.t4 }}>vs periode sebelumnya</span>
        </div>
      )}
      {hint && <div className="text-[9.5px] mt-1" style={{ color: T.t4 }}>{hint}</div>}
    </div>
  )
}

/* ── line trend ───────────────────────────────────────────────────────────── */

const W = 720
const H = 210
const PAD = { top: 16, right: 46, bottom: 26, left: 44 }

/**
 * One series, with a crosshair and a tooltip. One series and not two: engagement
 * rate and reach have different units, and a second y-axis is the single worst
 * thing you can do to a chart — the metric picker above swaps which one is
 * plotted instead.
 */
export function TrendChart({
  points, format, label,
}: {
  points: { x: string; y: number }[]
  format: (n: number) => string
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return null

  const ys = points.map(p => p.y)
  const max = Math.max(...ys)
  const min = Math.min(...ys)
  // A flat series would otherwise divide by zero and collapse onto one row.
  const span = max - min || max || 1
  const lo = Math.max(0, min - span * 0.35)
  const hi = max + span * 0.25

  const px = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (points.length - 1)
  const py = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom)

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(i)},${py(p.y)}`).join(' ')
  const area = `${line} L${px(points.length - 1)},${H - PAD.bottom} L${px(0)},${H - PAD.bottom} Z`
  const ticks = [hi, (hi + lo) / 2, lo]
  const active = hover === null ? points.length - 1 : hover

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`${label} — ${points.map(p => `${p.x} ${format(p.y)}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - r.left) / r.width) * W
          const step = (W - PAD.left - PAD.right) / (points.length - 1)
          setHover(Math.max(0, Math.min(points.length - 1, Math.round((x - PAD.left) / step))))
        }}>
        {/* Hairline grid, solid and one step off the surface. */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={py(t)} y2={py(t)} stroke={VIZ.grid} strokeWidth={1} />
            <text x={PAD.left - 8} y={py(t) + 3.5} textAnchor="end"
              style={{ fontSize: 10, fill: VIZ.axis, fontVariantNumeric: 'tabular-nums' }}>
              {format(t)}
            </text>
          </g>
        ))}

        <path d={area} fill={VIZ.series} opacity={0.1} />
        <path d={line} fill="none" stroke={VIZ.series} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <text key={p.x} x={px(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 10, fill: VIZ.axis }}>
            {p.x}
          </text>
        ))}

        {/* Crosshair on the hovered point; the end point when nothing is hovered. */}
        <line x1={px(active)} x2={px(active)} y1={PAD.top} y2={H - PAD.bottom}
          stroke={VIZ.axis} strokeWidth={1} opacity={hover === null ? 0 : 0.35} />
        {/* Surface ring keeps the marker legible where it crosses the line. */}
        <circle cx={px(active)} cy={py(points[active].y)} r={5}
          fill={VIZ.series} stroke={VIZ.surface} strokeWidth={2} />
        {/* Only the endpoint is labelled — never a number on every point. */}
        {hover === null && (
          <text x={px(points.length - 1) + 8} y={py(points[points.length - 1].y) + 3.5}
            style={{ ...PJ, fontSize: 11, fontWeight: 800, fill: T.t2 }}>
            {format(points[points.length - 1].y)}
          </text>
        )}
      </svg>

      {hover !== null && (
        <div className="absolute pointer-events-none rounded-lg border px-2 py-1.5 shadow-sm"
          style={{
            background: VIZ.surface, borderColor: T.outline,
            left: `${(px(hover) / W) * 100}%`, top: 0, transform: 'translateX(-50%)',
          }}>
          <div className="text-[9.5px]" style={{ color: T.t4 }}>{points[hover].x}</div>
          <div style={{ ...PJ, color: T.t1 }} className="text-[12px] font-extrabold">
            {format(points[hover].y)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── donut ────────────────────────────────────────────────────────────────── */

/**
 * Three slots at most — the categorical palette validates its first three under
 * the all-pairs test, and a donut puts every segment beside every other.
 */
export function Donut({
  parts, centerLabel, centerValue,
}: {
  parts: { label: string; pct: number }[]
  centerLabel: string
  centerValue: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const R = 54
  const STROKE = 18
  const C = 2 * Math.PI * R
  // 2px of surface between segments, expressed in arc length.
  const GAP = 2
  let offset = 0

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 140 140" className="w-[140px] h-[140px] flex-shrink-0" role="img"
        aria-label={parts.map(p => `${p.label} ${p.pct}%`).join(', ')}>
        <g transform="translate(70,70) rotate(-90)">
          {parts.map((p, i) => {
            const len = Math.max(0, (p.pct / 100) * C - GAP)
            const dash = `${len} ${C - len}`
            const el = (
              <circle key={p.label} r={R} fill="none"
                stroke={VIZ.categorical[i % VIZ.categorical.length]}
                strokeWidth={hover === i ? STROKE + 3 : STROKE}
                strokeDasharray={dash} strokeDashoffset={-offset}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                style={{ transition: 'stroke-width .12s' }} />
            )
            offset += (p.pct / 100) * C
            return el
          })}
        </g>
        <text x={70} y={66} textAnchor="middle" style={{ ...PJ, fontSize: 17, fontWeight: 800, fill: T.t1 }}>
          {hover === null ? centerValue : `${parts[hover].pct}%`}
        </text>
        <text x={70} y={81} textAnchor="middle" style={{ fontSize: 9.5, fill: T.t4 }}>
          {hover === null ? centerLabel : parts[hover].label}
        </text>
      </svg>

      {/* Legend is mandatory at two or more series — identity is never colour alone. */}
      <div className="flex flex-col gap-1.5">
        {parts.map((p, i) => (
          <div key={p.label} className="flex items-center gap-2"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0"
              style={{ background: VIZ.categorical[i % VIZ.categorical.length] }} />
            <span className="text-[11.5px]" style={{ color: T.t2 }}>{p.label}</span>
            <span style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-extrabold tabular-nums">
              {p.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── horizontal bars ──────────────────────────────────────────────────────── */

/**
 * `ordinal` paints the one-hue ramp (ordered bands — ages, tiers); leaving it off
 * paints every bar the same slot-1 hue (nominal — cities, formats, topics).
 */
export function Bars({
  parts, ordinal, suffix = '%',
}: {
  parts: { label: string; pct: number }[]
  ordinal?: boolean
  suffix?: string
}) {
  const max = Math.max(...parts.map(p => p.pct), 1)
  return (
    <div className="flex flex-col gap-2">
      {parts.map((p, i) => (
        <div key={p.label} className="flex items-center gap-2.5" title={`${p.label}: ${p.pct}${suffix}`}>
          <span className="text-[11px] w-[86px] flex-shrink-0 truncate" style={{ color: T.t3 }}>{p.label}</span>
          <div className="flex-1 h-[12px] rounded-[4px]" style={{ background: T.outlineSoft }}>
            <div className="h-full rounded-r-[4px]" style={{
              width: `${Math.max(2, (p.pct / max) * 100)}%`,
              // Ordinal steps run light→dark in band order; nominal bars all wear slot 1.
              background: ordinal ? VIZ.ordinal[Math.min(i, VIZ.ordinal.length - 1)] : VIZ.series,
            }} />
          </div>
          <span style={{ ...PJ, color: T.t2 }} className="text-[11px] font-extrabold w-[52px] text-right tabular-nums">
            {p.pct}{suffix}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── meter ────────────────────────────────────────────────────────────────── */

/** Score bar: fill carries severity, the track is a lighter step of the same ramp. */
export function Meter({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const fill = pct >= 85 ? VIZ.series : pct >= 70 ? VIZ.ordinal[2] : VIZ.warning
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] w-[104px] flex-shrink-0" style={{ color: T.t3 }}>{label}</span>
      <div className="flex-1 h-[10px] rounded-[4px]" style={{ background: '#e8eff2' }}>
        <div className="h-full rounded-r-[4px]" style={{ width: `${pct}%`, background: fill }} />
      </div>
      <span style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-extrabold w-[30px] text-right tabular-nums">
        {Math.round(value)}
      </span>
    </div>
  )
}

/* ── layout ───────────────────────────────────────────────────────────────── */

/**
 * The workspace's repeating rhythm: data on the left, the reading of it on the
 * right. Deliberately not two equal cards — equal weight would say the score is
 * as big a thing as the chart it summarises, and the whole point of the right
 * column is that it is the short answer.
 *
 * Collapses to one column under 900px, where 35% of the width is too narrow for
 * a meter with a label.
 */
export function Split({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,65fr) minmax(260px,35fr)' }}>
      <div className="min-w-0 flex flex-col gap-4">{main}</div>
      <div className="min-w-0 flex flex-col gap-4">{aside}</div>
    </div>
  )
}

/** A big score with its verdict — the right column's usual opening. */
export function ScoreBlock({
  score, verdict, max = 100,
}: { score: number; verdict: string; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100))
  return (
    <div className="text-center">
      <div style={{ ...PJ, color: T.primaryDeep }} className="text-[40px] font-extrabold leading-none">
        {score}
      </div>
      <div className="text-[10.5px] mt-0.5" style={{ color: T.t4 }}>/ {max}</div>
      <div className="h-[10px] rounded-[4px] mt-2.5" style={{ background: '#e8eff2' }}>
        <div className="h-full rounded-r-[4px]" style={{ width: `${pct}%`, background: VIZ.series }} />
      </div>
      <div style={{ ...PJ, color: T.primaryDeep }} className="text-[11.5px] font-extrabold mt-2">
        {verdict}
      </div>
    </div>
  )
}

/* ── shared card ──────────────────────────────────────────────────────────── */

export function VizCard({
  title, subtitle, sample, action, children,
}: {
  title: string
  subtitle?: string
  sample?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[16px] border p-4" style={{ borderColor: T.outline, background: VIZ.surface }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold">{title}</h3>
            {sample && <SampleTag compact />}
          </div>
          {subtitle && <p className="text-[10.5px] mt-0.5" style={{ color: T.t4 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Small label/value row used by the snapshot lists. */
export function Row({
  label, value, sample,
}: { label: string; value: React.ReactNode; sample?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[7px]"
      style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
      <span className="text-[11.5px]" style={{ color: T.t3 }}>{label}</span>
      <span className="flex items-center gap-1.5">
        {sample && <SampleTag compact />}
        <span style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-bold">{value}</span>
      </span>
    </div>
  )
}

export { fmtNum }
