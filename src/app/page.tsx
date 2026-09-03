import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { listOrgsForUser } from '@/lib/organizations/queries'
import { VIEW_ROLE_COOKIE, parseViewRole } from '@/lib/organizations/viewRole'
import { getPendingInvitationsForUser } from '@/lib/invitations/queries'
import WelcomePage from '@/components/organizations/WelcomePage'

export default async function HomePage() {
  const session = await auth()
  if (!session)                       redirect('/login')
  if (session.user?.role === 'ADMIN') redirect('/admin')

  const userId      = session.user?.id ?? ''
  const cookieStore = await cookies()
  const lastSlug    = cookieStore.get('last_org_slug')?.value

  const [orgs, invitations] = await Promise.all([
    listOrgsForUser(userId),
    getPendingInvitationsForUser(userId),
  ])

  const hasOrgs    = orgs.length > 0

  /**
   * Every sign-in lands here, so this is where the mode question is asked. Only
   * once: the cookie survives navigation, and is cleared on logout so the next
   * session is asked again.
   */
  if (hasOrgs && !parseViewRole(cookieStore.get(VIEW_ROLE_COOKIE)?.value)) {
    redirect('/choose-mode')
  }

  const targetSlug =
    (lastSlug && orgs.find(o => o.slug === lastSlug) ? lastSlug : null) ??
    orgs[0]?.slug ??
    ''

  return (
    <WelcomePage
      hasOrgs={hasOrgs}
      firstOrgSlug={targetSlug}
      initialInvitations={invitations}
    />
  )
}
