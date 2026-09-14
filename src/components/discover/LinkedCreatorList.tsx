'use client'

/**
 * The creators this organization has a standing relationship with — one list,
 * two facets.
 *
 * Both facets are the same table read two ways (`discover_creator_links`,
 * migration 053) and the same endpoint asked two questions, so they are one
 * component rather than two that would drift:
 *
 *   * `roster` — **My Creators**, the half adopted from the Creator Database.
 *     Somebody pressed Add to My Creators on a creator who lives in the KOL
 *     database, and this org now keeps them in its working roster without a copy
 *     of their record existing anywhere.
 *   * `tracked` — **Tracked Accounts**. Somebody pressed Start Tracking. Being
 *     in the Creator Database, or even in My Creators, is not tracking; tracking
 *     is an explicit decision with a status you can pause and resume.
 *
 * A creator in either facet is either a row in the commercial KOL database or
 * one this org profiled itself, and the row says which by where its Open Profile
 * goes.
 *
 * ── Why the dates are two different things ──────────────────────────────────
 * `Last updated` is when the creator's own numbers were last collected, which is
 * a fact about the creator's record. `Next update` is only ever shown when the
 * link row actually carries one — nothing here invents a schedule, because
 * nothing in this app currently runs one. Saying "next update in 6 hours" when
 * no job exists to do it would be the one lie this screen could tell that a user
 * would act on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Btn, Chip, EmptyState, ErrorState, PJ, TOKENS as T, fmtNum, fmtSince, RosterAvatar, SelectPill, Spinner } from './ui'
import { platformLabel } from '@/lib/discover/creatorInput'
import type { LinkedCreator, TrackingStatus } from '@/lib/discover/types'

export type LinkFacet = 'roster' | 'tracked'

export interface LinkedCreatorListProps {
  orgId: string
  /** Which half of the relationship this list is about. */
  facet: LinkFacet
  /** Open a creator this org profiled itself. */
  onOpenCreator: (creatorId: string) => void
  /** Open a creator from the commercial KOL database. */
  onOpenRosterCreator: (kolId: string) => void
  /** The empty state's way to the Creator Database, where both lists are filled. */
  onGoToDatabase: () => void
  /** Hand a creator to Smart Discovery as its reference. */
  onFindSimilar: (id: string, source: 'creator' | 'roster') => void
}

/** Copy and empty states, per facet. Everything else about the two is identical. */
const FACET_COPY: Record<LinkFacet, {
  countNoun: string
  searchPlaceholder: string
  emptyIcon: string
  emptyTitle: string
  emptyBody: string
}> = {
  roster: {
    countNoun: 'creator di My Creators',
    searchPlaceholder: 'Cari creator di My Creators…',
    emptyIcon: 'folder_shared',
    emptyTitle: 'No creators in My Creators yet',
    emptyBody: 'Save creators from the Creator Database, or add a new creator, to build your organization’s working roster.',
  },
  tracked: {
    countNoun: 'creator dipantau',
    searchPlaceholder: 'Cari creator yang dipantau…',
    emptyIcon: 'monitor_heart',
    emptyTitle: 'Nothing tracked yet',
    emptyBody: 'Start monitoring creators from their profile or their card in the Creator Database to follow changes in performance and activity.',
  },
}

const STATUS_STEPS: { label: string; value: string }[] = [
  { label: 'Semua status', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
]

const STATUS_STYLE: Record<Exclude<TrackingStatus, 'none'>, { bg: string; fg: string; icon: string; label: string }> = {
  active: { bg: '#e8f5ee', fg: '#2f6d4c', icon: 'monitor_heart', label: 'Active' },
  paused: { bg: '#fdf3e3', fg: '#96621a', icon: 'pause_circle', label: 'Paused' },
}

export default function LinkedCreatorList({
  orgId, facet, onOpenCreator, onOpenRosterCreator, onGoToDatabase, onFindSimilar,
}: LinkedCreatorListProps) {
  const copy = FACET_COPY[facet]
  const [rows, setRows] = useState<LinkedCreator[] | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [platform, setPlatform] = useState('')
  /** The key of the creator whose row has a write in flight. */
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? '' : t)), 2600)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/links/creators?facet=${facet}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Daftar creator gagal dimuat.')
      setRows((data.creators ?? []) as LinkedCreator[])
      setNotes((data.notes ?? []) as string[])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setRows([])
    }
  }, [orgId, facet])

  useEffect(() => { void load() }, [load])

  /**
   * Status changes go straight to the link endpoint rather than through
   * `useCreatorLinks`.
   *
   * That hook exists for screens showing creators they do *not* have loaded —
   * the Creator Database grid, which needs a membership test per card. Here the
   * rows are the links, so the list itself is the state, and reloading it after
   * a write is both simpler and the only thing that keeps `trackingChangedAt`
   * on screen honest.
   */
  const setTracking = useCallback(async (c: LinkedCreator, next: TrackingStatus) => {
    setBusy(c.key)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: c.key, tracking: next }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Status tracking gagal diubah.')
      await load()
      flash(
        next === 'active' ? `Tracking @${c.username} aktif`
          : next === 'paused' ? `Tracking @${c.username} dijeda`
          : `@${c.username} tidak lagi dipantau`,
      )
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }, [orgId, load, flash])

  /**
   * Take a creator out of My Creators.
   *
   * Removing does not delete anybody: the creator stays in the Creator Database,
   * where they came from, and a creator this org profiled itself cannot be
   * removed from here at all — it is in My Creators because it is *in this
   * org's own table*, and the way to remove one of those is to delete it from
   * its own profile.
   */
  const removeFromRoster = useCallback(async (c: LinkedCreator) => {
    setBusy(c.key)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: c.key, inRoster: false }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Creator gagal dikeluarkan dari My Creators.')
      await load()
      flash(`@${c.username} dikeluarkan dari My Creators — creator-nya tetap ada di Creator Database`)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }, [orgId, load, flash])

  const refresh = useCallback(async (c: LinkedCreator) => {
    setBusy(c.key)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/links/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: c.key }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Refresh gagal dimulai.')
      await load()
      // Deliberately not "refreshed": the pipeline runs for minutes after this
      // returns, and a toast claiming the numbers are new would be wrong for
      // most of that time.
      flash(`Pengambilan data @${c.username} dimulai — hasilnya menyusul beberapa menit lagi`)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }, [orgId, load, flash])

  const platforms = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of rows ?? []) {
      if (r.platform) seen.set(r.platform, (seen.get(r.platform) ?? 0) + 1)
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (rows ?? []).filter(r => {
      if (status && r.link.tracking !== status) return false
      if (platform && r.platform !== platform) return false
      if (!term) return true
      return r.username.toLowerCase().includes(term)
        || (r.displayName ?? '').toLowerCase().includes(term)
        || r.categories.some(c => c.toLowerCase().includes(term))
    })
  }, [rows, q, status, platform])

  const counts = useMemo(() => ({
    active: (rows ?? []).filter(r => r.link.tracking === 'active').length,
    paused: (rows ?? []).filter(r => r.link.tracking === 'paused').length,
  }), [rows])

  if (error && !rows?.length) return <ErrorState message={error} />
  if (rows === null) return <Spinner label="Memuat creator…" />

  if (!rows.length) {
    return (
      <>
        {notes.map((n, i) => <Note key={i} text={n} />)}
        <EmptyState
          icon={copy.emptyIcon}
          title={copy.emptyTitle}
          body={copy.emptyBody}
          action={
            <Btn variant="primary" onClick={onGoToDatabase}>
              <span className="material-symbols-outlined text-[15px]">search</span>
              Browse Creator Database
            </Btn>
          }
        />
      </>
    )
  }

  return (
    <div>
      {notes.map((n, i) => <Note key={i} text={n} />)}

      {/* ── count line and filters ── */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <p className="text-[12.5px]" style={{ color: T.t3 }}>
          {shown.length === rows.length
            ? `${rows.length} ${copy.countNoun}`
            : `${shown.length} dari ${rows.length} ${copy.countNoun}`}
          {/* Tracking states are the subject of one facet and only context in
              the other, so they are only counted out where they are the point. */}
          {facet === 'tracked'
            ? <>{' · '}{counts.active} active{counts.paused > 0 && ` · ${counts.paused} paused`}</>
            : counts.active + counts.paused > 0
              && ` · ${counts.active + counts.paused} sedang dipantau`}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <label className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-[16px]" style={{ color: T.t4 }}>search</span>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={copy.searchPlaceholder}
            style={{ ...PJ, borderColor: T.outline }}
            className="h-9 w-[260px] rounded-lg border pl-8 pr-3 text-[12px] bg-white outline-none focus:border-[#A7C8D4]"
          />
        </label>
        {/* Tracking status narrows Tracked Accounts, where every row has one. In
            My Creators most rows are not tracked at all, so the control would be
            a filter whose default answer is "almost everything". */}
        {facet === 'tracked' && (
          /* SelectPill fills its container by design — it lives in filter
             sidebars elsewhere — so it gets a width here rather than stretching
             across the toolbar. */
          <div className="w-[150px]">
            <SelectPill icon="monitor_heart" label="Status" value={status} options={STATUS_STEPS} onChange={setStatus} />
          </div>
        )}
        {platforms.length > 1 && (
          <>
            <Chip label="Semua platform" on={platform === ''} onClick={() => setPlatform('')} />
            {platforms.map(([key, n]) => (
              <Chip key={key} label={`${platformLabel(key)} (${n})`} on={platform === key}
                onClick={() => setPlatform(platform === key ? '' : key)} />
            ))}
          </>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon="filter_alt_off"
          title="Tidak ada yang cocok dengan filter ini"
          body="Longgarkan pencarian, status atau platform untuk melihat creator yang dipantau."
          action={
            <Btn onClick={() => { setQ(''); setStatus(''); setPlatform('') }}>Clear filters</Btn>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(c => (
            <LinkedRow
              key={c.key}
              creator={c}
              facet={facet}
              busy={busy === c.key}
              onOpen={() => (c.source === 'roster' ? onOpenRosterCreator(c.id) : onOpenCreator(c.id))}
              onSimilar={() => onFindSimilar(c.id, c.source === 'roster' ? 'roster' : 'creator')}
              onPause={() => setTracking(c, 'paused')}
              onResume={() => setTracking(c, 'active')}
              onStop={() => setTracking(c, 'none')}
              onRefresh={() => refresh(c)}
              // Only a creator adopted from the database can be un-adopted; the
              // org's own creators are in My Creators by construction.
              onRemove={c.source === 'roster' ? () => removeFromRoster(c) : null}
            />
          ))}
        </div>
      )}

      {toast && (
        <div style={{ ...PJ, background: T.t1 }}
          className="fixed bottom-[30px] left-1/2 -translate-x-1/2 z-50 text-white text-[12.5px] font-semibold px-[18px] py-[11px] rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ── one linked creator ───────────────────────────────────────────────────── */

function LinkedRow({
  creator: c, facet, busy, onOpen, onSimilar, onPause, onResume, onStop, onRefresh, onRemove,
}: {
  creator: LinkedCreator
  facet: LinkFacet
  busy: boolean
  onOpen: () => void
  onSimilar: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onRefresh: () => void
  /** Null for a creator that cannot be removed from My Creators — see the writer. */
  onRemove: (() => void) | null
}) {
  const tracking = c.link.tracking
  const active = tracking === 'active'
  const st = tracking === 'none' ? null : STATUS_STYLE[active ? 'active' : 'paused']

  /**
   * Two dates that mean different things, and are not merged.
   *
   * `lastRefreshedAt` comes from the creator's own record and is the only thing
   * that says how old the numbers on screen are. `lastCheckedAt` is when
   * somebody last pressed Refresh — the pipeline runs for minutes afterwards, so
   * a pending request is not new data, and folding the two together would print
   * "updated just now" over figures that had not moved.
   */
  const lastUpdated = c.lastRefreshedAt
  const refreshPending = !!c.link.lastCheckedAt
    && (!c.lastRefreshedAt || c.link.lastCheckedAt > c.lastRefreshedAt)

  const meta = [
    c.platform ? platformLabel(c.platform) : null,
    c.categories[0] ?? null,
    c.city,
  ].filter(Boolean).join(' · ')

  return (
    <article
      className="rounded-2xl border bg-white px-4 py-3 flex items-center gap-3.5 flex-wrap transition-colors hover:border-[#A7C8D4]"
      style={{ borderColor: T.outline, boxShadow: T.shadow, opacity: busy ? 0.6 : 1 }}
    >
      <span className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
        style={{ background: T.gradient }}>
        <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[12px]" />
      </span>

      <div className="min-w-[180px] flex-1">
        <button type="button" onClick={onOpen} style={{ ...PJ, color: T.t1 }}
          className="text-[13.5px] font-extrabold truncate hover:underline text-left block max-w-full"
          title={`Open ${c.displayName || `@${c.username}`}`}>
          {c.displayName || `@${c.username}`}
        </button>
        <div className="text-[11px] truncate" style={{ color: T.t4 }}>
          {[c.displayName ? `@${c.username}` : null, meta].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      <div className="text-[11px] min-w-[92px]" style={{ color: T.t3 }}>
        <b style={{ ...PJ, color: T.t1 }} className="text-[12.5px] tabular-nums">
          {c.followers !== null ? fmtNum(c.followers) : '—'}
        </b>{' '}followers
      </div>
      <div className="text-[11px] min-w-[74px]" style={{ color: T.t3 }}>
        <b style={{ ...PJ, color: T.t1 }} className="text-[12.5px] tabular-nums">
          {c.erPct !== null ? `${c.erPct.toFixed(2)}%` : '—'}
        </b>{' '}ER
      </div>

      {/* Not tracked is a real state in My Creators and a state that cannot
          occur in Tracked Accounts, so it renders as a quiet label rather than
          as a missing chip. */}
      {st ? (
        <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-extrabold"
          style={{ ...PJ, background: st.bg, color: st.fg }}
          title={c.link.trackingChangedAt ? `Status berubah ${fmtSince(c.link.trackingChangedAt)}` : undefined}>
          <span className="material-symbols-outlined text-[12px]">{st.icon}</span>
          {st.label}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-bold"
          style={{ ...PJ, background: T.outlineSoft, color: T.t4 }}
          title="Creator ini ada di roster kamu tapi belum dipantau.">
          <span className="material-symbols-outlined text-[12px]">radar</span>
          Not tracked
        </span>
      )}

      <div className="text-[10.5px] min-w-[124px] leading-snug" style={{ color: T.t4 }}>
        <div>Last updated: <span style={{ color: T.t3 }}>{lastUpdated ? fmtSince(lastUpdated) : 'belum pernah'}</span></div>
        {refreshPending && (
          <div style={{ color: '#96621a' }} title="Refresh sudah diminta; datanya menyusul.">
            Refresh diminta {fmtSince(c.link.lastCheckedAt!)}
          </div>
        )}
        {/* Only printed when there really is a schedule behind it. */}
        {c.link.nextCheckAt && (
          <div>Next update: <span style={{ color: T.t3 }}>{fmtSince(c.link.nextCheckAt)}</span></div>
        )}
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <RowAction icon="open_in_new" title="Open profile" onClick={onOpen} disabled={busy} />
        <RowAction icon="auto_awesome" title="Find similar creators" onClick={onSimilar} disabled={busy} />
        {/* Refreshing spends an Apify run and the server only allows it for a
            creator this org tracks, so the button is only offered where that is
            true rather than offered and then refused. */}
        {tracking !== 'none' && (
          <RowAction icon="refresh" title="Refresh data" onClick={onRefresh} disabled={busy} />
        )}
        {active
          ? <RowAction icon="pause_circle" title="Pause tracking" onClick={onPause} disabled={busy} />
          : <RowAction icon="play_circle"
              title={tracking === 'paused' ? 'Resume tracking' : 'Start tracking'}
              onClick={onResume} disabled={busy} accent="#2f6d4c" />}
        {facet === 'tracked'
          ? (
            <RowAction icon="highlight_off" title="Stop tracking — creator tetap ada di Creator Database"
              onClick={onStop} disabled={busy} accent="#a15252" />
          )
          : onRemove && (
            <RowAction icon="folder_off"
              title="Remove from My Creators — creator tetap ada di Creator Database"
              onClick={onRemove} disabled={busy} accent="#a15252" />
          )}
      </div>
    </article>
  )
}

function RowAction({
  icon, title, onClick, disabled, accent,
}: { icon: string; title: string; onClick: () => void; disabled?: boolean; accent?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="w-8 h-8 rounded-lg border flex items-center justify-center transition-colors hover:bg-[#f0f7fa]"
      style={{
        borderColor: T.outline,
        color: accent ?? T.t3,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span className="material-symbols-outlined text-[17px]">{icon}</span>
    </button>
  )
}

/** A line the server sent about what it could not show. */
function Note({ text }: { text: string }) {
  return (
    <p className="text-[11px] rounded-lg border px-3 py-2 mb-2.5 leading-snug"
      style={{ borderColor: '#e6d6b8', background: '#fdf8ef', color: '#8a6a2f' }}>
      {text}
    </p>
  )
}
