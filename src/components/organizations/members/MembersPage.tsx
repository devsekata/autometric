'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { OrgMember } from '@/lib/organizations/members'
import InviteMemberModal from './InviteMemberModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/* ── Avatar ─────────────────────────────────────────────────────────────── */
function MemberAvatar({ name, email, size = 40 }: { name: string | null; email: string; size?: number }) {
  const label  = name ?? email
  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444']
  const idx    = label.charCodeAt(0) % colors.length
  return (
    <div
      className="rounded-lg flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: colors[idx], fontSize: size * 0.36, borderRadius: 10 }}
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  )
}

function PendingAvatar({ size = 40 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center flex-shrink-0 bg-[#e9eef4]" style={{ width: size, height: size, borderRadius: 10 }}>
      <span className="material-symbols-outlined text-[#cbd5e1]" style={{ fontSize: size * 0.52 }}>person</span>
    </div>
  )
}

/* ── Role Dropdown ───────────────────────────────────────────────────────── */
function RoleDropdown({
  memberId, orgId, currentRole, canEdit, onChanged, onError,
}: {
  memberId: string; orgId: string; currentRole: 'ADMIN' | 'MEMBER'
  canEdit: boolean; onChanged: (id: string, role: 'ADMIN' | 'MEMBER') => void; onError: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function pick(role: 'ADMIN' | 'MEMBER') {
    if (role === currentRole) { setOpen(false); return }
    setBusy(true); setOpen(false)
    try {
      const res  = await fetch(`/api/organizations/${orgId}/members/${memberId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      })
      if (!res.ok) { const j = await res.json(); onError(j.error ?? 'Failed to update role.') }
      else onChanged(memberId, role)
    } finally { setBusy(false) }
  }

  const label = currentRole === 'ADMIN' ? 'Admin' : 'Member'

  if (!canEdit) {
    return (
      <div className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#e2e8f0] bg-[#e9eef4] select-none w-[120px]" style={PJB}>
        <span className="flex-1 text-[13px] font-medium text-[#0f172a]">{label}</span>
        <span className="material-symbols-outlined text-[14px] text-[#cbd5e1]">expand_more</span>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        style={PJB}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#e2e8f0] bg-[#e9eef4] hover:border-[#cbd5e1] hover:bg-[#e9eef4] transition-all disabled:opacity-50 w-[120px]"
      >
        <span className="flex-1 text-left text-[13px] font-medium text-[#0f172a]">{label}</span>
        <span className="material-symbols-outlined text-[14px] text-[#94a3b8]">expand_more</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] w-36 bg-white border border-[#e2e8f0] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] z-30 py-1 overflow-hidden">
          {(['ADMIN', 'MEMBER'] as const).map(r => (
            <button key={r} onClick={() => pick(r)} style={PJB}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-[13px] transition-colors ${
                r === currentRole ? 'bg-[#f0f7ff] text-[#3b5bdb] font-semibold' : 'text-[#334155] hover:bg-[#e9eef4] font-medium'
              }`}
            >
              {r === 'ADMIN' ? 'Admin' : 'Member'}
              {r === currentRole && <span className="material-symbols-outlined text-[14px]">check</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Kebab Menu ──────────────────────────────────────────────────────────── */
function KebabMenu({
  member, orgId, isSelf, isAdmin, onAction,
}: {
  member: OrgMember; orgId: string; isSelf: boolean; isAdmin: boolean
  onAction: (type: 'kick' | 'leave' | 'cancel', memberId: string) => void
}) {
  const [open, setBusy_open] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setBusy_open(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const isPending = member.status === 'PENDING'

  // Determine which items to show
  const items: { label: string; icon: string; action: 'kick' | 'leave' | 'cancel'; danger: boolean }[] = []

  if (isSelf) {
    items.push({ label: 'Leave organization', icon: 'logout', action: 'leave', danger: true })
  } else if (isAdmin) {
    if (isPending) {
      items.push({ label: 'Cancel invitation', icon: 'cancel_schedule_send', action: 'cancel', danger: false })
    } else {
      items.push({ label: 'Kick member', icon: 'person_remove', action: 'kick', danger: true })
    }
  }

  if (items.length === 0) return <div className="w-8" />

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setBusy_open(v => !v)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#94a3b8] hover:text-[#334155] hover:bg-[#e9eef4] transition-colors flex-shrink-0"
      >
        <span className="material-symbols-outlined text-[18px]">more_vert</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] w-52 bg-white border border-[#e2e8f0] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.10)] z-30 py-1 overflow-hidden">
          {items.map(item => (
            <button
              key={item.action}
              onClick={() => { setBusy_open(false); onAction(item.action, member.id) }}
              style={PJB}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                item.danger
                  ? 'text-[#ef4444] hover:bg-[#fef2f2]'
                  : 'text-[#334155] hover:bg-[#e9eef4]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
interface Props {
  orgId: string; orgName: string
  currentRole: 'ADMIN' | 'MEMBER'
  currentUserId: string
  initialMembers: OrgMember[]
}

export default function MembersPage({ orgId, orgName, currentRole, currentUserId, initialMembers }: Props) {
  const router     = useRouter()
  const [members,    setMembers]    = useState<OrgMember[]>(initialMembers)
  const [showInvite, setShowInvite] = useState(false)
  const [search,     setSearch]     = useState('')
  const [busy,       setBusy]       = useState<string | null>(null)
  const [toast,      setToast]      = useState('')

  const isAdmin    = currentRole === 'ADMIN'
  const totalCount = members.length

  const filtered = search.trim()
    ? members.filter(m => {
        const q = search.toLowerCase()
        return m.email.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q)
      })
    : members

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }
  function handleInvited(member: OrgMember) { setMembers(prev => [...prev, member]) }
  function handleRoleChanged(id: string, role: 'ADMIN' | 'MEMBER') {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, role } : m))
  }

  async function handleAction(type: 'kick' | 'leave' | 'cancel', memberId: string) {
    setBusy(memberId)
    try {
      const res = await fetch(`/api/organizations/${orgId}/members/${memberId}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json(); showToast(j.error ?? 'Action failed.'); return }
      if (type === 'leave') {
        router.push('/organizations')
      } else {
        setMembers(prev => prev.filter(m => m.id !== memberId))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-white">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-[#1e293b] text-white text-[13px] rounded-xl shadow-2xl" style={PJB}>
          <span className="material-symbols-outlined text-[15px] text-[#f87171]">error</span>
          {toast}
        </div>
      )}

      {/* ════ Header — title only ════ */}
      <div className="px-10 pt-7 pb-5 border-b-2 border-[#e2e8f0]">
        <p className="text-[12.5px] text-[#94a3b8] mb-1.5 tracking-wide" style={PJB}>Manage members access</p>
        <h1 style={PJB} className="text-[36px] font-bold text-[#0f172a] tracking-[-0.04em] leading-none">
          Members
        </h1>
        <p className="text-[13.5px] text-[#94a3b8] mt-2" style={PJB}>
          <span className="font-bold text-[#334155]">{totalCount}</span> member{totalCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ════ Body — two columns ════ */}
      <div className="flex flex-1">

        {/* Member list */}
        <div className="flex-1 min-w-0 px-10 pt-6 pb-10">

          {/* Controls above table */}
          <div className="flex items-center justify-end gap-3 mb-4">
            <div className="relative flex items-center">
              <span className="material-symbols-outlined text-[15px] text-[#94a3b8] absolute left-3 pointer-events-none">search</span>
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
                className="h-9 pl-8 pr-10 w-44 text-[13px] text-[#334155] placeholder:text-[#94a3b8] bg-white border border-[#e2e8f0] rounded-lg outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10 transition-all"
                style={PJB}
              />
              <span className="absolute right-2.5 text-[11px] text-[#cbd5e1] font-mono select-none">⌘K</span>
            </div>
            <button onClick={() => setShowInvite(true)} style={PJB}
              className="flex items-center gap-1.5 h-9 px-4 bg-[#4338ca] hover:bg-[#3730a3] text-white text-[13px] font-semibold rounded-lg transition-colors shadow-[0_2px_8px_rgba(67,56,202,0.30)]"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Add member
            </button>
          </div>

          {/* Table top border */}
          <div className="border-t-2 border-[#e2e8f0]" />
          {filtered.length === 0 ? (
            <div className="py-20 text-center">
              <span className="material-symbols-outlined text-[44px] text-[#e2e8f0] mb-3 block">group</span>
              <p style={PJB} className="text-[14px] font-semibold text-[#334155]">
                {search ? 'No members found' : 'No members yet'}
              </p>
              <p className="text-[13px] text-[#94a3b8] mt-1">
                {search ? 'Try a different search.' : 'Invite someone to collaborate.'}
              </p>
            </div>
          ) : (
            <div>
              {filtered.map(member => {
                const isPending   = member.status === 'PENDING'
                const hasName     = !!member.name
                const isSelf      = member.user_id === currentUserId
                const isBusy      = busy === member.id
                const canEditRole = isAdmin && !isSelf

                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 py-4 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#fafafa] -mx-3 px-3 rounded-lg transition-colors"
                  >
                    {isPending && !hasName ? <PendingAvatar /> : <MemberAvatar name={member.name} email={member.email} />}

                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      {hasName && (
                        <span style={PJB} className="text-[14px] font-semibold text-[#0f172a]">{member.name}</span>
                      )}
                      <span className="text-[13.5px] text-[#94a3b8]">{member.email}</span>
                      {isSelf && (
                        <span className="text-[11px] font-semibold text-[#6366f1] bg-[#eef2ff] px-2 py-0.5 rounded-full" style={PJB}>You</span>
                      )}
                      {isPending && (
                        <span className="flex items-center gap-1 text-[12.5px] text-[#94a3b8]">
                          <span className="text-[#94a3b8]">·</span>
                          <span className="material-symbols-outlined text-[13px] text-[#7c9cf7]">send</span>
                          Invitation pending
                        </span>
                      )}
                    </div>

                    <RoleDropdown
                      memberId={member.id} orgId={orgId} currentRole={member.role}
                      canEdit={canEditRole} onChanged={handleRoleChanged} onError={showToast}
                    />

                    {isBusy ? (
                      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                        <div className="w-4 h-4 border-2 border-[#94a3b8]/30 border-t-[#94a3b8] rounded-full animate-spin" />
                      </div>
                    ) : (
                      <KebabMenu
                        member={member} orgId={orgId}
                        isSelf={isSelf} isAdmin={isAdmin}
                        onAction={handleAction}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Access control */}
        <div className="w-[260px] flex-shrink-0 px-7 pt-8 pb-10">
          <h2 style={PJB} className="text-[16px] font-bold text-[#0f172a] mb-3">Access control</h2>
          <p className="text-[13px] text-[#64748b] leading-[1.65] mb-6">
            Manage team members of your organization and set their access level. You can invite new members to join{' '}
            <span className="font-semibold text-[#334155]">{orgName}</span>.
          </p>

          <div className="flex flex-col gap-5">
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#0f172a] mb-1.5">Admin role</p>
              <p className="text-[12.5px] text-[#64748b] leading-[1.65]">
                Admins have full access. They can edit settings, manage members, change roles, and delete the organization.
              </p>
            </div>
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#0f172a] mb-1.5">Member role</p>
              <p className="text-[12.5px] text-[#64748b] leading-[1.65]">
                Members can view all data and invite new members, but cannot edit settings or remove others.
              </p>
            </div>
          </div>

          <div className="mt-7 pt-6 border-t border-[#e2e8f0] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-[#94a3b8]">Active</span>
              <span style={PJB} className="text-[13px] font-semibold text-[#334155]">
                {members.filter(m => m.status === 'ACTIVE').length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-[#94a3b8]">Pending</span>
              <span style={PJB} className="text-[13px] font-semibold text-[#f59e0b]">
                {members.filter(m => m.status === 'PENDING').length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {showInvite && (
        <InviteMemberModal orgId={orgId} onClose={() => setShowInvite(false)} onInvited={handleInvited} />
      )}
    </div>
  )
}
