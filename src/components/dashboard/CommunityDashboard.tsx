'use client'

import { Card, CardHead, SectionHeader, FlexKpiCard, Callout } from './ui'
import { MultiLineChart } from './charts'
import DashboardChrome from './DashboardChrome'
import {
  COMMUNITY_KPIS, COMMENT_VOLUME, COMMENT_VOLUME_LABELS, COMMENT_BY_HOUR,
  COMMENT_PRIME_INSIGHT, COMMUNITY_CONTRIBUTORS, PLATFORM_META, PALETTE,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const TIER_STYLE: Record<string, string> = {
  'Super Fan': 'text-[#7a4fb5] bg-[#f3eefb]',
  Active:      'text-[#3d8a5f] bg-[#e7f3ed]',
  Casual:      'text-[#6b7280] bg-[#f3f4f6]',
}

/* 24-hour comment activity, prime window (18:00–22:00) emphasised. */
function HourBars() {
  const W = 600, H = 230, padL = 36, padR = 8, padT = 12, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB
  const top = 3000
  const slot = plotW / 24
  const barW = slot * 0.66
  const y = (v: number) => padT + plotH * (1 - v / top)
  const yTicks = [0, 500, 1000, 1500, 2000, 2500, 3000]
  const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {yTicks.map(t => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#eef0f2" strokeWidth={1} />
          <text x={padL - 5} y={y(t) + 3} textAnchor="end" className="fill-[#9ca3af]" fontSize={9.5}>{fmt(t)}</text>
        </g>
      ))}
      {COMMENT_BY_HOUR.map((v, i) => {
        const peak = i >= 18 && i <= 22
        return <rect key={i} x={padL + slot * i + (slot - barW) / 2} y={y(v)} width={barW}
          height={Math.max(0, padT + plotH - y(v))} rx={3} fill={peak ? '#6c4cd6' : '#bcaee8'} />
      })}
      {COMMENT_BY_HOUR.map((_, i) => i % 2 === 0 && (
        <text key={i} x={padL + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="fill-[#9ca3af]" fontSize={9}>
          {String(i).padStart(2, '0')}:00
        </text>
      ))}
    </svg>
  )
}

const LB_COLS = 'grid-cols-[48px_minmax(150px,2fr)_72px_90px_120px_96px_96px]'
const LB_HEADS = ['Rank', 'Username', 'Platform', 'Comments', 'Likes Received', 'Avg Replies', 'Tier']

export default function CommunityDashboard() {
  return (
    <DashboardChrome title="Community" subtitle="Comment activity & your most engaged audience">
      {() => (
        <>
          <SectionHeader icon="diversity_3" first>Performance</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {COMMUNITY_KPIS.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
            <Card className="flex flex-col">
              <CardHead title="Comment Volume by Platform" sub="Comments tracked per week" />
              <div className="flex items-center justify-center gap-5 pb-1">
                {COMMENT_VOLUME.map(s => (
                  <span key={s.name} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#6b7280]">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}
                  </span>
                ))}
              </div>
              <div className="px-4 pb-4 pt-1 flex-1">
                <MultiLineChart series={COMMENT_VOLUME} labels={COMMENT_VOLUME_LABELS} height={250} dots />
              </div>
            </Card>

            <Card className="flex flex-col">
              <CardHead title="Comment Activity by Hour of Day" sub="When your audience comments (WIB)" />
              <div className="px-4 pb-3 pt-3">
                <HourBars />
              </div>
              <div className="mx-4 mb-4 mt-auto">
                <Callout tone="success" title="Prime Window">{COMMENT_PRIME_INSIGHT}</Callout>
              </div>
            </Card>
          </div>

          <SectionHeader icon="leaderboard">Top Commenters — Community Leaderboard</SectionHeader>
          <Card className="overflow-hidden">
            <CardHead title="Top Commenters — Community Leaderboard" sub="comment_username · likes_count · replies_count" />
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className={`grid ${LB_COLS} gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]`}>
                  {LB_HEADS.map((h, i) => (
                    <span key={i} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
                  ))}
                </div>
                {COMMUNITY_CONTRIBUTORS.map((c, i) => (
                  <div key={c.username}
                    className={`grid ${LB_COLS} gap-2 px-4 py-3.5 items-center text-[13px] hover:bg-[#fafbfb] ${
                      i < COMMUNITY_CONTRIBUTORS.length - 1 ? 'border-b border-[#f1f3f4]' : ''
                    }`}>
                    <span style={PJ} className="text-[13px] font-bold text-[#6c4cd6] tabular-nums">#{c.rank}</span>
                    <span className="font-medium text-[#374151] truncate">{c.username}</span>
                    <span className="inline-flex items-center justify-center text-[10px] font-bold text-white rounded px-1.5 py-0.5 w-fit"
                      style={{ background: PLATFORM_META[c.platform].color }}>{PLATFORM_META[c.platform].short}</span>
                    <span className="font-semibold text-[#111827] tabular-nums">{c.comments}</span>
                    <span className="text-[#374151] tabular-nums">{c.likes}</span>
                    <span className="text-[#374151] tabular-nums">{c.daily}</span>
                    <span className={`inline-flex items-center justify-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full w-fit ${TIER_STYLE[c.tier]}`}>{c.tier}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}
    </DashboardChrome>
  )
}
