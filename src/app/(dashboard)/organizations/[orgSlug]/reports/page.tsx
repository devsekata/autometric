import { getOrgBySlug } from '@/lib/organizations/dummy'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function ReportsPage({ params }: Props) {
  const { orgSlug } = await params
  const org = getOrgBySlug(orgSlug)!

  return (
    <div>
      <div className="bg-white px-8 pt-8 pb-6 border-b border-[#e5e7eb]">
        <h1
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          className="text-[26px] font-bold text-[#111827] tracking-[-0.03em] leading-none"
        >
          Reports
        </h1>
        <p className="text-[12.5px] text-[#9ca3af] mt-1.5 font-medium">{org.name}</p>
      </div>
      <div className="px-8 pt-8">
        <p className="text-[13px] text-[#6b7280]">Coming soon.</p>
      </div>
    </div>
  )
}
