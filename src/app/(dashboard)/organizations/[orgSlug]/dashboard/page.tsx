import { redirect } from 'next/navigation'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DashboardPage({ params }: Props) {
  const { orgSlug } = await params
  redirect(`/organizations/${orgSlug}/dashboard/overview`)
}
