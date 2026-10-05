'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Selection shared between Directory's two rosters and Compare.
 *
 * In the source platform these were fields on one global `state` object that
 * every page mutated, because the whole app was a single re-rendered document.
 * Here they are separate React trees, so the set is persisted to localStorage
 * (scoped per org) and re-read on mount — picking creators in one and then
 * switching to Compare carries over, which the original had for free.
 *
 * The set holds two populations. A bare id is an account this org tracks in the
 * warehouse; a roster creator from the commercial KOL directory is stored as
 * `roster:<id>`. Both id spaces are UUIDs from different databases, so the
 * prefix is what tells them apart — and a plain id keeps meaning what it always
 * did, so selections saved before roster creators existed still load.
 */

export type SelectionSource = 'account' | 'roster'

const ROSTER_PREFIX = 'roster:'

/** The key an id is stored under. */
export const selectionKey = (source: SelectionSource, id: string) =>
  source === 'roster' ? ROSTER_PREFIX + id : id

/** Splits a stored key back into what it names. */
export function parseSelectionKey(key: string): { source: SelectionSource; id: string } {
  return key.startsWith(ROSTER_PREFIX)
    ? { source: 'roster', id: key.slice(ROSTER_PREFIX.length) }
    : { source: 'account', id: key }
}

/** Just the ids of one population, in stored order. */
export function idsOf(keys: Iterable<string>, source: SelectionSource): string[] {
  const out: string[] = []
  for (const k of keys) {
    const parsed = parseSelectionKey(k)
    if (parsed.source === source) out.push(parsed.id)
  }
  return out
}
function readSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function useDiscoverSelection(orgId: string, bucket: 'compare' | 'fav') {
  const key = `autometric:discover:${bucket}:${orgId}`
  // Starts empty so server and first client render agree; the stored value is
  // adopted in the effect below to avoid a hydration mismatch.
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setIds(readSet(key))
    setReady(true)
  }, [key])

  const persist = useCallback((next: Set<string>) => {
    setIds(next)
    try { window.localStorage.setItem(key, JSON.stringify([...next])) } catch { /* quota / privacy mode */ }
  }, [key])

  const toggle = useCallback((id: string) => {
    setIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { window.localStorage.setItem(key, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [key])

  const clear = useCallback(() => persist(new Set()), [persist])

  return { ids, ready, toggle, clear, setIds: persist }
}
