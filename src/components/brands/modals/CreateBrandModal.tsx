'use client'

import { useState, useRef, useEffect } from 'react'
import { Brand, Platform, PLATFORM_LIST, PLATFORM_CONFIG } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  orgId: string
  onClose: () => void
  onCreated: (brand: Brand) => void
}

interface PendingItem {
  platform: Platform
  username: string
}

type Step = 1 | 2 | 3

function StepIndicator({ step }: { step: Step }) {
  const steps: { n: number; label: string }[] = [
    { n: 1, label: 'Brand Name' },
    { n: 2, label: 'Connect Accounts' },
    { n: 3, label: 'Add Competitors' },
  ]
  return (
    <div className="flex items-center px-6 pt-4 pb-3">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-1.5">
            <div style={PJB} className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
              step > s.n  ? 'bg-[#3d7e96] text-white' :
              step === s.n ? 'bg-[#3d7e96] text-white' :
              'bg-[#f3f4f6] text-[#9ca3af]'
            }`}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={PJB} className={`text-[11.5px] font-semibold whitespace-nowrap ${
              step >= s.n ? 'text-[#111827]' : 'text-[#9ca3af]'
            }`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-5 h-px mx-2 flex-shrink-0 ${step > s.n ? 'bg-[#3d7e96]' : 'bg-[#e5e7eb]'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function PlatformPicker({ selected, onSelect }: { selected: Platform; onSelect: (p: Platform) => void }) {
  return (
    <div className="flex gap-2">
      {PLATFORM_LIST.map(p => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
            selected === p
              ? 'border-[#3d7e96] bg-[#3d7e96]/5'
              : 'border-[#e5e7eb] hover:border-[#d1d5db] hover:bg-[#f9fafb]'
          }`}
        >
          <PlatformIcon platform={p} size={24} />
          <span className={`text-[9px] font-bold ${selected === p ? 'text-[#3d7e96]' : 'text-[#9ca3af]'}`}>
            {PLATFORM_CONFIG[p].short}
          </span>
        </button>
      ))}
    </div>
  )
}

function AddedList({ items, onRemove, emptyLabel }: {
  items: PendingItem[]
  onRemove: (idx: number) => void
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-[#9ca3af] text-center py-2">{emptyLabel}</p>
  }
  return (
    <div className="flex flex-col gap-1.5 max-h-[108px] overflow-y-auto">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 px-3 h-8 bg-[#f9fafb] rounded-lg border border-[#e5e7eb]">
          <PlatformIcon platform={item.platform} size={16} />
          <span style={PJB} className="text-[12.5px] text-[#111827] flex-1 truncate">{item.username}</span>
          <button type="button" onClick={() => onRemove(i)}
            className="text-[#9ca3af] hover:text-[#6b7280] transition-colors">
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      ))}
    </div>
  )
}

export default function CreateBrandModal({ orgId, onClose, onCreated }: Props) {
  const [step,    setStep]    = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [brandId, setBrandId] = useState<string | null>(null)

  // Step 1
  const [name,    setName]    = useState('')
  const [nameErr, setNameErr] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // Step 2
  const [accounts,     setAccounts]     = useState<PendingItem[]>([])
  const [acctPlatform, setAcctPlatform] = useState<Platform>('instagram')
  const [acctUsername, setAcctUsername] = useState('')
  const [acctErr,      setAcctErr]      = useState('')
  const acctRef = useRef<HTMLInputElement>(null)

  // Step 3
  const [competitors,  setCompetitors]  = useState<PendingItem[]>([])
  const [compPlatform, setCompPlatform] = useState<Platform>('instagram')
  const [compUsername, setCompUsername] = useState('')
  const [compErr,      setCompErr]      = useState('')
  const compRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => { if (step === 2) acctRef.current?.focus() }, [step])
  useEffect(() => { if (step === 3) compRef.current?.focus() }, [step])

  const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  // ── Step 1 ──────────────────────────────────────────────────────
  async function handleStep1() {
    const trimmed = name.trim()
    if (!trimmed) { setNameErr('Brand name is required.'); return }
    setLoading(true); setError('')
    try {
      const res  = await fetch(`/api/organizations/${orgId}/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Something went wrong.'); return }
      setBrandId(json.data.id)
      setStep(2)
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2 helpers ──────────────────────────────────────────────
  function addAccount() {
    const u = acctUsername.trim()
    if (!u) { setAcctErr('Enter a username.'); return }
    setAccounts(prev => [...prev, { platform: acctPlatform, username: u }])
    setAcctUsername('')
    setAcctErr('')
    acctRef.current?.focus()
  }

  async function handleStep2(skip: boolean) {
    if (!brandId) return
    setLoading(true); setError('')
    try {
      if (!skip) {
        for (const a of accounts) {
          const res = await fetch(`/api/brands/${brandId}/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: a.platform, username: a.username }),
          })
          if (!res.ok) {
            const json = await res.json()
            setError(json.error ?? 'Failed to connect account.')
            return
          }
        }
      }
      setStep(3)
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3 helpers ──────────────────────────────────────────────
  function addCompetitor() {
    const u = compUsername.trim()
    if (!u) { setCompErr('Enter a username.'); return }
    setCompetitors(prev => [...prev, { platform: compPlatform, username: u }])
    setCompUsername('')
    setCompErr('')
    compRef.current?.focus()
  }

  async function handleFinish(skip: boolean) {
    if (!brandId) return
    setLoading(true); setError('')
    try {
      if (!skip) {
        for (const c of competitors) {
          const res = await fetch(`/api/brands/${brandId}/competitors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: c.platform, username: c.username }),
          })
          if (!res.ok) {
            const json = await res.json()
            setError(json.error ?? 'Failed to add competitor.')
            return
          }
        }
      }
      // Fetch final brand with all added data
      const res  = await fetch(`/api/brands/${brandId}`)
      const json = await res.json()
      if (res.ok) onCreated(json.data)
      onClose()
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[500px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">New Brand</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">Set up your brand in a few quick steps.</p>
        </div>

        <StepIndicator step={step} />
        <div className="border-t border-[#f3f4f6]" />

        {/* ── Step 1: Brand Name ── */}
        {step === 1 && (
          <div className="px-6 py-5 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div style={{ width: 40, height: 40, background: '#3d7e96', borderRadius: 10, fontSize: 14 }}
                className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none">
                {initials}
              </div>
              <div>
                <p style={PJB} className="text-[14px] font-bold text-[#111827]">{name || 'Brand name'}</p>
                <p className="text-[11px] text-[#9ca3af] mt-0.5">0 accounts · 0 competitors</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
                Brand name
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setNameErr('') }}
                onKeyDown={e => e.key === 'Enter' && handleStep1()}
                placeholder="e.g. Nike Indonesia"
                maxLength={80}
                className={`h-9 px-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                  nameErr
                    ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                    : 'border-[#e5e7eb] focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10'
                }`}
              />
              {nameErr && <p className="text-[12px] text-red-500">{nameErr}</p>}
            </div>

            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
        )}

        {/* ── Step 2: Connect Accounts ── */}
        {step === 2 && (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#111827]">Connect social accounts</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5">Select a platform and enter the account username.</p>
            </div>

            <PlatformPicker selected={acctPlatform} onSelect={p => { setAcctPlatform(p); setAcctErr('') }} />

            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <input
                  ref={acctRef}
                  type="text"
                  value={acctUsername}
                  onChange={e => { setAcctUsername(e.target.value); setAcctErr('') }}
                  onKeyDown={e => e.key === 'Enter' && addAccount()}
                  placeholder={`@username on ${PLATFORM_CONFIG[acctPlatform].label}`}
                  className={`h-9 px-3 text-[13px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                    acctErr
                      ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                      : 'border-[#e5e7eb] focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10'
                  }`}
                />
                {acctErr && <p className="text-[11px] text-red-500">{acctErr}</p>}
              </div>
              <button type="button" onClick={addAccount} style={PJB}
                className="h-9 px-3.5 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[13px] font-semibold text-[#374151] rounded-lg transition-colors flex-shrink-0 self-start">
                Add
              </button>
            </div>

            <AddedList
              items={accounts}
              onRemove={i => setAccounts(prev => prev.filter((_, idx) => idx !== i))}
              emptyLabel="No accounts added yet."
            />

            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
        )}

        {/* ── Step 3: Add Competitors ── */}
        {step === 3 && (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#111827]">Add competitors</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5">Track competitor accounts to benchmark against.</p>
            </div>

            <PlatformPicker selected={compPlatform} onSelect={p => { setCompPlatform(p); setCompErr('') }} />

            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <input
                  ref={compRef}
                  type="text"
                  value={compUsername}
                  onChange={e => { setCompUsername(e.target.value); setCompErr('') }}
                  onKeyDown={e => e.key === 'Enter' && addCompetitor()}
                  placeholder={`@username on ${PLATFORM_CONFIG[compPlatform].label}`}
                  className={`h-9 px-3 text-[13px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                    compErr
                      ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                      : 'border-[#e5e7eb] focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10'
                  }`}
                />
                {compErr && <p className="text-[11px] text-red-500">{compErr}</p>}
              </div>
              <button type="button" onClick={addCompetitor} style={PJB}
                className="h-9 px-3.5 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[13px] font-semibold text-[#374151] rounded-lg transition-colors flex-shrink-0 self-start">
                Add
              </button>
            </div>

            <AddedList
              items={competitors}
              onRemove={i => setCompetitors(prev => prev.filter((_, idx) => idx !== i))}
              emptyLabel="No competitors added yet."
            />

            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex items-center justify-between">

          {step === 1 && (
            <>
              <button type="button" onClick={onClose}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleStep1} disabled={!name.trim() || loading} style={PJB}
                className="h-8 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                {loading ? 'Creating…' : <><span>Next</span><span className="material-symbols-outlined text-[14px]">arrow_forward</span></>}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button type="button" onClick={() => handleStep2(true)} disabled={loading} style={PJB}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
                Skip
              </button>
              <button type="button" onClick={() => handleStep2(false)} disabled={loading} style={PJB}
                className="h-8 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                {loading ? 'Saving…' : <><span>Next</span><span className="material-symbols-outlined text-[14px]">arrow_forward</span></>}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button type="button" onClick={() => handleFinish(true)} disabled={loading} style={PJB}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
                Skip
              </button>
              <button type="button" onClick={() => handleFinish(false)} disabled={loading} style={PJB}
                className="h-8 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                {loading ? 'Saving…' : <><span>Finish</span><span className="material-symbols-outlined text-[14px]">check</span></>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
