'use client'

import { createContext, useContext, useState } from 'react'

// Collapse state for the main application sidebar (left navigation).
// Shared so the toggle button (inside the sidebar) and the layout shell
// (which animates the sidebar width + main-content margin) read the same value.
const SidebarContext = createContext<{
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
}>({ collapsed: false, toggle: () => {}, setCollapsed: () => {} })

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed(v => !v), setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
