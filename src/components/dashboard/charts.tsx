'use client'

import { useId } from 'react'

/* ---------- helpers ---------- */

function buildPath(data: number[], w: number, h: number, pad: number) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = (w - pad * 2) / (data.length - 1)
  return data.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (h - pad * 2) * (1 - (v - min) / span)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

/* ---------- Sparkline (KPI cards) ---------- */

export function Sparkline({ data, color, width = 96, height = 30 }: {
  data: number[]; color: string; width?: number; height?: number
}) {
  const d = buildPath(data, width, height, 3)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- Line / Area chart ---------- */

export function LineChart({ data, color = '#285D6E', height = 200, area = true, labels }: {
  data: number[]; color?: string; height?: number; area?: boolean; labels?: string[]
}) {
  const id = useId()
  const W = 600
  const H = height
  const pad = 12
  const line = buildPath(data, W, H, pad)
  const areaPath = `${line} L${W - pad},${H - pad} L${pad},${H - pad} Z`
  const gridYs = [0.25, 0.5, 0.75]

  return (
    <div className="w-full">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {gridYs.map(g => (
          <line key={g} x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * g} y2={pad + (H - pad * 2) * g}
            stroke="#eef0f2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {area && <path d={areaPath} fill={`url(#g-${id})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
          strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {labels && (
        <div className="flex justify-between mt-2 px-1">
          {labels.map((l, i) => (
            <span key={i} className="text-[10px] text-[#9ca3af]">{l}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Multi-series line chart (shared scale) ---------- */

function niceCeil(n: number) {
  if (n <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(n)))
  const step = p / 5
  return Math.ceil(n / step) * step
}

export function MultiLineChart({ series, labels, height = 220, dots = false, yAxis = false, fmtY }: {
  series: { name: string; color: string; data: number[] }[]
  labels?: string[]; height?: number; dots?: boolean
  yAxis?: boolean; fmtY?: (n: number) => string
}) {
  const W = 600
  const H = height
  const pad = 14
  const all = series.flatMap(s => s.data)
  const min = yAxis ? 0 : Math.min(...all)
  const max = yAxis ? niceCeil(Math.max(...all)) : Math.max(...all)
  const span = max - min || 1
  const n = series[0]?.data.length ?? 0
  const stepX = (W - pad * 2) / Math.max(1, n - 1)
  const gridYs = yAxis ? [0, 0.25, 0.5, 0.75, 1] : [0.25, 0.5, 0.75]
  const ptX = (i: number) => pad + i * stepX
  const ptY = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / span)
  const fy = fmtY ?? ((v: number) => String(v))

  const toPath = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? 'M' : 'L'}${ptX(i).toFixed(1)},${ptY(v).toFixed(1)}`).join(' ')

  return (
    <div className="w-full flex">
      {yAxis && (
        <div className="relative w-12 flex-shrink-0" style={{ height: H }}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <span key={f} className="absolute right-1.5 text-[10px] text-[#9ca3af] -translate-y-1/2 tabular-nums"
              style={{ top: pad + (H - pad * 2) * f }}>{fy(min + span * (1 - f))}</span>
          ))}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="relative" style={{ height: H }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
            {gridYs.map(g => (
              <line key={g} x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * g} y2={pad + (H - pad * 2) * g}
                stroke="#eef0f2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {series.map(s => (
              <path key={s.name} d={toPath(s.data)} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {dots && (
            <div className="absolute inset-0 pointer-events-none">
              {series.map(s => s.data.map((v, i) => (
                <span key={`${s.name}-${i}`} className="absolute w-[7px] h-[7px] rounded-full bg-white -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${(ptX(i) / W) * 100}%`, top: ptY(v), border: `2px solid ${s.color}` }} />
              )))}
            </div>
          )}
        </div>
        {labels && (
          <div className="flex justify-between mt-2 px-1">
            {labels.map((l, i) => <span key={i} className="text-[10px] text-[#9ca3af]">{l}</span>)}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Scatter plot ---------- */

export function ScatterPlot({ points, xMax, yMax, xTicks, yTicks, xLabel, yLabel, color = '#8b7fc7', height = 240 }: {
  points: { x: number; y: number }[]
  xMax: number; yMax: number; xTicks: number[]; yTicks: number[]
  xLabel?: string; yLabel?: string; color?: string; height?: number
}) {
  const W = 600, H = height, padL = 44, padR = 14, padT = 12, padB = 38
  const plotW = W - padL - padR, plotH = H - padT - padB
  const px = (v: number) => padL + (v / xMax) * plotW
  const py = (v: number) => padT + plotH * (1 - v / yMax)
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {yTicks.map(t => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={py(t)} y2={py(t)} stroke="#eef0f2" strokeWidth={1} />
          <text x={padL - 6} y={py(t) + 3} textAnchor="end" className="fill-[#9ca3af]" fontSize={10}>{t}{yMax <= 100 ? '%' : ''}</text>
        </g>
      ))}
      {xTicks.map(t => (
        <text key={t} x={px(t)} y={H - padB + 16} textAnchor="middle" className="fill-[#9ca3af]" fontSize={10}>{t}</text>
      ))}
      {points.map((p, i) => (
        <circle key={i} cx={px(p.x)} cy={py(p.y)} r={5.5} fill={color} fillOpacity={0.55} stroke={color} strokeWidth={1.5} />
      ))}
      {xLabel && <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="fill-[#6b7280]" fontSize={10.5}>{xLabel}</text>}
    </svg>
  )
}

/* ---------- Diverging bars (gained up / lost down) ---------- */

export function DivergingBars({ data, posColor = '#7cc499', negColor = '#e89aa3', height = 240, fmt = (n: number) => String(n) }: {
  data: { label: string; gained: number; lost: number }[]
  posColor?: string; negColor?: string; height?: number; fmt?: (n: number) => string
}) {
  const maxPos = Math.max(...data.map(d => d.gained), 1)
  const maxNeg = Math.max(...data.map(d => d.lost), 1)
  const total = maxPos + maxNeg
  const topFrac = maxPos / total
  return (
    <div className="w-full">
      <div className="flex items-stretch gap-3" style={{ height }}>
        {data.map(d => (
          <div key={d.label} className="flex-1 flex flex-col">
            <div className="flex flex-col justify-end" style={{ height: `${topFrac * 100}%` }}>
              <div className="rounded-t-md mx-auto w-3/4" title={`+${fmt(d.gained)}`}
                style={{ height: `${(d.gained / maxPos) * 100}%`, background: posColor }} />
            </div>
            <div className="border-t border-[#e5e7eb]" />
            <div className="flex flex-col justify-start" style={{ height: `${(1 - topFrac) * 100}%` }}>
              <div className="rounded-b-md mx-auto w-3/4" title={`-${fmt(d.lost)}`}
                style={{ height: `${(d.lost / maxNeg) * 100}%`, background: negColor }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-2">
        {data.map(d => <span key={d.label} className="flex-1 text-center text-[10px] text-[#9ca3af]">{d.label}</span>)}
      </div>
    </div>
  )
}

/* ---------- Combo: bars (left axis) + line (right axis) ---------- */

export function ComboBarLine({ labels, bars, line, barColor = '#e7a6bd', lineColor = '#6c4cd6', leftMax, rightMax, height = 260, fmtLeft = (n: number) => String(n) }: {
  labels: string[]; bars: number[]; line: number[]
  barColor?: string; lineColor?: string; leftMax: number; rightMax: number; height?: number
  fmtLeft?: (n: number) => string
}) {
  const W = 600, H = height, padL = 46, padR = 42, padT = 12, padB = 30
  const plotW = W - padL - padR, plotH = H - padT - padB
  const n = labels.length
  const slot = plotW / n
  const barW = slot * 0.5
  const yL = (v: number) => padT + plotH * (1 - v / leftMax)
  const yR = (v: number) => padT + plotH * (1 - v / rightMax)
  const cx = (i: number) => padL + slot * i + slot / 2
  const linePath = line.map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${yR(v).toFixed(1)}`).join(' ')
  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(leftMax * f))
  const rightTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(rightMax * f))
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {leftTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yL(t)} y2={yL(t)} stroke="#eef0f2" strokeWidth={1} />
          <text x={padL - 6} y={yL(t) + 3} textAnchor="end" className="fill-[#9ca3af]" fontSize={9.5}>{fmtLeft(t)}</text>
        </g>
      ))}
      {rightTicks.map((t, i) => (
        <text key={i} x={W - padR + 6} y={yR(t) + 3} textAnchor="start" className="fill-[#9ca3af]" fontSize={9.5}>{t}</text>
      ))}
      {bars.map((v, i) => (
        <rect key={i} x={cx(i) - barW / 2} y={yL(v)} width={barW} height={Math.max(0, plotH + padT - yL(v))}
          rx={4} fill={barColor} />
      ))}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {line.map((v, i) => <circle key={i} cx={cx(i)} cy={yR(v)} r={4} fill="#fff" stroke={lineColor} strokeWidth={2} />)}
      {labels.map((l, i) => (
        <text key={i} x={cx(i)} y={H - 10} textAnchor="middle" className="fill-[#9ca3af]" fontSize={10}>{l}</text>
      ))}
    </svg>
  )
}

/* ---------- Donut ---------- */

export function Donut({ segments, size = 140, thickness = 18, centerLabel, centerSub, legend = true }: {
  segments: { label: string; value: number; color: string }[]
  size?: number; thickness?: number; centerLabel?: string; centerSub?: string; legend?: boolean
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0

  const ring = (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={thickness} />
        {segments.map(s => {
          const frac = s.value / total
          const dash = `${frac * c} ${c}`
          const el = (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness} strokeDasharray={dash}
              strokeDashoffset={-offset * c} strokeLinecap="butt" />
          )
          offset += frac
          return el
        })}
      </svg>
      {centerLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
          <span className="text-[22px] font-bold text-[#111827] leading-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{centerLabel}</span>
          {centerSub && <span className="text-[10px] text-[#9ca3af] mt-1 leading-tight">{centerSub}</span>}
        </div>
      )}
    </div>
  )

  if (!legend) return <div className="flex justify-center">{ring}</div>

  return (
    <div className="flex items-center gap-4">
      {ring}
      <ul className="flex-1 min-w-0 space-y-1.5">
        {segments.map(s => (
          <li key={s.label} className="flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[#374151] flex-1">{s.label}</span>
            <span className="font-semibold text-[#111827]">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Vertical bars ---------- */

export function BarChart({ bars, height = 180 }: {
  bars: { label: string; value: number; color: string; display: string }[]
  height?: number
}) {
  const max = Math.max(...bars.map(b => b.value)) || 1
  return (
    <div className="flex items-end gap-4 w-full" style={{ height }}>
      {bars.map(b => (
        <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full">
          <span className="text-[11px] font-semibold text-[#374151] mb-1.5">{b.display}</span>
          <div className="w-full rounded-t-md transition-all" style={{
            height: `${Math.max(4, (b.value / max) * (height - 44))}px`,
            background: b.color,
          }} />
          <span className="text-[11px] text-[#9ca3af] mt-2">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Thin horizontal bar (share of voice) ---------- */

export function ShareBar({ value, color, track = '#f3f4f6' }: { value: number; color: string; track?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: track }}>
      <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
    </div>
  )
}

/* ---------- Labeled horizontal bars ---------- */

export function HBars({ items }: {
  items: { label: string; value: number; display: string; color: string; icon?: string }[]
}) {
  const max = Math.max(...items.map(i => i.value)) || 1
  return (
    <div className="flex flex-col gap-3.5">
      {items.map(it => (
        <div key={it.label}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#374151]">
              {it.icon && <span className="material-symbols-outlined text-[16px]" style={{ color: it.color }}>{it.icon}</span>}
              {it.label}
            </span>
            <span className="text-[12px] font-bold text-[#111827]">{it.display}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#f3f4f6] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, background: it.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Heatmap (day × time slot) ---------- */

export function Heatmap({ rows, cols, grid, base = '#285D6E', cellHeight = 34 }: {
  rows: string[]; cols: string[]; grid: number[][]; base?: string; cellHeight?: number
}) {
  return (
    <div className="w-full">
      <div className="flex">
        <div className="w-9 flex-shrink-0" />
        {cols.map(c => (
          <div key={c} className="flex-1 text-center text-[10px] text-[#9ca3af] pb-1.5">{c}</div>
        ))}
      </div>
      {rows.map((r, ri) => (
        <div key={r} className="flex items-center mb-1.5 last:mb-0">
          <div className="w-9 flex-shrink-0 text-[10.5px] font-semibold text-[#6b7280]">{r}</div>
          {grid[ri].map((v, ci) => (
            <div key={ci} className="flex-1 px-0.5">
              <div className="w-full rounded-[5px]"
                style={{ height: cellHeight, background: base, opacity: 0.12 + v * 0.88 }}
                title={`${r} ${cols[ci]} · ${Math.round(v * 100)}%`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
