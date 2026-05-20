import { auth } from '@/auth'
import { listOrgsForUser } from '@/lib/organizations/queries'
import { getPendingInvitationsForUser } from '@/lib/invitations/queries'
import OrganizationsPage from '@/components/organizations/OrganizationsPage'

export default async function OrganizationsRoute() {
  const session = await auth()
  const userId  = session?.user?.id ?? ''

  const [orgs, invitations] = await Promise.all([
    listOrgsForUser(userId),
    getPendingInvitationsForUser(userId),
  ])

  return <OrganizationsPage initialOrgs={orgs} initialInvitations={invitations} />
}
