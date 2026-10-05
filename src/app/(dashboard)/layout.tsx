import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Providers from '@/components/layout/Providers'
import Sidebar from '@/components/layout/Sidebar'
import DashboardShell from '@/components/layout/DashboardShell'
import AuthGuard from '@/components/layout/AuthGuard'
import { listOrgsForUser } from '@/lib/organizations/queries'
import { VIEW_ROLE_COOKIE, parseViewRole } from '@/lib/organizations/viewRole'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const userId      = session.user?.id ?? ''
  const cookieStore = await cookies()
  const lastSlug    = cookieStore.get('last_org_slug')?.value
  /**
   * The workspace mode this session chose after signing in, read here so the
   * sidebar renders for the right one on the server. Without it a Member would
   * get one painted frame holding the Ordering and Settings entries before the
   * client corrected it.
   */
  const viewRole    = parseViewRole(cookieStore.get(VIEW_ROLE_COOKIE)?.value)

  const orgs        = await listOrgsForUser(userId)
  const hasOrgs     = orgs.length > 0
  const currentOrg   = hasOrgs ? (orgs.find(o => o.slug === lastSlug) ?? orgs[0]) : null
  const fallbackSlug = currentOrg?.slug ?? ''

  /**
   * No mode chosen yet — a fresh sign-in, or a deep link followed before the
   * question was answered. Ask first; the chooser sends them back in.
   *
   * Gated here rather than only after login so every way into the product passes
   * through it: a bookmark straight to a campaign, a link from an email, or the
   * browser restoring yesterday's tabs.
   */
  if (hasOrgs && !viewRole) redirect('/choose-mode')

  return (
    <Providers
      session={session}
      initialViewRole={viewRole}
      initialActualRole={currentOrg?.role ?? null}
    >
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
