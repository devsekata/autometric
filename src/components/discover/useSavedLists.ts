'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Saved Lists, kept on the server.
 *
 * Replaces two separate `localStorage` implementations of the same feature —
 * one in `DiscoverDirectoryView` under `autometric:discover:dirlists:<org>`,
 * one in `KolDirectoryPage` under `autometric.kolDirectory.lists.<org>`. Both
 * lost everything to a cleared cache and neither followed the user anywhere.
 *
 * `scope` keeps the two apart. The Creator Database and Tracked Accounts filter
 * different things with non-overlapping field names, so a list saved on one
 * would silently match nothing applied to the other — see
 * `@/lib/discover/savedLists`.
 *
 * Filters stay opaque here: this hook moves them, the directory that saved them
 * interprets them. That is what lets one hook serve both callers without
 * knowing either filter shape.
 */

export type SavedListScope = 'database' | 'tracked'

export interface SavedListRecord<F = unknown> {
  id: string
  scope: SavedListScope
  name: string
  description: string | null
  filters: F
  /** Creator keys pinned into this list — `<uuid>` or `roster:<uuid>`. */
  items: string[]
  createdAt: string
  updatedAt: string
}

export interface UseSavedLists<F> {
  lists: SavedListRecord<F>[]
  /** False until the first load settles. */
  ready: boolean
  /** Set when a read or write failed. Cleared by the next successful call. */
  error: string | null
  /** Creates, or overwrites the list already holding that name. */
  save: (name: string, filters: F, description?: string | null) => Promise<boolean>
  rename: (id: string, name: string) => Promise<boolean>
  /** Replaces a stored list's filters with the ones on screen now. */
  update: (id: string, filters: F) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  /** Pins or unpins one creator. `key` is `<uuid>` or `roster:<uuid>`. */
  setMember: (id: string, key: string, member: boolean) => Promise<boolean>
  retry: () => void
}

/** The localStorage keys this hook supersedes, per scope. */
const LEGACY_KEY: Record<SavedListScope, (orgId: string) => string> = {
  tracked: orgId => `autometric:discover:dirlists:${orgId}`,
  database: orgId => `autometric.kolDirectory.lists.${orgId}`,
}

/**
 * Whatever the old browser array held, reduced to the two fields the server
 * takes. Both legacy shapes carried `{ name, filters }`; the Tracked Accounts
 * one also had a client-generated `id`, which the database now issues.
 */
function readLegacy(orgId: string, scope: SavedListScope): { name: string; filters: unknown }[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY[scope](orgId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const lists = parsed
      .filter((l): l is { name: string; filters: unknown } =>
        !!l && typeof l === 'object' && typeof (l as { name?: unknown }).name === 'string')
      .map(l => ({ name: l.name, filters: (l as { filters?: unknown }).filters ?? {} }))
    return lists.length ? lists : null
  } catch {
    return null
  }
}

export function useSavedLists<F = unknown>(orgId: string, scope: SavedListScope): UseSavedLists<F> {
  const [lists, setLists] = useState<SavedListRecord<F>[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  /** Guards against a slow initial load landing on top of a newer write. */
  const generation = useRef(0)
  const base = `/api/organizations/${orgId}/discover/saved-lists`

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const mine = ++generation.current

    ;(async () => {
      try {
        // A browser still holding the old array hands it over once. The server
        // keeps whatever it already has under the same name, so a stale tab
        // cannot overwrite a list edited elsewhere since.
        const legacy = readLegacy(orgId, scope)
        const res = legacy
          ? await fetch(base, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scope, import: legacy }),
            })
          : await fetch(`${base}?scope=${scope}`)

        if (!res.ok) throw new Error(String(res.status))
        const data: { lists?: SavedListRecord<F>[] } = await res.json()
        if (cancelled || mine !== generation.current) return

        setLists(data.lists ?? [])
        setError(null)
        // Dropped only after the server confirms it holds them.
        if (legacy) {
          try { window.localStorage.removeItem(LEGACY_KEY[scope](orgId)) } catch { /* ignore */ }
        }
      } catch {
        if (!cancelled && mine === generation.current) setError('Unable to load saved lists.')
      } finally {
        if (!cancelled && mine === generation.current) setReady(true)
      }
    })()

    return () => { cancelled = true }
  }, [orgId, scope, base, reload])

  /**
   * Every mutation re-reads the collection from the response rather than
   * patching locally. A saved list is a small object and these are rare,
   * deliberate actions — correctness beats saving a round trip, and it keeps
   * "save over an existing name" (an update, not an insert) honest on screen.
   */
  const runList = useCallback(async (
    input: RequestInfo, init: RequestInit, failure: string,
  ): Promise<boolean> => {
    const mine = ++generation.current
    try {
      const res = await fetch(input, init)
      if (!res.ok) throw new Error(String(res.status))
      const data: { lists?: SavedListRecord<F>[] } = await res.json()
      if (mine === generation.current) {
        // Single-list endpoints answer with `{ list }`; refresh the collection.
        if (data.lists) setLists(data.lists)
        else {
          const again = await fetch(`${base}?scope=${scope}`)
          if (again.ok) setLists(((await again.json()) as { lists?: SavedListRecord<F>[] }).lists ?? [])
        }
        setError(null)
      }
      return true
    } catch {
      setError(failure)
      return false
    }
  }, [base, scope])

  const save = useCallback((name: string, filters: F, description?: string | null) =>
    runList(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, name, description: description ?? null, filters }),
    }, 'Unable to save list. Please try again.'),
  [base, runList, scope])

  const rename = useCallback((id: string, name: string) =>
    runList(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }, 'Unable to rename list. Please try again.'),
  [base, runList])

  const update = useCallback((id: string, filters: F) =>
    runList(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters }),
    }, 'Unable to update list. Please try again.'),
  [base, runList])

  const setMember = useCallback((id: string, key: string, member: boolean) =>
    runList(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, member }),
    }, 'Unable to update list. Please try again.'),
  [base, runList])

  const remove = useCallback(async (id: string) => {
    // Optimistic: the row leaves the menu immediately, because a delete the user
    // has already confirmed should not sit there looking undone.
    const before = lists
    setLists(prev => prev.filter(l => l.id !== id))
    try {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      setError(null)
      return true
    } catch {
      setLists(before)
      setError('Unable to delete list. Please try again.')
      return false
    }
  }, [base, lists])

  const retry = useCallback(() => { setError(null); setReady(false); setReload(n => n + 1) }, [])

  return { lists, ready, error, save, rename, update, remove, setMember, retry }
}
