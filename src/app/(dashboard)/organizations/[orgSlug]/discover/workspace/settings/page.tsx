import { redirect } from 'next/navigation'
import { tabHref } from '@/lib/discover/tabs'

interface Props { params: Promise<{ orgSlug: string }> }

/** Workspace Settings is /discover?tab=settings&view=workspace. */
export default async function Redirect({ params }: Props) {
  const { orgSlug } = await params
  redirect(tabHref(orgSlug, 'settings', 'workspace'))
}
