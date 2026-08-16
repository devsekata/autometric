'use client'

/**
 * Creator Profile — what a creator card in the KOL Directory opens into.
 *
 * Deliberately not a second dashboard. It renders inside the app's existing
 * shell — same sidebar, same topbar, same tokens, same card style — and only
 * the main content area changes. The page is the Directory's detail view, not a
 * new place.
 *
 * Shape: back link → creator header → quick metrics → tabs → tab content.
 * Overview is the default and lives in `KolCreatorOverview`; the other six tabs
 * are in `KolCreatorSections`. Report is a button rather than a tab — it is
 * something you do once you have decided, not something you read every visit.
 *
 * ── What is real and what is not ─────────────────────────────────────────────
 * The commercial roster (`public.kol_directory`) stores identity only. Real
 * here: username, platform, profile URL, avatar, bio, followers, engagement
 * rate, category, tier, verified, last refresh — plus what the API computes from
 * the roster: rank by followers, rank inside the creator's category, rank by
 * engagement rate among measured rows, the sibling account on the other
 * platform, and the Similar Creators row.
 *
 * Everything else the brief asks for — reach, views, growth, audience
 * demographics, content, campaigns, brand fit, AI insights — has no source, so
 * it comes from `@/lib/discover/kolSample` and is marked at every figure. The
 * header carries a "Demo profile · Sample data" chip and each sampled number
 * wears `<SampleTag />`, so no screenshot can be mistaken for a measurement.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PJ, TOKENS as T, PLATFORM_ICON, Btn, fmtNum } from './ui'
import { ErrorBlock, Overlay, Row, SampleTag, Skeleton, StatTile, VIZ } from './kolViz'
import OverviewSection from './KolCreatorOverview'
import KolCreatorReport from './KolCreatorReport'
import {
  AiSection, AudienceSection, BrandFitSection, CampaignSection, ContentSection,
  PerformanceSection, platformLabel, type SectionProps,
} from './KolCreatorSections'
import { sampleIntel } from '@/lib/discover/kolSample'
import type { KolCreatorPayload } from '@/lib/discover/kolDirectory'

/** Report is absent on purpose — it is an action in the header, not a tab. */
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'performance', label: 'Performance', icon: 'insights' },
  { id: 'audience', label: 'Audience', icon: 'group' },
  { id: 'content', label: 'Content', icon: 'grid_view' },
  { id: 'campaigns', label: 'Campaign', icon: 'campaign' },
  { id: 'brandfit', label: 'Brand Fit', icon: 'handshake' },
  { id: 'ai', label: 'AI Insights', icon: 'auto_awesome' },
] as const

type TabId = (typeof TABS)[number]['id']

const CAMPAIGN_OPTIONS = ['Summer Beauty Campaign', 'Ramadan 2026', 'Product Launch Q3']

const initialsOf = (u: string) => (u.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?').toUpperCase()

export default function KolCreatorWorkspace({
  orgId, orgSlug, kolId,
}: { orgId: string; orgSlug: string; kolId: string }) {
  const router = useRouter()
  const [data, setData] = useState<KolCreatorPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [tab, setTab] = useState<TabId>('overview')

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
    // Landing on a creator from Similar Creators should start at the top of
    // their page, not wherever the previous creator was being read.
    setTab('overview')
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
   * Seeded from the creator id, so the sampled figures are identical on every
   * render and every reload — placeholder numbers that reshuffle themselves make
   * the screen obviously fake and the screenshots irreproducible.
   */
  const intel = useMemo(() => (data ? sampleIntel(data.creator) : null), [data])

  const backToDirectory = () => router.push(`/organizations/${orgSlug}/discover/kol`)

  return (
    <div className="p-5 pb-24 max-w-[1360px] mx-auto">
      {/* Back first, breadcrumb second: leaving is the more common intent. */}
      <button type="button" onClick={backToDirectory} style={{ ...PJ, color: T.primary }}
        className="inline-flex items-center gap-1 text-[11.5px] font-bold hover:underline mb-1.5">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Back to Directory
      </button>

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap mb-3">
        {['Discovery', 'Directory', data ? `@${data.creator.username}` : 'Creator Profile'].map((label, i) => (
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
          data={data} intel={intel} tab={tab} setTab={setTab}
          fav={fav} setFav={setFav}
          onCompare={() => { setCompareTray(true); setToast('Ditambahkan ke compare') }}
          onAddCampaign={() => setCampaignOpen(true)}
          onReport={() => setReportOpen(true)}
          addedTo={addedTo}
          orgSlug={orgSlug}
          setToast={setToast}
        />
      )}

      {/* ── overlays ── */}
      {data && intel && (
        <>
          <AddToCampaign
            open={campaignOpen} onClose={() => setCampaignOpen(false)}
            username={data.creator.username}
            tier={data.creator.tier}
            onAdd={name => {
              setAddedTo(name)
              setCampaignOpen(false)
              setToast(`@${data.creator.username} ditambahkan ke ${name}`)
            }} />

          <KolCreatorReport
            open={reportOpen} onClose={() => setReportOpen(false)}
            creator={data.creator} rank={data.rank} platforms={data.platforms} intel={intel} />
        </>
      )}

      {/* ── compare tray ── */}
      {compareTray && data && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border px-3.5 py-2.5"
          style={{ background: VIZ.surface, borderColor: T.outline, boxShadow: T.shadowMd }}>
          <span style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide">
            Compare
          </span>
          <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
            className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1">
            @{data.creator.username}
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
  data, intel, tab, setTab, fav, setFav, onCompare, onAddCampaign, onReport,
  addedTo, orgSlug, setToast,
}: {
  data: KolCreatorPayload
  intel: NonNullable<ReturnType<typeof sampleIntel>>
  tab: TabId
  setTab: (t: TabId) => void
  fav: boolean
  setFav: (f: (v: boolean) => boolean) => void
  onCompare: () => void
  onAddCampaign: () => void
  onReport: () => void
  addedTo: string | null
  orgSlug: string
  setToast: (s: string) => void
}) {
  const { creator, rank, platforms, similar } = data
  const sectionProps: SectionProps = { creator, rank, platforms, similar, intel }
  const estReach = creator.followers !== null && creator.erPct !== null
    ? Math.round((creator.followers * creator.erPct) / 100)
    : null

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
              {creator.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element -- roster avatars come from CDNs not in next.config
                ? <img src={creator.avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span style={PJ} className="text-white text-[24px] font-extrabold">
                    {initialsOf(creator.username)}
                  </span>}
            </div>

            <div className="flex-1 min-w-[240px] pb-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {/* The roster has no display-name column — the handle is the name. */}
                <h1 style={{ ...PJ, color: T.t1 }} className="text-[20px] font-extrabold tracking-[-0.02em]">
                  @{creator.username}
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
                {/* Status is metadata — small, and marked, because the roster has
                    no availability column at all. */}
                <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: T.t4 }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#3d8a5f' }} />
                  Available
                  <SampleTag compact />
                </span>
              </div>

              <div className="text-[11.5px] mt-1" style={{ color: T.t3 }}>
                {creator.categories.length ? creator.categories.join(' · ') : 'Kategori belum diisi di roster'}
              </div>
              <div className="text-[11.5px]" style={{ color: T.t4 }}>
                {creator.city || 'Lokasi belum diisi di roster'}
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

            {/* Actions top-right, horizontal, primary last: Favorite is tertiary,
                Compare secondary, Add to Campaign the thing this page is for. */}
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

      {/* ── quick metrics ── */}
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))' }}>
        <StatTile label="Followers"
          value={creator.followers === null ? '—' : fmtNum(creator.followers)}
          hint={`#${rank.followersRank.toLocaleString('id-ID')} dari ${rank.rosterTotal.toLocaleString('id-ID')}`} />
        <StatTile label="Engagement Rate"
          value={creator.erPct === null ? 'belum diukur' : `${creator.erPct.toFixed(2)}%`}
          hint={rank.erRank === null
            ? 'tidak masuk peringkat'
            : `#${rank.erRank.toLocaleString('id-ID')} dari ${rank.erMeasuredTotal.toLocaleString('id-ID')} terukur`} />
        <StatTile label="Est. Reach"
          value={estReach === null ? '—' : fmtNum(estReach)} hint="followers × ER" />
        <StatTile label="Avg Views" value={fmtNum(intel.kpi.avgViews)} delta={intel.kpi.delta.views} sample />
        <StatTile label="Growth" value={`${intel.growth.monthly}%`} sample hint="30 hari terakhir" />
      </div>

      {/* ── tabs ── */}
      <div className="flex gap-1 flex-wrap mb-4" style={{ borderBottom: `1px solid ${T.outline}` }}>
        {TABS.map(t => {
          const on = tab === t.id
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{
                ...PJ,
                color: on ? T.primaryDeep : T.t3,
                // Marked by a rule under it rather than a filled pill: the row
                // reads as one strip, and the rule points at what it belongs to.
                borderBottom: `2px solid ${on ? T.primary : 'transparent'}`,
                marginBottom: -1,
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-[11.5px] font-bold">
              <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewSection {...sectionProps} onGoTo={setTab} orgSlug={orgSlug} />}
      {tab === 'performance' && <PerformanceSection {...sectionProps} />}
      {tab === 'audience' && <AudienceSection {...sectionProps} />}
      {tab === 'content' && <ContentSection {...sectionProps} />}
      {tab === 'campaigns' && <CampaignSection {...sectionProps} />}
      {tab === 'brandfit' && <BrandFitSection {...sectionProps} />}
      {tab === 'ai' && <AiSection {...sectionProps} />}
    </>
  )
}

/* ── add to campaign ──────────────────────────────────────────────────────── */

/**
 * A drawer rather than a silent add: dropping a creator into a campaign with no
 * confirmation leaves the user unsure whether it happened, and with no chance to
 * pick *which* campaign.
 */
function AddToCampaign({
  open, onClose, username, tier, onAdd,
}: {
  open: boolean
  onClose: () => void
  username: string
  tier: string | null
  onAdd: (campaign: string) => void
}) {
  const [campaign, setCampaign] = useState(CAMPAIGN_OPTIONS[0])

  return (
    <Overlay open={open} title="Add Creator to Campaign" side="right" onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => onAdd(campaign)}>Add Creator</Btn>
        </>
      }>
      <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold">@{username}</div>
      <div className="text-[11px] mb-4" style={{ color: T.t4 }}>{tier ?? 'Creator'}</div>

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
          @{username}
        </div>
      </div>

      <Row label="Estimated cost" value="$4,500 – $6,000" sample />
      <p className="text-[10px] mt-2.5 leading-[1.5]" style={{ color: T.t4 }}>
        Rate card belum ada di database KOL, jadi estimasi biaya di atas contoh.
        Daftar campaign juga masih contoh — tabel campaign platform KOL masih kosong.
      </p>
    </Overlay>
  )
}

/* ── states ───────────────────────────────────────────────────────────────── */

/** The page's own shape while it loads, rather than a spinner in the middle. */
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

      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))' }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-[14px] border px-3.5 py-3 flex flex-col gap-2"
            style={{ borderColor: T.outline, background: VIZ.surface }}>
            <Skeleton h={10} w="52%" />
            <Skeleton h={18} w="66%" />
            <Skeleton h={9} w="44%" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,70fr) minmax(250px,30fr)' }}>
        {[0, 1].map(i => (
          <div key={i} className="rounded-[16px] border p-4 flex flex-col gap-2.5"
            style={{ borderColor: T.outline, background: VIZ.surface }}>
            <Skeleton h={13} w="38%" />
            <Skeleton h={11} w="92%" />
            <Skeleton h={11} w="84%" />
            <Skeleton h={11} w="70%" />
            <Skeleton h={90} />
          </div>
        ))}
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
