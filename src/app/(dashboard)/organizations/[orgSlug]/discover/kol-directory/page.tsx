import { redirect } from 'next/navigation'
import { tabHref } from '@/lib/discover/tabs'

interface Props { params: Promise<{ orgSlug: string }> }

/** The KOL roster is the `Directory` tab of /discover. */
export default async function Redirect({ params }: Props) {
  const { orgSlug } = await params
  redirect(tabHref(orgSlug, 'directory'))
}
