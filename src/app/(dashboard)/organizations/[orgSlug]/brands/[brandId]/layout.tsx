import { notFound } from 'next/navigation'
import { getOrgBasicBySlug } from '@/lib/organizations/queries'
import { getBrandById } from '@/lib/brands/queries'
import { BrandDetailProvider } from '@/components/brands/detail/BrandDetailContext'
import BrandDetailShell from '@/components/brands/detail/BrandDetailShell'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgSlug: string; brandId: string }>
}

export default async function BrandDetailLayout({ children, params }: Props) {
  const { orgSlug, brandId } = await params

  const [org, brand] = await Promise.all([
    getOrgBasicBySlug(orgSlug),
    getBrandById(brandId),
  ])

  if (!org || !brand) notFound()

  return (
    <BrandDetailProvider initial={brand} orgName={org.name}>
      <BrandDetailShell orgSlug={orgSlug}>
        {children}
      </BrandDetailShell>
    </BrandDetailProvider>
  )
}
