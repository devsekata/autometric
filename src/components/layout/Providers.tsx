'use client'

import { SessionProvider } from 'next-auth/react'
import { Session } from 'next-auth'
import { OrgProvider } from './OrgContext'

export default function Providers({ children, session }: { children: React.ReactNode; session: Session }) {
  return (
    <SessionProvider session={session}>
      <OrgProvider>{children}</OrgProvider>
    </SessionProvider>
  )
}
