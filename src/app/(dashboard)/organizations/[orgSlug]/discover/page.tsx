import { redirect } from 'next/navigation'

interface Props { params: Promise<{ orgSlug: string }> }

// /discover has no landing view of its own — Content is the module's entry point,
// matching the source platform where "Discovery Content" is the default view.
export default async function DiscoverIndex({ params }: Props) {
  const { orgSlug } = await params
  redirect(`/organizations/${orgSlug}/discover/content`)
}
