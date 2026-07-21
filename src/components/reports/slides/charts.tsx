'use client'

import { useEffect, useState } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import {
  ChartConfig, Series, LineSeries, BarSeries, resolveBarData, resolveLineData, chartIcon, chartSummary,
  SENTIMENT_PALETTES,
} from '@/lib/reports/data/chartData'
import { AxisScale, compactNum, cloudWordsFrom, CloudWordData } from '@/lib/reports/data/chartTypes'
import { computeWordCloud, WC_W, WC_H, WC_FONT, type PlacedWord } from '@/lib/reports/data/wordcloudLayout'
import { useReportChart } from '@/lib/reports/data/metricsContext'
import { PJ, Card, CardLabel, Placeholder } from './parts'

function ChartLegend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap" style={{ gap: '0.6cqh 1.6cqw', marginBottom: '1cqh' }}>
      {series.map(s => (
        <div key={s.name} className="flex items-center" style={{ gap: '0.5cqw' }}>
          <span style={{ width: '1.2cqw', height: '1.2cqw', borderRadius: '999px', background: s.color }} />
          <span style={{ fontSize: '1.1cqw', fontWeight: 600, color: '#64748b', ...PJ }}>{s.name}</span>
        </div>
      ))}
    </div>
  )
}

const Y_AXIS_W = '5cqw'
const BAR_SCALE: AxisScale = { min: 0, max: 100, ticks: [100, 75, 50, 25, 0] }

interface Axis { scale: AxisScale; color: string }

// Show ~8 x-labels max; blank the rest so a 30-day month doesn't crowd the axis.
function sampleLabels(labels: string[]): string[] {
  if (labels.length <= 8) return labels
  const step = Math.ceil(labels.length / 7)
  return labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? l : ''))
}

// Vertical axis ticks (real values, colored to match the series they scale).
function AxisTicks({ axis, side }: { axis: Axis; side: 'left' | 'right' }) {
  return (
    <div
      className={`flex flex-col justify-between ${side === 'left' ? 'items-end' : 'items-start'}`}
      style={{ width: Y_AXIS_W, flexShrink: 0, [side === 'left' ? 'paddingRight' : 'paddingLeft']: '0.8cqw' }}
    >
      {axis.scale.ticks.map((t, i) => (
        <span key={i} style={{ fontSize: '0.95cqw', color: axis.color, opacity: 0.85, lineHeight: 1, ...PJ }}>{compactNum(t)}</span>
      ))}
    </div>
  )
}

/**
 * Chart frame with a real value axis on the left (series[0]) and, when a second
 * metric is present, a second value axis on the right (series[1]) — dual-axis so
 * two metrics of very different magnitude each stay readable. Gridlines follow
 * the left axis; x-axis labels are sampled to avoid crowding.
 *
 * For HORIZONTAL bars the axes swap: category labels move to the left (Y) and the
 * value ticks run along the bottom (X), with vertical gridlines.
 */
function ChartFrame({ labels, left, right, horizontal, children }: { labels: string[]; left: Axis; right?: Axis; horizontal?: boolean; children: React.ReactNode }) {
  const ticks = left.scale.ticks
  if (horizontal) {
    const valTicks = [...ticks].reverse() // min→max, left→right along the bottom value axis
    return (
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0 flex">
          {/* category axis (left) — aligned to the horizontal bands */}
          <div className="flex flex-col" style={{ width: Y_AXIS_W, flexShrink: 0, paddingRight: '0.8cqw' }}>
            {labels.map((l, i) => (
              <span key={i} className="truncate flex items-center justify-end" style={{ flex: 1, fontSize: '0.95cqw', fontWeight: 600, color: '#94a3b8', ...PJ }} title={l}>{l}</span>
            ))}
          </div>
          {/* plot with vertical gridlines */}
          <div className="flex-1 relative" style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
            {ticks.slice(1, -1).map((_, i) => (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: `${((i + 1) / (ticks.length - 1)) * 100}%`, width: '1px', background: '#f1f3f5' }} />
            ))}
            <div className="absolute inset-0">{children}</div>
          </div>
        </div>
        {/* value axis (bottom) */}
        <div className="flex" style={{ marginTop: '0.6cqh' }}>
          <div style={{ width: Y_AXIS_W, flexShrink: 0 }} />
          <div className="flex-1 flex justify-between">
            {valTicks.map((t, i) => (
              <span key={i} style={{ fontSize: '0.95cqw', color: left.color, opacity: 0.85, ...PJ }}>{compactNum(t)}</span>
            ))}
          </div>
        </div>
      </div>
    )
  }
  const shown = sampleLabels(labels)
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <AxisTicks axis={left} side="left" />
        <div className="flex-1 relative" style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
          {ticks.slice(1, -1).map((_, i) => (
            <div key={i} className="absolute left-0 right-0" style={{ top: `${((i + 1) / (ticks.length - 1)) * 100}%`, height: '1px', background: '#f1f3f5' }} />
          ))}
          <div className="absolute inset-0">{children}</div>
        </div>
        {right && <AxisTicks axis={right} side="right" />}
      </div>
      <div className="flex" style={{ marginTop: '0.6cqh' }}>
        <div style={{ width: Y_AXIS_W, flexShrink: 0 }} />
        <div className="flex-1 flex justify-between">
          {shown.map((l, i) => (
            <span key={i} className="truncate" style={{ flex: 1, textAlign: 'center', fontSize: '1.0cqw', fontWeight: 600, color: '#94a3b8', ...PJ }}>{l}</span>
          ))}
        </div>
        {right && <div style={{ width: Y_AXIS_W, flexShrink: 0 }} />}
      </div>
    </div>
  )
}

// Multi-line plot — each series maps against its OWN scale (dual-axis), so a
// large-magnitude metric and a small one both fill the plot height.
function MultiLine({ series }: { series: LineSeries[] }) {
  const w = 100, h = 56
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      {series.map(s => {
        const span = (s.scale.max - s.scale.min) || 1
        const pts = s.data.map((v, i) => [(i / Math.max(s.data.length - 1, 1)) * w, h - ((v - s.scale.min) / span) * h])
        return (
          <polyline key={s.name} points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={s.color}
            strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        )
      })}
    </svg>
  )
}

// Bars are drawn as a fraction of the shared value axis (scale.max), so every
// series reads in the same true units from a zero baseline.
function GroupedBars({ labels, series, orientation }: { labels: string[]; series: BarSeries[]; orientation: 'vertical' | 'horizontal' }) {
  const w = 100, h = 56, gGap = 3
  const groups = labels.length
  const n = Math.max(series.length, 1)
  const bGap = 0.6
  const frac = (s: BarSeries, gi: number) => Math.max(0, Math.min(1, (s.data[gi] ?? 0) / (s.scale.max || 1)))
  if (orientation === 'horizontal') {
    const gH = (h - gGap * (groups - 1)) / groups
    const bh = (gH - bGap * (n - 1)) / n
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
        {labels.map((_, gi) => series.map((s, si) => (
          <rect key={`${gi}-${si}`} x={0} y={gi * (gH + gGap) + si * (bh + bGap)} width={frac(s, gi) * w} height={bh} rx={0.6} fill={s.color} />
        )))}
      </svg>
    )
  }
  const gW = (w - gGap * (groups - 1)) / groups
  const bw = (gW - bGap * (n - 1)) / n
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      {labels.map((_, gi) => series.map((s, si) => {
        const bh = frac(s, gi) * h
        return <rect key={`${gi}-${si}`} x={gi * (gW + gGap) + si * (bw + bGap)} y={h - bh} width={bw} height={bh} rx={0.6} fill={s.color} />
      }))}
    </svg>
  )
}

// stable 0..1 from a string
function whash(s: string): number {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0
  return (x % 1000) / 1000
}

// Word cloud — real words (l2_gold.post_wordcloud) packed by d3-cloud (glyph-level
// collision, Wordle structure), colored by the source post's dominant sentiment
// (positive=green, neutral=slate, negative=red). The layout runs in an effect
// (d3-cloud needs a browser canvas); the same function backs the PPTX export, so
// preview and export match.
function WordCloud({ words }: { words: CloudWordData[] }) {
  const [placed, setPlaced] = useState<PlacedWord[]>([])
  const sig = words.map(w => `${w.word}:${w.frequency}:${w.sentiment}`).join('|')
  useEffect(() => {
    setPlaced(computeWordCloud(words))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return (
    <svg viewBox={`0 0 ${WC_W} ${WC_H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ display: 'block' }}>
      {placed.map(p => {
        const pal = SENTIMENT_PALETTES[p.sentiment]
        const color = pal[Math.floor(whash(p.word + 'c') * pal.length)]
        return (
          <text
            key={p.word}
            textAnchor="middle"
            transform={`translate(${p.x.toFixed(2)},${p.y.toFixed(2)})${p.rotate ? ` rotate(${p.rotate})` : ''}`}
            fontSize={p.fontSize}
            fontWeight={p.weight}
            fontFamily={WC_FONT}
            fill={color}
          >
            {p.word}
          </text>
        )
      })}
    </svg>
  )
}

// Empty state — shown when the brand+period has no real data (never dummy).
function NoData({ label }: { label: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center" style={{ color: '#b6bcc4' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '2.8cqw' }}>data_usage</span>
      <span style={{ fontSize: '1.15cqw', fontWeight: 600, marginTop: '0.5cqh', ...PJ }}>{label}</span>
    </div>
  )
}

function RenderChart({ config, colors, channel }: { config: ChartConfig; colors: CoverColors; channel: string }) {
  const chartCtx = useReportChart()
  const noDataLabel = chartCtx === null ? 'Loading…' : 'No data for this period'

  // Word cloud — real words scoped to brand+period, colored by post sentiment.
  if (config.chartType === 'wordcloud') {
    const words = cloudWordsFrom(chartCtx, channel, config.sentiment)
    if (!words.length) return <NoData label={noDataLabel} />
    return <WordCloud words={words} />
  }

  if (config.chartType === 'bar') {
    // Small multiples: one mini bar chart per metric (category members on X, its
    // own real value axis) — so mixed-magnitude metrics each read in true units.
    const { labels, series } = resolveBarData(config, chartCtx, channel, colors)
    if (!series.length) return <NoData label={noDataLabel} />
    return (
      <div className="w-full h-full flex" style={{ gap: '2cqw' }}>
        {series.map(s => (
          <div key={s.name} className="flex-1 min-w-0 flex flex-col">
            <div className="truncate" style={{ fontSize: '1.05cqw', fontWeight: 700, color: '#64748b', textAlign: 'center', marginBottom: '0.8cqh', ...PJ }}>{s.name}</div>
            <div className="flex-1 min-h-0">
              <ChartFrame labels={labels} left={{ scale: s.scale, color: '#b6bcc4' }} horizontal={config.barOrientation === 'horizontal'}>
                <GroupedBars labels={labels} series={[s]} orientation={config.barOrientation ?? 'vertical'} />
              </ChartFrame>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const { labels, series } = resolveLineData(config, chartCtx, channel, colors)
  if (!series.length) return <NoData label={noDataLabel} />
  const left = series[0]
  const right = series.length === 2 ? series[1] : undefined   // dual-axis for a plain 2-metric line
  return (
    <div className="w-full h-full flex flex-col">
      <ChartLegend series={series} />
      <div className="flex-1 min-h-0">
        <ChartFrame
          labels={labels}
          left={{ scale: left.scale, color: left.color }}
          right={right ? { scale: right.scale, color: right.color } : undefined}
        >
          <MultiLine series={series} />
        </ChartFrame>
      </div>
    </div>
  )
}

// Chart card subtitle — resolves org custom-metric ids to their labels (from context).
function ChartSummaryText({ config }: { config: ChartConfig }) {
  const ctx = useReportChart()
  const labelOf = (id: string) => ctx?.customMetrics?.find(c => c.id === id)?.label
  return <>{chartSummary(config, labelOf)}</>
}

export function ChartBlock({
  config, colors, channel = 'instagram', editable, onConfigure, placeholderLabel = 'Main chart area',
}: {
  config: ChartConfig | null
  colors: CoverColors
  channel?: string
  editable: boolean
  onConfigure?: () => void
  placeholderLabel?: string
}) {
  if (!config) return <Placeholder icon="bar_chart" label={placeholderLabel} editable={editable} onClick={onConfigure} />
  return (
    <Card style={{ padding: '2cqh 1.8cqw', display: 'flex', flexDirection: 'column', gap: '1.4cqh' }}>
      <CardLabel icon={chartIcon(config)} accent={colors.primary} onEdit={editable ? onConfigure : undefined}><ChartSummaryText config={config} /></CardLabel>
      <div className="flex-1 min-h-0"><RenderChart config={config} colors={colors} channel={channel} /></div>
    </Card>
  )
}
