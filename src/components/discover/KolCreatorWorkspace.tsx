'use client'

/**
 * Creator Profile — what a creator card in the KOL Directory opens into.
 *
 * Deliberately not a second dashboard. It renders inside the app's existing
 * shell — same sidebar, same topbar, same tokens, same card style — and only
 * the main content area changes.
 *
 * Shape: back link → creator header → three primary KPIs → six secondary KPIs →
 * a two-column body whose LEFT column is this page's own navigation, not the
 * app's. That distinction matters: the app sidebar says where you are in the
 * product, this one says which view of one creator you are reading. Horizontal
 * tabs were the earlier shape and lost that separation — seven labels in a strip
 * read as peers of Directory rather than as sections of a record.
 *
 * ── What is real and what is not ─────────────────────────────────────────────
 * The roster stores identity. Real here: display name and agency (from the
 * agency tables — 7.684 of 7.718 rows carry a name), username, platform, avatar,
 * bio, followers, engagement rate, category, tier, verified, last refresh, the
 * follower split across the creator's accounts, and every ranking the API
 * computes (roster, category, engagement inside the category).
 *
 * Part of the rest is measured too, for the creators the warehouse has actually
 * harvested: likes, comments, views, the format mix and the content grid come
 * from `l1_silver.unified_post`, and prices from `l1_silver.unified_rate_card`.
 * `@/lib/discover/kolIntel` overlays those onto the sampled shape and reports,
 * per field, which is which.
 *
 * What still has no source anywhere — reach, EMV, CPE, growth, audience
 * demographics, campaigns, brand fit and AI prose — stays sampled and is marked
 * as an estimate at every figure.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PJ, TOKENS as T, PLATFORM_ICON, Btn, fmtNum, RosterAvatar } from './ui'
import { ErrorBlock, Overlay, Row, SampleTag, Skeleton, StatTile, VIZ } from './kolViz'
import { ProfileSection, InsightsSection } from './KolCreatorProfile'
import KolCreatorReport from './KolCreatorReport'
import {
  AiSection, AudienceSection, BrandFitSection, CampaignSection, ContentSection,
  PerformanceSection, platformLabel, type SectionProps,
} from './KolCreatorSections'
import { creatorIntel, measuredBasis, type CreatorIntel } from '@/lib/discover/kolIntel'
import { tabHref } from '@/lib/discover/tabs'
import type { KolCreatorPayload } from '@/lib/discover/kolDirectory'
import type { KolMeasuredRate } from '@/lib/discover/kolMeasured'

/**
 * The creator navigation. Report is absent on purpose — it is an action in the
 * header, not a view of the creator.
 */
const NAV = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'content', label: 'Content Analytics', icon: 'grid_view' },
  { id: 'analytics', label: 'Analytics', icon: 'insights' },
  { id: 'audience', label: 'Audience Insights', icon: 'group' },
  { id: 'campaigns', label: 'Brand & Campaign History', icon: 'campaign' },
  { id: 'ai', label: 'AI Insights', icon: 'auto_awesome' },
  { id: 'insights', label: 'Insights', icon: 'lightbulb' },
] as const

type NavId = (typeof NAV)[number]['id']

const CAMPAIGN_OPTIONS = ['Summer Beauty Campaign', 'Ramadan 2026', 'Product Launch Q3']

export default function KolCreatorWorkspace({
  orgId, orgSlug, kolId,
}: { orgId: string; orgSlug: string; kolId: string }) {
  const router = useRouter()
  const [data, setData] = useState<KolCreatorPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<NavId>('profile')

  const [fav, setFav] = useState(false)
  const [compareTray, setCompareTray] = useState(false)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [addedTo, setAddedTo] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setData(null)
    // Landing on a creator from Similar Creators starts at the top of their
    // page, not wherever the previous creator was being read.
    setView('profile')
    fetch(`/api/organizations/${orgId}/discover/kol-directory/${kolId}`)
      .then(async r => {
        if (r.ok) return r.json()
        const body = await r.json().catch(() => null)
        throw new Error(body?.detail || body?.error || `HTTP ${r.status}`)
      })
      .then((d: KolCreatorPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, kolId, reload])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  /**
   * Measured figures where the warehouse has them, sampled everywhere else. The
   * sampled half is seeded from the creator id, so it is identical on every
   * render and every reload — placeholder numbers that reshuffle themselves make
   * the screen obviously fake and screenshots irreproducible.
   */
  const intel = useMemo(
    () => (data ? creatorIntel(data.creator, data.measured) : null),
    [data],
  )

  /**
   * Back to the list this creator was opened from — the Creator Database,
   * named rather than left to Discovery's default.
   *
   * `/discover/kol` used to be that list. It is a redirect now, and it resolves
   * to Discovery's landing page, so leaving it here would answer "back" with
   * the front door: a search you spent three filters on, gone.
   */
  const backToDirectory = () => router.push(tabHref(orgSlug, 'directory', 'database'))

  /** Similar Creators hands back `creator:<id>`; everything else is a nav id. */
  const goTo = (id: string) => {
    if (id.startsWith('creator:')) {
      router.push(`/organizations/${orgSlug}/discover/kol-directory/${id.slice(8)}`)
      return
    }
    setView(id as NavId)
  }

  return (
    <div className="p-5 pb-24 max-w-[1360px] mx-auto">
      <button type="button" onClick={backToDirectory} style={{ ...PJ, color: T.primary }}
        className="inline-flex items-center gap-1 text-[11.5px] font-bold hover:underline mb-1.5">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Back to Directory
      </button>

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap mb-3">
        {['Discovery', 'Directory', data
          ? (data.identity.displayName ?? `@${data.creator.username}`)
          : 'Creator Profile'].map((label, i) => (
          <span key={label} className="inline-flex items-center gap-1">
            {i > 0 && <span className="material-symbols-outlined text-[13px]" style={{ color: T.outline }}>chevron_right</span>}
            <span style={{ ...PJ, color: T.t4 }} className="text-[10.5px] font-bold uppercase tracking-widest">
              {label}
            </span>
          </span>
        ))}
      </nav>

      {error ? (
        <div className="rounded-[18px] border" style={{ borderColor: T.outline, background: VIZ.surface }}>
          <ErrorBlock title="Creator gagal dimuat"
            body={`Kami tidak bisa mengambil data creator ini. ${error}`}
            onRetry={() => setReload(n => n + 1)} />
        </div>
      ) : !data || !intel ? (
        <CreatorSkeleton />
      ) : (
        <Loaded
          data={data} intel={intel} view={view} goTo={goTo}
          fav={fav} setFav={setFav}
          onCompare={() => { setCompareTray(true); setToast('Ditambahkan ke compare') }}
          onAddCampaign={() => setCampaignOpen(true)}
          onReport={() => setReportOpen(true)}
          addedTo={addedTo}
          setToast={setToast}
        />
      )}

      {data && intel && (
        <>
          <AddToCampaign
            open={campaignOpen} onClose={() => setCampaignOpen(false)}
            name={data.identity.displayName ?? `@${data.creator.username}`}
            username={data.creator.username}
            tier={data.creator.tier}
            rates={data.measured?.rates ?? []}
            onAdd={campaign => {
              setAddedTo(campaign)
              setCampaignOpen(false)
              setToast(`@${data.creator.username} ditambahkan ke ${campaign}`)
            }} />

          <KolCreatorReport
            open={reportOpen} onClose={() => setReportOpen(false)}
            creator={data.creator} rank={data.rank} platforms={data.platforms} intel={intel} />
        </>
      )}

      {compareTray && data && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 flex-wrap"
          style={{ background: VIZ.surface, borderColor: T.outline, boxShadow: T.shadowMd }}>
          <span style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide">
            Compare
          </span>
          <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
            className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1">
            {data.identity.displayName ?? `@${data.creator.username}`}
            <button type="button" onClick={() => setCompareTray(false)}
              className="material-symbols-outlined text-[13px] cursor-pointer" title="Hapus">close</button>
          </span>
          <span className="text-[11px]" style={{ color: T.t4 }}>+ tambah creator lain dari Directory</span>
          <Btn variant="primary" size="sm" onClick={backToDirectory}>Compare Now</Btn>
        </div>
      )}

      {toast && (
        <div style={{ ...PJ, background: T.primaryDeep }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 text-white text-[11.5px] font-bold px-3.5 py-2 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ── loaded page ──────────────────────────────────────────────────────────── */

function Loaded({
  data, intel, view, goTo, fav, setFav, onCompare, onAddCampaign, onReport, addedTo, setToast,
}: {
  data: KolCreatorPayload
  intel: CreatorIntel
  view: NavId
  goTo: (id: string) => void
  fav: boolean
  setFav: (f: (v: boolean) => boolean) => void
  onCompare: () => void
  onAddCampaign: () => void
  onReport: () => void
  addedTo: string | null
  setToast: (s: string) => void
}) {
  const { creator, identity, rank, platforms, similar } = data
  const sectionProps: SectionProps = { creator, identity, rank, platforms, similar, intel, gold: data.gold }
  const name = identity.displayName ?? `@${creator.username}`

  const estReach = creator.followers !== null && creator.erPct !== null
    ? Math.round((creator.followers * creator.erPct) / 100)
    : null

  /** "Top N% in category" — the real standing, not a slogan. */
  const categoryTop = rank.categoryErPercentile === null
    ? null : Math.max(1, Math.round(100 - rank.categoryErPercentile))

  /**
   * The creator's own prices, cheapest first. `fee` is what the KOL platform
   * records, so this KPI is a measurement and prints without a marker.
   */
  const rates = [...(intel.measured?.rates ?? [])]
    .filter(r => Number.isFinite(r.fee) && r.fee > 0)
    .sort((a, b) => a.fee - b.fee)
  const cheapestRate = rates[0] ?? null
  const rateCount = rates.length

  const viewsBasis = measuredBasis(intel) ?? 'avg / post'

  return (
    <>
      {/* ── creator header ── */}
      <div className="rounded-[18px] border overflow-hidden mb-4"
        style={{ borderColor: T.outline, background: VIZ.surface }}>
        <div className="h-[76px]" style={{ background: T.gradient }} />
        <div className="px-4 pb-4 -mt-9">
          <div className="flex items-end gap-3.5 flex-wrap">
            <div className="w-20 h-20 rounded-[20px] border-[3px] flex-shrink-0 overflow-hidden flex items-center justify-center"
              style={{ borderColor: VIZ.surface, background: T.gradient }}>
              <RosterAvatar src={creator.avatarUrl} username={creator.username} textClass="text-[24px]" />
            </div>

            <div className="flex-1 min-w-[240px] pb-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {/* The display name comes from the agency tables; the handle sits
                    under it. Where no name exists, the handle is promoted. */}
                <h1 style={{ ...PJ, color: T.t1 }} className="text-[20px] font-extrabold tracking-[-0.02em]">
                  {name}
                </h1>
                {creator.verified && (
                  <span style={{ ...PJ, background: '#eaf5ef', color: '#3d8a5f' }}
                    className="inline-flex items-center gap-1 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                    <span className="material-symbols-outlined text-[12px]">verified</span>Verified
                  </span>
                )}
                {creator.tier && (
                  <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                    {creator.tier}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: T.t4 }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#3d8a5f' }} />
                  Available
                  <SampleTag compact />
                </span>
              </div>

              {identity.displayName && (
                <div className="text-[12px]" style={{ color: T.t3 }}>@{creator.username}</div>
              )}
              <div className="text-[11.5px] mt-0.5" style={{ color: T.t3 }}>
                {creator.categories.length ? creator.categories.join(' · ') : 'Kategori belum diisi di roster'}
              </div>
              <div className="text-[11.5px]" style={{ color: T.t4 }}>
                {creator.city || 'Lokasi belum diisi di roster'}
                {identity.agency && <> · dikelola {identity.agency}</>}
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {platforms.map(p => (
                  <a key={p.id} href={p.profileUrl ?? undefined} target="_blank" rel="noopener noreferrer"
                    style={{ ...PJ, borderColor: T.outline, color: T.t2 }}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[11px] font-bold hover:bg-[#f9fafb]">
                    <span className="material-symbols-outlined text-[14px]" style={{ color: T.primary }}>
                      {PLATFORM_ICON[p.platform ?? ''] ?? 'public'}
                    </span>
                    {platformLabel(p.platform)}
                    <span style={{ color: T.t4 }} className="tabular-nums">
                      {p.followers === null ? '—' : fmtNum(p.followers)}
                    </span>
                  </a>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap pb-0.5">
              <span style={{ ...PJ, background: '#fdf3e7', color: '#b5761f' }}
                className="text-[9px] font-extrabold px-2 py-1 rounded-md mr-1">
                Demo profile · Sample data
              </span>
              <ActionBtn icon={fav ? 'favorite' : 'favorite_border'} label="Favorite" on={fav}
                onClick={() => { setFav(f => !f); setToast(fav ? 'Dihapus dari favorit' : 'Creator added to Favorites') }} />
              <ActionBtn icon="compare" label="Compare" onClick={onCompare} />
              <ActionBtn icon="lab_profile" label="Report" onClick={onReport} />
              <ActionBtn icon="add" label="Add to Campaign" primary onClick={onAddCampaign} />
            </div>
          </div>

          {addedTo && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px]" style={{ color: '#3d8a5f' }}>
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              Sudah ada di <b>{addedTo}</b>
            </div>
          )}
        </div>
      </div>

      {/* ── three primary KPIs ── */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <BigKpi label="Followers"
          value={creator.followers === null ? '—' : fmtNum(creator.followers)}
          note={`▲ ${intel.growth.monthly}% / bulan`} noteSample
          sub={`#${rank.followersRank.toLocaleString('id-ID')} dari ${rank.rosterTotal.toLocaleString('id-ID')} creator`} />
        <BigKpi label="Engagement Rate"
          value={creator.erPct === null ? 'belum diukur' : `${creator.erPct.toFixed(2)}%`}
          note={categoryTop !== null && rank.categoryName
            ? `Top ${categoryTop}% di ${rank.categoryName}`
            : rank.erRank !== null
              ? `#${rank.erRank.toLocaleString('id-ID')} dari ${rank.erMeasuredTotal.toLocaleString('id-ID')} terukur`
              : 'belum masuk peringkat'}
          sub={rank.categoryErTotal > 0
            ? `dibanding ${rank.categoryErTotal.toLocaleString('id-ID')} creator kategori ini yang terukur`
            : undefined} />
        {/* A real price beats a modelled one. Where the KOL platform prices this
            creator — 7,230 of the roster's 7,718 do — the third KPI is that
            price and carries no marker; Est. Media Value is what stands in when
            they have none. */}
        {cheapestRate ? (
          <BigKpi label="Rate Card"
            value={`Rp${cheapestRate.fee.toLocaleString('id-ID')}`}
            note={cheapestRate.label}
            sub={rateCount > 1
              ? `termurah dari ${rateCount} deliverable · rate card database KOL`
              : 'dari rate card database KOL'} />
        ) : (
          <BigKpi label="Est. Media Value" value={`$${fmtNum(intel.kpi.emvUsd)}`}
            note="per campaign" sample sub="creator ini belum punya rate card di database KOL" />
        )}
      </div>

      {/* ── six secondary KPIs ── */}
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        <StatTile label="Reach" value={estReach === null ? '—' : fmtNum(estReach)}
          hint="followers × ER" />
        <StatTile label="Avg. Views" value={fmtNum(intel.kpi.avgViews)}
          hint={intel.real.views ? viewsBasis : 'avg / post'} sample={!intel.real.views} />
        <StatTile label="CPE" value={`$${(intel.kpi.emvUsd / Math.max(1, intel.performance.likes)).toFixed(2)}`}
          hint="per engagement" sample />
        <StatTile label="Audience Quality" value={`${intel.audience.qualityScore}`} hint="/ 100" sample />
        <StatTile label="Authenticity" value={`${intel.audience.authenticity}%`} hint="real" sample />
        <StatTile label="Growth Rate" value={`${intel.growth.monthly}%`} hint="per month" sample />
      </div>

      {/* ── creator navigation + the view it selects ── */}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(210px,250px) minmax(0,1fr)' }}>
        <nav className="rounded-[16px] border p-1.5 sticky top-4"
          style={{ borderColor: T.outline, background: VIZ.surface }}>
          {NAV.map(n => {
            const on = view === n.id
            return (
              <button key={n.id} type="button" onClick={() => goTo(n.id)}
                style={{
                  ...PJ,
                  background: on ? T.surfaceVariant : 'transparent',
                  color: on ? T.primaryDeep : T.t3,
                  // The active row is marked on its leading edge, so the list
                  // reads as one column with a pointer rather than seven pills.
                  boxShadow: on ? `inset 2px 0 0 ${T.primary}` : undefined,
                }}
                className="w-full flex items-center gap-2 h-9 px-2.5 rounded-lg text-[11.5px] font-bold text-left transition-colors hover:bg-[#f9fbfc]">
                <span className="material-symbols-outlined text-[16px] flex-shrink-0">{n.icon}</span>
                <span className="truncate">{n.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="min-w-0">
          {view === 'profile' && <ProfileSection {...sectionProps} onGoTo={goTo} />}
          {view === 'content' && <ContentSection {...sectionProps} />}
          {view === 'analytics' && <PerformanceSection {...sectionProps} />}
          {view === 'audience' && <AudienceSection {...sectionProps} />}
          {view === 'campaigns' && <CampaignSection {...sectionProps} />}
          {/* Brand Fit is the scoring half of AI Insights, so the two share a
              view rather than splitting one argument across two nav rows. */}
          {view === 'ai' && (
            <div className="flex flex-col gap-4">
              <BrandFitSection {...sectionProps} />
              <AiSection {...sectionProps} />
            </div>
          )}
          {view === 'insights' && <InsightsSection {...sectionProps} />}
        </div>
      </div>
    </>
  )
}

/**
 * A primary KPI: bigger figure, a qualifier under it, and the roster context
 * that makes the qualifier checkable.
 */
function BigKpi({
  label, value, note, sub, sample, noteSample,
}: {
  label: string; value: string; note: string; sub?: string
  sample?: boolean; noteSample?: boolean
}) {
  return (
    <div className="rounded-[16px] border px-4 py-3.5" style={{ borderColor: T.outline, background: VIZ.surface }}>
      <div className="flex items-center gap-1.5">
        <span style={{ ...PJ, color: T.t4 }} className="text-[10px] font-extrabold uppercase tracking-widest">
          {label}
        </span>
        {sample && <SampleTag compact />}
      </div>
      <div style={{ ...PJ, color: T.t1 }} className="text-[27px] font-extrabold mt-1.5 tracking-[-0.03em] leading-none">
        {value}
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <span style={{ ...PJ, color: T.primaryDeep }} className="text-[11px] font-bold">{note}</span>
        {noteSample && <SampleTag compact />}
      </div>
      {sub && <div className="text-[9.5px] mt-1" style={{ color: T.t4 }}>{sub}</div>}
    </div>
  )
}

/* ── add to campaign ──────────────────────────────────────────────────────── */

function AddToCampaign({
  open, onClose, name, username, tier, rates, onAdd,
}: {
  open: boolean
  onClose: () => void
  name: string
  username: string
  tier: string | null
  /** The creator's real prices, empty for the ~6% of the roster without any. */
  rates: KolMeasuredRate[]
  onAdd: (campaign: string) => void
}) {
  const [campaign, setCampaign] = useState(CAMPAIGN_OPTIONS[0])

  /**
   * The cost line used to be a hardcoded "$4,500 – $6,000" under a note saying
   * the KOL database had no rate card. It does: `l1_silver.unified_rate_card`
   * prices 7,230 of the 7,718 roster creators, in rupiah. So the range is the
   * creator's own cheapest and dearest deliverable, and only falls back to a
   * disclosure when they genuinely have no price.
   */
  const fees = rates.map(r => r.fee).filter(f => Number.isFinite(f) && f > 0).sort((a, b) => a - b)
  const idr = (n: number) => `Rp${n.toLocaleString('id-ID')}`
  const cost = fees.length === 0
    ? null
    : fees.length === 1 || fees[0] === fees[fees.length - 1]
      ? idr(fees[0])
      : `${idr(fees[0])} – ${idr(fees[fees.length - 1])}`

  return (
    <Overlay open={open} title="Add Creator to Campaign" side="right" onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => onAdd(campaign)}>Add Creator</Btn>
        </>
      }>
      <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold">{name}</div>
      <div className="text-[11px] mb-4" style={{ color: T.t4 }}>@{username} · {tier ?? 'Creator'}</div>

      <div className="text-[10.5px] mb-1" style={{ color: T.t3 }}>Select campaign</div>
      <select value={campaign} onChange={e => setCampaign(e.target.value)}
        className="w-full h-9 rounded-lg border px-2 text-[11.5px] mb-4"
        style={{ borderColor: T.outline, color: T.t1, background: T.surface }}>
        {CAMPAIGN_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <div className="rounded-xl border px-3 py-2.5 mb-3" style={{ borderColor: T.outline }}>
        <div className="text-[10.5px] mb-1.5" style={{ color: T.t3 }}>Selected creator</div>
        <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: T.t1 }}>
          <span className="material-symbols-outlined text-[15px]" style={{ color: '#3d8a5f' }}>check_circle</span>
          {name}
        </div>
      </div>

      <Row label="Estimated cost" value={cost ?? 'belum ada rate card'} sample={cost === null} />

      {cost !== null && rates.length > 1 && (
        <div className="mt-2 flex flex-col gap-1">
          {rates.map(r => (
            <div key={r.postType} className="flex items-center justify-between text-[10.5px]"
              style={{ color: T.t3 }}>
              <span>{r.label}</span>
              <span style={{ ...PJ, color: T.t1 }} className="font-bold tabular-nums">
                Rp{r.fee.toLocaleString('id-ID')}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] mt-2.5 leading-[1.5]" style={{ color: T.t4 }}>
        {cost === null
          ? 'Creator ini belum punya rate card di database KOL, jadi biayanya belum bisa dihitung.'
          : 'Harga di atas berasal dari rate card creator di database KOL.'}
        {' '}Daftar campaign masih estimasi — tabel campaign platform KOL masih kosong.
      </p>
    </Overlay>
  )
}

/* ── skeleton ─────────────────────────────────────────────────────────────── */

function CreatorSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[18px] border overflow-hidden" style={{ borderColor: T.outline, background: VIZ.surface }}>
        <Skeleton h={76} radius={0} />
        <div className="px-4 pb-4 -mt-9">
          <div className="flex items-end gap-3.5">
            <Skeleton h={80} w={80} radius={20} />
            <div className="flex-1 flex flex-col gap-2 pb-1">
              <Skeleton h={18} w="42%" />
              <Skeleton h={12} w="28%" />
              <Skeleton h={12} w="34%" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-[16px] border px-4 py-3.5 flex flex-col gap-2.5"
            style={{ borderColor: T.outline, background: VIZ.surface }}>
            <Skeleton h={10} w="46%" />
            <Skeleton h={26} w="62%" />
            <Skeleton h={10} w="38%" />
          </div>
        ))}
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-[14px] border px-3.5 py-3 flex flex-col gap-2"
            style={{ borderColor: T.outline, background: VIZ.surface }}>
            <Skeleton h={10} w="52%" />
            <Skeleton h={18} w="66%" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(210px,250px) minmax(0,1fr)' }}>
        <div className="rounded-[16px] border p-2 flex flex-col gap-1.5"
          style={{ borderColor: T.outline, background: VIZ.surface }}>
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} h={30} />)}
        </div>
        <div className="rounded-[16px] border p-4 flex flex-col gap-2.5"
          style={{ borderColor: T.outline, background: VIZ.surface }}>
          <Skeleton h={13} w="30%" />
          <Skeleton h={11} w="92%" />
          <Skeleton h={11} w="84%" />
          <Skeleton h={110} />
        </div>
      </div>
    </div>
  )
}

function ActionBtn({
  icon, label, onClick, primary, on,
}: { icon: string; label?: string; onClick: () => void; primary?: boolean; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label ?? icon}
      style={{
        ...PJ,
        background: primary ? T.primary : on ? T.surfaceVariant : VIZ.surface,
        borderColor: primary ? T.primary : on ? T.primary : T.outline,
        color: primary ? '#fff' : on ? T.primaryDeep : T.t2,
      }}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11.5px] font-bold hover:brightness-[.98]">
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  )
}
