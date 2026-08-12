import { redirect } from 'next/navigation'

interface Props { params: Promise<{ orgSlug: string }> }

/**
 * Compare lives inside the KOL Intelligence workspace, where it shares the
 * shortlist, the breadcrumb and the sidebar highlight with the rest of the
 * flow. This standalone copy rendered the same component with none of that
 * context and was linked from nowhere, so it only ever showed up as a stale
 * bookmark that dropped the user out of the module. Kept as a redirect rather
 * than deleted so those bookmarks still land somewhere correct.
 */
export default async function DiscoverComparePage({ params }: Props) {
  const { orgSlug } = await params
  redirect(`/organizations/${orgSlug}/discover/kol?tab=compare`)
}
