import { getOrgBySlug } from '@/lib/organizations/dummy'
import { getBrandsByOrgSlug } from '@/lib/brands/dummy'
import BrandsPage from '@/components/brands/list/BrandsPage'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function BrandsRoute({ params }: Props) {
  const { orgSlug } = await params
  const org = getOrgBySlug(orgSlug)!
  const brands = getBrandsByOrgSlug(orgSlug)

  return <BrandsPage orgId={org.id} orgName={org.name} initialBrands={brands} />
}
