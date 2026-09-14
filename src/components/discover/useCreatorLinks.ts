'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { selectionKey, type SelectionSource } from './useDiscoverSelection'
import type { CreatorLink, LinkCounts, TrackingStatus } from '@/lib/discover/types'

/**
 * My Creators membership and tracking, for every creator this org has a
 * relationship with.
 *
 * The third of Discovery's three per-creator sets, and the only one that is an
 * organization-wide decision rather than a personal or a per-session one:
 *
 *   * `useDiscoverSelection` — Compare. One sitting's working set, localStorage.
 *   * `useDiscoverFavorites` — a personal bookmark, per (org, user), server-side.
 *   * this — the org's roster and what it is watching, per org, server-side.
 *
 * All three are keyed the same way: a bare UUID for a creator in this database,
 * `roster:<uuid>` for one in the commercial KOL database. So a card can ask all
 * three about the same creator without knowing which server it came from.
 *
 * ── Why one hook for two decisions ──────────────────────────────────────────
 * They are one row on the server (migration 053) and one press apart on screen:
 * a card draws Save and Track side by side. Two hooks would mean two loads, two
 * sets of optimistic state, and a window where the card has been saved but does
 * not yet know it is tracked.
 */

export interface CreatorLinks {
  /** Every live link, by client key. */
  byKey: Map<string, CreatorLink>
  counts: LinkCounts
  /** False until the first load settles — cards render neutral rather than wrong. */
  ready: boolean
  /** Set when the last read or write failed; the caller shows it and offers `retry`. */
  error: string | null
  /** Keys with a write in flight, so a button can disable itself rather than queue. */
  busy: Set<string>
  inRoster: (source: SelectionSource, id: string) => boolean
  trackingOf: (source: SelectionSource, id: string) => TrackingStatus
  /** Optimistic. Resolves false and reverts if the server rejects it. */
  setRoster: (source: SelectionSource, id: string, on: boolean) => Promise<boolean>
  setTracking: (source: SelectionSource, id: string, status: TrackingStatus) => Promise<boolean>
  retry: () => void
}

const EMPTY_COUNTS: LinkCounts = { roster: 0, tracked: 0, paused: 0 }

/** The link a creator has when the server has never heard of them. */
const blank = (source: SelectionSource, id: string): CreatorLink => ({
  source, id,
  inRoster: false,
  rosterAddedAt: null,
  tracking: 'none',
  trackingStartedAt: null,
  trackingChangedAt: null,
  lastCheckedAt: null,
  nextCheckAt: null,
})

const indexBy = (links: CreatorLink[]) =>
  new Map(links.map(l => [selectionKey(l.source, l.id), l]))

export function useCreatorLinks(orgId: string): CreatorLinks {
  const [byKey, setByKey] = useState<Map<string, CreatorLink>>(new Map())
  const [counts, setCounts] = useState<LinkCounts>(EMPTY_COUNTS)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [reload, setReload] = useState(0)

  /**
   * Read-after-write ordering, the same guard `useDiscoverFavorites` carries: a
   * list load that resolves after a toggle would otherwise put the pre-toggle
   * state back on screen. A response older than the counter stands down.
   */
  const generation = useRef(0)

  const endpoint = `/api/organizations/${orgId}/discover/links`

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const mine = ++generation.current

    fetch(endpoint)
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<{ links?: CreatorLink[]; counts?: LinkCounts }>
      })
      .then(data => {
        if (cancelled || mine !== generation.current) return
        setByKey(indexBy(data.links ?? []))
        setCounts(data.counts ?? EMPTY_COUNTS)
        setError(null)
      })
      .catch(() => {
        if (!cancelled && mine === generation.current) setError('Unable to load saved creators.')
      })
      .finally(() => {
        if (!cancelled && mine === generation.current) setReady(true)
      })

    return () => { cancelled = true }
  }, [orgId, endpoint, reload])

  const inRoster = useCallback(
    (source: SelectionSource, id: string) => byKey.get(selectionKey(source, id))?.inRoster ?? false,
    [byKey])

  const trackingOf = useCallback(
    (source: SelectionSource, id: string) =>
      byKey.get(selectionKey(source, id))?.tracking ?? 'none',
    [byKey])

  /**
   * One writer for both decisions.
   *
   * `patch` names only what changes, and the server leaves the other half alone
   * — which is what lets Pause run without having to know, or restate, whether
   * the creator is also in My Creators.
   */
  const write = useCallback(async (
    source: SelectionSource, id: string,
    patch: { inRoster?: boolean; tracking?: TrackingStatus },
  ): Promise<boolean> => {
    const key = selectionKey(source, id)
    const mine = ++generation.current

    let previous: Map<string, CreatorLink> | null = null
    setByKey(prev => {
      previous = prev
      const next = new Map(prev)
      const current = prev.get(key) ?? blank(source, id)
      const merged: CreatorLink = {
        ...current,
        inRoster: patch.inRoster ?? current.inRoster,
        tracking: patch.tracking ?? current.tracking,
      }
      // A creator who is neither saved nor tracked has no relationship left, so
      // the entry goes rather than lingering as a row of falses the counts would
      // then have to filter out again.
      if (!merged.inRoster && merged.tracking === 'none') next.delete(key)
      else next.set(key, merged)
      return next
    })
    setBusy(prev => new Set(prev).add(key))
    setError(null)

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, ...patch }),
      })
      const data = await res.json().catch(() => null) as
        { links?: CreatorLink[]; counts?: LinkCounts; error?: string } | null
      if (!res.ok) throw new Error(data?.error || String(res.status))

      // The server's set is authoritative — it also reconciles anything a
      // colleague changed since this page loaded.
      if (mine === generation.current) {
        setByKey(indexBy(data?.links ?? []))
        setCounts(data?.counts ?? EMPTY_COUNTS)
      }
      return true
    } catch (err) {
      if (mine === generation.current && previous) setByKey(previous)
      setError(err instanceof Error && err.message.length < 120
        ? err.message
        : 'Unable to update this creator.')
      return false
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }, [endpoint])

  const setRoster = useCallback(
    (source: SelectionSource, id: string, on: boolean) => write(source, id, { inRoster: on }),
    [write])

  const setTracking = useCallback(
    (source: SelectionSource, id: string, status: TrackingStatus) => write(source, id, { tracking: status }),
    [write])

  const retry = useCallback(() => { setError(null); setReady(false); setReload(n => n + 1) }, [])

  return { byKey, counts, ready, error, busy, inRoster, trackingOf, setRoster, setTracking, retry }
}
