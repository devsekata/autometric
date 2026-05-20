import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import OrgTracker from '@/components/layout/OrgTracker'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function OrgLayout({ children, params }: Props) {
  const { orgSlug } = await params
  const session     = await auth()
  const userId      = session?.user?.id ?? ''

  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <>
      <OrgTracker orgSlug={orgSlug} />
      {children}
    </>
  )
}
