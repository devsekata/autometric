import { notFound } from 'next/navigation'
import { getBrandById } from '@/lib/brands/dummy'
import { BrandDetailProvider } from '@/components/brands/detail/BrandDetailContext'
import BrandDetailShell from '@/components/brands/detail/BrandDetailShell'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgSlug: string; brandId: string }>
}

export default async function BrandDetailLayout({ children, params }: Props) {
  const { orgSlug, brandId } = await params
  const brand = getBrandById(brandId)
  if (!brand) notFound()

  return (
    <BrandDetailProvider initial={brand}>
      <BrandDetailShell orgSlug={orgSlug}>
        {children}
      </BrandDetailShell>
    </BrandDetailProvider>
  )
}
