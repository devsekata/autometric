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
 * (org, user) — see `@/lib/discover/favorites` for why favourites are personal
 * rather than org-wide.
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

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const mine = ++generation.current

    ;(async () => {
      try {
        // A browser holding the old localStorage set hands it over on first
        // load. The server merges rather than replaces, so a second browser
        // replaying its own stale copy cannot un-favourite anything.
        const legacy = readLegacy(orgId)
        const res = legacy
          ? await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ import: legacy }),
            })
          : await fetch(endpoint)

        if (!res.ok) throw new Error(String(res.status))
        const data: { keys?: string[] } = await res.json()
        if (cancelled || mine !== generation.current) return

        setKeys(new Set(data.keys ?? []))
        setError(null)
        // Only dropped once the server has confirmed it holds them, so a failed
        // migration leaves the user's list where it was.
        if (legacy) { try { window.localStorage.removeItem(legacyKey(orgId)) } catch { /* ignore */ } }
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
    const key = selectionKey(source, id)

    // Optimistic: the heart fills on click. `generation` is bumped so a list
    // load still in flight cannot land on top of this.
    const mine = ++generation.current
    let reverted: Set<string> | null = null
    setKeys(prev => {
      reverted = prev
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
    setError(null)

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status))
        const data: { keys?: string[] } = await res.json()
        // The server's set is authoritative — it also reconciles anything
        // favourited in another tab since this page loaded.
        if (mine === generation.current) setKeys(new Set(data.keys ?? []))
      })
      .catch(() => {
        if (mine === generation.current && reverted) setKeys(reverted)
        setError('Unable to update favorite.')
      })
  }, [endpoint])

  const retry = useCallback(() => { setError(null); setReady(false); setReload(n => n + 1) }, [])

  return { keys, ready, error, has, toggle, retry }
}
