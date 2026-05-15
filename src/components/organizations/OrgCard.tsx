'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import OrgAvatar from './OrgAvatar'
import { Organization } from '@/lib/organizations/types'

const roleMeta: Record<Organization['role'], { label: string; color: string }> = {
  OWNER: { label: 'Owner', color: '#3d7e96' },
  ADMIN: { label: 'Admin', color: '#6b7280' },
  VIEWER: { label: 'Viewer', color: '#9ca3af' },
}

const MEMBER_COLORS = ['#3d7e96', '#5b7a6e', '#64748b', '#7b6b8b', '#8b6b5e']

function getMemberColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return MEMBER_COLORS[hash % MEMBER_COLORS.length]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

interface Props {
  org: Organization
}

export default function OrgCard({ org }: Props) {
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const role = roleMeta[org.role]
  const extraMembers = org.member_count - org.members_preview.length

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  return (
    <div
      onClick={() => router.push(`/organizations/${org.id}`)}
      className="group relative bg-white border border-[#e5e7eb] rounded-lg p-5 hover:border-[#c5dce5] hover:shadow-sm hover:shadow-[#3d7e96]/8 transition-all cursor-pointer"
    >
      {/* Kebab */}
      <div
        className="absolute top-3.5 right-3.5"
        ref={dropdownRef}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setDropdownOpen(v => !v)}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#f3f4f6] transition-colors"
        >
          <span className="material-symbols-outlined text-[16px] text-[#6b7280]">more_horiz</span>
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-8 w-48 bg-white border border-[#e5e7eb] rounded-md shadow-lg shadow-black/5 z-20 py-1">
            <button
              onClick={() => router.push(`/organizations/${org.id}/settings`)}
              className="w-full flex items-center gap-2.5 px-3.5 h-9 text-[13px] text-[#374151] hover:bg-[#f9fafb] transition-colors"
            >
              <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">settings</span>
              Organization Settings
            </button>
          </div>
        )}
      </div>
      {/* Avatar + Name + Brand count */}
      <div className="flex items-center gap-3.5 mb-5">
        <OrgAvatar name={org.name} size={40} />
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#111827] truncate leading-tight">
            {org.name}
          </h3>
          <span style={{ color: role.color }} className="text-[11px] font-semibold uppercase tracking-wide mt-0.5 block">
            {role.label}
          </span>
          <div className="flex items-center gap-1 text-[#9ca3af] mt-1">
            <span className="material-symbols-outlined text-[12px]">storefront</span>
            <span className="text-[11px]">{org.brand_count} brands</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[#f3f4f6] pt-3.5 flex items-center justify-between">
        {/* Member avatar stack */}
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {org.members_preview.map((m, i) => (
              <div
                key={i}
                style={{ backgroundColor: getMemberColor(m.name), zIndex: org.members_preview.length - i }}
                className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center relative"
                title={m.name}
              >
                <span className="text-[9px] font-bold text-white leading-none">
                  {m.name[0].toUpperCase()}
                </span>
              </div>
            ))}
            {extraMembers > 0 && (
              <div
                style={{ zIndex: 0 }}
                className="w-6 h-6 rounded-full border-2 border-white bg-[#f3f4f6] flex items-center justify-center relative"
              >
                <span className="text-[9px] font-semibold text-[#6b7280] leading-none">+{extraMembers}</span>
              </div>
            )}
          </div>
          <span className="text-[12px] text-[#9ca3af]">{org.member_count} members</span>
        </div>

        <span className="text-[12px] text-[#9ca3af] tabular-nums">{formatDate(org.created_at)}</span>
      </div>
    </div>
  )
}
