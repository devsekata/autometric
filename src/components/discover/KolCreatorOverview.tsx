'use client'

/**
 * Overview — the Creator Intelligence Workspace's landing tab.
 *
 * Seven rows, each one the same pairing: the data on the left at 65%, the
 * reading of it on the right at 35%. Not two equal cards — equal weight would
 * claim the score matters as much as the chart it summarises, and the right
 * column earns its place precisely by being the short answer.
 *
 * Every row is a *snapshot*: three campaigns rather than the campaign table,
 * three posts rather than the grid. Each card carries a link to the tab that
 * holds the full version instead of growing to hold it here — the tab exists so
 * this page can stay answerable in thirty seconds.
 *
 * Provenance follows the rest of the workspace: sampled figures wear
 * `<SampleTag />`, and the two cards built on measured data — Similar Creators
 * and the roster standing inside the AI card — say so.
 */

import { useRouter } from 'next/navigation'
import { PJ, TOKENS as T, fmtNum } from './ui'
import { Bars, Donut, Meter, Row, ScoreBlock, Split, TrendChart, VIZ, VizCard } from './kolViz'
import { platformLabel, type SectionProps } from './KolCreatorSections'
import type { KolCreatorRank, KolSimilarRow } from '@/lib/discover/kolDirectory'

export type OverviewTab =
  'overview' | 'performance' | 'audience' | 'content' | 'campaigns' | 'brandfit' | 'ai'

export default function OverviewSection({
  creator, rank, platforms, similar, intel, onGoTo, orgSlug,
}: SectionProps & { onGoTo: (t: OverviewTab) => void; orgSlug: string }) {
  return (
    <div className="flex flex-col gap-4">
      {/* ── 1 · who is this creator, and are they any good ── */}
      <Split
        main={
          <VizCard title="Creator Overview">
            <p className="text-[12.5px] leading-[1.65] mb-3" style={{ color: T.t2 }}>
              {creator.bio || (
                <span style={{ color: T.t4 }}>
                  Roster tidak menyimpan bio untuk creator ini — kolom itu terisi hanya
                  untuk sekitar 12% roster.
                </span>
              )}
            </p>
            <Row label="Category" value={creator.categories[0] ?? '—'} />
            <Row label="Niche" value={creator.categories.slice(1).join(' · ') || '—'} />
            <Row label="Location" value={creator.city || 'belum diisi di roster'} />
            <Row label="Tier" value={creator.tier ?? '—'} />
            <Row label="Platforms" value={platforms.map(p => platformLabel(p.platform)).join(' · ')} />
            <Row label="Audience quality" value={`${intel.audience.qualityScore} / 100`} sample />
          </VizCard>
        }
        aside={
          <VizCard title="Creator Quality" sample>
            <ScoreBlock score={intel.quality.score} verdict={intel.quality.verdict} />
            <div className="flex flex-col gap-2 mt-3.5">
              {intel.quality.bars.map(b => <Meter key={b.label} label={b.label} value={b.pct} />)}
            </div>
          </VizCard>
        }
      />

      {/* ── 2 · performance ── */}
      <Split
        main={
          <VizCard title="Performance Trend" subtitle="Engagement rate — 6 bulan terakhir" sample
            action={<TabLink label="Performance" onClick={() => onGoTo('performance')} />}>
            <TrendChart points={intel.trend.map(p => ({ x: p.month, y: p.erPct }))}
              format={n => `${n.toFixed(2)}%`} label="Engagement rate" />
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

      {/* ── 3 · audience ── */}
      <Split
        main={
          <VizCard title="Audience Demographics" sample
            action={<TabLink label="Audience" onClick={() => onGoTo('audience')} />}>
            <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
              <div>
                <SubLabel>Gender</SubLabel>
                <Donut parts={intel.audience.gender} centerLabel="audiens"
                  centerValue={`${intel.audience.gender[0]?.pct ?? 0}%`} />
              </div>
              <div>
                <SubLabel>Age</SubLabel>
                <Bars parts={intel.audience.age} ordinal />
              </div>
            </div>
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Top Locations" sample>
              <Bars parts={intel.audience.location} />
            </VizCard>
            <VizCard title="Audience Interests" sample>
              <div className="flex flex-wrap gap-1.5">
                {intel.audience.interests.slice(0, 6).map(i => (
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

      {/* ── 4 · content ── */}
      <Split
        main={
          <VizCard title="Top Performing Content" sample
            action={<TabLink label="View all" onClick={() => onGoTo('content')} />}>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
              {intel.content.top.map((c, i) => (
                <div key={i} className="rounded-[12px] border overflow-hidden" style={{ borderColor: T.outline }}>
                  <div className="h-[86px] flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg,${VIZ.ordinal[i % VIZ.ordinal.length]},${VIZ.ordinal[(i + 2) % VIZ.ordinal.length]})` }}>
                    <span className="material-symbols-outlined text-white text-[22px] opacity-90">image</span>
                  </div>
                  <div className="p-2">
                    <div style={{ ...PJ, color: T.t1 }} className="text-[11px] font-bold truncate">{c.title}</div>
                    <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold mt-0.5">
                      {fmtNum(c.views)}
                    </div>
                    <div className="text-[10px]" style={{ color: T.t4 }}>views · ER {c.erPct}%</div>
                  </div>
                </div>
              ))}
            </div>
          </VizCard>
        }
        aside={
          <VizCard title="Content Performance" subtitle="Pembagian per format" sample>
            <Bars parts={intel.content.formats} />
          </VizCard>
        }
      />

      {/* ── 5 · campaigns ── */}
      <Split
        main={
          <VizCard title="Campaign History" sample
            action={<TabLink label="View all" onClick={() => onGoTo('campaigns')} />}>
            <div className="flex flex-col">
              {intel.campaigns.slice(0, 3).map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2.5"
                  style={{ borderBottom: i < 2 ? `1px solid ${T.outlineSoft}` : undefined }}>
                  <div className="min-w-0">
                    <div style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-bold truncate">
                      {c.brand} · {c.name}
                    </div>
                    <div className="text-[10.5px]" style={{ color: T.t4 }}>{c.period}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div style={{ ...PJ, color: c.status === 'Completed' ? '#3d8a5f' : '#b5761f' }}
                      className="text-[10px] font-extrabold">
                      {c.status}
                    </div>
                    <div style={{ ...PJ, color: T.primaryDeep }} className="text-[11.5px] font-extrabold tabular-nums">
                      ER {c.erPct}%
                    </div>
                  </div>
                </div>
              ))}
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

      <SimilarCreators similar={similar} rank={rank} orgSlug={orgSlug} />
    </div>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
      {children}
    </div>
  )
}

/** The "→ tab" affordance a snapshot card carries in its header. */
function TabLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...PJ, color: T.primary }}
      className="text-[10.5px] font-bold hover:underline whitespace-nowrap flex-shrink-0">
      {label} →
    </button>
  )
}

/* ── similar creators ─────────────────────────────────────────────────────── */

/**
 * Real rows, not sampled: roster neighbours in the same category, ordered by how
 * close their follower count is. This answers "siapa lagi yang sekelas dia,
 * mungkin lebih murah" — and it is one of the few questions on this page the
 * roster can answer exactly.
 */
function SimilarCreators({
  similar, rank, orgSlug,
}: { similar: KolSimilarRow[]; rank: KolCreatorRank; orgSlug: string }) {
  const router = useRouter()
  if (!similar.length) return null

  return (
    <VizCard title="Similar Creators"
      subtitle={rank.categoryName
        ? `Kategori ${rank.categoryName}, ukuran audiens terdekat — data asli roster`
        : 'Ukuran audiens terdekat di roster — data asli'}>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        {similar.map(s => (
          <button key={s.id} type="button"
            onClick={() => router.push(`/organizations/${orgSlug}/discover/kol-directory/${s.id}`)}
            style={{ borderColor: T.outline }}
            className="rounded-[14px] border p-3 text-left hover:bg-[#f9fbfc] transition-colors">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 overflow-hidden"
                style={{ background: T.gradient }}>
                {s.avatarUrl
                  // eslint-disable-next-line @next/next/no-img-element -- roster avatars come from CDNs not in next.config
                  ? <img src={s.avatarUrl} alt="" className="w-full h-full object-cover" />
                  : <span style={PJ} className="text-white text-[11px] font-extrabold">
                      {(s.username.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?').toUpperCase()}
                    </span>}
              </span>
              <div className="min-w-0">
                <div style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-bold truncate">@{s.username}</div>
                <div className="text-[10px]" style={{ color: T.t4 }}>
                  {platformLabel(s.platform)}{s.tier ? ` · ${s.tier}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[10.5px]" style={{ color: T.t3 }}>
                {s.followers === null ? '—' : fmtNum(s.followers)}
              </span>
              <span style={{ ...PJ, color: T.primaryDeep }} className="text-[10.5px] font-extrabold tabular-nums">
                {s.erPct === null ? 'ER —' : `ER ${s.erPct.toFixed(2)}%`}
              </span>
            </div>
          </button>
        ))}
      </div>
    </VizCard>
  )
}
