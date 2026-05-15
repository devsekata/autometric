import { notFound } from 'next/navigation'
import { getOrgBySlug } from '@/lib/organizations/dummy'
import OrgTracker from '@/components/layout/OrgTracker'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function OrgLayout({ children, params }: Props) {
  const { orgSlug } = await params
  const org = getOrgBySlug(orgSlug)
  if (!org) notFound()

  return (
    <>
      <OrgTracker orgSlug={orgSlug} />
      {children}
    </>
  )
}
