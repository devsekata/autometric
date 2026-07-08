'use client'

import { useEffect, useState } from 'react'
import { Card, CardHead, SectionHeader, FlexKpiCard, Callout } from './ui'
import { MultiLineChart } from './charts'
import DashboardChrome, { type ChromeState } from './DashboardChrome'
import { PLATFORM_META, PALETTE, type PlatformFilter, type Period } from './data'
import type { CommunityPayload } from '@/lib/dashboard/community'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const TIER_STYLE: Record<string, string> = {
  'Super Fan': 'text-[#7a4fb5] bg-[#f3eefb]',
  Active:      'text-[#3d8a5f] bg-[#e7f3ed]',
  Casual:      'text-[#6b7280] bg-[#f3f4f6]',
}

/* 24-hour comment activity; peak window (primeFrom..primeTo) emphasised. */
function HourBars({ hours, primeFrom, primeTo }: { hours: number[]; primeFrom: number; primeTo: number }) {
  const W = 600, H = 230, padL = 36, padR = 8, padT = 12, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB
  const peakMax = Math.max(1, ...hours)
  const p = Math.pow(10, Math.floor(Math.log10(peakMax)))
  const top = Math.max(p, Math.ceil(peakMax / p) * p)
  const slot = plotW / 24
  const barW = slot * 0.66
  const y = (v: number) => padT + plotH * (1 - v / top)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(top * f))
  const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {yTicks.map(t => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#eef0f2" strokeWidth={1} />
          <text x={padL - 5} y={y(t) + 3} textAnchor="end" className="fill-[#9ca3af]" fontSize={9.5}>{fmt(t)}</text>
        </g>
      ))}
      {hours.map((v, i) => {
        const peak = i >= primeFrom && i <= primeTo
        return <rect key={i} x={padL + slot * i + (slot - barW) / 2} y={y(v)} width={barW}
          height={Math.max(0, padT + plotH - y(v))} rx={3} fill={peak ? '#6c4cd6' : '#bcaee8'} />
      })}
      {hours.map((_, i) => i % 2 === 0 && (
        <text key={i} x={padL + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="fill-[#9ca3af]" fontSize={9}>
          {String(i).padStart(2, '0')}:00
        </text>
      ))}
    </svg>
  )
}

const LB_COLS = 'grid-cols-[48px_minmax(150px,2fr)_72px_90px_120px_96px_96px]'
const LB_HEADS = ['Rank', 'Username', 'Platform', 'Comments', 'Likes Received', 'Avg Replies', 'Tier']

const platformParam = (p: PlatformFilter) => (p === 'All' ? 'all' : p)

export default function CommunityDashboard({ orgId }: { orgId: string }) {
  return (
    <DashboardChrome title="Community" subtitle="Comment activity & your most engaged audience">
      {(state) => <CommunityBody orgId={orgId} brandId={state.brand.id} platform={state.platform} period={state.period} />}
    </DashboardChrome>
  )
}

function CommunityBody({ orgId, brandId, platform, period }: { orgId: string; brandId: string; platform: ChromeState['platform']; period: Period }) {
  const [data, setData] = useState<CommunityPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null)
    const url = `/api/organizations/${orgId}/dashboard/community?platform=${platformParam(platform)}&period=${encodeURIComponent(period)}&brand=${encodeURIComponent(brandId)}`
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CommunityPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, brandId, platform, period])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="material-symbols-outlined text-[40px] text-[#d1d5db] mb-2">error</span>
        <p className="text-[13px] text-[#6b7280]">Gagal memuat data: {error}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="material-symbols-outlined text-[34px] text-[#cbd1d8] animate-spin mb-2">progress_activity</span>
        <p className="text-[13px] text-[#9ca3af]">Memuat data dari gold layer…</p>
      </div>
    )
  }
  if (data.empty || data.kpis.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="material-symbols-outlined text-[40px] text-[#d1d5db] mb-2">database</span>
        <p className="text-[13px] text-[#6b7280]">Belum ada data komunitas untuk filter ini.</p>
      </div>
    )
  }

  return (
    <>
      <SectionHeader icon="diversity_3" first>Performance</SectionHeader>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {data.kpis.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card className="flex flex-col">
          <CardHead title="Comment Volume by Platform" sub="Comments tracked per week" />
          <div className="flex items-center justify-center gap-5 pb-1">
            {data.commentVolume.map(s => (
              <span key={s.name} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#6b7280]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}
              </span>
            ))}
          </div>
          <div className="px-4 pb-4 pt-1 flex-1">
            {data.commentVolume.length
              ? <MultiLineChart series={data.commentVolume} labels={data.commentVolumeLabels} height={250} dots />
              : <div className="h-[250px] flex items-center justify-center text-[12px] text-[#9ca3af]">Tidak ada data volume komentar.</div>}
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Comment Activity by Hour of Day" sub="When your audience comments (WIB)" />
          <div className="px-4 pb-3 pt-3">
            {data.commentByHour.some(v => v > 0)
              ? <HourBars hours={data.commentByHour} primeFrom={data.primeFrom} primeTo={data.primeTo} />
              : <div className="h-[230px] flex items-center justify-center text-[12px] text-[#9ca3af]">Tidak ada data per jam.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="success" title="Prime Window">{data.primeInsight}</Callout>
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
            {data.contributors.map((c, i) => (
              <div key={c.username}
                className={`grid ${LB_COLS} gap-2 px-4 py-3.5 items-center text-[13px] hover:bg-[#fafbfb] ${
                  i < data.contributors.length - 1 ? 'border-b border-[#f1f3f4]' : ''
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
            {data.contributors.length === 0 && (
              <div className="px-4 py-8 text-center text-[12.5px] text-[#9ca3af]">Belum ada data kontributor pada periode ini.</div>
            )}
          </div>
        </div>
      </Card>
    </>
  )
}
