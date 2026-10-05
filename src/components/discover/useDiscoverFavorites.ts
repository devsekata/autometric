'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { selectionKey, type SelectionSource } from './useDiscoverSelection'

/**
 * Favourites, kept on the server.
 *
 * This is the persistent half of what `useDiscoverSelection` does. That hook
 * still owns Compare — a working set for one sitting, which is genuinely
 * browser state — but a favourite is a decision the user expects to find again
 * on another machine next week, and it was living in `localStorage` under
 * `autometric:discover:fav:<org>`. Worse, the Creator Database never even got
 * that far: `KolDirectoryPage` held favourites in a bare `useState`, so they
 * were gone on navigation.
 *
 * Both now read and write `/api/organizations/[id]/discover/favorites`, keyed by
 * (agency, user) in the KOL table `agency_kol_favorites` — see
 * `@/lib/discover/favorites`. Only Creator Database creators can be favourited.
 *
 * ── Keys ────────────────────────────────────────────────────────────────────
 * The set holds the same strings `useDiscoverSelection` uses: a bare UUID for a
 * tracked account, `roster:<uuid>` for a commercial-roster creator. Callers
 * build them with `selectionKey(source, id)`, so a card can test membership
 * without knowing which database it came from.
 */

export interface DiscoverFavorites {
  keys: Set<string>
  /** False until the first load settles — cards render unfilled rather than wrong. */
  ready: boolean
  /** Set when the last read or write failed; the UI shows it and offers `retry`. */
  error: string | null
  has: (source: SelectionSource, id: string) => boolean
  /** Optimistic. Reverts and sets `error` if the server rejects it. */
  toggle: (source: SelectionSource, id: string) => void
  retry: () => void
}

const legacyKey = (orgId: string) => `autometric:discover:fav:${orgId}`

/** The localStorage set this hook replaces, or null when there is nothing to adopt. */
function readLegacy(orgId: string): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(legacyKey(orgId))
    if (!raw) return null
    const arr = JSON.parse(raw)
    const keys = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    return keys.length ? keys : null
  } catch {
    return null
  }
}

export function useDiscoverFavorites(orgId: string): DiscoverFavorites {
  const [keys, setKeys] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  /**
   * Read-after-write ordering. A toggle that resolves after a slower list load
   * would otherwise be overwritten by the stale list; the counter lets a
   * response identify itself as older than what is on screen and stand down.
   */
  const generation = useRef(0)

  const endpoint = `/api/organizations/${orgId}/discover/favorites`

  /** Server ids → the client keys cards test with (`roster:<uuid>`). */
  const toKeys = (ids: unknown): Set<string> =>
    new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string')
      .map(id => selectionKey('roster', id)))

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const mine = ++generation.current

    ;(async () => {
      try {
        // A browser holding the old localStorage set hands its Creator Database
        // favourites over on first load, one add each (the endpoint is
        // idempotent). Tracked-account keys have no KOL home, so when any are
        // present the local copy is kept rather than dropped.
        const legacy = readLegacy(orgId)
        if (legacy) {
          const rosterIds = legacy.filter(k => k.startsWith('roster:')).map(k => k.slice('roster:'.length))
          for (const kolId of rosterIds) {
            await fetch(endpoint, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kolId }),
            })
          }
          if (rosterIds.length === legacy.length) {
            try { window.localStorage.removeItem(legacyKey(orgId)) } catch { /* ignore */ }
          }
        }

        const res = await fetch(endpoint)
        if (!res.ok) throw new Error(String(res.status))
        const data: { ids?: string[] } = await res.json()
        if (cancelled || mine !== generation.current) return
        setKeys(toKeys(data.ids))
        setError(null)
      } catch {
        if (!cancelled && mine === generation.current) {
          setError('Unable to load favorites.')
        }
      } finally {
        if (!cancelled && mine === generation.current) setReady(true)
      }
    })()

    return () => { cancelled = true }
  }, [orgId, endpoint, reload])

  const has = useCallback(
    (source: SelectionSource, id: string) => keys.has(selectionKey(source, id)),
    [keys],
  )

  const toggle = useCallback((source: SelectionSource, id: string) => {
    // Favourites live in `agency_kol_favorites` on the KOL server, keyed by the
    // Creator Database id. A tracked account has no row there to point at.
    if (source !== 'roster') {
      setError('Favorites are available for Creator Database creators only.')
      return
    }
    const key = selectionKey(source, id)

    // Optimistic: the heart fills on click. `generation` is bumped so a list
    // load still in flight cannot land on top of this.
    const mine = ++generation.current
    let reverted: Set<string> | null = null
    let removing = false
    setKeys(prev => {
      reverted = prev
      removing = prev.has(key)
      const next = new Set(prev)
      if (removing) next.delete(key); else next.add(key)
      return next
    })
    setError(null)

    const write = removing
      ? fetch(`${endpoint}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      : fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kolId: id }),
        })

    write
      .then(async res => {
        // 404 on DELETE means it was already gone — the end state is the same.
        if (!res.ok && !(removing && res.status === 404)) throw new Error(String(res.status))
        // The server's set is authoritative — it also reconciles anything
        // favourited in another tab since this page loaded.
        const list = await fetch(endpoint)
        if (!list.ok) return
        const data: { ids?: string[] } = await list.json()
        if (mine === generation.current) setKeys(toKeys(data.ids))
      })
      .catch(() => {
        if (mine === generation.current && reverted) setKeys(reverted)
        setError('Unable to update favorite.')
      })
  }, [endpoint])

  const retry = useCallback(() => { setError(null); setReady(false); setReload(n => n + 1) }, [])

  return { keys, ready, error, has, toggle, retry }
}
