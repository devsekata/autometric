'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import OrgAvatar from './OrgAvatar'
import RenameOrgModal from './RenameOrgModal'
import DeleteOrgModal from './DeleteOrgModal'
import { Organization } from '@/lib/organizations/types'

const roleMeta: Record<Organization['role'], { label: string; color: string }> = {
  OWNER: { label: 'Owner', color: '#3d7e96' },
  ADMIN: { label: 'Admin', color: '#6b7280' },
  VIEWER: { label: 'Viewer', color: '#9ca3af' },
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

interface Props {
  org: Organization
  onRename: (id: string, newName: string) => void
  onDelete: (id: string) => void
}

export default function OrgListItem({ org, onRename, onDelete }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const role = roleMeta[org.role]

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
    <>
      <div className="flex items-center h-[52px] px-6 hover:bg-[#f9fafb] transition-colors group">
        <Link href={`/organizations/${org.id}`} className="flex items-center gap-4 flex-1 min-w-0 h-full">
          <OrgAvatar name={org.name} size={30} />
          <span className="text-[14px] font-medium text-[#111827] group-hover:text-[#3d7e96] transition-colors truncate">
            {org.name}
          </span>
        </Link>

        <div className="flex items-center gap-6 flex-shrink-0">
          <span style={{ color: role.color }} className="text-[11px] font-semibold uppercase tracking-wide w-12 text-right">
            {role.label}
          </span>

          <div className="flex items-center gap-1 text-[#9ca3af] w-16 justify-end">
            <span className="material-symbols-outlined text-[14px]">group</span>
            <span className="text-[13px]">{org.member_count}</span>
          </div>

          <span className="text-[13px] text-[#9ca3af] w-20 text-right tabular-nums">
            {formatDate(org.created_at)}
          </span>

          <div className="relative w-7" ref={dropdownRef}>
            <button
              onClick={e => { e.preventDefault(); setDropdownOpen(v => !v) }}
              className="w-7 h-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#e5e7eb] transition-all"
            >
              <span className="material-symbols-outlined text-[16px] text-[#6b7280]">more_horiz</span>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-8 w-44 bg-white border border-[#e5e7eb] rounded-md shadow-lg shadow-black/5 z-20 py-1">
                <button
                  onClick={() => { setShowRename(true); setDropdownOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3.5 h-9 text-[13px] text-[#374151] hover:bg-[#f9fafb] transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">edit</span>
                  Rename
                </button>
                {org.role === 'OWNER' && (
                  <button
                    onClick={() => { setShowDelete(true); setDropdownOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3.5 h-9 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px]">delete</span>
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showRename && (
        <RenameOrgModal
          orgId={org.id}
          currentName={org.name}
          onClose={() => setShowRename(false)}
          onRenamed={onRename}
        />
      )}
      {showDelete && (
        <DeleteOrgModal
          orgId={org.id}
          orgName={org.name}
          onClose={() => setShowDelete(false)}
          onDeleted={onDelete}
        />
      )}
    </>
  )
}
