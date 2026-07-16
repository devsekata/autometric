'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardHead, SectionHeader, FlexKpiCard, Callout, Badge } from './ui'
import { BarChart, HBars } from './charts'
import DashboardChrome, { type ChromeState } from './DashboardChrome'
import { PLATFORM_META, PALETTE, fmtNum, type PlatformFilter, type Period } from './data'
import type { ContentOverviewPayload } from '@/lib/dashboard/content'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const FORMAT_ICON: Record<string, string> = {
  Reel: 'movie', Video: 'smart_display', Carousel: 'collections', Image: 'image', Link: 'link', Story: 'amp_stories',
}
const FORMATS = ['All Formats', 'Reel', 'Video', 'Carousel', 'Image'] as const

const TABLE_COLS =
  'grid-cols-[36px_50px_minmax(220px,2.6fr)_92px_72px_72px_72px_84px_72px_60px_84px]'
const TABLE_HEADS = ['#', '', 'Post', 'Format', 'Reach', 'Views', 'Likes', 'Comments', 'Shares', 'ER', 'Tag']

const platformParam = (p: PlatformFilter) => (p === 'All' ? 'all' : p)

export default function ContentDashboard({ orgId }: { orgId: string }) {
  return (
    <DashboardChrome title="Content Overview" subtitle="What's working in your content">
      {(state) => <ContentBody orgId={orgId} brandId={state.brand.id} platform={state.platform} period={state.period} start={state.start} end={state.end} />}
    </DashboardChrome>
  )
}

function ContentBody({ orgId, brandId, platform, period, start, end }: { orgId: string; brandId: string; platform: ChromeState['platform']; period: Period; start: string | null; end: string | null }) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]>('All Formats')
  const [data, setData] = useState<ContentOverviewPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null)
    const range = start && end ? `&start=${start}&end=${end}` : ''
    const url = `/api/organizations/${orgId}/dashboard/content?platform=${platformParam(platform)}&period=${encodeURIComponent(period)}${range}&brand=${encodeURIComponent(brandId)}`
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ContentOverviewPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, brandId, platform, period, start, end])

  const rows = useMemo(
    () => (!data ? [] : format === 'All Formats' ? data.topPosts : data.topPosts.filter(r => r.format === format)),
    [data, format],
  )

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
        <p className="text-[13px] text-[#6b7280]">Belum ada data untuk filter ini.</p>
      </div>
    )
  }

  return (
    <>
      {/* Performance KPIs */}
      <SectionHeader icon="monitoring" first>Performance</SectionHeader>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {data.kpis.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
      </div>

      {/* Post type performance + content volume */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card className="flex flex-col">
          <CardHead title="Post Type Performance" sub="Instagram · avg reach by format" />
          <div className="px-4 pb-4 pt-3">
            {data.postTypePerf.length
              ? <HBars items={data.postTypePerf.map(p => ({
                  label: p.label, value: p.value, display: fmtNum(p.value), color: p.color,
                }))} />
              : <div className="py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data format Instagram.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="success" title="Reels Dominate">{data.postTypeInsight}</Callout>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Content Volume by Week" sub="Posts published per week"
            action={<Badge text="Posts" color={PALETTE[1]} />} />
          <div className="px-4 pb-4 pt-3 flex-1 flex items-end">
            {data.contentVolume.length
              ? <BarChart height={200} bars={data.contentVolume.map(w => ({
                  label: w.label, value: w.value, display: String(w.value),
                  color: PALETTE[1],
                }))} />
              : <div className="w-full py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data volume.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="warning" title="Consistency Gap">{data.contentVolumeInsight}</Callout>
          </div>
        </Card>
      </div>

      {/* Top posts table */}
      <SectionHeader icon="emoji_events">Top Posts — Performance Table</SectionHeader>
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2 flex-wrap gap-2">
          <div>
            <h3 style={PJ} className="text-[12.5px] font-bold text-[#111827] tracking-[-0.01em]">Top Posts</h3>
            <p className="text-[11px] text-[#9ca3af] mt-0.5">Ranked by engagement rate · all platforms combined</p>
          </div>
          <div className="flex items-center bg-[#f3f4f6] rounded-lg p-0.5">
            {FORMATS.map(f => (
              <button key={f} onClick={() => setFormat(f)} style={PJ}
                className={`h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
                  format === f ? 'bg-white text-[#1e4f49] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'
                }`}>{f}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div className={`grid ${TABLE_COLS} gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]`}>
              {TABLE_HEADS.map((h, i) => (
                <span key={i} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
              ))}
            </div>
            {rows.map((r, i) => {
              const meta = PLATFORM_META[r.platform]
              return (
                <div key={r.rank}
                  className={`grid ${TABLE_COLS} gap-2 px-4 py-3 items-center text-[13px] hover:bg-[#fafbfb] ${
                    i < rows.length - 1 ? 'border-b border-[#f1f3f4]' : ''
                  }`}>
                  <span style={PJ} className="text-[12px] font-bold text-[#9ca3af] tabular-nums">{r.rank}</span>
                  <img src={meta.logo} alt={meta.label} title={meta.label} className="w-[18px] h-[18px] object-contain" />
                  <span className="text-[#374151] font-medium truncate" title={r.caption}>{r.caption}</span>
                  <span className="inline-flex items-center gap-1 text-[12px] text-[#6b7280]">
                    <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">{FORMAT_ICON[r.format] ?? 'play_circle'}</span>
                    {r.format}
                  </span>
                  <span className="text-[#374151] tabular-nums">{fmtNum(r.reach)}</span>
                  <span className="text-[#374151] tabular-nums">{fmtNum(r.views)}</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{fmtNum(r.likes)}</span>
                  <span className="text-[#374151] tabular-nums">{fmtNum(r.comments)}</span>
                  <span className="text-[#374151] tabular-nums">{r.shares == null ? '—' : fmtNum(r.shares)}</span>
                  <span className="font-semibold text-[#3d8a5f] tabular-nums">{r.er}%</span>
                  <span className={`inline-flex items-center justify-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    r.tag === 'Boosted' ? 'text-[#b8915a] bg-[#fbf4e8]' : 'text-[#6b7280] bg-[#f3f4f6]'
                  }`}>{r.tag}</span>
                </div>
              )
            })}
            {rows.length === 0 && (
              <div className="px-4 py-8 text-center text-[12.5px] text-[#9ca3af]">No posts for this format.</div>
            )}
          </div>
        </div>
      </Card>

      {/* TikTok video analytics */}
      <SectionHeader icon="smart_display">Video Analytics</SectionHeader>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="flex flex-col">
          <CardHead title="TikTok Completion Rate Distribution" sub="completion_rate · % of videos per bucket" />
          <div className="px-4 pb-4 pt-3 flex-1 flex items-end">
            {data.completionDist.some(d => d.value > 0)
              ? <BarChart height={200} bars={data.completionDist.map((d, i) => ({
                  label: d.label, value: d.value, display: `${d.value}%`, color: PALETTE[i % PALETTE.length],
                }))} />
              : <div className="w-full py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data completion TikTok.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="success" title="Strong Retention">{data.completionInsight}</Callout>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Reel Watch Time by Duration" sub="reel_avg_watch_time · avg completion %" />
          <div className="px-4 pb-4 pt-3 flex-1 flex items-end">
            {data.reelWatch.some(d => d.value > 0)
              ? <BarChart height={200} bars={data.reelWatch.map(d => ({
                  label: d.label, value: d.value, display: `${d.value}%`,
                  color: d.value >= 60 ? '#5fa783' : d.value >= 40 ? '#e0a458' : '#d97a7a',
                }))} />
              : <div className="w-full py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data watch time reel.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="info" emoji="💡" title="Sweet Spot">{data.reelWatchInsight}</Callout>
          </div>
        </Card>
      </div>
    </>
  )
}
