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
    if (!res.ok) throw new Error('Failed to add competitor')
    const { data } = await res.json()
    setBrand(b => ({ ...b, competitors: [...b.competitors, data] }))
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
