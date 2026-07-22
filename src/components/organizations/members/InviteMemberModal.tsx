'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { OrgMember } from '@/lib/organizations/members'
import type { UserSearchResult } from '@/app/api/organizations/[id]/members/search/route'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

type SearchState = 'idle' | 'loading' | 'found' | 'not_found'

const ROLE_OPTIONS: { value: 'ADMIN' | 'MEMBER'; label: string; desc: string }[] = [
  { value: 'MEMBER', label: 'Member', desc: 'Can view data and invite members' },
  { value: 'ADMIN',  label: 'Admin',  desc: 'Can manage members and organization settings' },
]

function UserAvatar({ name, email, size = 36 }: { name: string | null; email: string; size?: number }) {
  const label = name ?? email
  const colors = ['#1B8A80', '#7c5cbf', '#d97706', '#059669', '#dc2626']
  const idx = label.charCodeAt(0) % colors.length
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: colors[idx], fontSize: size * 0.38 }}
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  )
}

interface Props {
  orgId: string
  onClose: () => void
  onInvited: (member: OrgMember) => void
}

export default function InviteMemberModal({ orgId, onClose, onInvited }: Props) {
  const [email,        setEmail]        = useState('')
  const [searchState,  setSearchState]  = useState<SearchState>('idle')
  const [searchResult, setSearchResult] = useState<UserSearchResult | null>(null)
  const [selected,     setSelected]     = useState<UserSearchResult | null>(null)
  const [role,         setRole]         = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [submitError,  setSubmitError]  = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const inputRef  = useRef<HTMLInputElement>(null)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 4) { setSearchState('idle'); setSearchResult(null); return }

    setSearchState('loading')
    setSearchResult(null)
    try {
      const res  = await fetch(`/api/organizations/${orgId}/members/search?email=${encodeURIComponent(q)}`)
      const json = await res.json()
      const results: UserSearchResult[] = json.data ?? []
      if (results.length > 0) {
        setSearchResult(results[0])
        setSearchState('found')
      } else {
        setSearchState('not_found')
      }
    } catch {
      setSearchState('idle')
    }
  }, [orgId])

  function handleEmailChange(val: string) {
    setEmail(val)
    setSearchResult(null)
    setSearchState('idle')

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(val.trim()), 400)
  }

  function handleClearEmail() {
    setEmail('')
    setSearchResult(null)
    setSearchState('idle')
    setSelected(null)
    inputRef.current?.focus()
  }

  function handleSelectUser(user: UserSearchResult) {
    setSelected(user)
    setSearchState('idle')
  }

  function handleClearSelected() {
    setSelected(null)
    setEmail('')
    setSearchState('idle')
    setSearchResult(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleSubmit() {
    if (!selected) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch(`/api/organizations/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selected.email, role }),
      })
      const json = await res.json()
      if (!res.ok) { setSubmitError(json.error ?? 'Something went wrong.'); return }
      onInvited(json.data as OrgMember)
      onClose()
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Invite Member</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">Find a user by email, then set their role.</p>
        </div>

        <div className="border-t border-[#f3f4f6]" />

        <div className="px-6 py-5 flex flex-col gap-5">

          {/* ── Email search ── */}
          {!selected ? (
            <div className="flex flex-col gap-1.5">
              <label style={PJB} className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">
                Email address
              </label>

              {/* Input */}
              <div className="relative">
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={e => handleEmailChange(e.target.value)}
                  placeholder="colleague@example.com"
                  className="w-full h-10 pl-3 pr-9 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#1B8A80] focus:ring-2 focus:ring-[#1B8A80]/10 transition-all"
                />
                {/* Right icon: spinner or clear */}
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {searchState === 'loading' ? (
                    <div className="w-4 h-4 border-2 border-[#1B8A80]/30 border-t-[#1B8A80] rounded-full animate-spin" />
                  ) : email.length > 0 ? (
                    <button onClick={handleClearEmail} className="text-[#9ca3af] hover:text-[#374151] transition-colors">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Search result dropdown */}
              {searchState === 'found' && searchResult && (
                <button
                  onClick={() => handleSelectUser(searchResult)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-[#e5e7eb] hover:border-[#1B8A80] hover:bg-[#f0f7fa] transition-all text-left mt-0.5"
                >
                  <UserAvatar name={searchResult.name} email={searchResult.email} size={34} />
                  <div className="flex-1 min-w-0">
                    <p style={PJB} className="text-[13.5px] font-semibold text-[#111827] truncate leading-tight">
                      {searchResult.name ?? searchResult.email}
                    </p>
                    {searchResult.name && (
                      <p className="text-[12px] text-[#9ca3af] truncate">{searchResult.email}</p>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-[#1B8A80] flex-shrink-0">Select</span>
                </button>
              )}

              {searchState === 'not_found' && email.length >= 4 && (
                <p className="text-[12.5px] text-[#9ca3af] mt-0.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">search_off</span>
                  No registered user found with this email.
                </p>
              )}

              {searchState === 'idle' && email.length > 0 && email.length < 4 && (
                <p className="text-[12px] text-[#b0b8c4]">Keep typing to search…</p>
              )}
            </div>
          ) : (

            /* ── Selected user card ── */
            <div className="flex flex-col gap-1.5">
              <label style={PJB} className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">
                Inviting
              </label>
              <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-[#1B8A80] bg-[#f0f7fa]">
                <UserAvatar name={selected.name} email={selected.email} size={34} />
                <div className="flex-1 min-w-0">
                  <p style={PJB} className="text-[13.5px] font-semibold text-[#111827] truncate leading-tight">
                    {selected.name ?? selected.email}
                  </p>
                  {selected.name && (
                    <p className="text-[12px] text-[#9ca3af] truncate">{selected.email}</p>
                  )}
                </div>
                <button
                  onClick={handleClearSelected}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[#9ca3af] hover:text-[#374151] hover:bg-white transition-colors flex-shrink-0"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Role (only visible after user selected) ── */}
          {selected && (
            <div className="flex flex-col gap-1.5">
              <label style={PJB} className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">
                Role
              </label>
              <div className="flex gap-2">
                {ROLE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    className={`flex-1 flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all ${
                      role === opt.value
                        ? 'border-[#1B8A80] bg-[#f0f7fa]'
                        : 'border-[#e5e7eb] hover:border-[#c5dce5] hover:bg-[#fafafa]'
                    }`}
                  >
                    <span style={PJB} className={`text-[13px] font-semibold ${role === opt.value ? 'text-[#2C3079]' : 'text-[#374151]'}`}>
                      {opt.label}
                    </span>
                    <span className="text-[11.5px] text-[#9ca3af]">{opt.desc}</span>
                  </button>
                ))}
              </div>
              {submitError && <p className="text-[12px] text-red-500 mt-1">{submitError}</p>}
            </div>
          )}
        </div>

        <div className="border-t border-[#f3f4f6]" />

        {/* ── Footer ── */}
        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selected || submitting}
            style={PJB}
            className="h-8 px-4 bg-[#1B8A80] hover:bg-[#177A70] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5"
          >
            {submitting ? 'Sending…' : (
              <>
                <span className="material-symbols-outlined text-[14px]">person_add</span>
                Send Invite
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
