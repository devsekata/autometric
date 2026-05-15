import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Providers from '@/components/layout/Providers'
import Sidebar from '@/components/layout/Sidebar'
import AuthGuard from '@/components/layout/AuthGuard'
import { DUMMY_ORGS } from '@/lib/organizations/dummy'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const cookieStore = await cookies()
  const lastSlug = cookieStore.get('last_org_slug')?.value

  const hasOrgs      = DUMMY_ORGS.length > 0
  const fallbackSlug = hasOrgs
    ? (DUMMY_ORGS.find(o => o.slug === lastSlug)?.slug ?? DUMMY_ORGS[0].slug)
    : ''

  return (
    <Providers session={session}>
      <AuthGuard />
      <div className="flex min-h-screen bg-[#f9fafb]">
        <Sidebar fallbackOrgSlug={fallbackSlug} hasOrgs={hasOrgs} />
        <main className="flex-1 ml-[280px] min-w-0">
          {children}
        </main>
      </div>
    </Providers>
  )
}
