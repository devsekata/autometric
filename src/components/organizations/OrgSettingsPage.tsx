'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Organization } from '@/lib/organizations/types'
import OrgAvatar from './OrgAvatar'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  org: Organization
}

export default function OrgSettingsPage({ org }: Props) {
  const router = useRouter()
  const isAdmin = org.role === 'ADMIN'

  const [name,      setName]      = useState(org.name)
  // Last name the server accepted — keeps the dirty check stable while the
  // router refresh is still in flight.
  const [savedName, setSavedName] = useState(org.name)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [saveErr,   setSaveErr]   = useState('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting,    setDeleting]    = useState(false)
  const [deleteErr,   setDeleteErr]   = useState('')

  const isDirty   = name.trim() !== savedName && name.trim().length > 0
  // Deleting is only allowed once the organization has no brands left — the API
  // enforces this too, this just explains it before the user tries.
  const hasBrands = org.brand_count > 0
  const canDelete = confirmName.trim() === savedName && !hasBrands

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true); setSaveErr(''); setSaved(false)
    try {
      const res  = await fetch(`/api/organizations/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveErr(json.error ?? 'Something went wrong.'); return }
      setSavedName(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.refresh()
    } catch {
      setSaveErr('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true); setDeleteErr('')
    try {
      const res = await fetch(`/api/organizations/${org.id}`, { method: 'DELETE' })
      if (res.status === 204) {
        router.push('/organizations')
        return
      }
      const json = await res.json().catch(() => ({}))
      setDeleteErr(json.error ?? 'Something went wrong.')
    } catch {
      setDeleteErr('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="w-full max-w-3xl">

      {/* ── General ── */}
      <div className="w-full border-b border-[#e5e7eb] pb-6">
        <div className="py-5">
          <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">General</span>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <OrgAvatar name={name || org.name} size={48} />
          <div>
            <p style={PJB} className="text-[16px] font-bold text-[#111827]">{name || 'Organization name'}</p>
            <p className="text-[12px] text-[#9ca3af] mt-0.5">
              {org.member_count} member{org.member_count !== 1 ? 's' : ''} · {org.brand_count} brand{org.brand_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="w-full mb-5">
          <label style={PJB} className="block text-[12px] font-semibold text-[#374151] mb-1.5">Organization Name</label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setSaved(false); setSaveErr('') }}
            onKeyDown={e => { if (e.key === 'Enter' && isDirty && isAdmin) handleSave() }}
            disabled={!isAdmin}
            maxLength={255}
            style={{ ...PJB, width: '100%', maxWidth: '24rem' }}
            className="h-9 px-3 text-[13.5px] border border-[#e5e7eb] rounded-lg focus:outline-none focus:border-[#285D6E] focus:ring-1 focus:ring-[#285D6E]/20 transition disabled:bg-[#f9fafb] disabled:text-[#9ca3af] disabled:cursor-not-allowed"
          />
          <p className="text-[11.5px] text-[#9ca3af] mt-1.5">
            The URL stays <span className="font-medium text-[#6b7280]">/{org.slug}</span> — renaming does not change it.
          </p>
          {saveErr && <p className="text-[12px] text-red-500 mt-1.5">{saveErr}</p>}
        </div>

        {isAdmin ? (
          <button onClick={handleSave} disabled={(!isDirty && !saved) || saving} style={PJB}
            className={`flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold transition-all ${
              saved
                ? 'bg-[#ecfdf5] text-[#059669] border border-[#059669]/20'
                : isDirty
                ? 'bg-[#285D6E] hover:bg-[#1E4A58] text-white'
                : 'bg-[#f3f4f6] text-[#9ca3af] cursor-not-allowed'
            }`}>
            {saved
              ? <><span className="material-symbols-outlined text-[15px]">check</span> Saved</>
              : <><span className="material-symbols-outlined text-[15px]">save</span> {saving ? 'Saving…' : 'Save Changes'}</>
            }
          </button>
        ) : (
          <p className="text-[12.5px] text-[#9ca3af]">Only Admins can change these settings.</p>
        )}
      </div>

      {/* ── Danger Zone ── */}
      {isAdmin && (
        <div className="py-5">
          <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#dc2626]">Danger Zone</span>

          <div className="mt-4 border border-[#fca5a5] rounded-xl px-5 py-4">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 min-w-0">
                <p style={PJB} className="text-[13.5px] font-semibold text-[#111827]">Delete this organization</p>
                <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
                  Removes <span className="font-medium text-[#6b7280]">{savedName}</span> and revokes access for every
                  member. Historical analytics are retained but become unreachable.
                </p>
              </div>

              {!confirmOpen && (
                <button onClick={() => { setConfirmOpen(true); setDeleteErr('') }} style={PJB}
                  className="flex-shrink-0 flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold border border-[#fca5a5] text-[#dc2626] hover:bg-[#fef2f2] transition-colors">
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                  Delete Organization
                </button>
              )}
            </div>

            {hasBrands && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#fffbeb] border border-[#fde68a] px-3.5 py-3">
                <span className="material-symbols-outlined text-[16px] text-[#d97706] mt-px">warning</span>
                <p className="text-[12.5px] text-[#92400e]">
                  This organization still has <span className="font-semibold">{org.brand_count} brand{org.brand_count !== 1 ? 's' : ''}</span>.
                  Delete them first from each brand&apos;s Settings tab, then come back here.
                </p>
              </div>
            )}

            {confirmOpen && (
              <div className="mt-4 pt-4 border-t border-[#fecaca]">
                <label style={PJB} className="block text-[12px] font-semibold text-[#374151] mb-1.5">
                  Type <span className="font-bold text-[#dc2626]">{savedName}</span> to confirm
                </label>
                <input
                  autoFocus
                  type="text"
                  value={confirmName}
                  onChange={e => { setConfirmName(e.target.value); setDeleteErr('') }}
                  disabled={hasBrands}
                  placeholder={savedName}
                  style={{ ...PJB, width: '100%', maxWidth: '24rem' }}
                  className="h-9 px-3 text-[13.5px] border border-[#e5e7eb] rounded-lg focus:outline-none focus:border-[#dc2626] focus:ring-1 focus:ring-[#dc2626]/20 transition placeholder:text-[#d1d5db] disabled:bg-[#f9fafb] disabled:cursor-not-allowed"
                />

                {deleteErr && <p className="text-[12px] text-red-500 mt-2">{deleteErr}</p>}

                <div className="flex items-center gap-2 mt-4">
                  <button onClick={() => { setConfirmOpen(false); setConfirmName(''); setDeleteErr('') }} style={PJB}
                    className="h-8 px-3 text-[12px] font-medium text-[#6b7280] border border-[#e5e7eb] rounded-lg hover:bg-[#f9fafb] transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleDelete} disabled={!canDelete || deleting} style={PJB}
                    className="h-8 px-3 text-[12px] font-semibold text-white bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors">
                    {deleting ? 'Deleting…' : 'Delete Organization'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
