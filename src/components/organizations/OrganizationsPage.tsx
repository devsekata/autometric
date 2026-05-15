'use client'

import { useState, useMemo } from 'react'
import OrgList from '@/components/organizations/OrgList'
import EmptyState from '@/components/organizations/EmptyState'
import CreateOrgModal from '@/components/organizations/CreateOrgModal'
import OrgAvatar from '@/components/organizations/OrgAvatar'
import { Organization } from '@/lib/organizations/types'
import { Invitation } from '@/lib/invitations/types'
import { DUMMY_ORGS } from '@/lib/organizations/dummy'

const DUMMY_INVITES: Invitation[] = [
  { id: '1', org_id: '4', org_name: 'Design Co',   invited_by: 'Alex Kim',   invited_at: '2026-05-10T00:00:00Z', member_count: 5  },
  { id: '2', org_id: '5', org_name: 'Growth Labs', invited_by: 'Sarah Chen', invited_at: '2026-05-12T00:00:00Z', member_count: 12 },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function OrganizationsPage() {
  const [orgs,         setOrgs]         = useState<Organization[]>(DUMMY_ORGS)
  const [invites,      setInvites]      = useState<Invitation[]>(DUMMY_INVITES)
  const [showCreate,   setShowCreate]   = useState(false)
  const [activeFilter, setActiveFilter] = useState<'ALL' | Organization['role']>('ALL')

  const totalMembers = orgs.reduce((sum, o) => sum + o.member_count, 0)
  const totalBrands  = orgs.reduce((sum, o) => sum + o.brand_count,  0)
  const hasInvites   = invites.length > 0

  const filteredOrgs = useMemo(() =>
    activeFilter === 'ALL' ? orgs : orgs.filter(o => o.role === activeFilter),
    [orgs, activeFilter]
  )

  const tabs: { key: 'ALL' | Organization['role']; label: string }[] = [
    { key: 'ALL',    label: 'All'    },
    { key: 'OWNER',  label: 'Owner'  },
    { key: 'ADMIN',  label: 'Admin'  },
    { key: 'VIEWER', label: 'Viewer' },
  ]

  function handleCreated(org: Organization) { setOrgs(prev => [org, ...prev]) }
  function handleAccept(id: string)  { setInvites(prev => prev.filter(i => i.id !== id)) }
  function handleDecline(id: string) { setInvites(prev => prev.filter(i => i.id !== id)) }

  return (
    <div>

      {/* ── Header ── */}
      <div className="bg-white px-8 pt-8 pb-6 border-b border-[#e5e7eb]">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={PJB} className="text-[26px] font-bold text-[#111827] tracking-[-0.03em] leading-none">
              Organizations
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{orgs.length}</span> organizations
              </span>
              <span className="text-[#d1d5db] select-none">·</span>
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{totalMembers}</span> members
              </span>
              <span className="text-[#d1d5db] select-none">·</span>
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{totalBrands}</span> brands
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            style={PJB}
            className="flex items-center gap-2 h-10 px-5 bg-[#3d7e96] hover:bg-[#2d6e85] active:bg-[#1e6278] text-white text-[13.5px] font-semibold rounded-lg transition-colors shadow-[0_2px_10px_rgba(61,126,150,0.28)]"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Organization
          </button>
        </div>
      </div>

      {/* ── Invitations ── */}
      {hasInvites && (
        <div className="px-8 pt-6 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">Invitations</span>
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#3d7e96] text-white text-[10px] font-bold flex items-center justify-center">
              {invites.length}
            </span>
          </div>
          <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden divide-y divide-[#f3f4f6]">
            {invites.map(invite => (
              <div key={invite.id} className="flex items-center gap-4 h-[62px] px-5 hover:bg-[#fafafa] transition-colors">
                <OrgAvatar name={invite.org_name} size={30} />
                <div className="flex-1 min-w-0">
                  <p style={PJB} className="text-[13.5px] font-semibold text-[#111827] truncate leading-tight">
                    {invite.org_name}
                  </p>
                  <p className="text-[11.5px] text-[#9ca3af] mt-0.5">
                    Invited by <span className="text-[#6b7280] font-medium">{invite.invited_by}</span>
                    {' · '}{formatDate(invite.invited_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[#b0b8c4] mr-3">
                  <span className="material-symbols-outlined text-[13px]">group</span>
                  <span className="text-[12px] font-medium">{invite.member_count}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDecline(invite.id)}
                    className="h-8 px-3.5 text-[12px] font-medium text-[#6b7280] hover:text-[#111827] border border-[#e5e7eb] hover:border-[#d1d5db] rounded-lg transition-colors"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => handleAccept(invite.id)}
                    style={PJB}
                    className="h-8 px-3.5 text-[12px] font-semibold bg-[#3d7e96] hover:bg-[#2d6e85] text-white rounded-lg transition-colors"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filter tabs ── */}
      <div className="px-8 pt-5 pb-1 flex items-center gap-1">
        {tabs.map(tab => {
          const count = tab.key === 'ALL' ? orgs.length : orgs.filter(o => o.role === tab.key).length
          if (tab.key !== 'ALL' && count === 0) return null
          const active = activeFilter === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={PJB}
              className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-[12.5px] font-semibold transition-colors border-b-2 ${
                active
                  ? 'border-b-[#3d7e96] text-[#111827]'
                  : 'border-b-transparent text-[#6b7280] hover:text-[#374151] hover:bg-[#f3f4f6]'
              }`}
            >
              {tab.label}
              <span className={`text-[11px] font-bold ${active ? 'text-[#3d7e96]' : 'text-[#b0b8c4]'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Grid ── */}
      <div className="px-8 pt-3 pb-8">
        {filteredOrgs.length === 0 ? (
          <EmptyState onNew={() => setShowCreate(true)} />
        ) : (
          <OrgList orgs={filteredOrgs} />
        )}
      </div>

      {showCreate && (
        <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

    </div>
  )
}
