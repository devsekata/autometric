'use client'

import { useEffect } from 'react'
import OrgAvatar from '@/components/organizations/OrgAvatar'
import { Invitation } from '@/lib/invitations/types'

interface Props {
  invites:   Invitation[]
  onAccept:  (id: string) => void
  onDecline: (id: string) => void
  onClose:   () => void
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function InvitationsModal({ invites, onAccept, onDecline, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-[480px] mx-4 shadow-2xl shadow-black/10 border border-[#e5e7eb] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[#0f172a]">Pending Invitations</h2>
            <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
              {invites.length} invitation{invites.length !== 1 ? 's' : ''} waiting for you
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="border-t border-[#f3f4f6]" />

        {/* Invitation list */}
        <div className="divide-y divide-[#f3f4f6] max-h-[380px] overflow-y-auto">
          {invites.map(invite => (
            <div key={invite.id} className="px-6 py-4">

              {/* Row 1: avatar + org name + action buttons */}
              <div className="flex items-center gap-3">
                <OrgAvatar name={invite.org_name} size={36} />
                <p className="text-[14px] font-semibold text-[#0f172a] flex-1 truncate">
                  {invite.org_name}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onDecline(invite.id)}
                    className="h-8 px-3.5 text-[12.5px] font-medium text-[#6b7280] hover:text-[#111827] border border-[#e5e7eb] hover:border-[#d1d5db] rounded-lg transition-colors"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => onAccept(invite.id)}
                    className="h-8 px-3.5 text-[12.5px] font-semibold bg-[#3d7e96] hover:bg-[#2d6e85] text-white rounded-lg transition-colors"
                  >
                    Accept
                  </button>
                </div>
              </div>

              {/* Row 2: detail — indented to align with org name */}
              <div className="flex items-center gap-2.5 mt-1.5 pl-[48px] text-[12px] text-[#9ca3af]">
                <span>
                  Invited by{' '}
                  <span className="text-[#374151] font-medium">{invite.invited_by}</span>
                </span>
                <span className="text-[#d1d5db]">·</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">group</span>
                  {invite.member_count} members
                </span>
                <span className="text-[#d1d5db]">·</span>
                <span>{formatDate(invite.invited_at)}</span>
              </div>

            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-[#f3f4f6] px-6 py-3">
          <p className="text-[11.5px] text-[#9ca3af] text-center">
            Accepting an invitation will add you to that organization.
          </p>
        </div>

      </div>
    </div>
  )
}
