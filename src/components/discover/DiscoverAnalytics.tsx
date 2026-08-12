'use client'

/**
 * Audience / Reports for Discover.
 *
 * Both render from one `/discover/summary` payload with different framings,
 * which is what keeps them consistent with the Content grid and with each other.
 *
 * There was a third, Campaign Content — campaign-tagged and boosted posts versus
 * organic. It was removed: real campaigns live in Campaign Management now, and
 * having a page called "Campaign Content" next to it made the nav a guessing
 * game about which one meant the campaigns you had actually bought.
 *
 * Deliberate omission: the source platform's versions of these pages were built
 * on commercial KOL metrics — EMV, ROI, CPE, rate cards, agency margins, deal
 * status. autometric stores none of them (it is a social performance warehouse,
 * not an influencer marketplace), so rather than render invented numbers or a
 * grid of zeros, each page is rebuilt on the dimensions the data really has.
 */

import { useEffect, useState } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { BarChart, Donut, HBars, MultiLineChart } from '@/components/dashboard/charts'
import { DiscoverHeader, EmptyState, ErrorState, PJ, Spinner, fmtNum } from './ui'
import type { DiscoverSummaryPayload, NamedCount } from '@/lib/discover/summary'

const PALETTE = ['#285D6E', '#4E96AC', '#e0a458', '#5fa783', '#8b7fc7', '#d97a7a', '#7DB4C6']

function useSummary(orgId: string) {
  const [data, setData] = useState<DiscoverSummaryPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/summary`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DiscoverSummaryPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])
  return { data, error }
}

function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</div>
          <div style={PJ} className="text-[21px] font-extrabold text-[#111827] mt-1 tabular-nums">{value}</div>
          {sub && <div className="text-[10.5px] text-[#9ca3af] mt-0.5">{sub}</div>}
        </div>
        <span className="w-8 h-8 rounded-lg bg-[#f0f7fa] flex items-center justify-center">
          <span className="material-symbols-outlined text-[17px] text-[#285D6E]">{icon}</span>
        </span>
      </div>
    </Card>
  )
}

const toBars = (items: NamedCount[], metric: (n: NamedCount) => number, fmt: (n: number) => string) =>
  items.map((n, i) => ({
    label: n.label, value: metric(n), color: PALETTE[i % PALETTE.length], display: fmt(metric(n)),
  }))

/* ── Audience ─────────────────────────────────────────────────────────────── */

export function DiscoverAudience({ orgId }: { orgId: string }) {
  const { data, error } = useSummary(orgId)
  if (error) return <div className="p-5"><ErrorState message={error} /></div>
  if (!data) return <div className="p-5"><Spinner /></div>

  const engagementOf = (n: NamedCount) => n.likes + n.comments

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <DiscoverHeader
        title="Audience Insights"
        subtitle="Di mana audiens Discover kamu berada dan konten seperti apa yang mereka respons — dari post brand dan kompetitor."
      />

      <div className="grid grid-cols-4 gap-3.5 mb-4">
        <Kpi label="Total views" value={fmtNum(data.totals.views)} icon="visibility" />
        <Kpi label="Total likes" value={fmtNum(data.totals.likes)} icon="favorite" />
        <Kpi label="Total comments" value={fmtNum(data.totals.comments)} icon="chat_bubble" />
        <Kpi label="Rata-rata ER" value={`${data.totals.erPct.toFixed(2)}%`} icon="bolt" />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Platform" sub="Distribusi views" />
          <div className="px-4 pb-4">
            <Donut
              segments={data.byPlatform.map((p, i) => ({
                label: p.label, value: p.views, color: PALETTE[i % PALETTE.length],
              }))}
              centerLabel={fmtNum(data.totals.views)}
              centerSub="views"
            />
          </div>
        </Card>

        <Card>
          <CardHead
            title="Format"
            sub="Diukur dengan engagement — post statis Facebook/IG tidak melaporkan views"
          />
          <div className="px-4 pb-4">
            <HBars items={data.byFormat.map((f, i) => ({
              label: f.label, value: engagementOf(f), display: fmtNum(engagementOf(f)),
              color: PALETTE[i % PALETTE.length],
            }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3.5 mt-3.5">
        <Card>
          <CardHead title="Content pillar" sub="Rata-rata engagement rate" />
          <div className="px-4 pb-4">
            {data.byPillar.length === 0
              ? <EmptyState icon="category" title="Belum ada pillar" body="Post brand belum diberi content pillar." />
              : <BarChart bars={toBars(data.byPillar, n => n.erPct, n => `${n.toFixed(1)}%`)} height={190} />}
          </div>
        </Card>

        <Card>
          <CardHead title="Brand vs kompetitor" sub="Volume dan engagement" />
          <div className="px-4 pb-4">
            <HBars items={data.bySource.map((s, i) => ({
              label: `${s.label} · ${s.erPct.toFixed(2)}% ER`,
              value: s.posts, display: `${s.posts} post`, color: PALETTE[i],
            }))} />
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

export function DiscoverReports({ orgId }: { orgId: string }) {
  const { data, error } = useSummary(orgId)
  if (error) return <div className="p-5"><ErrorState message={error} /></div>
  if (!data) return <div className="p-5"><Spinner /></div>

  const labels = data.timeline.map(t => t.month.slice(5))

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <DiscoverHeader
        title="Discover Reports"
        subtitle={`Ringkasan performa ${data.totals.posts} konten brand dan kompetitor.`}
      />

      <div className="grid grid-cols-4 gap-3.5 mb-4">
        <Kpi label="Konten" value={String(data.totals.posts)} icon="grid_view" />
        <Kpi label="Views" value={fmtNum(data.totals.views)} icon="visibility" />
        <Kpi label="Engagement" value={fmtNum(data.totals.likes + data.totals.comments + data.totals.shares)} icon="favorite" />
        <Kpi label="Rata-rata ER" value={`${data.totals.erPct.toFixed(2)}%`} icon="bolt" />
      </div>

      <Card>
        <CardHead title="Aktivitas per bulan" sub="Jumlah post dan total views" />
        <div className="px-4 pb-4">
          {data.timeline.length < 2 ? (
            <EmptyState icon="show_chart" title="Data belum cukup"
              body="Perlu minimal dua bulan data untuk menggambar tren." />
          ) : (
            <MultiLineChart
              labels={labels}
              series={[
                { name: 'Views', color: '#285D6E', data: data.timeline.map(t => t.views) },
                { name: 'Posts', color: '#e0a458', data: data.timeline.map(t => t.posts) },
              ]}
              height={210}
              yAxis
              fmtY={(n: number) => fmtNum(n)}
            />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3.5 mt-3.5">
        <Card className="overflow-hidden">
          <CardHead title="Akun teratas" sub="Berdasarkan total views" />
          <div className="px-4 pb-4">
            <HBars items={data.topAuthors.slice(0, 6).map((a, i) => ({
              label: a.label, value: a.views, display: fmtNum(a.views), color: PALETTE[i % PALETTE.length],
            }))} />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHead title="Konten teratas" sub="Berdasarkan views" />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e7eb]">
                  {['#', 'Akun', 'Format', 'Views', 'ER'].map((h, i) => (
                    <th key={h} style={PJ}
                      className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i > 2 ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.topPosts.slice(0, 8).map((p, i) => (
                  <tr key={p.key} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                    <td className="px-3 py-2 text-[11px] text-[#9ca3af] tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div style={PJ} className="text-[11.5px] font-bold text-[#111827] truncate max-w-[150px]">{p.author}</div>
                      <div className="text-[10px] text-[#9ca3af] truncate max-w-[150px]">{p.caption || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#6b7280]">{p.format}</td>
                    <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{fmtNum(p.views)}</td>
                    <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{p.erPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
