import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ orgSlug: string; brandId: string }>
}

export default async function BrandDetailRoot({ params }: Props) {
  const { orgSlug, brandId } = await params
  redirect(`/organizations/${orgSlug}/brands/${brandId}/overview`)
}
