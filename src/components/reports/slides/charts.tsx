'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import {
  ChartConfig, Series, buildBarData, buildLineData, chartIcon, chartSummary,
  SENTIMENT_PALETTES, cloudWordsFor,
} from '@/lib/reports/data/chartData'
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

const Y_TICKS = [100, 75, 50, 25, 0]
const Y_AXIS_W = '5cqw'

/**
 * Chart frame with a clear Y axis (value ticks + gridlines) and X axis labels.
 * The plot (svg) fills the area; gridlines sit behind it.
 */
function ChartFrame({ labels, children }: { labels: string[]; children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        {/* Y axis ticks */}
        <div className="flex flex-col justify-between items-end" style={{ width: Y_AXIS_W, flexShrink: 0, paddingRight: '0.8cqw' }}>
          {Y_TICKS.map(t => (
            <span key={t} style={{ fontSize: '0.95cqw', color: '#b6bcc4', lineHeight: 1, ...PJ }}>{t}</span>
          ))}
        </div>
        {/* Plot */}
        <div className="flex-1 relative" style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
          {Y_TICKS.slice(0, -1).map(t => (
            <div key={t} className="absolute left-0 right-0" style={{ top: `${100 - t}%`, height: '1px', background: '#f1f3f5' }} />
          ))}
          <div className="absolute inset-0">{children}</div>
        </div>
      </div>
      {/* X axis labels */}
      <div className="flex" style={{ marginTop: '0.6cqh' }}>
        <div style={{ width: Y_AXIS_W, flexShrink: 0 }} />
        <div className="flex-1 flex justify-between">
          {labels.map((l, i) => (
            <span key={i} className="truncate" style={{ flex: 1, textAlign: 'center', fontSize: '1.0cqw', fontWeight: 600, color: '#94a3b8', ...PJ }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function MultiLine({ series }: { series: Series[] }) {
  const w = 100, h = 56
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      {series.map(s => {
        const pts = s.data.map((v, i) => [(i / Math.max(s.data.length - 1, 1)) * w, h - (v / 100) * h])
        return (
          <polyline key={s.name} points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={s.color}
            strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        )
      })}
    </svg>
  )
}

function GroupedBars({ labels, series, orientation }: { labels: string[]; series: Series[]; orientation: 'vertical' | 'horizontal' }) {
  const w = 100, h = 56, gGap = 3
  const groups = labels.length
  const n = Math.max(series.length, 1)
  const bGap = 0.6
  if (orientation === 'horizontal') {
    const gH = (h - gGap * (groups - 1)) / groups
    const bh = (gH - bGap * (n - 1)) / n
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
        {labels.map((_, gi) => series.map((s, si) => (
          <rect key={`${gi}-${si}`} x={0} y={gi * (gH + gGap) + si * (bh + bGap)} width={(s.data[gi] / 100) * w} height={bh} rx={0.6} fill={s.color} />
        )))}
      </svg>
    )
  }
  const gW = (w - gGap * (groups - 1)) / groups
  const bw = (gW - bGap * (n - 1)) / n
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      {labels.map((_, gi) => series.map((s, si) => {
        const bh = (s.data[gi] / 100) * h
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

const CLOUD_ANGLES = [0, 0, 0, -8, 8, -5, 5, 0, -3, 6]

// Word cloud — colored by sentiment (positive=green, neutral=slate, negative=red),
// frequency-weighted sizes, and slight per-word rotation for a fuller cloud shape.
function WordCloud({ sentiment }: { sentiment?: string }) {
  const words = cloudWordsFor(sentiment)
    .map(d => ({ ...d, r: whash(d.word) }))
    .sort((a, b) => b.r - a.r)
  // Shrink as the word count grows so "All" (many words) stays inside the box.
  const scale = words.length > 24 ? 0.6 : words.length > 16 ? 0.78 : 1
  return (
    <div className="w-full h-full flex flex-wrap items-center justify-center content-center overflow-hidden" style={{ gap: '0.3cqh 0.9cqw', padding: '0.4cqh 0.5cqw' }}>
      {words.map(({ word, sentiment: sent, r }) => {
        const size = (1.4 + Math.pow(r, 1.5) * 3.8) * scale   // scaled by word count to fit
        const pal = SENTIMENT_PALETTES[sent]
        const color = pal[Math.floor(whash(word + 'c') * pal.length)]
        const rot = CLOUD_ANGLES[Math.floor(whash(word + 'r') * CLOUD_ANGLES.length)]
        return (
          <span
            key={word}
            style={{
              display: 'inline-block',
              transform: `rotate(${rot}deg)`,
              fontSize: `${size}cqw`,
              fontWeight: size > 3.4 ? 800 : size > 2.3 ? 700 : 600,
              color,
              opacity: 0.6 + r * 0.4,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              ...PJ,
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}

function RenderChart({ config, colors }: { config: ChartConfig; colors: CoverColors }) {
  if (config.chartType === 'wordcloud') return <WordCloud sentiment={config.sentiment} />
  const { labels, series } = config.chartType === 'bar' ? buildBarData(config, colors) : buildLineData(config, colors)
  return (
    <div className="w-full h-full flex flex-col">
      <ChartLegend series={series} />
      <div className="flex-1 min-h-0">
        <ChartFrame labels={labels}>
          {config.chartType === 'bar'
            ? <GroupedBars labels={labels} series={series} orientation={config.barOrientation ?? 'vertical'} />
            : <MultiLine series={series} />}
        </ChartFrame>
      </div>
    </div>
  )
}

export function ChartBlock({
  config, colors, editable, onConfigure, placeholderLabel = 'Main chart area',
}: {
  config: ChartConfig | null
  colors: CoverColors
  editable: boolean
  onConfigure?: () => void
  placeholderLabel?: string
}) {
  if (!config) return <Placeholder icon="bar_chart" label={placeholderLabel} editable={editable} onClick={onConfigure} />
  return (
    <Card style={{ padding: '2cqh 1.8cqw', display: 'flex', flexDirection: 'column', gap: '1.4cqh' }}>
      <CardLabel icon={chartIcon(config)} accent={colors.primary} onEdit={editable ? onConfigure : undefined}>{chartSummary(config)}</CardLabel>
      <div className="flex-1 min-h-0"><RenderChart config={config} colors={colors} /></div>
    </Card>
  )
}
