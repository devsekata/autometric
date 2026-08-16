'use client'

/**
 * The tab bodies of the Creator Intelligence Workspace.
 *
 * Split from the shell (`KolCreatorWorkspace`) purely for file size — the shell
 * owns the header, the KPI bar, the tab state and Overview; everything a tab
 * needs arrives through `SectionProps`.
 *
 * Provenance is the rule that shapes every section here: the roster backs
 * username, platform, followers, engagement rate, category, tier and verified —
 * and nothing else. Anything beyond that is sampled (see `@/lib/discover/kolSample`)
 * and is stamped with `<SampleTag />` at the figure, not just in a footnote. Where
 * a section can mix the two — Platform Comparison, whose follower counts and rates
 * are real for the 277 creators holding accounts on both platforms — the real
 * columns are left unstamped so the difference is visible in the same table.
 */

import { useMemo, useState } from 'react'
import { PJ, TOKENS as T, PLATFORM_ICON, fmtNum, Btn } from './ui'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import {
  Bars, Donut, EmptyBlock, Meter, Overlay, Row, SampleTag, ScoreBlock, Split, TrendChart,
  VIZ, VizCard, StatTile,
} from './kolViz'
import {
  CAMPAIGN_STAGES, type SampleContentItem, type SampleIntel,
} from '@/lib/discover/kolSample'
import type {
  KolCreatorPlatformRow, KolCreatorRank, KolDirectoryRow, KolSimilarRow,
} from '@/lib/discover/kolDirectory'

export interface SectionProps {
  creator: KolDirectoryRow
  rank: KolCreatorRank
  platforms: KolCreatorPlatformRow[]
  similar: KolSimilarRow[]
  intel: SampleIntel
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube',
}
export const platformLabel = (k: string | null) => (k ? PLATFORM_LABEL[k] ?? k : '—')

const pctLabel = (n: number) => `${n.toFixed(2)}%`
const usd = (n: number) => `$${n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n}`

/* ── Performance ──────────────────────────────────────────────────────────── */

type MetricKey = 'erPct' | 'reach' | 'views' | 'followers'

const METRICS: { key: MetricKey; label: string; format: (n: number) => string }[] = [
  { key: 'erPct', label: 'Engagement rate', format: n => `${n.toFixed(2)}%` },
  { key: 'reach', label: 'Reach', format: fmtNum },
  { key: 'views', label: 'Views', format: fmtNum },
  { key: 'followers', label: 'Followers', format: fmtNum },
]

const PERIODS = ['30 hari terakhir', '90 hari terakhir', '6 bulan terakhir'] as const

export function PerformanceSection({ creator, platforms, intel }: SectionProps) {
  const [metric, setMetric] = useState<MetricKey>('erPct')
  const [platform, setPlatform] = useState('all')
  const [period, setPeriod] = useState<string>(PERIODS[2])
  const m = METRICS.find(x => x.key === metric) ?? METRICS[0]

  /**
   * The period control trims the series rather than refetching: there is only
   * one sampled series behind it, and a filter that visibly does nothing is
   * worse than one that does the honest, small thing.
   */
  const months = period === PERIODS[0] ? 1 : period === PERIODS[1] ? 3 : 6
  const points = intel.trend.slice(-Math.max(2, months)).map(p => ({ x: p.month, y: p[metric] }))

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-filters sit in one row above the cards, never inside them. */}
      <div className="flex items-end gap-2.5 flex-wrap">
        <Field label="Platform">
          <Select value={platform} onChange={setPlatform}
            options={([['all', 'Semua platform']] as [string, string][])
              .concat(platforms.map(p => [p.platform ?? 'other', platformLabel(p.platform)] as [string, string]))} />
        </Field>
        <Field label="Period">
          <Select value={period} onChange={setPeriod}
            options={PERIODS.map(p => [p, p] as [string, string])} />
        </Field>
        <Field label="Metric">
          <Select value={metric} onChange={v => setMetric(v as MetricKey)}
            options={METRICS.map(x => [x.key, x.label] as [string, string])} />
        </Field>
      </div>

      <VizCard title="Performance Overview" subtitle="Rata-rata per konten">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          {/* The only measured figure in this card carries no marker. */}
          <StatTile label="Engagement Rate"
            value={creator.erPct === null ? 'belum diukur' : pctLabel(creator.erPct)}
            hint={creator.erPct === null ? undefined : 'dari roster KOL'} />
          <StatTile label="Reach" value={fmtNum(intel.kpi.avgReach)} sample />
          <StatTile label="Impressions" value={fmtNum(intel.performance.impressions)} sample />
          <StatTile label="Views" value={fmtNum(intel.kpi.avgViews)} sample />
          <StatTile label="Likes" value={fmtNum(intel.performance.likes)} sample />
          <StatTile label="Comments" value={fmtNum(intel.performance.comments)} sample />
          <StatTile label="Shares" value={fmtNum(intel.performance.shares)} sample />
          <StatTile label="Saves" value={fmtNum(intel.performance.saves)} sample />
        </div>
      </VizCard>

      <Split
        main={
          <VizCard title="Performance Trend" subtitle={`${m.label} · ${period.toLowerCase()}`} sample>
            {/* One metric at a time: two units on one chart would need a second
                y-axis, which is never the answer. */}
            <TrendChart points={points} format={m.format} label={m.label} />
            <p className="text-[9.5px] mt-1.5" style={{ color: T.t4 }}>
              Titik terakhir menempel pada engagement rate asli creator ini; lima bulan
              sebelumnya adalah contoh.
            </p>
          </VizCard>
        }
        aside={
          <VizCard title="Performance Highlights" sample>
            <div className="flex flex-col gap-3">
              {intel.highlights.map(h => (
                <div key={h.headline} className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[16px] mt-px"
                    style={{ color: h.tone === 'good' ? VIZ.good : h.tone === 'warning' ? VIZ.warning : T.t4 }}>
                    {h.icon}
                  </span>
                  <div>
                    <div style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-extrabold">{h.headline}</div>
                    <div className="text-[10.5px] mt-0.5 leading-[1.45]" style={{ color: T.t3 }}>{h.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </VizCard>
        }
      />

      <VizCard title="Platform Comparison"
        subtitle={platforms.length > 1
          ? 'Followers dan engagement rate di bawah adalah data asli roster'
          : 'Creator ini hanya punya satu akun di roster'}>
        {platforms.length > 1 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.outline}` }}>
                  <th className="text-left py-2 font-bold" style={{ color: T.t3 }}>Metric</th>
                  {platforms.map(p => (
                    <th key={p.id} className="text-right py-2 font-bold" style={{ color: T.t2 }}>
                      <span className="inline-flex items-center gap-1 justify-end">
                        <span className="material-symbols-outlined text-[14px]" style={{ color: T.primary }}>
                          {PLATFORM_ICON[p.platform ?? ''] ?? 'public'}
                        </span>
                        {platformLabel(p.platform)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <MetricRow label="Followers" cells={platforms.map(p => (p.followers === null ? '—' : fmtNum(p.followers)))} />
                <MetricRow label="Engagement rate"
                  cells={platforms.map(p => (p.erPct === null ? 'belum diukur' : pctLabel(p.erPct)))} />
                <MetricRow label="Avg. reach" sample
                  cells={platforms.map(p => fmtNum(Math.round((p.followers ?? 0) * 0.32)))} />
                <MetricRow label="Avg. views" sample
                  cells={platforms.map(p => fmtNum(Math.round((p.followers ?? 0) * 0.41)))} />
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11.5px]" style={{ color: T.t3 }}>
            Hanya ada satu akun ({platformLabel(creator.platform)}) untuk username ini di
            roster, jadi tidak ada yang bisa dibandingkan. 277 creator di roster punya
            akun di dua platform sekaligus.
          </p>
        )}
      </VizCard>

      <Split
        main={
          <VizCard title="Growth" subtitle="Follower growth — 6 bulan" sample>
            <TrendChart points={intel.trend.map(p => ({ x: p.month, y: p.followers }))}
              format={fmtNum} label="Followers" />
            <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
              <StatTile label="Current followers"
                value={creator.followers === null ? '—' : fmtNum(creator.followers)}
                hint="data asli roster" />
              <StatTile label="Monthly" value={`${intel.growth.monthly}%`} sample />
              <StatTile label="3 bulan" value={`${intel.growth.threeMonth}%`} sample />
              <StatTile label="6 bulan" value={`${intel.growth.sixMonth}%`} sample />
            </div>
          </VizCard>
        }
        aside={<EngagementBreakdown intel={intel} />}
      />
    </div>
  )
}

/**
 * Where the engagement actually comes from — likes, comments, shares and saves
 * as a share of total interactions. Nominal categories, so every bar wears the
 * same hue: the bar length is the value, and colouring them differently would
 * claim an identity the four do not have.
 */
function EngagementBreakdown({ intel }: { intel: SampleIntel }) {
  const p = intel.performance
  const total = p.likes + p.comments + p.shares + p.saves || 1
  const parts = [
    { label: 'Likes', n: p.likes },
    { label: 'Comments', n: p.comments },
    { label: 'Shares', n: p.shares },
    { label: 'Saves', n: p.saves },
  ].map(x => ({ label: x.label, pct: Math.round((x.n / total) * 1000) / 10 }))

  return (
    <VizCard title="Engagement Breakdown" subtitle="Bagian dari total interaksi" sample>
      <Bars parts={parts} />
      <div className="mt-3">
        <Row label="Total interaksi" value={fmtNum(total)} sample />
      </div>
    </VizCard>
  )
}

function MetricRow({ label, cells, sample }: { label: string; cells: string[]; sample?: boolean }) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
      <td className="py-2" style={{ color: T.t3 }}>
        <span className="inline-flex items-center gap-1.5">{label}{sample && <SampleTag compact />}</span>
      </td>
      {cells.map((c, i) => (
        <td key={i} className="py-2 text-right tabular-nums" style={{ ...PJ, color: T.t1, fontWeight: 700 }}>{c}</td>
      ))}
    </tr>
  )
}


/* ── Content ──────────────────────────────────────────────────────────────── */

const CONTENT_SORTS = [
  ['top', 'Top performing'], ['recent', 'Terbaru'], ['views', 'Views terbanyak'],
] as const

/**
 * Content gets its own tab rather than living under Performance: "konten apa
 * yang berhasil" is the question a brief is written from, and it is asked on
 * its own, not as a footnote to the rate.
 */
export function ContentSection({ creator, intel }: SectionProps) {
  const [format, setFormat] = useState('all')
  const [sort, setSort] = useState<string>('top')
  const [openItem, setOpenItem] = useState<SampleContentItem | null>(null)

  const formats = useMemo(
    () => [...new Set(intel.content.recent.map(c => c.format))], [intel.content.recent])

  const items = useMemo(() => {
    const out = intel.content.recent.filter(c => format === 'all' || c.format === format)
    if (sort === 'views') return [...out].sort((a, b) => b.views - a.views)
    if (sort === 'top') return [...out].sort((a, b) => b.erPct - a.erPct)
    return out
  }, [intel.content.recent, format, sort])

  return (
    <div className="flex flex-col gap-4">
      <Split
        main={
          <VizCard title="Content Performance" sample
            subtitle="Roster tidak menyimpan satu pun post — seluruh konten di bawah contoh"
            action={
              <div className="flex gap-1.5 flex-wrap">
                <Select value={format} onChange={setFormat}
                  options={([['all', 'Semua format']] as [string, string][])
                    .concat(formats.map(f => [f, f] as [string, string]))} />
                <Select value={sort} onChange={setSort}
                  options={CONTENT_SORTS.map(([v, l]) => [v, l] as [string, string])} />
              </div>
            }>
            {items.length === 0 ? (
              <EmptyBlock icon="grid_off" title="Tidak ada konten pada filter ini"
                body="Coba ganti format atau urutannya."
                action={
                  <Btn onClick={() => { setFormat('all'); setSort('top') }}>Reset filter</Btn>
                } />
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))' }}>
                {items.map((c, i) => (
                  <button key={`${c.title}-${i}`} type="button" onClick={() => setOpenItem(c)}
                    className="rounded-[12px] border overflow-hidden text-left hover:brightness-[.99] transition"
                    style={{ borderColor: T.outline }}>
                    <div className="h-[96px] flex items-center justify-center"
                      style={{ background: `linear-gradient(135deg,${VIZ.ordinal[i % VIZ.ordinal.length]},${VIZ.ordinal[(i + 2) % VIZ.ordinal.length]})` }}>
                      <span className="material-symbols-outlined text-white text-[22px] opacity-90">
                        {c.format === 'Reels' || c.format === 'Video' ? 'play_circle' : 'image'}
                      </span>
                    </div>
                    <div className="p-2">
                      <div style={{ ...PJ, color: T.t1 }} className="text-[11px] font-bold truncate">{c.title}</div>
                      <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold mt-0.5">
                        {fmtNum(c.views)}
                      </div>
                      <div className="text-[10px]" style={{ color: T.t4 }}>
                        views · ER {c.erPct}% · {fmtNum(c.likes)} likes
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Content Format" sample>
              <Bars parts={intel.content.formats} />
            </VizCard>
            <VizCard title="Content Topic" sample>
              <Bars parts={intel.content.topics} />
            </VizCard>
            <VizCard title="Sentiment" sample>
              <SentimentBars parts={intel.content.sentiment} />
            </VizCard>
          </>
        }
      />

      <ContentDetail item={openItem} creator={creator} onClose={() => setOpenItem(null)} />
    </div>
  )
}

function ContentDetail({
  item, creator, onClose,
}: { item: SampleContentItem | null; creator: KolDirectoryRow; onClose: () => void }) {
  return (
    <Overlay open={item !== null} title="Content Detail" onClose={onClose}>
      {item && (
        <div className="flex gap-4 flex-wrap">
          <div className="w-[200px] flex-shrink-0">
            <div className="h-[200px] rounded-[14px] flex items-center justify-center"
              style={{ background: `linear-gradient(135deg,${VIZ.ordinal[1]},${VIZ.ordinal[3]})` }}>
              <span className="material-symbols-outlined text-white text-[30px] opacity-90">
                {item.format === 'Reels' || item.format === 'Video' ? 'play_circle' : 'image'}
              </span>
            </div>
            <div className="text-[10.5px] mt-2 text-center" style={{ color: T.t4 }}>
              {item.platform} · {item.format} · {item.postedAt}
            </div>
          </div>

          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span style={{ ...PJ, color: T.t1 }} className="text-[12.5px] font-extrabold">{item.title}</span>
              <SampleTag compact />
            </div>
            <p className="text-[11.5px] leading-[1.6] mb-3" style={{ color: T.t2 }}>{item.caption}</p>

            <Row label="Views" value={fmtNum(item.views)} />
            <Row label="Likes" value={fmtNum(item.likes)} />
            <Row label="Comments" value={fmtNum(item.comments)} />
            <Row label="Shares" value={fmtNum(item.shares)} />
            <Row label="Saves" value={fmtNum(item.saves)} />
            <Row label="Engagement rate" value={`${item.erPct}%`} />
            <Row label="Sentiment" value={
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]"
                  style={{ color: item.sentiment === 'Positif' ? VIZ.good : T.t4 }}>
                  {item.sentiment === 'Positif' ? 'sentiment_satisfied' : 'sentiment_neutral'}
                </span>
                {item.sentiment}
              </span>
            } />

            <div className="mt-3">
              <div className="text-[10.5px] mb-1.5" style={{ color: T.t3 }}>Hashtags</div>
              <div className="flex flex-wrap gap-1.5">
                {item.hashtags.map(h => (
                  <span key={h} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-6 px-2 rounded-md text-[10.5px] font-bold inline-flex items-center">
                    {h}
                  </span>
                ))}
              </div>
            </div>

            {creator.profileUrl && (
              <a href={creator.profileUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...PJ, color: T.primary }}
                className="inline-flex items-center gap-1 text-[11px] font-bold mt-3.5 hover:underline">
                Buka profil asli
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              </a>
            )}
          </div>
        </div>
      )}
    </Overlay>
  )
}

/** Sentiment wears status colours, so each row carries an icon and a label. */
function SentimentBars({ parts }: { parts: { label: string; pct: number }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((s, i) => {
        const tone = [
          { c: VIZ.good, icon: 'sentiment_satisfied' },
          { c: T.t4, icon: 'sentiment_neutral' },
          { c: VIZ.critical, icon: 'sentiment_dissatisfied' },
        ][i] ?? { c: T.t4, icon: 'circle' }
        return (
          <div key={s.label} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]" style={{ color: tone.c }}>{tone.icon}</span>
            <span className="text-[11px] w-[48px]" style={{ color: T.t3 }}>{s.label}</span>
            <div className="flex-1 h-[10px] rounded-[4px]" style={{ background: T.outlineSoft }}>
              <div className="h-full rounded-r-[4px]" style={{ width: `${s.pct}%`, background: tone.c }} />
            </div>
            <span style={{ ...PJ, color: T.t1 }} className="text-[11px] font-extrabold w-[38px] text-right tabular-nums">
              {s.pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Audience Insights ────────────────────────────────────────────────────── */

export function AudienceSection({ intel }: SectionProps) {
  const a = intel.audience
  return (
    <div className="flex flex-col gap-4">
      <VizCard title="Audience Quality" sample
        subtitle="Kualitas audiens dinilai dari aktivitas, perilaku dan sinyal akun">
        <div className="grid gap-2.5 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <StatTile label="Audience authenticity" value={`${a.authenticity}%`} sample />
          <StatTile label="Quality score" value={`${a.qualityScore} / 100`} sample />
          <StatTile label="Potential reach" value={fmtNum(a.potentialReach)} sample />
        </div>
        <Meter label="Authenticity" value={a.authenticity} />
      </VizCard>

      <Split
        main={
          <VizCard title="Audience Demographics" sample>
            <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
              <div>
                <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                  Gender
                </div>
                <Donut parts={a.gender} centerLabel="audiens" centerValue={`${a.gender[0]?.pct ?? 0}%`} />
              </div>
              <div>
                <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                  Age
                </div>
                {/* Ordinal ramp: the order of the bands is part of the meaning. */}
                <Bars parts={a.age} ordinal />
              </div>
            </div>
            <div className="mt-5">
              <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                Generation
              </div>
              <Bars parts={a.generation} />
            </div>
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Top Locations" sample>
              <Bars parts={a.location} />
            </VizCard>
            <VizCard title="Audience Interests" sample>
              <div className="flex flex-wrap gap-1.5">
                {a.interests.map(i => (
                  <span key={i} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center">
                    {i}
                  </span>
                ))}
              </div>
            </VizCard>
          </>
        }
      />

      <Split
        main={
          <VizCard title="Audience Authenticity" sample>
            <Bars parts={a.quality} />
            <p className="text-[9.5px] mt-2.5 leading-[1.5]" style={{ color: T.t4 }}>
              Angka authenticity biasanya dihitung dari rasio akun aktif, pola komentar
              dan lonjakan follower. Roster KOL belum menyimpan satu pun sinyal itu.
            </p>
          </VizCard>
        }
        aside={
          <VizCard title="Quality Score" sample>
            <ScoreBlock score={a.qualityScore} verdict={a.qualityScore >= 85 ? 'Strong' : 'Fair'} />
          </VizCard>
        }
      />
    </div>
  )
}

/* ── Campaign History ─────────────────────────────────────────────────────── */

export function CampaignSection({ intel }: SectionProps) {
  const [open, setOpen] = useState<number | null>(0)
  const [status, setStatus] = useState('all')
  const [brand, setBrand] = useState('all')

  const brands = useMemo(
    () => [...new Set(intel.campaigns.map(c => c.brand))], [intel.campaigns])
  const rows = useMemo(
    () => intel.campaigns.filter(c =>
      (status === 'all' || c.status === status) && (brand === 'all' || c.brand === brand)),
    [intel.campaigns, status, brand])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2.5 flex-wrap">
        <Field label="Status">
          <Select value={status} onChange={setStatus}
            options={[['all', 'Semua status'], ['Completed', 'Completed'], ['Running', 'Running']]} />
        </Field>
        <Field label="Brand">
          <Select value={brand} onChange={setBrand}
            options={([['all', 'Semua brand']] as [string, string][])
              .concat(brands.map(b => [b, b] as [string, string]))} />
        </Field>
      </div>

      <Split
        main={
      <VizCard title="Campaign History" sample
        subtitle="Tabel campaign platform KOL masih kosong — seluruh baris di bawah contoh">
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.outline}` }}>
                {['Campaign', 'Brand', 'Period', 'Deliverables', 'Budget', 'Status', 'Performance'].map(h => (
                  <th key={h} className="text-left py-2 font-bold whitespace-nowrap" style={{ color: T.t3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={i} onClick={() => setOpen(open === i ? null : i)}
                  className="cursor-pointer hover:bg-[#f9fbfc]"
                  style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
                  <td className="py-2.5" style={{ ...PJ, color: T.t1, fontWeight: 700 }}>{c.name}</td>
                  <td className="py-2.5" style={{ color: T.t2 }}>{c.brand}</td>
                  <td className="py-2.5 whitespace-nowrap" style={{ color: T.t3 }}>{c.period}</td>
                  <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>{c.deliverables}</td>
                  <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>{usd(c.budgetUsd)}</td>
                  <td className="py-2.5">
                    <span style={{
                      ...PJ,
                      background: c.status === 'Completed' ? '#eaf5ef' : '#fdf3e7',
                      color: c.status === 'Completed' ? '#3d8a5f' : '#b5761f',
                    }} className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5 tabular-nums" style={{ ...PJ, color: T.primaryDeep, fontWeight: 800 }}>
                    {c.erPct}% ER
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VizCard>
        }
        aside={
          <VizCard title="Collaboration Summary" sample>
            <Row label="Campaigns completed" value={intel.collaboration.completed} />
            <Row label="Avg campaign ER" value={`${intel.collaboration.avgCampaignErPct}%`} />
            <Row label="On-time delivery" value={`${intel.collaboration.onTimePct}%`} />
            <Row label="Repeat collaborations" value={intel.collaboration.repeat} />
            <div className="mt-3">
              <Meter label="Reliability" value={intel.collaboration.reliability} />
            </div>
          </VizCard>
        }
      />

      {open !== null && rows[open] && (
        <VizCard title={`Campaign Overview — ${rows[open].name}`} sample>
          <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
            <StatTile label="Status" value={rows[open].status} sample />
            <StatTile label="Deliverables"
              value={`${rows[open].deliverables} / ${rows[open].deliverables}`} sample />
            <StatTile label="Budget" value={usd(rows[open].budgetUsd)} sample />
            <StatTile label="Payment" value={rows[open].paid ? 'Paid' : 'Pending'} sample />
            <StatTile label="ROAS" value={`${rows[open].roas}x`} sample />
            <StatTile label="Reach" value={fmtNum(rows[open].reach)} sample />
            <StatTile label="Engagement" value={fmtNum(rows[open].engagement)} sample />
          </div>

          <div style={{ ...PJ, color: T.t2 }} className="text-[11.5px] font-extrabold mb-2">Campaign Timeline</div>
          <div className="flex items-center gap-1 flex-wrap">
            {CAMPAIGN_STAGES.map((s, i) => {
              const done = i <= rows[open].stage
              return (
                <span key={s} className="inline-flex items-center gap-1">
                  <span style={{
                    ...PJ,
                    background: done ? T.surfaceVariant : T.surface,
                    borderColor: done ? T.primary : T.outline,
                    color: done ? T.primaryDeep : T.t4,
                  }} className="h-7 px-2.5 rounded-lg border text-[10.5px] font-bold inline-flex items-center gap-1">
                    {done && <span className="material-symbols-outlined text-[13px]">check</span>}
                    {s}
                  </span>
                  {i < CAMPAIGN_STAGES.length - 1 && (
                    <span className="material-symbols-outlined text-[14px]" style={{ color: T.outline }}>
                      chevron_right
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        </VizCard>
      )}
    </div>
  )
}

/* ── Brand Fit ────────────────────────────────────────────────────────────── */

export function BrandFitSection({ intel }: SectionProps) {
  const f = intel.brandFit
  return (
    <div className="flex flex-col gap-4">
      <Split
        main={
          <VizCard title="Brand Fit" sample
            subtitle="Skor ini butuh data audiens dan riwayat campaign — keduanya belum ada">
            <div className="flex items-center gap-7 flex-wrap">
              <div className="w-[128px] flex-shrink-0">
                <ScoreBlock score={f.score} verdict={f.verdict} />
              </div>
              <div className="flex-1 min-w-[240px] flex flex-col gap-2.5">
                {f.bars.map(b => <Meter key={b.label} label={b.label} value={b.pct} />)}
              </div>
            </div>
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Why this creator fits" sample>
              <ul className="flex flex-col gap-2">
                {f.strengths.map(s => (
                  <li key={s} className="flex items-start gap-2 text-[11.5px] leading-[1.5]" style={{ color: T.t2 }}>
                    <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.good }}>check_circle</span>
                    {s}
                  </li>
                ))}
              </ul>
            </VizCard>

            <VizCard title="Potential Risk" sample>
              <ul className="flex flex-col gap-2">
                {f.watchouts.map(s => (
                  <li key={s} className="flex items-start gap-2 text-[11.5px] leading-[1.5]" style={{ color: T.t2 }}>
                    <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.warning }}>warning</span>
                    {s}
                  </li>
                ))}
              </ul>
            </VizCard>
          </>
        }
      />
    </div>
  )
}

/* ── AI Insights ──────────────────────────────────────────────────────────── */

export function AiSection({ creator, rank, intel }: SectionProps) {
  const ai = intel.ai
  return (
    <div className="flex flex-col gap-4">
      <VizCard title="AI Summary" sample>
        <p className="text-[12.5px] leading-[1.65]" style={{ color: T.t2 }}>{ai.summary}</p>
        {/* The one paragraph on this tab that is not sampled. */}
        <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: T.surfaceVariant }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>verified</span>
            <span style={{ ...PJ, color: T.primaryDeep }} className="text-[10.5px] font-extrabold uppercase tracking-wide">
              Dari data asli
            </span>
          </div>
          <p className="text-[11.5px] leading-[1.6]" style={{ color: T.t2 }}>
            @{creator.username} berada di peringkat <b>#{rank.followersRank.toLocaleString('id-ID')}</b> dari{' '}
            {rank.rosterTotal.toLocaleString('id-ID')} creator berdasarkan followers
            {rank.categoryName && rank.categoryFollowersRank !== null && (
              <> — dan <b>#{rank.categoryFollowersRank}</b> di kategori {rank.categoryName}{' '}
              ({rank.categoryTotal.toLocaleString('id-ID')} creator)</>
            )}
            {rank.erRank !== null && (
              <>. Engagement rate-nya peringkat <b>#{rank.erRank.toLocaleString('id-ID')}</b> dari{' '}
              {rank.erMeasuredTotal.toLocaleString('id-ID')} creator yang pernah diukur</>
            )}.
          </p>
        </div>
      </VizCard>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <VizCard title="Strengths" sample>
          <ul className="flex flex-col gap-2">
            {ai.strengths.map(s => (
              <li key={s} className="flex items-start gap-2 text-[11.5px]" style={{ color: T.t2 }}>
                <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.good }}>check</span>
                {s}
              </li>
            ))}
          </ul>
        </VizCard>

        <VizCard title="Watch-outs" sample>
          <ul className="flex flex-col gap-2">
            {ai.watchouts.map(s => (
              <li key={s} className="flex items-start gap-2 text-[11.5px]" style={{ color: T.t2 }}>
                <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.warning }}>warning</span>
                {s}
              </li>
            ))}
          </ul>
        </VizCard>
      </div>

      <Split
        main={
          <VizCard title="Predicted Growth" sample>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }}>
              <StatTile label="Current" value={creator.followers === null ? '—' : fmtNum(creator.followers)}
                hint="data asli" />
              <StatTile label="30 hari" value={fmtNum(ai.predicted.d30)} sample />
              <StatTile label="90 hari" value={fmtNum(ai.predicted.d90)} sample />
              <StatTile label="6 bulan" value={fmtNum(ai.predicted.m6)} sample />
            </div>
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Recommended Campaign" sample>
              <Row label="Campaign type" value={ai.suggestion.campaignType} />
              <Row label="Best content" value={ai.suggestion.content} />
              <Row label="Objective" value={ai.suggestion.objective} />
              <Row label="Posting time" value={ai.suggestion.postingTime} />
            </VizCard>

            <VizCard title="Suggested Brands" sample>
              <div className="flex flex-wrap gap-1.5">
                {intel.suggestedBrands.map(b => (
                  <span key={b} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center">
                    {b}
                  </span>
                ))}
              </div>
            </VizCard>
          </>
        }
      />
    </div>
  )
}

/* ── shared form bits ─────────────────────────────────────────────────────── */

/** Used by the sub-filter rows above Performance, Content and Campaign. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] mb-1" style={{ color: T.t3 }}>{label}</div>
      {children}
    </div>
  )
}

function Select({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full h-8 rounded-lg border px-2 text-[11.5px]"
      style={{ borderColor: T.outline, color: T.t1, background: T.surface }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
