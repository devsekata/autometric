'use client'

import { useState, useEffect, useRef } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import { SlideChrome, ContentSlide } from '@/lib/reports/data/slideModel'
import { useReportKpi, useReportAI, useReportMetrics, useReportChart, useReportPosts, sectionMetricsFor } from '@/lib/reports/data/metricsContext'
import { kpiDefsForChannel, kpiMetricFor, type KpiMetric } from '@/lib/reports/data/kpiMetrics'
import { TABLE_TYPES, buildTable } from '@/lib/reports/data/tableTypes'
import { resolveLineData, resolveBarData, type ChartConfig } from '@/lib/reports/data/chartData'
import { buildPosts } from '@/lib/reports/data/posts'
import { PLATFORM_META } from '@/components/dashboard/data'

// Resolves to the report's selected font (set as --report-font on the slide root).
export const PJ = { fontFamily: 'var(--report-font, "Plus Jakarta Sans", sans-serif)' } as const

export function Placeholder({ icon, label, editable, onClick }: { icon?: string; label: string; editable: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={editable ? onClick : undefined}
      disabled={!editable}
      className={`w-full h-full flex flex-col items-center justify-center rounded-[1.4cqw] border-2 border-dashed transition-colors ${
        editable ? 'border-[#cbd5e1] text-[#94a3b8] hover:border-[#1e4f49] hover:text-[#1e4f49] hover:bg-[#f2f8f5] cursor-pointer' : 'border-[#dbe1e8] text-[#b6bcc4] cursor-default'
      }`}
      style={{ background: 'rgba(255,255,255,0.45)' }}
    >
      {icon && <span className="material-symbols-outlined" style={{ fontSize: '3.8cqw', marginBottom: '1cqh' }}>{icon}</span>}
      <span style={{ fontSize: '1.35cqw', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', ...PJ }}>{label}</span>
    </button>
  )
}

export function Card({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid #e8ebee', borderRadius: '1.4cqw', boxShadow: '0 1cqh 2.4cqh -1.4cqh rgba(16,24,40,0.18)', height: '100%', ...style }}
    >
      {children}
    </div>
  )
}

export function CardLabel({ children, icon, accent, onEdit }: { children: React.ReactNode; icon?: string; accent?: string; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between" style={{ ...PJ }}>
      <div className="flex items-center min-w-0" style={{ gap: '0.6cqw', fontSize: '1.2cqw', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {icon && <span className="material-symbols-outlined" style={{ fontSize: '1.6cqw', color: accent }}>{icon}</span>}
        <span className="truncate">{children}</span>
      </div>
      {onEdit && (
        <button onClick={onEdit} className="material-symbols-outlined" style={{ fontSize: '1.7cqw', color: '#cbd5e1' }} title="Reconfigure">tune</button>
      )}
    </div>
  )
}

export function Title({ value, editable, onChange }: { value: string; editable: boolean; onChange?: (v: string) => void }) {
  if (editable) {
    return (
      <input
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder="Slide title"
        style={{ fontSize: '2.8cqw', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', background: 'transparent', outline: 'none', width: '100%', ...PJ }}
        className="placeholder:text-slate-300"
      />
    )
  }
  return (
    <div className="truncate" style={{ fontSize: '2.8cqw', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', ...PJ }}>
      {value || 'Untitled slide'}
    </div>
  )
}

export function ChannelBadge({ channel }: { channel: string }) {
  // "All channels" — a compact row of every platform logo.
  if (channel === 'all') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6cqw' }}>
        {(['instagram', 'facebook', 'tiktok'] as const).map(p => (
          <img key={p} src={PLATFORM_META[p].logo} alt={PLATFORM_META[p].label} style={{ width: '2.8cqw', height: '2.8cqw', objectFit: 'contain' }} />
        ))}
      </div>
    )
  }
  const meta = PLATFORM_META[channel as keyof typeof PLATFORM_META]
  if (!meta) return null
  // Logo only — no background, no label.
  return <img src={meta.logo} alt={meta.label} style={{ width: '4cqw', height: '4cqw', objectFit: 'contain' }} />
}

export function InsightsBlock({ value, editable, onChange, label = 'Key insights' }: { value: string; editable: boolean; onChange?: (v: string) => void; label?: string }) {
  const [editing, setEditing] = useState(false)
  const style: React.CSSProperties = { fontSize: '1.45cqw', color: '#475569', lineHeight: 1.55, ...PJ }

  if (!value && !editing) {
    return <Placeholder icon="auto_awesome" label={label === 'Key insights' ? 'AI Key Insights' : label} editable={editable} onClick={() => editable && setEditing(true)} />
  }
  return (
    <Card style={{ padding: '2cqh 1.8cqw', display: 'flex', flexDirection: 'column', gap: '1.4cqh' }}>
      <CardLabel icon="auto_awesome" accent="#1e4f49">{label}</CardLabel>
      <div className="flex-1 min-h-0">
        {editable ? (
          <textarea
            autoFocus={editing && !value}
            value={value}
            onChange={e => onChange?.(e.target.value)}
            placeholder="• Type a key insight per line…"
            style={{ ...style, width: '100%', height: '100%', background: 'transparent', outline: 'none', resize: 'none' }}
            className="placeholder:text-slate-300"
          />
        ) : (
          <div className="whitespace-pre-wrap overflow-hidden" style={{ ...style, height: '100%' }}>{value}</div>
        )}
      </div>
    </Card>
  )
}

// ── AI Key Insights (Gemini analyst) ─────────────────────────────────────────
const AI_COLORS = { primary: '#1e4f49', secondary: '#3d7e96', accent: '#e0a458' }

/** Render **bold** markers as <strong>. */
function renderBold(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 800, color: '#0f172a' }}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  )
}

const kpiRow = (m: KpiMetric) => ({ metric: m.label, value: m.value, change: m.hasDelta === false ? 'n/a' : `${m.delta >= 0 ? '+' : ''}${m.delta}%` })

function chartToData(cfg: ChartConfig | null, chart: ReturnType<typeof useReportChart>, channel: string) {
  if (!cfg) return null
  if (cfg.chartType === 'bar') {
    const { labels, series } = resolveBarData(cfg, chart, channel, AI_COLORS)
    return { type: 'bar', categories: labels, series: series.map(s => ({ metric: s.name, values: s.data })) }
  }
  const { labels, series } = resolveLineData(cfg, chart, channel, AI_COLORS)
  return { type: 'line', axis: labels, series: series.map(s => ({ metric: s.name, values: s.data })) }
}

/** Build the AI payload from what THIS slide actually shows (its table/chart/kpi/posts). */
function gatherSlideData(
  slide: ContentSlide,
  ctx: { kpi: ReturnType<typeof useReportKpi>; table: ReturnType<typeof useReportMetrics>; chart: ReturnType<typeof useReportChart>; posts: ReturnType<typeof useReportPosts> },
) {
  const ch = slide.channel
  const out: Record<string, unknown> = { channel: ch }

  // Overview shows EITHER a chart or a table (visualMode) — read only what's shown.
  const overviewMode = slide.type === 'overview' ? slide.visualMode : null

  // TABLE — dashboard always; overview only when it's showing the table.
  if (slide.table && (slide.type !== 'overview' || overviewMode === 'table')) {
    const built = buildTable(slide.table, sectionMetricsFor(ctx.table, slide.table.type, ch), null)
    out.table = {
      name: TABLE_TYPES[slide.table.type]?.label ?? 'Table',
      rows: built.rows.map(r => {
        const o: Record<string, string> = { row: r.label }
        built.columns.forEach(c => { o[c.label] = r.cells[c.id]?.text ?? '—' })
        return o
      }),
    }
  }
  // CHART — comparison = both sides; overview only when showing the chart; others = main chart.
  if (slide.type === 'comparison') {
    const a = chartToData(slide.chartA, ctx.chart, ch); if (a) out.chartLeft = a
    const b = chartToData(slide.chartB, ctx.chart, ch); if (b) out.chartRight = b
  } else if (slide.type !== 'overview' || overviewMode === 'chart') {
    const c = chartToData(slide.chart, ctx.chart, ch); if (c) out.chart = c
  }
  if (slide.type === 'kpi') {
    out.scorecards = slide.kpiMetrics.map(k => kpiMetricFor(ctx.kpi, ch, k)).filter((m): m is KpiMetric => !!m).map(kpiRow)
  }
  if (slide.type === 'visual') {
    out.posts = buildPosts(slide.postCount, slide.postFilter, { source: ctx.posts?.[ch] ?? undefined, format: slide.postFormat, pillar: slide.postPillar, sortMetric: slide.postSortMetric })
      .map(p => ({ rank: p.id, format: p.format, pillar: p.pillar, ...p.metrics }))
  }
  const has = out.table || out.chart || out.chartLeft || (out.scorecards as unknown[] | undefined)?.length || (out.posts as unknown[] | undefined)?.length
  if (!has) {
    out.metrics = kpiDefsForChannel(ch).map(d => kpiMetricFor(ctx.kpi, ch, d.key)).filter((m): m is KpiMetric => !!m && m.value !== '—').map(kpiRow)
  }
  return out
}

/** Renders the analysis paragraph, auto-shrinking its font to fit the fixed box (matches PPTX fit:'shrink'). */
function AutoFitParagraph({ text, baseCqw, editable, onClick }: { text: string; baseCqw: number; editable: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = `${baseCqw}cqw`
    const avail = el.clientHeight, need = el.scrollHeight
    if (need > avail && avail > 0) el.style.fontSize = `calc(${baseCqw}cqw * ${Math.max(0.72, (avail / need) * 0.985)})`
  })
  return (
    <div ref={ref} onClick={onClick}
      style={{ height: '100%', overflow: 'hidden', fontSize: `${baseCqw}cqw`, color: '#475569', lineHeight: 1.45, cursor: editable ? 'text' : 'default', ...PJ }}>
      {renderBold(text)}
    </div>
  )
}

export function AiInsightBlock({ slide, editable, onChange, label = 'AI Key Insights' }: {
  slide: ContentSlide; editable: boolean; onChange?: (next: ContentSlide) => void; label?: string
}) {
  const kpi = useReportKpi()
  const table = useReportMetrics()
  const chart = useReportChart()
  const posts = useReportPosts()
  const ai = useReportAI()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editingAnalysis, setEditingAnalysis] = useState(false)
  const insight = slide.aiInsight

  async function generate() {
    if (!ai || loading) return
    setLoading(true); setErr(null)
    try {
      const data = gatherSlideData(slide, { kpi, table, chart, posts })
      const res = await fetch(`/api/organizations/${encodeURIComponent(ai.orgId)}/reports/ai-insight`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideType: slide.type, channel: slide.channel, brandName: ai.brandName, period: ai.period, title: slide.title, data }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Gagal generate')
      onChange?.({ ...slide, aiInsight: { analysis: j.analysis || '', recommendations: Array.isArray(j.recommendations) ? j.recommendations : [] } })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal generate')
    } finally { setLoading(false) }
  }

  if (!insight && !slide.insights && !editable) {
    return <Placeholder icon="auto_awesome" label={label} editable={false} />
  }

  const textStyle: React.CSSProperties = { fontSize: '1.4cqw', color: '#475569', lineHeight: 1.5, ...PJ }
  return (
    <Card style={{ padding: '1.7cqh 1.5cqw', display: 'flex', flexDirection: 'column', gap: '1cqh' }}>
      <div className="flex items-center justify-between" style={{ ...PJ }}>
        <span className="flex items-center" style={{ gap: '0.5cqw', fontSize: '1.15cqw', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#1e4f49' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '1.6cqw' }}>auto_awesome</span>{label}
        </span>
        {editable && ai && (
          <button onClick={generate} disabled={loading} title={insight ? 'Regenerate' : 'Generate with AI'}
            className="flex items-center rounded-full transition-colors"
            style={{ gap: '0.4cqw', fontSize: '1cqw', fontWeight: 700, padding: '0.5cqh 1cqw', color: loading ? '#94a3b8' : '#1e4f49', background: '#f2f8f5', border: '1px solid #cfe5dd', ...PJ }}>
            <span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''}`} style={{ fontSize: '1.3cqw' }}>{loading ? 'progress_activity' : 'auto_awesome'}</span>
            {loading ? 'Generating…' : insight ? 'Regenerate' : 'Generate AI'}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
        {insight ? (
          editable && editingAnalysis ? (
            <textarea autoFocus value={insight.analysis}
              onChange={e => onChange?.({ ...slide, aiInsight: { ...insight, analysis: e.target.value } })}
              onBlur={() => setEditingAnalysis(false)}
              style={{ fontSize: '1.3cqw', color: '#475569', lineHeight: 1.45, width: '100%', height: '100%', background: 'transparent', outline: 'none', resize: 'none', ...PJ }} />
          ) : (
            <AutoFitParagraph text={insight.analysis} baseCqw={1.45} editable={editable} onClick={() => editable && setEditingAnalysis(true)} />
          )
        ) : editable ? (
          <textarea value={slide.insights} onChange={e => onChange?.({ ...slide, insights: e.target.value })}
            placeholder="Klik ‘Generate AI’ atau ketik insight manual…"
            style={{ ...textStyle, width: '100%', height: '100%', background: 'transparent', outline: 'none', resize: 'none' }}
            className="placeholder:text-slate-300" />
        ) : (
          <div className="whitespace-pre-wrap" style={{ ...textStyle }}>{slide.insights}</div>
        )}
      </div>
      {err && <span style={{ fontSize: '1cqw', color: '#dc2626', ...PJ }}>{err}</span>}
    </Card>
  )
}

export function Footer({ chrome, colors }: { chrome: SlideChrome; colors: CoverColors }) {
  return (
    <div className="flex items-center" style={{ paddingTop: '1.2cqh' }}>
      {/* Left — logo · period (no box) */}
      <div className="flex items-center flex-1" style={{ gap: '1.2cqw' }}>
        {chrome.logoDataUrl ? (
          <img src={chrome.logoDataUrl} alt="logo" style={{ height: '4.6cqh', maxWidth: '14cqw', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: '1.9cqw', fontWeight: 800, color: colors.primary, ...PJ }}>{chrome.brandName.slice(0, 2).toUpperCase()}</span>
        )}
        <span className="rounded-full" style={{ width: '0.9cqw', height: '0.9cqw', background: colors.primary }} />
        <span style={{ fontSize: '1.5cqw', fontWeight: 600, color: '#475569', ...PJ }}>{chrome.period}</span>
      </div>

      {/* Center — prepared by */}
      <div className="flex-1 flex flex-col items-center" style={{ gap: '0.2cqh' }}>
        {chrome.preparedBy && (
          <>
            <span style={{ fontSize: '1.05cqw', color: '#94a3b8', ...PJ }}>Prepared by</span>
            <span style={{ fontSize: '1.3cqw', fontWeight: 700, color: '#475569', ...PJ }}>{chrome.preparedBy}</span>
          </>
        )}
      </div>

      {/* Right — page (no pill) */}
      <div className="flex-1 flex items-center justify-end" style={{ gap: '0.5cqw', ...PJ }}>
        <span style={{ fontSize: '1.55cqw', fontWeight: 800, color: colors.primary }}>{chrome.pageNumber}</span>
        <span style={{ fontSize: '1.55cqw', color: '#cbd5e1' }}>/</span>
        <span style={{ fontSize: '1.55cqw', color: '#94a3b8' }}>{chrome.totalPages}</span>
      </div>
    </div>
  )
}
