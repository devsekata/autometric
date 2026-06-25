import Link from 'next/link'
import OrgSwitcher from './OrgSwitcher'
import OrgNav from './OrgNav'
import UserMenu from './UserMenu'
import SidebarToggle from './SidebarToggle'
import { Organization } from '@/lib/organizations/types'

interface Props {
  fallbackOrgSlug: string
  hasOrgs: boolean
  initialOrgs: Organization[]
}

export default function Sidebar({ fallbackOrgSlug, hasOrgs, initialOrgs }: Props) {
  return (
    <aside className="h-screen w-[280px] flex flex-col bg-white border-r-2 border-[#e2e8f0]">
      <div className="h-16 flex items-center justify-between gap-2 px-4 border-b border-[#e5e7eb] flex-shrink-0">
        <Link href="/" className="min-w-0">
          <img src="/auometric-logo-long.png" alt="Autometric" className="w-full max-w-[168px] h-auto" />
        </Link>
        <SidebarToggle />
      </div>

      {hasOrgs ? (
        <>
          <OrgSwitcher fallbackOrgSlug={fallbackOrgSlug} initialOrgs={initialOrgs} />
          <OrgNav fallbackOrgSlug={fallbackOrgSlug} />
        </>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-3 border-b-2 border-[#e5e7eb]">
            <Link
              href="/organizations"
              className="flex items-center gap-2.5 h-9 px-3 rounded-md text-[13.5px] font-medium bg-[#edf5f8] text-[#1e6278]"
            >
              <span className="material-symbols-outlined text-[18px] flex-shrink-0 text-[#3d7e96]">
                corporate_fare
              </span>
              Organizations
            </Link>
          </div>
        </div>
      )}

      <UserMenu />
    </aside>
  )
}
