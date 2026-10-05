'use client'

import { SessionProvider } from 'next-auth/react'
import { Session } from 'next-auth'
import { OrgProvider } from './OrgContext'
import type { OrgRole } from '@/lib/organizations/viewRole'
import { SidebarProvider } from './SidebarContext'

export default function Providers({
  children, session, initialViewRole = null, initialActualRole = null,
}: {
  children: React.ReactNode
  session: Session
  /** The mode chosen on the "Viewing as" screen, read from its cookie. */
  initialViewRole?: OrgRole | null
  /** The membership for the org this session was last in. */
  initialActualRole?: OrgRole | null
}) {
  return (
    <SessionProvider session={session}>
      <OrgProvider initialViewRole={initialViewRole} initialActualRole={initialActualRole}>
        <SidebarProvider>{children}</SidebarProvider>
      </OrgProvider>
    </SessionProvider>
  )
}
