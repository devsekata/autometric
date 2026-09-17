'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The signed-in user's Saved Lists for the Creator Database in this agency, from
 * the KOL database (`/discover/saved-filters` → `public.agency_kol_saved_filters`).
 *
 * The lists used to live in this browser under
 * `autometric.kolDirectory.lists.<org>`. The first load in a browser that still
 * holds some copies them to the database once and removes the browser copy.
 */

export interface SavedFilterList<F> {
  id: string
  name: string
  filters: Partial<F>
}

const LEGACY_KEY = (orgId: string) => `autometric.kolDirectory.lists.${orgId}`

export function useSavedFilters<F extends object>(orgId: string, onError?: (message: string) => void) {
  const [lists, setLists] = useState<SavedFilterList<F>[]>([])
  const [ready, setReady] = useState(false)
  const base = `/api/organizations/${orgId}/discover/saved-filters`
  const errorRef = useRef(onError)
  errorRef.current = onError

  const load = useCallback(async () => {
    const res = await fetch(base)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json() as { lists: SavedFilterList<F>[] }
    return d.lists
  }, [base])

  const post = useCallback(async (name: string, filters: F) => {
    const res = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, filters }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body as { list: SavedFilterList<F>; created: boolean }
  }, [base])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let raw: string | null = null
        try { raw = window.localStorage.getItem(LEGACY_KEY(orgId)) } catch { /* private mode */ }
        if (raw) {
          let legacy: unknown = []
          try { legacy = JSON.parse(raw) } catch { /* corrupt entry: nothing to import */ }
          let failed = false
          for (const l of Array.isArray(legacy) ? legacy : []) {
            if (!l || typeof l.name !== 'string' || !l.filters || typeof l.filters !== 'object') continue
            try { await post(l.name, l.filters as F) } catch { failed = true }
          }
          if (!failed) { try { window.localStorage.removeItem(LEGACY_KEY(orgId)) } catch { /* ignore */ } }
        }
        const server = await load()
        if (!cancelled) setLists(server)
      } catch (e) {
        if (!cancelled) errorRef.current?.(`Saved Lists gagal dimuat: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [orgId, load, post])

  /** Saves (or updates, by name) and refreshes. Resolves true on success. */
  const save = useCallback(async (name: string, filters: F): Promise<boolean> => {
    try {
      await post(name, filters)
      setLists(await load())
      return true
    } catch (e) {
      errorRef.current?.(`List gagal disimpan: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }, [post, load])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const before = lists
    setLists(prev => prev.filter(l => l.id !== id))
    try {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
      return true
    } catch (e) {
      setLists(before)
      errorRef.current?.(`List gagal dihapus: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }, [base, lists])

  return { lists, ready, save, remove }
}
