'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AccountRelation } from '@/lib/discover/account'

/**
 * The Discover cart, shared across the KOL workspace.
 *
 * In the source platform the cart was a field on one global `state` object, so
 * "Add to Cart" on a creator page and the cart screen were the same object in
 * memory. Here they are different React trees on different routes, so the cart
 * is persisted to localStorage per org and re-read on mount — pressing Add to
 * Cart in an account's detail page puts a line in the Cart tab, which is the
 * connection that was missing when these were separate nav items.
 *
 * Only the selection lives here. Prices are never stored client-side: the cart
 * is priced by the server on every change (see DiscoverCart), so a tampered
 * localStorage entry can change what you asked for, never what it costs.
 */

export interface CartEntry {
  socialAccountId: string
  relation: AccountRelation
  deliverableId: string
  qty: number
}

/** `${relation}:${accountId}:${deliverableId}` — relation is part of the key
 *  because the same account id can be both owned and a tracked competitor. */
const keyOf = (e: Pick<CartEntry, 'socialAccountId' | 'relation' | 'deliverableId'>) =>
  `${e.relation}:${e.socialAccountId}:${e.deliverableId}`

type CartMap = Record<string, CartEntry>

function read(key: string): CartMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    // Drop anything malformed rather than letting it reach the pricing call.
    const out: CartMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as Partial<CartEntry>
      if (typeof e?.socialAccountId === 'string' && typeof e?.deliverableId === 'string'
          && (e.relation === 'owned' || e.relation === 'competitor')
          && Number.isFinite(e.qty) && (e.qty as number) > 0) {
        out[k] = { socialAccountId: e.socialAccountId, relation: e.relation, deliverableId: e.deliverableId, qty: Math.min(999, Math.floor(e.qty as number)) }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function useDiscoverCart(orgId: string) {
  const storageKey = `autometric:discover:cart:${orgId}`
  // Starts empty so the server and first client render agree; the stored value
  // is adopted in the effect below to avoid a hydration mismatch.
  const [items, setItems] = useState<CartMap>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setItems(read(storageKey))
    setReady(true)
  }, [storageKey])

  const persist = useCallback((next: CartMap) => {
    setItems(next)
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* quota / privacy mode */ }
  }, [storageKey])

  const setQty = useCallback((entry: Omit<CartEntry, 'qty'>, qty: number) => {
    setItems(prev => {
      const next = { ...prev }
      const k = keyOf(entry)
      if (qty <= 0) delete next[k]
      else next[k] = { ...entry, qty: Math.min(999, Math.floor(qty)) }
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [storageKey])

  /** Adds one unit; used by the Add to Cart buttons outside the cart itself. */
  const add = useCallback((entry: Omit<CartEntry, 'qty'>, qty = 1) => {
    setItems(prev => {
      const next = { ...prev }
      const k = keyOf(entry)
      next[k] = { ...entry, qty: Math.min(999, (next[k]?.qty ?? 0) + qty) }
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [storageKey])

  const removeAccount = useCallback((socialAccountId: string) => {
    setItems(prev => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([, v]) => v.socialAccountId !== socialAccountId))
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [storageKey])

  const clear = useCallback(() => persist({}), [persist])

  const qtyOf = useCallback(
    (entry: Omit<CartEntry, 'qty'>) => items[keyOf(entry)]?.qty ?? 0, [items])

  const lines = Object.values(items)
  const totalUnits = lines.reduce((n, l) => n + l.qty, 0)
  const accountIds = [...new Set(lines.map(l => l.socialAccountId))]

  return { items, lines, totalUnits, accountIds, ready, add, setQty, qtyOf, removeAccount, clear }
}
