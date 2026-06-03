'use client'

import { createContext, useContext, useState } from 'react'

type OrgRole = 'ADMIN' | 'MEMBER' | null

const OrgContext = createContext<{
  role: OrgRole
  setRole: (r: OrgRole) => void
}>({ role: null, setRole: () => {} })

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<OrgRole>(null)
  return <OrgContext.Provider value={{ role, setRole }}>{children}</OrgContext.Provider>
}

export function useOrgRole() {
  return useContext(OrgContext).role
}

export function useSetOrgRole() {
  return useContext(OrgContext).setRole
}
