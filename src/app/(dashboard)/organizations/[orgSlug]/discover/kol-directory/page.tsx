import { redirect } from 'next/navigation'
import { tabHref } from '@/lib/discover/tabs'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * The KOL roster is the Creator Database screen of Discovery.
 *
 * Named rather than left to the tab's default: Discovery lands on its hub now,
 * and a link saved from this route was saved to see the roster, not to be asked
 * which screen it wanted.
 */
export default async function Redirect({ params }: Props) {
  const { orgSlug } = await params
  redirect(tabHref(orgSlug, 'directory', 'database'))
}
