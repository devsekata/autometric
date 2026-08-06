'use client'

import { Card, CardHead } from './ui'
import {
  AI_SYNTHESIS, PERFORMANCE_MATRIX, COMMENT_RELEVANCE,
  RELEVANCE_INSIGHT, TOP_CONTRIBUTORS,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const fmt = (n: number) => n.toLocaleString('en-US')
const MAX_ER = Math.max(...PERFORMANCE_MATRIX.map(r => r.er))
const MATRIX_COLS = 'grid-cols-[1.5fr_0.85fr_0.75fr_0.85fr_0.8fr_2.3fr]'

/* ---------- AI Performance Synthesis ---------- */

export function AISynthesis() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <span className="w-6 h-6 rounded-md bg-gradient-to-br from-[#285D6E] to-[#327488] flex items-center justify-center">
          <span className="material-symbols-outlined text-[15px] text-white">auto_awesome</span>
        </span>
        <h3 style={PJ} className="text-[12.5px] font-bold text-[#111827]">AI Performance Synthesis</h3>
        <span className="text-[9px] font-bold uppercase tracking-wide text-[#285D6E] bg-[#eef5f8] px-1.5 py-0.5 rounded">AI</span>
      </div>
      <p className="px-4 pb-4 text-[13px] leading-relaxed text-[#4b5563]">{AI_SYNTHESIS}</p>
    </Card>
  )
}

/* ---------- Performance Matrix ---------- */

export function PerformanceMatrix() {
  return (
    <Card className="overflow-hidden">
      <CardHead title="Performance Matrix" sub="Reach, engagement & AI insight per niche / pillar" />
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={`grid ${MATRIX_COLS} gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]`}>
            {['Niche / Pillar', 'Reach', 'Likes', 'Comments', 'Eng. Rate', 'AI Insight'].map(h => (
              <span key={h} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
            ))}
          </div>
          {PERFORMANCE_MATRIX.map((r, i) => (
            <div key={r.niche}
              className={`grid ${MATRIX_COLS} gap-2 px-4 py-3 items-center text-[13px] hover:bg-[#fafbfb] ${
                i < PERFORMANCE_MATRIX.length - 1 ? 'border-b border-[#f1f3f4]' : ''
              }`}>
              <div className="min-w-0 pr-2">
                <div style={PJ} className="font-bold text-[#111827] text-[13px] truncate">{r.niche}</div>
                <div className="text-[11px] text-[#285D6E] font-medium truncate">{r.hashtag}</div>
              </div>
              <span className="text-[#374151] tabular-nums">{fmt(r.reach)}</span>
              <span className="text-[#374151] tabular-nums">{fmt(r.likes)}</span>
              <span className="text-[#374151] tabular-nums">{fmt(r.comments)}</span>
              <span className={`tabular-nums font-bold ${r.er === MAX_ER ? 'text-[#3d8a5f]' : 'text-[#111827]'}`}>
                {r.er.toFixed(2)}%
                {r.er === MAX_ER && <span className="ml-1 text-[9px] font-bold uppercase text-[#3d8a5f]">top</span>}
              </span>
              <span className="text-[12px] italic text-[#6b7280] leading-snug">“{r.insight}”</span>
            </div>
          ))}
        </div>
      </div>
      <p className="px-4 py-2.5 text-[10.5px] text-[#9ca3af] border-t border-[#f1f3f4]">*Engagement Rate = (Likes + Comments) / Reach</p>
    </Card>
  )
}

/* ---------- Comment Relevance ---------- */

export function CommentRelevance({ span }: { span?: string }) {
  return (
    <Card span={span} className="flex flex-col">
      <CardHead title="Comment Relevance" metricKey="comment_relevance.tier" sub="Semantic scoring of comments vs captions" />
      <div className="px-4 pb-4 pt-3 flex-1 flex flex-col">
        <div className="flex w-full h-2.5 rounded-full overflow-hidden mb-4">
          {COMMENT_RELEVANCE.map(t => (
            <div key={t.tier} style={{ width: `${t.pct}%`, background: t.color }} title={`${t.tier} · ${t.pct}%`} />
          ))}
        </div>
        <ul className="flex flex-col gap-3.5">
          {COMMENT_RELEVANCE.map(t => (
            <li key={t.tier} className="flex items-start gap-2.5">
              <span className="w-2.5 h-2.5 rounded-sm mt-1 flex-shrink-0" style={{ background: t.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-[#374151]">
                    {t.tier} <span className="text-[#9ca3af] font-normal">({t.range})</span>
                  </span>
                  <span style={PJ} className="text-[13px] font-bold text-[#111827]">{t.pct}%</span>
                </div>
                <p className="text-[11px] text-[#9ca3af] mt-0.5">{t.desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-4">
          <div className="flex items-start gap-2 bg-[#f7f9fa] border border-[#eef0f2] rounded-lg px-3 py-2.5">
            <span className="material-symbols-outlined text-[15px] text-[#285D6E] mt-0.5 flex-shrink-0">lightbulb</span>
            <p className="text-[11.5px] leading-relaxed text-[#6b7280]">{RELEVANCE_INSIGHT}</p>
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ---------- Top Community Contributors ---------- */

export function TopContributors({ span }: { span?: string }) {
  return (
    <Card span={span} className="overflow-hidden">
      <CardHead title="Top Community Contributors" metricKey="community_contributors.composite_score" sub="High engagement frequency & semantic relevance" />
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[1.8fr_0.8fr_1fr_2.2fr] gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]">
            {['User Profile', 'Comments', 'Relevancy', 'Top Content Context'].map(h => (
              <span key={h} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
            ))}
          </div>
          {TOP_CONTRIBUTORS.map((c, i) => (
            <div key={c.username}
              className={`grid grid-cols-[1.8fr_0.8fr_1fr_2.2fr] gap-2 px-4 py-3 items-center text-[13px] hover:bg-[#fafbfb] ${
                i < TOP_CONTRIBUTORS.length - 1 ? 'border-b border-[#f1f3f4]' : ''
              }`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0" style={{ background: c.color }}>{c.initials}</span>
                <div className="min-w-0">
                  <div className="font-semibold text-[#111827] truncate">{c.username}</div>
                  <div className="text-[10.5px] text-[#9ca3af] truncate">{c.tier}</div>
                </div>
              </div>
              <span className="font-semibold text-[#111827] tabular-nums">{c.comments}</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[#f3f4f6] overflow-hidden max-w-[52px]">
                  <div className="h-full rounded-full" style={{ width: `${c.relevancy}%`, background: c.color }} />
                </div>
                <span className="text-[12px] font-bold text-[#374151] tabular-nums">{c.relevancy}%</span>
              </div>
              <span className="text-[12px] italic text-[#6b7280] truncate">“{c.quote}”</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
