'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Selection shared between Directory and Compare.
 *
 * In the source platform these were fields on one global `state` object that
 * every page mutated, because the whole app was a single re-rendered document.
 * Here Directory and Compare are separate routes with separate React trees, so
 * the set is persisted to localStorage (scoped per org) and re-read on mount —
 * picking creators in Directory and then navigating to Compare carries over,
 * which is the behaviour the original had for free.
 */
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
