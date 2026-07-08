'use client'

import { useState } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import { SlideChrome, ContentSlide, RecommendationType } from '@/lib/reports/data/slideModel'
import { useReportKpi, useReportAI } from '@/lib/reports/data/metricsContext'
import { kpiDefsForChannel, kpiMetricFor, type KpiMetric, type ReportKpiMetrics } from '@/lib/reports/data/kpiMetrics'
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
const REC_STYLE: Record<RecommendationType, { color: string; bg: string }> = {
  SCALE:   { color: '#15803d', bg: '#f0fdf4' },
  REFINE:  { color: '#b45309', bg: '#fffbeb' },
  EXPLORE: { color: '#1d4ed8', bg: '#eff6ff' },
  STOP:    { color: '#b91c1c', bg: '#fef2f2' },
}

/** Render **bold** markers as <strong>. */
function renderBold(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 800, color: '#0f172a' }}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  )
}

/** Compact, real metric payload (channel KPIs with value + MoM change) for the AI. */
function gatherSlideData(slide: ContentSlide, kpi: ReportKpiMetrics | null) {
  const metrics = kpiDefsForChannel(slide.channel)
    .map(d => kpiMetricFor(kpi, slide.channel, d.key))
    .filter((m): m is KpiMetric => !!m && m.value !== '—' && m.value !== '')
    .map(m => ({ metric: m.label, value: m.value, change: m.hasDelta === false ? 'n/a' : `${m.delta >= 0 ? '+' : ''}${m.delta}%` }))
  return { channel: slide.channel, metrics }
}

export function AiInsightBlock({ slide, editable, onChange, label = 'AI Key Insights' }: {
  slide: ContentSlide; editable: boolean; onChange?: (next: ContentSlide) => void; label?: string
}) {
  const kpi = useReportKpi()
  const ai = useReportAI()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editingAnalysis, setEditingAnalysis] = useState(false)
  const insight = slide.aiInsight

  async function generate() {
    if (!ai || loading) return
    setLoading(true); setErr(null)
    try {
      const data = gatherSlideData(slide, kpi)
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

      <div className="flex-1 min-h-0" style={{ display: 'flex', flexDirection: 'column', gap: '0.7cqh', overflowY: 'auto', overflowX: 'hidden', paddingRight: '0.4cqw' }}>
        {insight ? (
          <>
            {editable && editingAnalysis ? (
              <textarea autoFocus value={insight.analysis}
                onChange={e => onChange?.({ ...slide, aiInsight: { ...insight, analysis: e.target.value } })}
                onBlur={() => setEditingAnalysis(false)}
                style={{ fontSize: '1.3cqw', color: '#475569', lineHeight: 1.4, width: '100%', minHeight: '7cqh', flexShrink: 0, background: 'transparent', outline: 'none', resize: 'none', ...PJ }} />
            ) : (
              <div onClick={() => editable && setEditingAnalysis(true)} style={{ fontSize: '1.3cqw', color: '#475569', lineHeight: 1.4, flexShrink: 0, cursor: editable ? 'text' : 'default', ...PJ }}>
                {renderBold(insight.analysis)}
              </div>
            )}
            {insight.recommendations.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45cqh', flexShrink: 0 }}>
                {insight.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start" style={{ gap: '0.6cqw' }}>
                    <span style={{ flexShrink: 0, fontSize: '0.78cqw', fontWeight: 800, letterSpacing: '0.02em', color: REC_STYLE[r.type].color, background: REC_STYLE[r.type].bg, borderRadius: '0.4cqw', padding: '0.2cqh 0.55cqw', ...PJ }}>{r.type}</span>
                    <span style={{ fontSize: '1.12cqw', color: '#334155', lineHeight: 1.32, flex: 1, ...PJ }}>{r.text}</span>
                    {editable && (
                      <button onClick={() => onChange?.({ ...slide, aiInsight: { ...insight, recommendations: insight.recommendations.filter((_, j) => j !== i) } })}
                        className="material-symbols-outlined" style={{ fontSize: '1.1cqw', color: '#cbd5e1', flexShrink: 0 }}>close</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
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
