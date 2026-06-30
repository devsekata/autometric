import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBasicBySlug } from '@/lib/organizations/queries'
import { listBrandsForOrg } from '@/lib/brands/queries'
import BrandsPage from '@/components/brands/list/BrandsPage'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function BrandsRoute({ params }: Props) {
  const { orgSlug } = await params
  const [session, org] = await Promise.all([auth(), getOrgBasicBySlug(orgSlug)])
  if (!org) notFound()

  const brands = await listBrandsForOrg(org.id)

  return <BrandsPage orgId={org.id} orgName={org.name} initialBrands={brands} />
}
