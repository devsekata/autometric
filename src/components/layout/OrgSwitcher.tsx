'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams, usePathname } from 'next/navigation'
import { DUMMY_ORGS } from '@/lib/organizations/dummy'
import { Organization } from '@/lib/organizations/types'

function OrgAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const colors = ['#3d7e96', '#7c5cbf', '#d97706', '#059669', '#dc2626']
  const index = name.charCodeAt(0) % colors.length
  return (
    <div
      className="rounded-md flex items-center justify-center flex-shrink-0 font-bold text-white"
      style={{ width: size, height: size, background: colors[index], fontSize: size * 0.42 }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function OrgSwitcher({ fallbackOrgSlug }: { fallbackOrgSlug: string }) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const orgSlug = (params?.orgSlug as string | undefined) ?? fallbackOrgSlug
  const current = DUMMY_ORGS.find(o => o.slug === orgSlug) ?? DUMMY_ORGS[0]

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function switchOrg(org: Organization) {
    setOpen(false)
    router.push(`/organizations/${org.slug}/dashboard`)
  }

  const orgPageActive = pathname === '/organizations'

  return (
    <div className="px-2 pt-3 pb-3 border-b-2 border-[#e8e8e6] flex flex-col gap-0.5">

      {/* Card + dropdown wrapper */}
      <div ref={ref} className="relative mb-1">
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-[#e5e7eb] shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_3px_10px_rgba(0,0,0,0.10)] hover:bg-[#f9fafb] transition-all"
        >
          <OrgAvatar name={current.name} size={28} />
          <span className="flex-1 text-left text-[13.5px] font-semibold text-[#111827] truncate">
            {current.name}
          </span>
          <span className="material-symbols-outlined text-[18px] text-[#9ca3af]">unfold_more</span>
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#e5e7eb] rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.10)] z-20 py-1">
            <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af]">
              Switch organization
            </p>
            {DUMMY_ORGS.map(org => (
              <button
                key={org.id}
                onClick={() => switchOrg(org)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#f9fafb] transition-colors ${
                  org.slug === orgSlug ? 'bg-[#edf5f8]' : ''
                }`}
              >
                <OrgAvatar name={org.name} size={24} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[13px] font-medium text-[#111827] truncate">{org.name}</p>
                  <p className="text-[11px] text-[#9ca3af] capitalize">{org.role.toLowerCase()}</p>
                </div>
                {org.slug === orgSlug && (
                  <span className="material-symbols-outlined text-[14px] text-[#3d7e96]">check</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab Organizations */}
      <Link
        href="/organizations"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        className={`flex items-center gap-2.5 h-9 rounded-md text-[13px] font-semibold transition-colors border-l-[3px] pl-[9px] pr-3 ${
          orgPageActive
            ? 'border-l-[#3d7e96] bg-[#f0f7fa] text-[#111827]'
            : 'border-l-transparent text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#374151]'
        }`}
      >
        <span className={`material-symbols-outlined text-[18px] flex-shrink-0 ${orgPageActive ? 'text-[#3d7e96]' : 'text-[#9ca3af]'}`}>
          corporate_fare
        </span>
        Organizations
      </Link>

      {/* Add organization */}
      <Link
        href="/organizations"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        className="flex items-center gap-2.5 h-9 rounded-md text-[13px] font-semibold border-l-[3px] border-l-transparent pl-[9px] pr-3 text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#374151] transition-colors"
      >
        <span className="material-symbols-outlined text-[18px] flex-shrink-0 text-[#9ca3af]">add</span>
        Add organization
      </Link>

    </div>
  )
}
