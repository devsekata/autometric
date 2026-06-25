'use client'

import { useState } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide } from '@/lib/reports/data/slideModel'
import { POST_COUNTS, POST_FILTERS, POST_METRICS, buildPosts, metricLabel } from '@/lib/reports/data/posts'
import { PJ, InsightsBlock } from './parts'

function hue(id: number) { return (id * 47) % 360 }

function PostCard({ id, tag, metrics, postMetrics, count }: { id: number; tag?: 'TOP' | 'LOW'; metrics: Record<string, string>; postMetrics: string[]; count: number }) {
  const labelFs = count === 4 ? '1.05cqw' : count === 6 ? '0.9cqw' : '0.78cqw'
  const h = hue(id)
  return (
    <div className="h-full flex flex-col rounded-[1cqw] overflow-hidden bg-white border border-[#e8ebee]" style={{ boxShadow: '0 1cqh 2cqh -1.4cqh rgba(16,24,40,0.18)' }}>
      {/* Image placeholder */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, hsl(${h} 45% 88%), hsl(${(h + 40) % 360} 45% 80%))` }}>
        <span className="material-symbols-outlined" style={{ fontSize: '3cqw', color: 'rgba(255,255,255,0.85)' }}>image</span>
        {tag && (
          <span style={{ position: 'absolute', top: '0.6cqh', left: '0.5cqw', fontSize: '0.8cqw', fontWeight: 800, color: '#fff', padding: '0.2cqh 0.7cqw', borderRadius: '999px', background: tag === 'TOP' ? '#16a34a' : '#e11d48', ...PJ }}>{tag}</span>
        )}
      </div>
      {/* Stats */}
      <div className="shrink-0" style={{ padding: count === 4 ? '0.9cqh 0.8cqw' : '0.7cqh 0.6cqw', borderTop: '1px solid #f1f3f5' }}>
        <div className="flex items-center justify-between" style={{ paddingBottom: '0.5cqh', marginBottom: '0.5cqh', borderBottom: '1px solid #f1f3f5' }}>
          <span style={{ fontSize: labelFs, fontWeight: 800, color: '#334155', ...PJ }}>#{id}</span>
          <span className="material-symbols-outlined" style={{ fontSize: '1.2cqw', color: '#94a3b8' }}>open_in_new</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: count === 4 ? '0.5cqh' : '0.35cqh', columnGap: '0.6cqw' }}>
          {postMetrics.map(mid => {
            const isER = mid === 'er'
            const v = metrics[mid] ?? '—'
            return (
              <span key={mid} className="contents">
                <span className="truncate" style={{ fontSize: labelFs, fontWeight: 500, color: '#94a3b8', ...PJ }}>{metricLabel(mid)}</span>
                <span style={{ fontSize: labelFs, fontWeight: isER ? 800 : 600, textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: isER ? (parseFloat(v) > 2.5 ? '#16a34a' : '#f59e0b') : '#334155' }}>{v}</span>
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Visual Analysis body — a grid of post cards (media + metrics) over a notes panel.
 * Header & footer come from the slide shell (SlidePreview).
 */
export default function VisualSlide({
  slide, editable, onChange,
}: {
  slide: ContentSlide
  colors: CoverColors
  editable: boolean
  onChange?: (next: ContentSlide) => void
}) {
  const [cfgOpen, setCfgOpen] = useState(false)
  const count = slide.postCount
  const posts = buildPosts(count, slide.postFilter)
  const cols = count === 4 ? 'repeat(4, 1fr)' : count === 6 ? 'repeat(6, 1fr)' : 'repeat(8, 1fr)'

  const toggleMetric = (id: string) => {
    const set = new Set(slide.postMetrics)
    if (set.has(id)) set.delete(id); else set.add(id)
    onChange?.({ ...slide, postMetrics: [...set] })
  }

  return (
    <>
      <div className="flex-1 min-h-0 relative">
        {editable && (
          <button
            onClick={() => setCfgOpen(true)}
            title="Content settings"
            className="absolute z-10 flex items-center justify-center rounded-[0.5cqw] bg-white border border-[#e2e8f0] text-[#94a3b8] hover:text-[#1e4f49] hover:border-[#cbd5e1] shadow-sm transition-colors"
            style={{ top: '-3cqh', right: 0, width: '2.6cqw', height: '2.6cqw' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '1.5cqw' }}>tune</span>
          </button>
        )}
        <div className="h-full" style={{ display: 'grid', gridTemplateColumns: cols, gap: count === 4 ? '1.2cqw' : count === 6 ? '0.9cqw' : '0.7cqw' }}>
          {posts.map((p, i) => (
            <PostCard key={i} id={p.id} tag={p.tag} metrics={p.metrics} postMetrics={slide.postMetrics} count={count} />
          ))}
        </div>
      </div>

      <div style={{ height: '18cqh', flexShrink: 0 }}>
        <InsightsBlock value={slide.insights} editable={editable} onChange={v => onChange?.({ ...slide, insights: v })} label="Visual strategy notes & insights" />
      </div>

      {/* Config modal (fixed → px, not cq) */}
      {cfgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCfgOpen(false)}>
          <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[460px] bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.30)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 style={PJ} className="text-[16px] font-bold text-[#0f172a]">Visual content</h3>
                <p className="text-[12px] text-[#94a3b8] mt-0.5">Filter, number of posts & metrics.</p>
              </div>
              <button onClick={() => setCfgOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <p style={PJ} className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-2">Filter</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {POST_FILTERS.map(f => (
                <button key={f.id} onClick={() => onChange?.({ ...slide, postFilter: f.id })} style={PJ}
                  className={`py-2.5 rounded-lg border text-[12px] font-semibold transition-all ${slide.postFilter === f.id ? 'border-[#1e4f49] bg-[#f2f8f5] text-[#1e4f49]' : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#334155]'}`}>
                  {f.label}
                </button>
              ))}
            </div>

            <p style={PJ} className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-2">Posts</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {POST_COUNTS.map(n => (
                <button key={n} onClick={() => onChange?.({ ...slide, postCount: n })} style={PJ}
                  className={`py-2.5 rounded-lg border text-[13px] font-bold transition-all ${count === n ? 'border-[#1e4f49] bg-[#f2f8f5] text-[#1e4f49]' : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#334155]'}`}>
                  {n}
                </button>
              ))}
            </div>

            <p style={PJ} className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-2">Metrics</p>
            <div className="grid grid-cols-3 gap-2">
              {POST_METRICS.map(m => {
                const on = slide.postMetrics.includes(m.id)
                return (
                  <button key={m.id} onClick={() => toggleMetric(m.id)} style={PJ}
                    className={`py-2 rounded-lg border text-[12px] font-medium transition-all ${on ? 'border-[#1e4f49] bg-[#f2f8f5] text-[#1e4f49]' : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#64748b]'}`}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
