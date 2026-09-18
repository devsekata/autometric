import { redirect } from 'next/navigation'

interface Props { params: Promise<{ orgSlug: string }> }

// The brand dashboards are switched off (they read the analytics warehouse), so
// links that open an organization land on Discover instead.
export default async function DashboardPage({ params }: Props) {
  const { orgSlug } = await params
  redirect(`/organizations/${orgSlug}/discover`)
}
