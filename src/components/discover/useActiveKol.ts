'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AccountRelation } from '@/lib/discover/account'

/**
 * The "active KOL" — the creator every per-KOL view in the workspace is about.
 *
 * Profile, Content Analytics, Analytics, Audience, Campaign History, Brand Fit,
 * AI Insights and Rate Card are all views *of a creator*, but they sit in the
 * same nav row as Directory, which is a view of the roster. Something has to
 * say which creator those tabs mean.
 *
 * Selecting one in Directory sets it here, persisted per org, so it survives
 * moving between tabs, a reload, and a trip out to the cart and back. Without
 * that the user would have to re-pick a creator every time they crossed a tab
 * boundary, which is exactly the friction this restructure is meant to remove.
 */

export interface ActiveKol {
  id: string
  relation: AccountRelation
  username: string
}

function read(key: string): ActiveKol | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (typeof v?.id === 'string' && typeof v?.username === 'string'
      && (v.relation === 'owned' || v.relation === 'competitor')) {
      return { id: v.id, relation: v.relation, username: v.username }
    }
    return null
  } catch {
    return null
  }
}

export function useActiveKol(scope: string) {
  // Scoped by org slug rather than id: the sidebar renders outside the org
  // layout and only knows the slug, and both it and the workspace must read
  // the same key for the selection to be shared.
  const key = `autometric:discover:activekol:${scope}`
  // Starts null so server and first client render agree; the stored value is
  // adopted in the effect below to avoid a hydration mismatch.
  const [kol, setKol] = useState<ActiveKol | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setKol(read(key))
    setReady(true)
  }, [key])

  const select = useCallback((next: ActiveKol) => {
    setKol(next)
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* quota / privacy mode */ }
  }, [key])

  const clear = useCallback(() => {
    setKol(null)
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
  }, [key])

  return { kol, ready, select, clear }
}
