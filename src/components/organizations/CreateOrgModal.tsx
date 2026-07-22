'use client'

import { useState, useRef, useEffect } from 'react'
import { Organization } from '@/lib/organizations/types'

interface Props {
  onClose: () => void
  onCreated: (org: Organization) => void
}

export default function CreateOrgModal({ onClose, onCreated }: Props) {
  const [name,    setName]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Organization name is required.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })

      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.')
        return
      }

      onCreated(json.data as Organization)
      onClose()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-lg w-full max-w-[440px] mx-4 shadow-xl shadow-black/5 border border-[#e5e7eb]">
        <div className="px-6 pt-5 pb-4">
          <h2 className="text-[15px] font-semibold text-[#111827]">New Organization</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Give your organization a name. You can change this later.
          </p>
        </div>

        <div className="border-t border-[#f3f4f6]" />

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">
            Organization name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="e.g. Acme Corp"
            maxLength={100}
            disabled={loading}
            className={`h-9 px-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-md outline-none transition-all disabled:opacity-60 ${
              error
                ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                : 'border-[#e5e7eb] focus:border-[#1B8A80] focus:ring-2 focus:ring-[#1B8A80]/10'
            }`}
          />
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </form>

        <div className="border-t border-[#f3f4f6]" />

        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            className="h-8 px-3.5 bg-[#1B8A80] hover:bg-[#177A70] disabled:opacity-40 text-white text-[13px] font-medium rounded-md transition-colors"
          >
            {loading ? 'Creating…' : 'Create Organization'}
          </button>
        </div>
      </div>
    </div>
  )
}
