import { redirect } from 'next/navigation'
import { tabHref } from '@/lib/discover/tabs'

interface Props { params: Promise<{ orgSlug: string }> }

/** Discovery Content is the `Content` tab of /discover. */
export default async function Redirect({ params }: Props) {
  const { orgSlug } = await params
  redirect(tabHref(orgSlug, 'discovery'))
}
