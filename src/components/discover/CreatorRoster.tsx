'use client'

/**
 * Creator Database — the org's own roster, and Basic Discovery over it.
 *
 * This is the list intake fills. It is deliberately the same screen as Basic
 * Discovery rather than a second copy of it: filtering a roster and browsing a
 * roster are the same act, and a separate "search creators" page over the same
 * table would drift from this one the first time a field was added.
 *
 * It is also where a creator is *managed* — last updated, refresh, monitoring on
 * or off. Those live on the card rather than behind a detail page because they
 * are the answers to "is this data still good", which is a question you ask of
 * the list, not of one creator at a time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, EmptyState, PJ, TOKENS as T, fmtNum, RosterAvatar, SelectPill } from './ui'
import AddCreatorModal from './AddCreatorModal'
import { CREATOR_PLATFORMS, platformLabel } from '@/lib/discover/creatorInput'
import { TIERS } from '@/lib/discover/vocab'
import type { CreatorSummary, ProfilingStatus } from '@/lib/discover/creatorFlow'

export interface CreatorRosterProps {
  orgId: string
  /** Arrive with the Add Account modal already open (`?add=1`). */
  openAddOnMount?: boolean
  /**
   * Rendered inside the Discover shell, which already draws the title and
   * subtitle for this segment. The screen then keeps only what is its own: the
   * count line, the Add button and the filters.
   */
  embedded?: boolean
  /** Open one creator's full profile. */
  onOpenCreator: (creatorId: string) => void
  /** Follow a run on the dedicated progress screen. */
  onOpenProfiling: (creatorId: string) => void
  /** Hand a creator to Smart Discovery as the reference. */
  onFindSimilar: (creatorId: string) => void
}

interface Filters {
  q: string
  platform: string
  category: string
  tier: string
  follMin: number
  minEr: number
  status: string
}

const DEFAULT_FILTERS: Filters = { q: '', platform: '', category: '', tier: '', follMin: 0, minEr: 0, status: '' }

const FOLLOWER_STEPS: { label: string; value: number }[] = [
  { label: 'Any followers', value: 0 },
  { label: '1K+', value: 1_000 },
  { label: '10K+', value: 10_000 },
  { label: '50K+', value: 50_000 },
  { label: '100K+', value: 100_000 },
  { label: '1M+', value: 1_000_000 },
]

const ER_STEPS: { label: string; value: number }[] = [
  { label: 'Any engagement', value: 0 },
  { label: 'ER 1%+', value: 1 },
  { label: 'ER 3%+', value: 3 },
  { label: 'ER 5%+', value: 5 },
]

const STATUS_STEPS: { label: string; value: string }[] = [
  { label: 'Any status', value: '' },
  { label: 'Ready', value: 'ready' },
  { label: 'Profiling', value: 'running' },
  { label: 'Failed', value: 'failed' },
]

interface Facets {
  categories: { name: string; count: number }[]
  platforms: { key: string; count: number }[]
  tiers: { name: string; count: number }[]
  total: number
}

export default function CreatorRoster({
  orgId, openAddOnMount, embedded, onOpenCreator, onOpenProfiling, onFindSimilar,
}: CreatorRosterProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [creators, setCreators] = useState<CreatorSummary[] | null>(null)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(!!openAddOnMount)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (withFacets: boolean) => {
    try {
      const qs = new URLSearchParams()
      if (filters.q.trim()) qs.set('q', filters.q.trim())
      if (filters.platform) qs.set('platform', filters.platform)
      if (filters.category) qs.set('category', filters.category)
      if (filters.tier) qs.set('tier', filters.tier)
      if (filters.status) qs.set('status', filters.status)
      if (filters.follMin) qs.set('follMin', String(filters.follMin))
      if (filters.minEr) qs.set('minEr', String(filters.minEr))
      if (withFacets) qs.set('facets', '1')

      const res = await fetch(`/api/organizations/${orgId}/discover/creators?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The roster could not be loaded.')
      setCreators(data.creators as CreatorSummary[])
      if (data.facets) setFacets(data.facets as Facets)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setCreators([])
    }
  }, [orgId, filters])

  /**
   * Facets describe the whole roster, not the filtered view, so they are asked
   * for once. Tracked in a ref rather than derived from `facets` state: reading
   * the state here would make the effect re-run the moment the facets arrive,
   * costing a second identical fetch on every mount.
   */
  const facetsAsked = useRef(false)
  useEffect(() => {
    const first = !facetsAsked.current
    facetsAsked.current = true
    // The first load is immediate; every later one waits out a keystroke.
    // `load` changes identity whenever any filter does, so without this the
    // search box fires one request per character typed.
    if (first) { load(true); return }
    const timer = setTimeout(() => load(false), 250)
    return () => clearTimeout(timer)
  }, [load])

  /**
   * A creator still being profiled has to keep its card current, and polling the
   * whole list is how a card that started as "queued" becomes "ready" without
   * the user reloading. The poll stops as soon as nothing is running, so a
   * settled roster costs nothing.
   */
  const anyRunning = useMemo(
    () => (creators ?? []).some(c => c.profilingStatus === 'queued' || c.profilingStatus === 'running'),
    [creators],
  )
  useEffect(() => {
    if (!anyRunning) return
    const timer = setInterval(() => load(false), 4_000)
    return () => clearInterval(timer)
  }, [anyRunning, load])

  async function refresh(creatorId: string) {
    setBusyId(creatorId)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}/refresh`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The refresh could not be started.')
      await load(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleMonitoring(creator: CreatorSummary) {
    setBusyId(creator.id)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creator.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitoringEnabled: !creator.monitoringEnabled }),
      })
      if (!res.ok) throw new Error((await res.json())?.error || 'The change could not be saved.')
      await load(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusyId(null)
    }
  }

  const activeCount =
    (filters.q ? 1 : 0) + (filters.platform ? 1 : 0) + (filters.category ? 1 : 0) +
    (filters.tier ? 1 : 0) + (filters.status ? 1 : 0) + (filters.follMin ? 1 : 0) + (filters.minEr ? 1 : 0)

  const total = facets?.total ?? creators?.length ?? 0

  const countLine = creators === null
    ? 'Loading the creators this organization has added…'
    : `${creators.length} of ${total} creator${total === 1 ? '' : 's'} added by this organization`
      + ' · every figure here was measured during profiling'

  const addButton = (
    <button type="button" onClick={() => setAdding(true)} style={PJ}
      className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E] cursor-pointer flex-shrink-0">
      <span className="material-symbols-outlined text-[16px]">person_add</span>
      Add Creator
    </button>
  )

  return (
    <div>
      {/* ── header ─────────────────────────────────────────────────────── */}
      {!embedded && (
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 style={PJ} className="text-[19px] font-extrabold text-[#111827] tracking-[-0.02em]">
              Creator Database
            </h2>
            <p className="text-[12px] text-[#6b7280] mt-1 max-w-[70ch]">{countLine}</p>
          </div>
          {addButton}
        </div>
      )}

      {/* ── filters ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4 mb-4" style={{ boxShadow: T.shadow }}>
        {/* Inside the shell the title lives above this card, so the count line
            and the Add button come along with the controls instead. */}
        {embedded && (
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3 pb-3 border-b border-[#f3f4f6]">
            <span className="text-[12px] text-[#6b7280]">{countLine}</span>
            {addButton}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <span className="material-symbols-outlined text-[16px] text-[#9ca3af] absolute left-2.5 top-1/2 -translate-y-1/2">
              search
            </span>
            <input
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Search by name or username"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#e5e7eb] text-[12.5px] text-[#111827] outline-none focus:border-[#327488]"
            />
          </div>
          <div className="w-[150px]"><SelectPill icon="group" label="Followers" value={filters.follMin}
            options={FOLLOWER_STEPS} onChange={v => setFilters(f => ({ ...f, follMin: v }))} /></div>
          <div className="w-[160px]"><SelectPill icon="favorite" label="Engagement" value={filters.minEr}
            options={ER_STEPS} onChange={v => setFilters(f => ({ ...f, minEr: v }))} /></div>
          <div className="w-[140px]"><SelectPill icon="rule" label="Status" value={filters.status}
            options={STATUS_STEPS} onChange={v => setFilters(f => ({ ...f, status: v }))} /></div>
          {activeCount > 0 && (
            <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} style={PJ}
              className="text-[11.5px] font-bold text-[#9ca3af] hover:text-[#374151] underline cursor-pointer">
              Clear {activeCount}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mt-3">
          {CREATOR_PLATFORMS.map(p => {
            const count = facets?.platforms.find(f => f.key === p.id)?.count
            return (
              <Chip
                key={p.id}
                icon={p.icon}
                label={count === undefined ? p.label : `${p.label} ${count}`}
                on={filters.platform === p.id}
                onClick={() => setFilters(f => ({ ...f, platform: f.platform === p.id ? '' : p.id }))}
              />
            )
          })}
          <span className="w-px h-4 bg-[#e5e7eb] mx-1" />
          {(facets?.categories ?? []).map(c => (
            <Chip
              key={c.name}
              label={`${c.name} ${c.count}`}
              on={filters.category === c.name}
              onClick={() => setFilters(f => ({ ...f, category: f.category === c.name ? '' : c.name }))}
            />
          ))}
          {!!facets?.tiers.length && <span className="w-px h-4 bg-[#e5e7eb] mx-1" />}
          {TIERS.filter(t => facets?.tiers.some(f => f.name === t)).map(t => (
            <Chip
              key={t}
              label={t}
              on={filters.tier === t}
              onClick={() => setFilters(f => ({ ...f, tier: f.tier === t ? '' : t }))}
            />
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-3 py-2 text-[11.5px] text-[#a04545] mb-4">
          {error}
        </div>
      )}

      {/* ── the roster ─────────────────────────────────────────────────── */}
      {creators === null ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2">
          <span className="material-symbols-outlined text-[26px] text-[#A7C8D4] animate-spin">progress_activity</span>
          <span className="text-[12px] text-[#9ca3af]">Loading creators…</span>
        </div>
      ) : creators.length === 0 ? (
        total === 0 ? (
          <EmptyState
            icon="person_add"
            title="No creators yet"
            body="Add a creator by pasting their profile URL or username. We validate the account, check it is not already here, then profile it."
            action={
              <button type="button" onClick={() => setAdding(true)} style={PJ}
                className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E] cursor-pointer">
                <span className="material-symbols-outlined text-[16px]">person_add</span>
                Add your first creator
              </button>
            }
          />
        ) : (
          <EmptyState
            icon="search_off"
            title="No creator matches these filters"
            body="Loosen a filter, or add a creator who fits what you are looking for."
            action={
              <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} style={PJ}
                className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-white border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb] cursor-pointer">
                Clear filters
              </button>
            }
          />
        )
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {creators.map(c => (
            <CreatorCard
              key={c.id}
              creator={c}
              busy={busyId === c.id}
              onOpen={() => onOpenCreator(c.id)}
              onFollowRun={() => onOpenProfiling(c.id)}
              onRefresh={() => refresh(c.id)}
              onToggleMonitoring={() => toggleMonitoring(c)}
              onFindSimilar={() => onFindSimilar(c.id)}
            />
          ))}
        </div>
      )}

      {adding && (
        <AddCreatorModal
          orgId={orgId}
          onClose={() => setAdding(false)}
          onProfilingStarted={creator => { setAdding(false); onOpenProfiling(creator.id) }}
          onViewExisting={id => { setAdding(false); onOpenCreator(id) }}
          onRefreshExisting={async id => { setAdding(false); await refresh(id); onOpenProfiling(id) }}
        />
      )}
    </div>
  )
}

/* ── card ─────────────────────────────────────────────────────────────────── */

const STATUS_LOOK: Record<ProfilingStatus, { label: string; fg: string; bg: string; icon: string }> = {
  ready: { label: 'Ready', fg: '#3d8a5f', bg: '#eaf5ef', icon: 'check_circle' },
  running: { label: 'Profiling', fg: '#327488', bg: '#f0f7fa', icon: 'progress_activity' },
  queued: { label: 'Queued', fg: '#6b5bb5', bg: '#f3f0fb', icon: 'schedule' },
  failed: { label: 'Failed', fg: '#a04545', bg: '#fdf2f2', icon: 'error' },
}

/** "2h ago" / "3mo ago", the same scale the KOL Directory cards use. */
function sinceLabel(iso: string | null): string {
  if (!iso) return 'never refreshed'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`
}

function CreatorCard({
  creator, busy, onOpen, onFollowRun, onRefresh, onToggleMonitoring, onFindSimilar,
}: {
  creator: CreatorSummary
  busy: boolean
  onOpen: () => void
  onFollowRun: () => void
  onRefresh: () => void
  onToggleMonitoring: () => void
  onFindSimilar: () => void
}) {
  const status = STATUS_LOOK[creator.profilingStatus] ?? STATUS_LOOK.queued
  const inFlight = creator.profilingStatus === 'running' || creator.profilingStatus === 'queued'
  const ready = creator.profilingStatus === 'ready'

  return (
    <article className="rounded-2xl border border-[#e5e7eb] bg-white overflow-hidden flex flex-col"
      style={{ boxShadow: T.shadow }}>
      <div className="p-4 flex items-start gap-3">
        <button type="button" onClick={onOpen}
          className="w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0 cursor-pointer"
          style={{ background: T.gradient }} title="Open profile">
          <RosterAvatar src={creator.avatarUrl} username={creator.username} textClass="text-[15px]" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onOpen} style={PJ}
              className="text-[13.5px] font-extrabold text-[#111827] truncate hover:text-[#285D6E] cursor-pointer">
              {creator.displayName || `@${creator.username}`}
            </button>
            {creator.verified && (
              <span className="material-symbols-outlined text-[14px] text-[#4E96AC]" title="Verified">verified</span>
            )}
          </div>
          <p className="text-[11.5px] text-[#9ca3af] truncate">
            {platformLabel(creator.platform)} · @{creator.username}
            {creator.city ? ` · ${creator.city}` : ''}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span
              style={{ ...PJ, background: status.bg, color: status.fg }}
              className="inline-flex items-center gap-1 rounded-md text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5"
            >
              <span className={`material-symbols-outlined text-[11px] ${inFlight ? 'animate-spin' : ''}`}>
                {status.icon}
              </span>
              {status.label}
            </span>
            {creator.category && (
              <span style={PJ} className="rounded-md bg-[#f3f4f6] text-[#6b7280] text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5">
                {creator.category}
              </span>
            )}
            {creator.tier && (
              <span style={PJ} className="rounded-md bg-[#EDF4F7] text-[#285D6E] text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5">
                {creator.tier}
              </span>
            )}
            {creator.visibility === 'private' && (
              <span style={PJ} className="rounded-md bg-[#fdf3e7] text-[#b5761f] text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5">
                private
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 grid grid-cols-3 gap-2">
        <Stat label="Followers" value={creator.followers !== null ? fmtNum(creator.followers) : null} />
        <Stat label="ER" value={creator.erPct !== null ? `${creator.erPct.toFixed(2)}%` : null} />
        <Stat label="Updated" value={creator.lastRefreshedAt ? sinceLabel(creator.lastRefreshedAt) : null} small />
      </div>

      {creator.profilingStatus === 'failed' && creator.profilingError && (
        <p className="mx-4 mb-3 rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-2.5 py-1.5 text-[11px] text-[#a04545] line-clamp-2">
          {creator.profilingError}
        </p>
      )}

      <div className="mt-auto border-t border-[#f3f4f6] px-2 py-2 flex items-center gap-0.5 flex-wrap">
        {inFlight ? (
          <CardAction icon="timeline" label="Follow run" onClick={onFollowRun} />
        ) : (
          <CardAction icon="person" label="Profile" onClick={onOpen} />
        )}
        {/* Every action stays pressable, including the ones that cannot do what
            they say yet. A run is already going, or profiling has not finished —
            both are answered by the progress screen, so the button goes there
            and says why, instead of greying out and explaining nothing. */}
        <CardAction
          icon="refresh"
          label="Refresh"
          busy={busy}
          onClick={inFlight ? onFollowRun : onRefresh}
          title={inFlight ? 'Sedang di-profiling — buka progresnya' : 'Ambil ulang data creator ini'}
        />
        <CardAction
          icon={creator.monitoringEnabled ? 'notifications_active' : 'notifications_off'}
          label={creator.monitoringEnabled ? 'Monitored' : 'Paused'}
          onClick={onToggleMonitoring}
          busy={busy}
          tone={creator.monitoringEnabled ? 'on' : 'off'}
          title={creator.monitoringEnabled
            ? 'Monitoring aktif — klik untuk menjeda'
            : 'Monitoring dijeda — klik untuk mengaktifkan'}
        />
        <CardAction
          icon="hub"
          label="Similar"
          onClick={ready ? onFindSimilar : onFollowRun}
          title={ready
            ? 'Cari creator dengan karakteristik serupa'
            : 'Perlu profil yang sudah selesai — buka progres profiling-nya'}
          muted={!ready}
        />
      </div>
    </article>
  )
}

function Stat({ label, value, small }: { label: string; value: string | null; small?: boolean }) {
  return (
    <div className="rounded-lg bg-[#f9fafb] px-2 py-1.5">
      <div style={PJ} className={`font-extrabold tabular-nums truncate ${small ? 'text-[11px]' : 'text-[13px]'} ${
        value ? 'text-[#111827]' : 'text-[#d1d5db]'
      }`}>
        {value ?? '—'}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-[#9ca3af] font-bold">{label}</div>
    </div>
  )
}

/**
 * A card action.
 *
 * `muted` dims the label for an action that is not the useful one right now,
 * but it stays clickable and its `title` says what pressing it will do instead.
 * Only `busy` — a request already in flight from this very button — actually
 * disables it, because a second click there would fire the same request twice.
 */
function CardAction({
  icon, label, onClick, busy, muted, tone, title,
}: {
  icon: string; label: string; onClick: () => void
  busy?: boolean; muted?: boolean; tone?: 'on' | 'off'; title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title ?? label}
      style={PJ}
      className={`inline-flex items-center gap-1 rounded-lg text-[11px] font-bold px-2 h-7 transition-colors ${
        busy ? 'text-[#d1d5db] cursor-wait'
          : muted ? 'text-[#c4cbd4] hover:bg-[#f3f4f6] hover:text-[#6b7280] cursor-pointer'
          : tone === 'on' ? 'text-[#3d8a5f] hover:bg-[#eaf5ef] cursor-pointer'
          : tone === 'off' ? 'text-[#b5761f] hover:bg-[#fdf3e7] cursor-pointer'
          : 'text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#374151] cursor-pointer'
      }`}
    >
      <span className={`material-symbols-outlined text-[15px] ${busy ? 'animate-spin' : ''}`}>
        {busy ? 'progress_activity' : icon}
      </span>
      {label}
    </button>
  )
}
