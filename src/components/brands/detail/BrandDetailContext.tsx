'use client'

import { createContext, useContext, useState } from 'react'
import { Brand, Platform, SocialAccount } from '@/lib/brands/types'

interface BrandDetailCtx {
  brand: Brand
  orgName: string
  addAccount: (account: SocialAccount) => void
  disconnectAccount: (accountId: string) => Promise<void>
  addCompetitor: (platform: Platform, username: string) => Promise<void>
  removeCompetitor: (socialAccountId: string) => Promise<void>
  updateBrandName: (name: string) => Promise<void>
  deleteBrand: () => Promise<void>
}

const Ctx = createContext<BrandDetailCtx | null>(null)

export function BrandDetailProvider({
  initial,
  orgName,
  children,
}: {
  initial: Brand
  orgName: string
  children: React.ReactNode
}) {
  const [brand, setBrand] = useState<Brand>(initial)

  function addAccount(account: SocialAccount) {
    setBrand(b => ({
      ...b,
      profile_url: b.profile_url ?? account.avatar_url,
      accounts: [...b.accounts, account],
    }))
  }

  async function disconnectAccount(accountId: string) {
    const res = await fetch(`/api/brands/${brand.id}/accounts/${accountId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to disconnect account')
    setBrand(b => ({ ...b, accounts: b.accounts.filter(a => a.id !== accountId) }))
  }

  async function addCompetitor(platform: Platform, username: string) {
    const res = await fetch(`/api/brands/${brand.id}/competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, username }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? 'Failed to add competitor')
    }
    const { data } = await res.json()
    setBrand(b => ({ ...b, competitors: [...b.competitors, data] }))

    // Facebook & TikTok avatars are uploaded by an async Apify sync that takes
    // minutes, so the POST response comes back with avatar_url: null. Poll until
    // it lands and patch it into state so the UI updates without a manual reload.
    if ((data.platform === 'facebook' || data.platform === 'tiktok') && !data.avatar_url) {
      pollCompetitorAvatar(data.social_account_id)
    }
  }

  function pollCompetitorAvatar(socialAccountId: string) {
    const POLL_INTERVAL_MS = 8_000
    const MAX_ATTEMPTS = 75 // ~10 minutes (Apify run cap is 8 min)
    let attempts = 0

    const tick = async () => {
      attempts++
      try {
        const res = await fetch(`/api/brands/${brand.id}/competitors`)
        if (res.ok) {
          const { data } = await res.json()
          const fresh = (data as Brand['competitors']).find(c => c.social_account_id === socialAccountId)
          if (fresh?.avatar_url) {
            setBrand(b => ({
              ...b,
              competitors: b.competitors.map(c =>
                c.social_account_id === socialAccountId
                  ? { ...c, avatar_url: fresh.avatar_url, profile_url: fresh.profile_url ?? c.profile_url }
                  : c,
              ),
            }))
            return
          }
        }
      } catch {
        // transient error — keep polling
      }
      if (attempts < MAX_ATTEMPTS) setTimeout(tick, POLL_INTERVAL_MS)
    }

    setTimeout(tick, POLL_INTERVAL_MS)
  }

  async function removeCompetitor(socialAccountId: string) {
    const res = await fetch(`/api/brands/${brand.id}/competitors/${socialAccountId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove competitor')
    setBrand(b => ({ ...b, competitors: b.competitors.filter(c => c.social_account_id !== socialAccountId) }))
  }

  async function updateBrandName(name: string) {
    const res = await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error('Failed to update brand')
    setBrand(b => ({ ...b, name }))
  }

  async function deleteBrand() {
    const res = await fetch(`/api/brands/${brand.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete brand')
  }

  return (
    <Ctx.Provider value={{ brand, orgName, addAccount, disconnectAccount, addCompetitor, removeCompetitor, updateBrandName, deleteBrand }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBrandDetail() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBrandDetail must be inside BrandDetailProvider')
  return ctx
}
