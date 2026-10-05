import { redirect } from 'next/navigation'
import { resolveTabParams, tabHref } from '@/lib/discover/tabs'

interface Props {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ tab?: string; view?: string }>
}

/**
 * The old KOL Intelligence workspace route.
 *
 * Its contents are tabs of `/discover` now. Every `?tab=` value it ever answered
 * to still resolves — `resolveTabParams` maps the old flat values onto the
 * tab/view pair they became — so bookmarks and links saved from any earlier
 * shape of this module land on the same screen rather than on a 404.
 *
 * The child routes under this path (`[accountId]`, `orders/[orderId]`,
 * `campaigns/[orderId]`) are unaffected: they are detail pages, not tabs.
 */
export default async function DiscoverKolRedirect({ params, searchParams }: Props) {
  const { orgSlug } = await params
  const { tab: rawTab, view: rawView } = await searchParams
  const { tab, view } = resolveTabParams(rawTab ?? 'directory', rawView)
  redirect(tabHref(orgSlug, tab, view))
}
