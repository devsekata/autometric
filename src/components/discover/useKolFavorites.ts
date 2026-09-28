'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The signed-in user's favorite creators in this agency, from the KOL database
 * (`/discover/favorites` → `public.agency_kol_favorites`).
 *
 * Toggling is optimistic: the heart flips at once, the request follows, and a
 * failed request puts it back and reports the error.
 *
 * Favorites used to live in this browser under the Compare/Favorite selection
 * store (`autometric:discover:fav:<org>`, Creator Database ids stored as
 * `roster:<id>`). The first load in a browser that still holds some copies
 * them to the database once and removes them from the browser, so nothing a
 * user already marked is lost. Tracked-account keys in the same store are left
 * alone.
 */

const LEGACY_KEY = (orgId: string) => `autometric:discover:fav:${orgId}`
const ROSTER_PREFIX = 'roster:'

function takeLegacyFavorites(orgId: string): string[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY(orgId))
    if (!raw) return []
    const all = JSON.parse(raw)
    if (!Array.isArray(all)) return []
    return all
      .filter((k): k is string => typeof k === 'string' && k.startsWith(ROSTER_PREFIX))
      .map(k => k.slice(ROSTER_PREFIX.length))
  } catch {
    return []
  }
}

function dropLegacyFavorites(orgId: string, moved: Set<string>) {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY(orgId))
    const all = raw ? JSON.parse(raw) : []
    if (!Array.isArray(all)) return
    const rest = all.filter(k => !(typeof k === 'string' && moved.has(k.slice(ROSTER_PREFIX.length)) && k.startsWith(ROSTER_PREFIX)))
    if (rest.length) window.localStorage.setItem(LEGACY_KEY(orgId), JSON.stringify(rest))
    else window.localStorage.removeItem(LEGACY_KEY(orgId))
  } catch { /* private mode: nothing to clean up */ }
}

export function useKolFavorites(orgId: string, onError?: (message: string) => void) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const base = `/api/organizations/${orgId}/discover/favorites`
  const errorRef = useRef(onError)
  errorRef.current = onError

  const load = useCallback(async () => {
    const res = await fetch(base)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json() as { ids: string[] }
    return new Set(d.ids)
  }, [base])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let server = await load()
        const legacy = takeLegacyFavorites(orgId).filter(id => !server.has(id))
        if (legacy.length) {
          const moved = new Set<string>()
          for (const kolId of legacy) {
            const res = await fetch(base, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kolId }),
            })
            // 404 means the creator is no longer in the database: nothing to keep.
            if (res.ok || res.status === 404) moved.add(kolId)
          }
          dropLegacyFavorites(orgId, moved)
          server = await load()
        }
        if (!cancelled) setIds(server)
      } catch (e) {
        if (!cancelled) errorRef.current?.(`Favorit gagal dimuat: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [orgId, base, load])

  const has = useCallback((kolId: string) => ids.has(kolId), [ids])

  /** Resolves to the new state, or null when the request failed (state is restored). */
  const toggle = useCallback(async (kolId: string): Promise<boolean | null> => {
    const was = ids.has(kolId)
    const flip = (on: boolean) => setIds(prev => {
      const next = new Set(prev)
      if (on) next.add(kolId); else next.delete(kolId)
      return next
    })
    flip(!was)
    try {
      const res = was
        ? await fetch(`${base}/${kolId}`, { method: 'DELETE' })
        : await fetch(base, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kolId }),
          })
      // Removing one that is already gone is the outcome that was asked for.
      if (!res.ok && !(was && res.status === 404)) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      return !was
    } catch (e) {
      flip(was)
      errorRef.current?.(`Favorit gagal diperbarui: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }, [ids, base])

  return { ids, ready, has, toggle, count: ids.size }
}
