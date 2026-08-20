import { redirect } from 'next/navigation'
import { tabHref } from '@/lib/discover/tabs'

interface Props { params: Promise<{ orgSlug: string }> }

/** Discover Reports is /discover?tab=reports&view=discover. */
export default async function Redirect({ params }: Props) {
  const { orgSlug } = await params
  redirect(tabHref(orgSlug, 'reports', 'discover'))
}
