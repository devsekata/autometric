'use client'

import { createContext, useContext, useState } from 'react'
import { Brand, SocialAccount, Competitor } from '@/lib/brands/types'

interface BrandDetailCtx {
  brand: Brand
  connectAccount: (acc: SocialAccount) => void
  disconnectAccount: (accId: string) => void
  addCompetitor: (comp: Competitor) => void
  removeCompetitor: (compId: string) => void
}

const Ctx = createContext<BrandDetailCtx | null>(null)

export function BrandDetailProvider({ initial, children }: { initial: Brand; children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(initial)

  function connectAccount(acc: SocialAccount) {
    setBrand(b => ({ ...b, accounts: [...b.accounts, acc] }))
  }
  function disconnectAccount(accId: string) {
    setBrand(b => ({ ...b, accounts: b.accounts.filter(a => a.id !== accId) }))
  }
  function addCompetitor(comp: Competitor) {
    setBrand(b => ({ ...b, competitors: [...b.competitors, comp] }))
  }
  function removeCompetitor(compId: string) {
    setBrand(b => ({ ...b, competitors: b.competitors.filter(c => c.id !== compId) }))
  }

  return (
    <Ctx.Provider value={{ brand, connectAccount, disconnectAccount, addCompetitor, removeCompetitor }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBrandDetail() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBrandDetail must be inside BrandDetailProvider')
  return ctx
}
