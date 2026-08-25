'use client'

/**
 * Per-account workspace — port of the source's creator detail page
 * (`creator-detail.js` + its header/section modules).
 *
 * Structure is the original's: a banner header with the account identity and
 * actions, a KPI row, then a left in-page sidebar switching the right-hand
 * content between sections. The source had eight sections; four are built here
 * (the set chosen for this port) and the reason the others are absent is
 * concrete rather than cosmetic:
 *
 *   Brand Fit / AI Insights / Individual Report — the first two were scored
 *   from `match`, `auth` and `aff` fields that only existed in the source's
 *   hardcoded KOL array, and the third exported a media kit built on rate cards.
 *   autometric stores none of those, so they would be invented numbers.
 *
 * Everything rendered below comes from the account's real post history.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { BarChart, Donut, HBars, MultiLineChart } from '@/components/dashboard/charts'
import {
  Btn, EmptyState, ErrorState, PJ, PLATFORM_ICON, RelationTag, Spinner,
  fmtDate, fmtNum, gradientFor,
} from './ui'
import RateOrderSection from './RateOrderSection'
import ContentAnalytics from './ContentAnalytics'
import { AiInsightsSection, BrandFitSection, KolReportSection } from './KolInsightSections'
import { DataSourceStrip } from './credibility'
import type { KolProfile } from '@/lib/discover/profile'
import type { AccountDetailPayload, AccountPost, AccountRelation } from '@/lib/discover/account'

type Section = 'profile' | 'content' | 'performance' | 'audience' | 'campaigns' | 'brandfit' | 'ai' | 'report' | 'rate'

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'content', label: 'Content Analytics', icon: 'summarize' },
  { id: 'performance', label: 'Analytics', icon: 'insights' },
  { id: 'audience', label: 'Audience Insights', icon: 'group' },
  { id: 'campaigns', label: 'Campaign History', icon: 'campaign' },
  { id: 'brandfit', label: 'Brand Fit', icon: 'handshake' },
  { id: 'ai', label: 'AI Insights', icon: 'auto_awesome' },
  { id: 'report', label: 'Report', icon: 'description' },
  { id: 'rate', label: 'Rate & Order', icon: 'payments' },
]

const PALETTE = ['#285D6E', '#4E96AC', '#e0a458', '#5fa783', '#8b7fc7', '#d97a7a', '#7DB4C6']

export default function DiscoverKolDetail({
  orgId, orgSlug, accountId, relation,
}: { orgId: string; orgSlug: string; accountId: string; relation: AccountRelation }) {
  const [data, setData] = useState<AccountDetailPayload | null>(null)
  const [profile, setProfile] = useState<KolProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('profile')

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null)
    fetch(`/api/organizations/${orgId}/discover/account/${accountId}?relation=${relation}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Akun tidak ditemukan di organisasi ini.' : `HTTP ${r.status}`))))
      .then((d: AccountDetailPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, accountId, relation])

  // The enriched profile powers Brand Fit, AI Insights and Report.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/profiles`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { profiles: KolProfile[] }) => {
        if (cancelled) return
        setProfile(d.profiles.find(p => p.account.id === accountId && p.account.relation === relation) ?? null)
      })
      .catch(() => { /* detail still works without the enriched profile */ })
    return () => { cancelled = true }
  }, [orgId, accountId, relation])

  const backHref = `/organizations/${orgSlug}/discover/kol`

  if (error) {
    return (
      <div className="p-5 max-w-[1500px] mx-auto">
        <Link href={backHref}><Btn size="sm" variant="ghost">
          <span className="material-symbols-outlined text-[15px]">arrow_back</span>Kembali ke KOL Intelligence
        </Btn></Link>
        <ErrorState message={error} />
      </div>
    )
  }
  if (!data) return <div className="p-5"><Spinner /></div>

  const { account: a, kpis } = data

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <Link href={backHref}>
        <Btn size="sm" variant="ghost">
          <span className="material-symbols-outlined text-[15px]">arrow_back</span>
          Kembali ke KOL Intelligence
        </Btn>
      </Link>

      {/* Banner header — the source's `dhead`. */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden mt-3">
        <div className="h-[76px] relative" style={{ background: gradientFor(a.id) }} />
        <div className="px-4 pb-4 flex items-end gap-3 flex-wrap">
          <div style={{ ...PJ, background: gradientFor(a.username) }}
            className="w-16 h-16 rounded-2xl border-[3px] border-white -mt-8 flex items-center justify-center text-white text-[19px] font-extrabold shadow-sm">
            {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
          </div>
          <div className="flex-1 min-w-0 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 style={PJ} className="text-[18px] font-extrabold text-[#111827] tracking-[-0.02em]">{a.username}</h1>
              <RelationTag relation={a.relation} />
            </div>
            <div className="flex items-center gap-2 text-[11.5px] text-[#9ca3af] mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">{PLATFORM_ICON[a.platform] ?? 'public'}</span>
                <span className="capitalize">{a.platform}</span>
              </span>
              {a.brandName && <><span className="text-[#d1d5db]">·</span><span>{a.brandName}</span></>}
              <span className="text-[#d1d5db]">·</span>
              <span>{kpis.firstPostAt ? fmtDate(kpis.firstPostAt) : '—'} → {kpis.lastPostAt ? fmtDate(kpis.lastPostAt) : '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            {a.profileUrl && (
              <a href={a.profileUrl} target="_blank" rel="noopener noreferrer">
                <Btn size="sm" variant="secondary">
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>Buka profil
                </Btn>
              </a>
            )}
            <Link href={`/organizations/${orgSlug}/discover/kol?tab=compare`}>
              <Btn size="sm" variant="secondary">
                <span className="material-symbols-outlined text-[14px]">compare</span>Compare
              </Btn>
            </Link>
          </div>
        </div>
      </div>

      {profile && (
        <DataSourceStrip source={profile.dataSource} lastSyncAt={profile.lastSyncAt}
          confidence={profile.confidence} className="mt-2.5" />
      )}

      {/* KPI row */}
      <div className="grid grid-cols-6 gap-3 mt-3.5">
        <Kpi label="Posts" value={String(kpis.posts)} icon="grid_view" />
        <Kpi label="Views" value={fmtNum(kpis.views)} icon="visibility" />
        <Kpi label="Likes" value={fmtNum(kpis.likes)} icon="favorite" />
        <Kpi label="Comments" value={fmtNum(kpis.comments)} icon="chat_bubble" />
        <Kpi label="Avg ER" value={`${kpis.erPct.toFixed(2)}%`} icon="bolt" />
        <Kpi label="Views / post" value={fmtNum(kpis.viewsPerPost)} icon="trending_up" />
      </div>

      {/* Sidebar + content — the source's `dwork` / `dside` layout. */}
      <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: '196px minmax(0,1fr)' }}>
        <aside className="bg-white border border-[#e5e7eb] rounded-xl p-1.5 self-start sticky top-4">
          {SECTIONS.map(s => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} style={PJ}
              className={`w-full flex items-center gap-2 h-9 px-2.5 rounded-lg text-[12px] font-bold transition-colors ${
                section === s.id ? 'bg-[#f0f7fa] text-[#285D6E]' : 'text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#374151]'
              }`}>
              <span className={`material-symbols-outlined text-[16px] ${section === s.id ? 'text-[#285D6E]' : 'text-[#9ca3af]'}`}>
                {s.icon}
              </span>
              {s.label}
            </button>
          ))}
        </aside>

        <div className="min-w-0">
          {section === 'profile' && <ProfileSection data={data} />}
          {section === 'performance' && <PerformanceSection data={data} />}
          {section === 'audience' && <AudienceSection data={data} />}
          {section === 'campaigns' && <CampaignSection data={data} />}
          {section === 'content' && <ContentAnalytics orgId={orgId} data={data} />}
          {section === 'brandfit' && (profile
            ? <BrandFitSection profile={profile} />
            : <Spinner />)}
          {section === 'ai' && (profile
            ? <AiInsightsSection profile={profile} data={data} />
            : <Spinner />)}
          {section === 'report' && (profile
            ? <KolReportSection profile={profile} data={data} />
            : <Spinner />)}
          {section === 'rate' && (
            <RateOrderSection orgId={orgId} orgSlug={orgSlug} data={data} />
          )}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</span>
      </div>
      <div style={PJ} className="text-[17px] font-extrabold text-[#111827] mt-1 tabular-nums">{value}</div>
    </Card>
  )
}

/* ── sections ─────────────────────────────────────────────────────────────── */

export function ProfileSection({ data }: { data: AccountDetailPayload }) {
  const { account: a, kpis, engagementMix } = data
  const totalEng = engagementMix.reduce((n, e) => n + e.value, 0)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Identitas akun" sub="Data akun seperti tersimpan di autometric" />
          <div className="px-4 pb-4 flex flex-col gap-2">
            <Row label="Handle" value={a.username} />
            <Row label="Platform" value={a.platform} />
            <Row label="Tipe" value={a.relation === 'owned' ? 'Akun brand kamu' : 'Kompetitor yang dilacak'} />
            <Row label="Brand terkait" value={a.brandName ?? '—'} />
            <Row label="Post pertama" value={kpis.firstPostAt ? fmtDate(kpis.firstPostAt) : '—'} />
            <Row label="Post terakhir" value={kpis.lastPostAt ? fmtDate(kpis.lastPostAt) : '—'} />
          </div>
        </Card>

        <Card>
          <CardHead title="Komposisi engagement" sub={`${fmtNum(totalEng)} total interaksi`} />
          <div className="px-4 pb-4">
            {totalEng === 0
              ? <EmptyState icon="favorite" title="Belum ada engagement" />
              : <Donut
                  segments={engagementMix.map((e, i) => ({ label: e.label, value: e.value, color: PALETTE[i] }))}
                  centerLabel={fmtNum(totalEng)} centerSub="interaksi" />}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Post terbaik" sub="Berdasarkan views" />
        <PostTable posts={data.topPosts} />
      </Card>
    </div>
  )
}

export function PerformanceSection({ data }: { data: AccountDetailPayload }) {
  const engagementOf = (n: { likes: number; comments: number }) => n.likes + n.comments
  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <CardHead title="Aktivitas per bulan" sub="Jumlah post dan total views" />
        <div className="px-4 pb-4">
          {data.timeline.length < 2 ? (
            <EmptyState icon="show_chart" title="Data belum cukup"
              body="Perlu minimal dua bulan data untuk menggambar tren." />
          ) : (
            <MultiLineChart
              labels={data.timeline.map(t => t.month.slice(5))}
              series={[
                { name: 'Views', color: '#285D6E', data: data.timeline.map(t => t.views) },
                { name: 'Posts', color: '#e0a458', data: data.timeline.map(t => t.posts) },
              ]}
              height={210} yAxis fmtY={(n: number) => fmtNum(n)}
            />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Format" sub="Diukur dengan engagement — post statis tidak melaporkan views" />
          <div className="px-4 pb-4">
            <HBars items={data.byFormat.map((f, i) => ({
              label: `${f.label} (${f.posts})`, value: engagementOf(f),
              display: fmtNum(engagementOf(f)), color: PALETTE[i % PALETTE.length],
            }))} />
          </div>
        </Card>

        <Card>
          <CardHead title="Engagement rate per format" sub="Rata-rata ER" />
          <div className="px-4 pb-4">
            <BarChart bars={data.byFormat.map((f, i) => ({
              label: f.label, value: f.erPct, color: PALETTE[i % PALETTE.length],
              display: `${f.erPct.toFixed(1)}%`,
            }))} height={190} />
          </div>
        </Card>
      </div>
    </div>
  )
}

export function AudienceSection({ data }: { data: AccountDetailPayload }) {
  const { account: a } = data
  return (
    <div className="flex flex-col gap-3.5">
      {a.relation === 'competitor' && (
        <div className="flex items-start gap-2 bg-[#f0f7fa] border border-[#A7C8D4] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#285D6E] mt-0.5">info</span>
          <p className="text-[11.5px] text-[#285D6E] leading-relaxed">
            Ini akun kompetitor, jadi datanya hanya dari post publik — tidak ada demografi audiens.
            Yang ditampilkan adalah respons audiens terhadap kontennya.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Content pillar" sub="Rata-rata engagement rate per pillar" />
          <div className="px-4 pb-4">
            {data.byPillar.length === 0 ? (
              <EmptyState icon="category" title="Belum ada pillar"
                body={a.relation === 'competitor'
                  ? 'Post kompetitor tidak punya content pillar.'
                  : 'Post akun ini belum diberi content pillar.'} />
            ) : (
              <BarChart bars={data.byPillar.map((p, i) => ({
                label: p.label, value: p.erPct, color: PALETTE[i % PALETTE.length],
                display: `${p.erPct.toFixed(1)}%`,
              }))} height={190} />
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Volume per pillar" sub="Jumlah post dan views" />
          <div className="px-4 pb-4">
            {data.byPillar.length === 0
              ? <EmptyState icon="donut_small" title="Tidak ada data pillar" />
              : <HBars items={data.byPillar.map((p, i) => ({
                  label: `${p.label} (${p.posts})`, value: p.views,
                  display: fmtNum(p.views), color: PALETTE[i % PALETTE.length],
                }))} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Respons audiens" sub="Rata-rata interaksi per post" />
        <div className="px-4 pb-4 grid grid-cols-4 gap-3">
          <MiniStat label="Likes / post" value={fmtNum(Math.round(data.kpis.likes / Math.max(1, data.kpis.posts)))} />
          <MiniStat label="Comments / post" value={fmtNum(Math.round(data.kpis.comments / Math.max(1, data.kpis.posts)))} />
          <MiniStat label="Shares / post" value={fmtNum(Math.round(data.kpis.shares / Math.max(1, data.kpis.posts)))} />
          <MiniStat label="Views / post" value={fmtNum(data.kpis.viewsPerPost)} />
        </div>
      </Card>
    </div>
  )
}

export function CampaignSection({ data }: { data: AccountDetailPayload }) {
  const campaign = data.campaignSplit.find(c => c.label.startsWith('Campaign'))
  const organic = data.campaignSplit.find(c => c.label === 'Organic')

  if (!campaign || campaign.posts === 0) {
    return (
      <Card>
        <CardHead title="Campaign history" />
        <EmptyState icon="campaign" title="Belum ada post campaign"
          body={data.account.relation === 'competitor'
            ? 'Post kompetitor tidak punya penanda campaign — flag ini hanya ada di post brand kamu.'
            : 'Belum ada post akun ini yang ditandai campaign atau boosted.'} />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Campaign vs Organic" sub="Jumlah post" />
          <div className="px-4 pb-4">
            <Donut
              segments={data.campaignSplit.map((c, i) => ({ label: c.label, value: c.posts, color: PALETTE[i] }))}
              centerLabel={String(data.kpis.posts)} centerSub="post"
            />
          </div>
        </Card>
        <Card>
          <CardHead title="Engagement rate" sub="Campaign vs organik" />
          <div className="px-4 pb-4">
            <BarChart bars={data.campaignSplit.map((c, i) => ({
              label: c.label, value: c.erPct, color: PALETTE[i], display: `${c.erPct.toFixed(2)}%`,
            }))} height={190} />
            <p className="text-[11px] text-[#9ca3af] mt-2">
              Campaign {campaign.erPct.toFixed(2)}% ER · Organik {(organic?.erPct ?? 0).toFixed(2)}% ER
            </p>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Post campaign terbaru" sub={`${campaign.posts} post ditandai campaign atau boosted`} />
        <PostTable posts={data.recentCampaignPosts} />
      </Card>
    </div>
  )
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#f3f4f6] last:border-0">
      <span className="text-[11.5px] text-[#9ca3af]">{label}</span>
      <span style={PJ} className="text-[12px] font-bold text-[#374151] capitalize">{value}</span>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f9fafb] rounded-lg px-3 py-2.5 text-center">
      <div style={PJ} className="text-[15px] font-extrabold text-[#111827] tabular-nums">{value}</div>
      <div className="text-[10px] text-[#9ca3af] mt-0.5">{label}</div>
    </div>
  )
}

function PostTable({ posts }: { posts: AccountPost[] }) {
  if (posts.length === 0) return <EmptyState icon="inbox" title="Tidak ada post" />
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px]">
        <thead>
          <tr className="border-b border-[#e5e7eb]">
            {['#', 'Post', 'Format', 'Tanggal', 'Views', 'Likes', 'ER'].map((h, i) => (
              <th key={h} style={PJ}
                className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i > 3 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {posts.map((p, i) => (
            <tr key={p.key} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
              <td className="px-3 py-2 text-[11px] text-[#9ca3af] tabular-nums">{i + 1}</td>
              <td className="px-3 py-2">
                <div className="text-[11.5px] text-[#374151] truncate max-w-[280px]">{p.caption || '—'}</div>
                {p.pillar && <div className="text-[10px] text-[#285D6E] font-semibold mt-0.5">{p.pillar}</div>}
              </td>
              <td className="px-3 py-2">
                <span className="text-[11px] text-[#6b7280]">{p.format}</span>
                {p.sponsored && (
                  <span className="ml-1.5 text-[8.5px] font-extrabold uppercase bg-[#fdf3e7] text-[#b5761f] rounded px-1 py-0.5">
                    Ads
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-[11px] text-[#9ca3af]">{p.postDate ? fmtDate(p.postDate) : '—'}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{fmtNum(p.views)}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{fmtNum(p.likes)}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{p.erPct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
