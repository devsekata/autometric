'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardHead, SectionHeader, FlexKpiCard, Callout, Badge } from './ui'
import { HBars, MultiLineChart } from './charts'
import DashboardChrome, { type ChromeState } from './DashboardChrome'
import { PLATFORM_META, PALETTE, fmtNum, type PlatformFilter, type Period } from './data'
import type { AudiencePayload } from '@/lib/dashboard/audience'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const FEMALE = '#d23f6f'
const MALE = '#6c4cd6'

const TIER_STYLE: Record<string, string> = {
  'Super Fan': 'text-[#1e6f55] bg-[#e7f3ed]',
  Active:      'text-[#3d6f8a] bg-[#e9f1f5]',
  Casual:      'text-[#6b7280] bg-[#f3f4f6]',
}
const UGC_ICON: Record<string, string> = { Reel: 'movie', Image: 'image', Video: 'smart_display', Carousel: 'collections' }

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={PJ}
      className="text-[11.5px] font-semibold text-[#374151] bg-white border border-[#e5e7eb] rounded-lg px-2.5 py-1.5 cursor-pointer hover:border-[#d1d5db] outline-none">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

const CONTRIB_COLS = 'grid-cols-[34px_minmax(150px,1.8fr)_52px_84px_64px_60px_84px_64px_96px]'
const CONTRIB_HEADS = ['#', 'User', '', 'Comments', 'Likes', 'Daily', 'Relevance', 'Score', 'Tier']
const UGC_COLS = 'grid-cols-[minmax(130px,1.1fr)_78px_minmax(200px,2.6fr)_64px_88px_64px_70px]'
const UGC_HEADS = ['User', 'Format', 'Caption', 'Likes', 'Comments', 'Total', 'Date']

const platformParam = (p: PlatformFilter) => (p === 'All' ? 'all' : p)

export default function AudienceDashboard({ orgId }: { orgId: string }) {
  return (
    <DashboardChrome title="Audience Deep Dive" subtitle="Who's watching and how they engage">
      {(state) => <AudienceBody orgId={orgId} brandId={state.brand.id} platform={state.platform} period={state.period} start={state.start} end={state.end} />}
    </DashboardChrome>
  )
}

function AudienceBody({ orgId, brandId, platform, period, start, end }: { orgId: string; brandId: string; platform: ChromeState['platform']; period: Period; start: string | null; end: string | null }) {
  const [data, setData] = useState<AudiencePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cPlatform, setCPlatform] = useState('All Platforms')
  const [cTier, setCTier] = useState('All Tiers')

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null)
    const range = start && end ? `&start=${start}&end=${end}` : ''
    const url = `/api/organizations/${orgId}/dashboard/audience?platform=${platformParam(platform)}&period=${encodeURIComponent(period)}${range}&brand=${encodeURIComponent(brandId)}`
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: AudiencePayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, brandId, platform, period, start, end])

  const platformOpts = ['All Platforms', ...Object.values(PLATFORM_META).map(m => m.label)]
  const tierOpts = ['All Tiers', 'Super Fan', 'Active', 'Casual']

  const contributors = useMemo(() => (data?.contributors ?? []).filter(c =>
    (cPlatform === 'All Platforms' || PLATFORM_META[c.platform].label === cPlatform) &&
    (cTier === 'All Tiers' || c.tier === cTier),
  ), [data, cPlatform, cTier])

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

  const relevanceTotal = data.relevanceTiers.reduce((s, t) => s + t.count, 0)

  return (
    <>
      {/* Reach KPIs */}
      <SectionHeader icon="groups" first>Audience</SectionHeader>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {data.kpis.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
      </div>

      {/* Demographics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card className="flex flex-col">
          <CardHead title="Audience Age Distribution" sub="unified_audience · share by age bucket" />
          <div className="px-4 pb-4 pt-3">
            {data.age.some(a => a.value > 0)
              ? <HBars items={data.age.map(a => ({
                  label: a.bucket, value: a.value, display: `${a.value}%`, color: a.color,
                }))} />
              : <div className="py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data usia audiens.</div>}
          </div>
          <div className="mx-4 mb-4 mt-auto">
            <Callout tone="info" emoji="💡" title="Gen-Z Core">{data.ageInsight}</Callout>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Gender Split by Platform" sub="Female vs. male share per channel" />
          <div className="flex items-center justify-center gap-6 pt-1 pb-3">
            <Badge text="Female" color={FEMALE} />
            <Badge text="Male" color={MALE} />
          </div>
          <div className="px-4 pb-4 flex-1 flex flex-col justify-center gap-4">
            {data.gender.length === 0 && (
              <div className="py-6 text-center text-[12px] text-[#9ca3af]">Tidak ada data gender.</div>
            )}
            {data.gender.map(g => (
              <div key={g.platform} className="flex items-center gap-3">
                <span className="w-[72px] flex-shrink-0 text-right text-[12.5px] font-medium text-[#374151]">{PLATFORM_META[g.platform].label}</span>
                <div className="flex-1 flex h-10 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-center" style={{ width: `${g.female}%`, background: FEMALE }}>
                    <span className="text-[11.5px] font-bold text-white">{g.female}%</span>
                  </div>
                  <div className="flex items-center justify-center" style={{ width: `${g.male}%`, background: MALE }}>
                    <span className="text-[11.5px] font-bold text-white">{g.male}%</span>
                  </div>
                </div>
              </div>
            ))}
            {data.gender.length > 0 && (
              <div className="flex items-center gap-3 mt-1">
                <span className="w-[72px] flex-shrink-0" />
                <div className="flex-1 flex justify-between">
                  {[0, 25, 50, 75, 100].map(t => (
                    <span key={t} className="text-[10px] text-[#9ca3af] tabular-nums">{t}%</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Comment relevance */}
      <SectionHeader icon="forum">Comment Relevance Analysis</SectionHeader>
      <Card className="mb-3">
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2 flex-wrap gap-2">
          <div>
            <h3 style={PJ} className="text-[12.5px] font-bold text-[#111827] tracking-[-0.01em]">Comment Relevance Analysis</h3>
            <p className="text-[11px] text-[#9ca3af] mt-0.5">Semantic scoring of each comment against its post caption — how contextually invested is the audience?</p>
          </div>
        </div>
        {relevanceTotal === 0 ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-[#9ca3af]">Belum ada skor relevansi komentar (feature.comment_relevance_scores masih kosong).</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 px-4 pt-1">
              {data.relevanceTiers.map(t => (
                <div key={t.tier} className="bg-[#fafbfb] border border-[#eef0f2] rounded-xl px-4 py-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
                    <span className="text-[12px] font-semibold text-[#374151]">{t.tier} ({t.range})</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span style={PJ} className="text-[22px] font-bold text-[#111827] leading-none tabular-nums">{fmtNum(t.count)}</span>
                    <span className="text-[11.5px] text-[#9ca3af] pb-0.5">{t.pct}% of all comments</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 pt-4 pb-4">
              <p style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-2.5">Relevance Distribution</p>
              <div className="flex flex-col gap-3">
                {data.relevanceTiers.map(t => (
                  <div key={t.tier}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12.5px] font-semibold text-[#374151]">{t.tier.replace(' Relevance', '')} ({t.range})</span>
                      <span style={PJ} className="text-[12.5px] font-bold text-[#111827]">{t.pct}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#f3f4f6] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${t.pct}%`, background: t.color }} />
                    </div>
                    <p className="text-[11px] text-[#9ca3af] mt-1">{t.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      {relevanceTotal > 0 && (
        <Card className="mb-1">
          <CardHead title="Sample Comments by Tier" sub="Representative comments from each relevance band" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 pt-1 pb-2">
            {data.relevanceTiers.map(t => (
              <div key={t.tier}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
                  <span style={PJ} className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280]">{t.tier} Samples</span>
                </div>
                <div className="flex flex-col gap-2">
                  {t.samples.map((s, i) => (
                    <p key={i} className="text-[12px] leading-snug text-[#4b5563] bg-[#fafbfb] border border-[#eef0f2] rounded-lg px-3 py-2">“{s}”</p>
                  ))}
                  {t.samples.length === 0 && <p className="text-[11.5px] text-[#9ca3af]">—</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="mx-4 mb-4 mt-2">
            <Callout tone="info" emoji="💡" title="Relevance Signal">{data.relevanceSignal}</Callout>
          </div>
        </Card>
      )}

      {/* Top contributors */}
      <SectionHeader icon="workspace_premium">Top Community Contributors</SectionHeader>
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2 flex-wrap gap-2">
          <div>
            <h3 style={PJ} className="text-[12.5px] font-bold text-[#111827] tracking-[-0.01em]">Top Community Contributors</h3>
            <p className="text-[11px] text-[#9ca3af] mt-0.5">Ranked by combined engagement frequency × semantic relevance score</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={cPlatform} onChange={setCPlatform} options={platformOpts} />
            <Select value={cTier} onChange={setCTier} options={tierOpts} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`grid ${CONTRIB_COLS} gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]`}>
              {CONTRIB_HEADS.map((h, i) => (
                <span key={i} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
              ))}
            </div>
            {contributors.map((c, i) => (
              <div key={c.username}
                className={`grid ${CONTRIB_COLS} gap-2 px-4 py-3 items-center text-[13px] hover:bg-[#fafbfb] ${
                  i < contributors.length - 1 ? 'border-b border-[#f1f3f4]' : ''
                }`}>
                <span style={PJ} className="text-[12px] font-bold text-[#9ca3af] tabular-nums">{c.rank}</span>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10.5px] font-bold flex-shrink-0" style={{ background: c.color }}>{c.initials}</span>
                  <span className="font-medium text-[#374151] truncate">{c.username}</span>
                </div>
                <img src={PLATFORM_META[c.platform].logo} alt={PLATFORM_META[c.platform].label} className="w-[18px] h-[18px] object-contain" />
                <span className="text-[#374151] tabular-nums">{c.comments}</span>
                <span className="text-[#374151] tabular-nums">{c.likes}</span>
                <span className="text-[#374151] tabular-nums">{c.daily}</span>
                <span className="font-semibold text-[#3d8a5f] tabular-nums">{c.relevance}%</span>
                <span style={PJ} className="font-bold text-[#111827] tabular-nums">{c.score}</span>
                <span className={`inline-flex items-center justify-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${TIER_STYLE[c.tier]}`}>{c.tier}</span>
              </div>
            ))}
            {contributors.length === 0 && (
              <div className="px-4 py-8 text-center text-[12.5px] text-[#9ca3af]">No contributors match these filters.</div>
            )}
          </div>
        </div>
        <div className="mx-4 my-4">
          <Callout tone="success" title="Super Fan Programme">{data.superFanNote}</Callout>
        </div>
      </Card>

      {/* Geography + growth */}
      <SectionHeader icon="public">Geography &amp; Growth</SectionHeader>
      <div className="grid grid-cols-12 gap-3 mb-3">
        <Card span="col-span-12 lg:col-span-5">
          <CardHead title="Top Audience Cities" sub="Share of followers by city" />
          <div className="px-4 pb-4 pt-3">
            {data.cities.length
              ? <HBars items={data.cities.map((c, i) => ({
                  label: c.city, value: c.value, display: `${c.value}%`, color: PALETTE[i % PALETTE.length],
                }))} />
              : <div className="py-10 text-center text-[12px] text-[#9ca3af]">Tidak ada data kota audiens.</div>}
          </div>
        </Card>

        <Card span="col-span-12 lg:col-span-7" className="flex flex-col">
          <CardHead title="Follower Growth Trend" sub="All brands · weekly" />
          <div className="px-4 pb-3 pt-3 flex-1">
            {data.followerTrend.length
              ? <MultiLineChart series={data.followerTrend} labels={data.followerLabels} height={220} />
              : <div className="h-[220px] flex items-center justify-center text-[12px] text-[#9ca3af]">Tidak ada data follower.</div>}
          </div>
          <div className="flex items-center gap-4 px-4 pb-4 flex-wrap">
            {data.followerTrend.map(s => (
              <span key={s.name} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#6b7280]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* UGC */}
      <SectionHeader icon="loyalty">User-Generated Content — Tagged Posts</SectionHeader>
      <Card className="overflow-hidden">
        <CardHead title="Tagged Posts" sub="instagram_tagged_post · username, like_count, comment_count" />
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`grid ${UGC_COLS} gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]`}>
              {UGC_HEADS.map((h, i) => (
                <span key={i} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
              ))}
            </div>
            {data.ugc.map((p, i) => (
              <div key={p.username + i}
                className={`grid ${UGC_COLS} gap-2 px-4 py-3 items-center text-[13px] hover:bg-[#fafbfb] ${
                  i < data.ugc.length - 1 ? 'border-b border-[#f1f3f4]' : ''
                }`}>
                <span className="font-medium text-[#374151] truncate">{p.username}</span>
                <span className="inline-flex items-center gap-1 text-[12px] text-[#6b7280]">
                  <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">{UGC_ICON[p.format] ?? 'image'}</span>
                  {p.format}
                </span>
                <span className="text-[#374151] truncate" title={p.caption}>“{p.caption}”</span>
                <span className="text-[#374151] tabular-nums">{p.likes}</span>
                <span className="text-[#374151] tabular-nums">{p.comments}</span>
                <span className="font-semibold text-[#111827] tabular-nums">{p.total}</span>
                <span className="text-[#9ca3af] text-[12px]">{p.date}</span>
              </div>
            ))}
            {data.ugc.length === 0 && (
              <div className="px-4 py-8 text-center text-[12.5px] text-[#9ca3af]">Belum ada UGC tagged post pada periode ini.</div>
            )}
          </div>
        </div>
        <div className="mx-4 my-4">
          <Callout tone="info" emoji="💡" title="UGC Opportunity">{data.ugcInsight}</Callout>
        </div>
      </Card>
    </>
  )
}
