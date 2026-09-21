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
 * from `l1_silver.unified_post`, prices from `l1_silver.unified_rate_card`, and
 * growth, avg views, audience, audience quality and per-post ER from `l2_gold`
 * / `feature` via `kolGold` and the directory row.
 *
 * Nothing on this page is generated. What has no source — reach, EMV, CPE,
 * age, campaign history, brand fit, AI prose — renders as "Belum terukur" or an
 * empty state, never as a placeholder number.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PJ, TOKENS as T, PLATFORM_ICON, Btn, fmtNum, RosterAvatar } from './ui'
import { ErrorBlock, Overlay, Row, Skeleton, StatTile, VIZ } from './kolViz'
import { ProfileSection, InsightsSection } from './KolCreatorProfile'
import KolCreatorReport from './KolCreatorReport'
import {
  AiSection, AudienceSection, BrandFitSection, CampaignSection, ContentSection,
  PerformanceSection, platformLabel, type SectionProps,
} from './KolCreatorSections'
import { avgViewsBasis, creatorIntel, type CreatorIntel } from '@/lib/discover/kolIntel'
import { tabHref } from '@/lib/discover/tabs'
import { selectionKey, useDiscoverSelection } from './useDiscoverSelection'
import { useKolFavorites } from './useKolFavorites'
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

/* ── refresh (D054) ───────────────────────────────────────────────────────── */

/** What `GET /api/kol-directory/add/[kolId]/status` answers with. */
type RunStatusPayload = {
  runId: string | null
  overallStatus: 'pending' | 'running' | 'success' | 'failed'
  steps: { key: string; label: string; status: 'pending' | 'running' | 'success' | 'failed'; detail?: string | null }[]
}

type RefreshPhase = 'idle' | 'starting' | 'running' | 'success' | 'failed'

/** Same cadence the Add KOL dialog polls its own run at. */
const REFRESH_POLL_MS = 2_000

/**
 * What a finished refresh actually changed. Said plainly because the page shows
 * both kinds of number side by side: the roster fields the pipeline writes
 * itself, and the L2/feature fields an external batch fills in later.
 */
const L2_LATER =
  'Followers, engagement dan identitas sudah diperbarui. Metrik analitik (growth, views, audience) '
  + 'menyusul saat batch L2 berikutnya berjalan.'

export default function KolCreatorWorkspace({
  orgId, orgSlug, kolId,
}: { orgId: string; orgSlug: string; kolId: string }) {
  const router = useRouter()
  const [data, setData] = useState<KolCreatorPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<NavId>('profile')

  /**
   * Favorite is the signed-in user's, stored in the KOL database; Compare is
   * this browser's working set, shared with the Creator Database.
   */
  const favorites = useKolFavorites(orgId, msg => setToast(msg))
  const compareSel = useDiscoverSelection(orgId, 'compare')
  const selKey = selectionKey('roster', kolId)
  const fav = favorites.has(kolId)
  const toggleFav = () => {
    void favorites.toggle(kolId).then(on => {
      if (on !== null) setToast(on ? 'Creator added to Favorites' : 'Dihapus dari favorit')
    })
  }

  /** My Creators membership of this creator for the current agency (KOL). */
  const [mine, setMine] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    setMine(null)
    fetch(`/api/organizations/${orgId}/discover/my-creators?ids=${kolId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { ids: string[] }) => { if (!cancelled) setMine(d.ids.includes(kolId)) })
      .catch(() => { if (!cancelled) setMine(null) })
    return () => { cancelled = true }
  }, [orgId, kolId])

  /**
   * Monitored / Paused for this agency (D054), the same
   * `agency_kol_accounts.monitoring_enabled` the My Creators card toggles.
   *
   * Read through the directory list scoped to this agency, which already
   * answers with `monitoringEnabled` for `scope=mine` — a creator the agency
   * does not hold comes back as no row at all, so `null` means "not one of
   * ours" and no control is drawn. Written through the PATCH that already
   * exists; nothing here defines the state, it only shows it.
   */
  const [monitoring, setMonitoring] = useState<boolean | null>(null)
  const [monitoringBusy, setMonitoringBusy] = useState(false)
  const loadMonitoring = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/discover/kol-directory?ids=${kolId}&scope=mine`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as { rows?: { id: string; monitoringEnabled?: boolean | null }[] }
      const row = (d.rows ?? []).find(r => r.id === kolId)
      return row?.monitoringEnabled ?? null
    } catch {
      return null
    }
  }, [orgId, kolId])

  useEffect(() => {
    let cancelled = false
    setMonitoring(null)
    void loadMonitoring().then((v: boolean | null) => { if (!cancelled) setMonitoring(v) })
    return () => { cancelled = true }
  }, [loadMonitoring])

  const toggleMonitoring = async () => {
    if (monitoring === null || monitoringBusy) return
    setMonitoringBusy(true)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/my-creators/${kolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitoringEnabled: !monitoring }),
      })
      const body = await res.json().catch(() => null) as { monitoringEnabled?: unknown; error?: string } | null
      if (!res.ok || typeof body?.monitoringEnabled !== 'boolean') {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      // Only what the server confirmed reaches the screen.
      setMonitoring(body.monitoringEnabled)
      setToast(body.monitoringEnabled ? 'Creator dipantau (Monitored)' : 'Monitoring dijeda (Paused)')
    } catch (e) {
      setToast(`Status monitoring gagal diperbarui: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setMonitoringBusy(false)
    }
  }

  const toggleMine = async () => {
    if (mine === null) return
    const was = mine
    setMine(!was)
    try {
      const res = was
        ? await fetch(`/api/organizations/${orgId}/discover/my-creators/${kolId}`, { method: 'DELETE' })
        : await fetch(`/api/organizations/${orgId}/discover/my-creators`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kolId }),
          })
      if (!res.ok && !(was && res.status === 404)) throw new Error(`HTTP ${res.status}`)
      setToast(was ? 'Dihapus dari My Creators' : 'Ditambahkan ke My Creators')
      // Leaving My Creators takes the monitoring state with it; joining brings
      // back whatever the agency had set before (the link keeps it).
      setMonitoring(was ? null : await loadMonitoring())
    } catch {
      setMine(was)
      setToast('My Creators gagal diperbarui')
    }
  }
  const [compareTray, setCompareTray] = useState(false)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  /**
   * Refresh (D054) — run the Add KOL pipeline again over this creator.
   *
   * Only the run's own progress lives here: the server owns whether a refresh
   * may start at all (link, status, cooldown, and a reservation that stops two
   * clicks from both starting one), and this page only reports what the
   * existing status endpoint says about the run it was given.
   */
  const [refreshPhase, setRefreshPhase] = useState<RefreshPhase>('idle')
  const [refreshRunId, setRefreshRunId] = useState<string | null>(null)
  const [refreshStep, setRefreshStep] = useState<{ done: number; total: number; label: string | null } | null>(null)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)

  const applyRunStatus = useCallback((d: RunStatusPayload) => {
    const steps = d.steps ?? []
    const done = steps.filter(s => s.status === 'success').length
    const current = steps.find(s => s.status === 'running') ?? steps.find(s => s.status === 'failed')
    setRefreshStep({ done, total: steps.length, label: current?.label ?? null })
    return steps
  }, [])

  /**
   * Reopening the page while a run is still going reattaches to it rather than
   * offering to start a second one: the status endpoint answers for the newest
   * run of this creator when no `runId` is pinned, which is exactly the run the
   * previous visit started.
   */
  useEffect(() => {
    if (mine !== true) return
    let cancelled = false
    fetch(`/api/kol-directory/add/${kolId}/status?orgId=${orgId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: RunStatusPayload | null) => {
        if (cancelled || !d || d.overallStatus !== 'running') return
        setRefreshRunId(d.runId)
        setRefreshPhase('running')
        applyRunStatus(d)
      })
      .catch(() => { /* no run to reattach to */ })
    return () => { cancelled = true }
  }, [mine, kolId, orgId, applyRunStatus])

  useEffect(() => {
    if (refreshPhase !== 'running') return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      try {
        const qs = new URLSearchParams({ orgId })
        if (refreshRunId) qs.set('runId', refreshRunId)
        const res = await fetch(`/api/kol-directory/add/${kolId}/status?${qs}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = await res.json() as RunStatusPayload
        if (cancelled) return
        const steps = applyRunStatus(d)
        if (d.overallStatus === 'success') {
          setRefreshPhase('success')
          setRefreshNote(null)
          // The roster numbers are already new; re-read the profile so the page
          // shows them without a manual reload.
          setReload(n => n + 1)
          return
        }
        if (d.overallStatus === 'failed') {
          setRefreshPhase('failed')
          setRefreshNote(steps.find(s => s.status === 'failed')?.detail ?? null)
          return
        }
      } catch {
        // A blip on the KOL host is not a failed run — ask again.
      }
      if (!cancelled) timer = window.setTimeout(poll, REFRESH_POLL_MS)
    }
    timer = window.setTimeout(poll, REFRESH_POLL_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [refreshPhase, refreshRunId, kolId, orgId, applyRunStatus])

  const startRefresh = async () => {
    if (refreshPhase === 'starting' || refreshPhase === 'running') return
    setRefreshPhase('starting')
    setRefreshNote(null)
    setRefreshStep(null)
    try {
      const res = await fetch(`/api/kol-directory/add/${kolId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json().catch(() => null) as { runId?: unknown; error?: string } | null
      if (res.status === 202 && typeof body?.runId === 'string') {
        setRefreshRunId(body.runId)
        setRefreshPhase('running')
        return
      }
      // Every refusal the route makes is already a sentence; show it as it is.
      setRefreshPhase('idle')
      setToast(body?.error || `Refresh tidak bisa dimulai (HTTP ${res.status})`)
    } catch (e) {
      setRefreshPhase('idle')
      setToast(`Refresh tidak bisa dimulai: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

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

  /** Measured figures only; every field is null where the warehouse has none. */
  const intel = useMemo(
    () => (data ? creatorIntel(data.creator, data.measured, data.gold?.posts ?? []) : null),
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

      {/* Refresh's own strip, above the creator: it reports one run, and it
          must not be mistaken for the state of the profile underneath. */}
      <RefreshStrip
        phase={refreshPhase} step={refreshStep} note={refreshNote}
        onDismiss={() => { setRefreshPhase('idle'); setRefreshNote(null); setRefreshStep(null) }} />

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
          fav={fav} onFav={toggleFav}
          mine={mine} onMine={() => { void toggleMine() }}
          monitoring={monitoring} monitoringBusy={monitoringBusy}
          onMonitoring={() => { void toggleMonitoring() }}
          refreshPhase={refreshPhase} onRefresh={() => { void startRefresh() }}
          onCompare={() => {
            if (!compareSel.ids.has(selKey)) compareSel.toggle(selKey)
            setCompareTray(true)
            setToast('Ditambahkan ke compare')
          }}
          onAddCampaign={() => setCampaignOpen(true)}
          onReport={() => setReportOpen(true)}
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
            rates={data.measured?.rates ?? []} />

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
  data, intel, view, goTo, fav, onFav, mine, onMine,
  monitoring, monitoringBusy, onMonitoring,
  refreshPhase, onRefresh,
  onCompare, onAddCampaign, onReport, setToast,
}: {
  data: KolCreatorPayload
  intel: CreatorIntel
  view: NavId
  goTo: (id: string) => void
  fav: boolean
  onFav: () => void
  /** Null while unknown (loading, or the check failed): the button is hidden. */
  mine: boolean | null
  onMine: () => void
  /** Monitored (true) / Paused (false) for this agency; null hides the control (D054). */
  monitoring: boolean | null
  monitoringBusy: boolean
  onMonitoring: () => void
  /** Refresh (D054): the phase of this page's own run, never of the profile. */
  refreshPhase: RefreshPhase
  onRefresh: () => void
  onCompare: () => void
  onAddCampaign: () => void
  onReport: () => void
  setToast: (s: string) => void
}) {
  const { creator, identity, rank, platforms, similar } = data
  const sectionProps: SectionProps = { creator, identity, rank, platforms, similar, intel, gold: data.gold }
  const name = identity.displayName ?? `@${creator.username}`

  /**
   * Real follower growth, `l2_gold.kol_profile_card.followers_growth` as the API
   * returns it: the change between two CONSECUTIVE snapshots, whatever their
   * gap. Never labelled monthly. Null for accounts scraped only once.
   */
  const realGrowth = creator.growthPct
  const growthNote = realGrowth === null
    ? 'Growth belum terukur'
    : `${realGrowth > 0 ? '▲' : realGrowth < 0 ? '▼' : ''} ${realGrowth.toFixed(2)}% sejak snapshot sebelumnya`
  const quality = data.gold?.audienceQuality ?? null

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
                {creator.connected && (
                  <span style={{ ...PJ, background: '#eaf5ef', color: '#3d8a5f' }}
                    className="inline-flex items-center gap-1 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                    <span className="material-symbols-outlined text-[12px]">link</span>Connected
                  </span>
                )}
                {creator.tier && (
                  <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                    {creator.tier}
                  </span>
                )}
                {/* "Available" stood here for every creator: the roster has no
                    availability column, so the status is left out. */}
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
              {mine !== null && (
                <ActionBtn icon={mine ? 'how_to_reg' : 'person_add'} label={mine ? 'In My Creators' : 'Add to My Creators'}
                  on={mine} onClick={onMine} />
              )}
              {/* My Creators only: the pipeline that fills this page can only be
                  re-run for a creator the agency actually holds (D054). */}
              {mine === true && (
                <ActionBtn
                  icon={refreshPhase === 'starting' || refreshPhase === 'running' ? 'progress_activity' : 'refresh'}
                  label={refreshPhase === 'running' ? 'Memperbarui…' : 'Refresh'}
                  busy={refreshPhase === 'starting' || refreshPhase === 'running'}
                  onClick={onRefresh} />
              )}
              {/* My Creators only: what the agency set, not a new state (D054). */}
              {monitoring !== null && (
                <ActionBtn
                  icon={monitoringBusy ? 'progress_activity' : monitoring ? 'notifications_active' : 'notifications_off'}
                  label={monitoring ? 'Monitored' : 'Paused'}
                  on={monitoring} onClick={onMonitoring} />
              )}
              <ActionBtn icon={fav ? 'favorite' : 'favorite_border'} label="Favorite" on={fav}
                onClick={onFav} />
              <ActionBtn icon="compare" label="Compare" onClick={onCompare} />
              <ActionBtn icon="lab_profile" label="Report" onClick={onReport} />
              <ActionBtn icon="add" label="Add to Campaign" primary onClick={onAddCampaign} />
            </div>
          </div>

        </div>
      </div>

      {/* ── three primary KPIs ── */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <BigKpi label="Followers"
          value={creator.followers === null ? '—' : fmtNum(creator.followers)}
          note={growthNote}
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
          /* EMV had no source: it was engagement times a generated CPM. */
          <BigKpi label="Est. Media Value" value="Belum terukur"
            note="butuh benchmark CPM" sub="creator ini belum punya rate card di database KOL" />
        )}
      </div>

      {/* ── six secondary KPIs ── */}
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {/* Was followers × ER, labelled Reach: that product is engagements per
            post, not reach. No reach column is populated on the KOL server. */}
        <StatTile label="Reach" value="Belum terukur" hint="belum ada data reach" />
        {/* L2 `kol_profile_card.avg_views`, over the posts that carry views. */}
        <StatTile label="Avg. Views"
          value={intel.kpi.avgViews === null ? 'Belum terukur' : fmtNum(intel.kpi.avgViews)}
          hint={intel.kpi.avgViews === null ? undefined : avgViewsBasis(creator)} />
        {/* CPE is EMV over engagement; with no EMV there is no CPE. */}
        <StatTile label="CPE" value="Belum terukur" hint="butuh EMV" />
        {/* Audience Quality is the API's L2 `audience_quality_score`;
            Authenticity has no L2 column and comes from
            `feature.*_audience_analysis` via `kolGold`. Null where unanalysed. */}
        <StatTile label="Audience Quality"
          value={creator.audienceQualityScore == null ? 'Belum terukur' : `${creator.audienceQualityScore}`}
          hint={creator.audienceQualityTier
            ? `/ 100 · ${creator.audienceQualityTier}`
            : '/ 100 · sampel follower'} />
        <StatTile label="Authenticity"
          value={quality?.authenticity == null ? 'Belum terukur' : `${quality.authenticity}%`}
          hint="sampel follower" />
        <StatTile label="Growth"
          value={realGrowth === null
            ? 'Belum terukur'
            : `${realGrowth > 0 ? '+' : ''}${realGrowth.toFixed(2)}%`}
          hint={realGrowth === null ? 'butuh dua snapshot' : 'sejak snapshot sebelumnya'} />
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
          {view === 'campaigns' && <CampaignSection />}
          {/* Brand Fit is the scoring half of AI Insights, so the two share a
              view rather than splitting one argument across two nav rows. */}
          {view === 'ai' && (
            <div className="flex flex-col gap-4">
              <BrandFitSection />
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
  label, value, note, sub,
}: {
  label: string; value: string; note: string; sub?: string
}) {
  return (
    <div className="rounded-[16px] border px-4 py-3.5" style={{ borderColor: T.outline, background: VIZ.surface }}>
      <div className="flex items-center gap-1.5">
        <span style={{ ...PJ, color: T.t4 }} className="text-[10px] font-extrabold uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div style={{ ...PJ, color: T.t1 }} className="text-[27px] font-extrabold mt-1.5 tracking-[-0.03em] leading-none">
        {value}
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <span style={{ ...PJ, color: T.primaryDeep }} className="text-[11px] font-bold">{note}</span>
      </div>
      {sub && <div className="text-[9.5px] mt-1" style={{ color: T.t4 }}>{sub}</div>}
    </div>
  )
}

/* ── add to campaign ──────────────────────────────────────────────────────── */

/**
 * The creator's real cost, ahead of adding them to a campaign.
 *
 * The campaign picker is gone: it offered three written-in names ("Summer
 * Beauty Campaign", ...) and "added" the creator to one of them without writing
 * anything. The KOL database has no campaign rows to offer here yet.
 */
function AddToCampaign({
  open, onClose, name, username, tier, rates,
}: {
  open: boolean
  onClose: () => void
  name: string
  username: string
  tier: string | null
  /** The creator's real prices, empty for the ~6% of the roster without any. */
  rates: KolMeasuredRate[]
}) {
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
      footer={<Btn onClick={onClose}>Tutup</Btn>}>
      <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold">{name}</div>
      <div className="text-[11px] mb-4" style={{ color: T.t4 }}>@{username} · {tier ?? 'Creator'}</div>

      <div className="rounded-xl border px-3 py-2.5 mb-3" style={{ borderColor: T.outline }}>
        <div className="text-[10.5px] mb-1.5" style={{ color: T.t3 }}>Selected creator</div>
        <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: T.t1 }}>
          <span className="material-symbols-outlined text-[15px]" style={{ color: '#3d8a5f' }}>check_circle</span>
          {name}
        </div>
      </div>

      <Row label="Estimated cost" value={cost ?? '—'} />

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
        {' '}Daftar campaign belum bisa dipilih dari halaman ini — tabel campaign di database KOL masih kosong.
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
  icon, label, onClick, primary, on, busy,
}: { icon: string; label?: string; onClick: () => void; primary?: boolean; on?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label ?? icon} disabled={busy}
      style={{
        ...PJ,
        background: primary ? T.primary : on ? T.surfaceVariant : VIZ.surface,
        borderColor: primary ? T.primary : on ? T.primary : T.outline,
        color: primary ? '#fff' : on ? T.primaryDeep : T.t2,
      }}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11.5px] font-bold hover:brightness-[.98] ${
        busy ? 'opacity-60 cursor-wait' : ''}`}>
      <span className={`material-symbols-outlined text-[15px] ${busy ? 'animate-spin' : ''}`}>{icon}</span>
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  )
}

/* ── refresh strip (D054) ─────────────────────────────────────────────────── */

/**
 * One run's progress, result or failure — never the profile's. A failed run
 * says so and says what is still there, because "Refresh gagal" next to a
 * creator's page reads like the creator is gone otherwise.
 */
function RefreshStrip({
  phase, step, note, onDismiss,
}: {
  phase: RefreshPhase
  step: { done: number; total: number; label: string | null } | null
  note: string | null
  onDismiss: () => void
}) {
  if (phase === 'idle') return null

  const tone =
    phase === 'failed' ? { bg: '#fdf2f2', fg: '#a04545', border: '#f3d9d9', icon: 'error' }
      : phase === 'success' ? { bg: '#eaf5ef', fg: '#2f6b4a', border: '#cfe6da', icon: 'check_circle' }
        : { bg: '#fdf3e7', fg: '#8a5a17', border: '#f0dcc0', icon: 'progress_activity' }

  const running = phase === 'starting' || phase === 'running'
  const headline =
    phase === 'failed' ? 'Refresh gagal'
      : phase === 'success' ? 'Data creator diperbarui'
        : 'Memperbarui data creator…'
  const body =
    phase === 'failed'
      ? `${note ? `${note} — ` : ''}Profil dan data lama creator ini tetap tersimpan, tidak ada yang dihapus.`
      : phase === 'success'
        ? L2_LATER
        : step && step.total
          ? `Langkah ${Math.min(step.done + 1, step.total)} dari ${step.total}${step.label ? ` · ${step.label}` : ''}`
          : 'Menyiapkan proses…'

  return (
    <div className="mb-3 rounded-[14px] border px-3.5 py-2.5 flex items-start gap-2.5"
      style={{ background: tone.bg, borderColor: tone.border }}>
      <span className={`material-symbols-outlined text-[18px] mt-px ${running ? 'animate-spin' : ''}`}
        style={{ color: tone.fg }}>{tone.icon}</span>
      <div className="min-w-0 flex-1">
        <div style={{ ...PJ, color: tone.fg }} className="text-[12px] font-extrabold">{headline}</div>
        <div className="text-[11.5px] mt-0.5" style={{ color: tone.fg }}>{body}</div>
      </div>
      {!running && (
        <button type="button" onClick={onDismiss} title="Tutup"
          className="material-symbols-outlined text-[16px] cursor-pointer shrink-0"
          style={{ color: tone.fg }}>close</button>
      )}
    </div>
  )
}
