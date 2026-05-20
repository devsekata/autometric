import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { getMembersByOrgId } from '@/lib/organizations/members'
import MembersPage from '@/components/organizations/members/MembersPage'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function MembersRoute({ params }: Props) {
  const { orgSlug } = await params
  const session     = await auth()
  const userId      = session?.user?.id ?? ''

  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  const members = await getMembersByOrgId(org.id)

  return (
    <MembersPage
      orgId={org.id}
      orgName={org.name}
      currentRole={org.role}
      currentUserId={userId}
      initialMembers={members}
    />
  )
}
