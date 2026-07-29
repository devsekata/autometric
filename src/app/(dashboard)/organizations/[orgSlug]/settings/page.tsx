import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import OrgSettingsPage from '@/components/organizations/OrgSettingsPage'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function SettingsPage({ params }: Props) {
  const { orgSlug } = await params
  const session     = await auth()
  const userId      = session?.user?.id ?? ''

  // Needs the member role and the brand count, so read the full org row rather
  // than getOrgBasicBySlug.
  const org = await getOrgBySlugForUser(orgSlug, userId)
  if (!org) notFound()

  return (
    <div>
      <div className="bg-white px-8 pt-8 pb-6 border-b border-[#e5e7eb]">
        <h1
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          className="text-[26px] font-bold text-[#111827] tracking-[-0.03em] leading-none"
        >
          Settings
        </h1>
        <p className="text-[12.5px] text-[#9ca3af] mt-1.5 font-medium">{org.name}</p>
      </div>
      <div className="px-8">
        <OrgSettingsPage org={org} />
      </div>
    </div>
  )
}
