import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Providers from '@/components/layout/Providers'
import Sidebar from '@/components/layout/Sidebar'
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
      <div className="flex min-h-screen bg-[#f9fafb]">
        <Sidebar fallbackOrgSlug={fallbackSlug} hasOrgs={hasOrgs} initialOrgs={orgs} />
        <main className="flex-1 ml-[280px] min-w-0">
          {children}
        </main>
      </div>
    </Providers>
  )
}
