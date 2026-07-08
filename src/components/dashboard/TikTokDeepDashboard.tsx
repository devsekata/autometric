'use client'

import { useEffect, useState } from 'react'
import { Card, CardHead, SectionHeader, FlexKpiCard, Callout, Badge } from './ui'
import { DivergingBars, ScatterPlot, HBars } from './charts'
import DashboardChrome, { type ChromeState } from './DashboardChrome'
import { PALETTE, fmtNum, type PlatformFilter, type Period } from './data'
import type { TiktokPayload } from '@/lib/dashboard/tiktok'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function FieldTag({ children }: { children: React.ReactNode }) {
  return <span style={PJ} className="text-[11px] font-semibold text-[#6b7280] bg-[#f3f4f6] px-2.5 py-1 rounded-full">{children}</span>
}

const platformParam = (p: PlatformFilter) => (p === 'All' ? 'all' : p)
const ceilTo = (n: number, step: number) => Math.max(step, Math.ceil(n / step) * step)

export default function TikTokDeepDashboard({ orgId }: { orgId: string }) {
  return (
    <DashboardChrome title="TikTok Deep" subtitle="Growth, churn & retention from TikTok's API">
      {(state) => <TikTokBody orgId={orgId} brandId={state.brand.id} platform={state.platform} period={state.period} />}
    </DashboardChrome>
  )
}

function TikTokBody({ orgId, brandId, platform, period }: { orgId: string; brandId: string; platform: ChromeState['platform']; period: Period }) {
  const [data, setData] = useState<TiktokPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null)
    const url = `/api/organizations/${orgId}/dashboard/tiktok?platform=${platformParam(platform)}&period=${encodeURIComponent(period)}&brand=${encodeURIComponent(brandId)}`
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: TiktokPayload) => { if (!cancelled) setData(d) })
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
        <p className="text-[13px] text-[#6b7280]">Belum ada data TikTok untuk filter ini.</p>
      </div>
    )
  }

  const { gained, lost, net } = data.churnTotals
  const xMax = ceilTo(Math.max(10, ...data.durationCompletion.map(p => p.x)), 10)
  const xTicks = Array.from({ length: xMax / 10 + 1 }, (_, i) => i * 10)
  const yTicks = [20, 40, 60, 80, 100]

  return (
    <>
      <SectionHeader icon="music_note" first>Performance</SectionHeader>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
        {data.kpis.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
      </div>

      {/* Follower churn */}
      <SectionHeader icon="sync_alt">Follower Churn Analysis</SectionHeader>
      <Card className="mb-3">
        <CardHead title="Follower Churn Analysis" sub="Unique to TikTok's API — no other platform in this schema tracks churn at this granularity"
          action={<FieldTag>new_followers · lost_followers · net_growth</FieldTag>} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 px-4 pt-1">
          {[
            { label: 'New Followers', value: `+${fmtNum(gained)}`, bg: '#edf6ef', border: '#d7ebdb', color: '#3d8a5f' },
            { label: 'Followers Lost', value: `−${fmtNum(lost)}`, bg: '#fcefec', border: '#f3d6d0', color: '#c2553f' },
            { label: 'Net Growth', value: `${net >= 0 ? '+' : '−'}${fmtNum(Math.abs(net))}`, bg: '#f3f1fb', border: '#e7e3f7', color: '#6c4cd6' },
          ].map(t => (
            <div key={t.label} className="rounded-xl border px-4 py-4 text-center" style={{ background: t.bg, borderColor: t.border }}>
              <div style={{ ...PJ, color: t.color }} className="text-[26px] font-bold leading-none tabular-nums">{t.value}</div>
              <div className="text-[12px] font-medium text-[#6b7280] mt-1.5">{t.label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-6 pt-4 pb-1">
          <Badge text="New Followers" color="#7cc499" />
          <Badge text="Lost Followers" color="#e89aa3" />
        </div>
        <div className="px-4 pb-4 pt-1">
          {data.churnWeeks.length
            ? <DivergingBars data={data.churnWeeks} height={240} fmt={fmtNum} />
            : <div className="h-[240px] flex items-center justify-center text-[12px] text-[#9ca3af]">Tidak ada data churn.</div>}
        </div>
        <div className="mx-4 mb-4">
          <Callout tone="danger" title="Churn Watch">{data.churnInsight}</Callout>
        </div>
      </Card>

      {/* Duration vs completion + watch time */}
      <SectionHeader icon="insights">Retention Drivers</SectionHeader>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="flex flex-col">
          <CardHead title="Duration vs. Completion Rate" action={<FieldTag>video_duration · completion_rate</FieldTag>} />
          <div className="px-4 pb-4 pt-3 flex-1">
            {data.durationCompletion.length
              ? <ScatterPlot points={data.durationCompletion} xMax={xMax} yMax={100}
                  xTicks={xTicks} yTicks={yTicks}
                  xLabel="Video Duration (seconds)" color="#8b7fc7" height={260} />
              : <div className="h-[260px] flex items-center justify-center text-[12px] text-[#9ca3af]">Tidak ada data durasi/completion.</div>}
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Avg Watch Time by Content Pillar" action={<FieldTag>avg_watch_time · content_pillar</FieldTag>} />
          <div className="px-4 pb-4 pt-3">
            {data.watchByPillar.length
              ? <HBars items={data.watchByPillar.map(w => ({
                  label: w.label, value: w.value, display: `${w.value}s`, color: w.color,
                }))} />
              : <div className="py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data pillar.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="success" title="Watch-Time Driver">{data.watchInsight}</Callout>
          </div>
        </Card>
      </div>
    </>
  )
}
