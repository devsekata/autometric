import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Providers from '@/components/layout/Providers'
import Sidebar from '@/components/layout/Sidebar'
import DashboardShell from '@/components/layout/DashboardShell'
import AuthGuard from '@/components/layout/AuthGuard'
import { listOrgsForUser } from '@/lib/organizations/queries'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const userId      = session.user?.id ?? ''
  const cookieStore = await cookies()
  const lastSlug    = cookieStore.get('last_org_slug')?.value

  const orgs        = await listOrgsForUser(userId)
  const hasOrgs     = orgs.length > 0
  const fallbackSlug = hasOrgs
    ? (orgs.find(o => o.slug === lastSlug)?.slug ?? orgs[0].slug)
    : ''

  return (
    <Providers session={session}>
      <AuthGuard />
      <DashboardShell
        sidebar={<Sidebar fallbackOrgSlug={fallbackSlug} hasOrgs={hasOrgs} initialOrgs={orgs} />}
        fallbackOrgSlug={fallbackSlug}
        hasOrgs={hasOrgs}
      >
        {children}
      </DashboardShell>
    </Providers>
  )
}
