'use client'

import { useEffect, useRef, useState } from 'react'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/**
 * In-app modal for saving the current report as a reusable template — replaces the
 * browser's window.prompt. Owns the name field + loading/error state; the parent
 * supplies onSave (which performs the actual persistence) and returns a result.
 */
export default function SaveTemplateModal({
  open, defaultName, onClose, onSave,
}: {
  open: boolean
  defaultName: string
  onClose: () => void
  onSave: (name: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset to the supplied default each time the modal opens, then focus the field.
  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setError(null)
    setSaving(false)
    const t = setTimeout(() => inputRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [open, defaultName])

  if (!open) return null

  const close = () => { if (!saving) onClose() }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Template name is required.'); return }
    setSaving(true)
    setError(null)
    const res = await onSave(trimmed)
    if (res.ok) { onClose(); return }
    setError(res.error ?? 'Could not save template.')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[440px] p-7 rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.30)]">
        <div className="flex items-start gap-3 mb-5">
          <span className="w-10 h-10 rounded-xl bg-[#e6f0ee] text-[#1e4f49] flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[20px]">bookmark_add</span>
          </span>
          <div>
            <h2 style={PJ} className="text-[16px] font-bold text-[#0f172a]">Save as template</h2>
            <p className="text-[12.5px] text-[#94a3b8] mt-0.5 leading-snug">
              Reuse this report’s structure (cover style + slides) for any brand or period.
            </p>
          </div>
        </div>

        <label style={PJ} className="block text-[12px] font-semibold text-[#475569] mb-1.5">Template name</label>
        <input
          ref={inputRef}
          value={name}
          onChange={e => { setName(e.target.value); if (error) setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close() }}
          placeholder="e.g. Monthly performance report"
          disabled={saving}
          style={PJ}
          className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] text-[#111827] bg-white focus:border-[#3d7e96] focus:outline-none disabled:bg-[#f9fafb]"
        />
        {error && <p className="text-[11.5px] text-[#dc2626] mt-1.5">{error}</p>}

        <div className="flex justify-end gap-2.5 mt-6">
          <button
            onClick={close}
            disabled={saving}
            style={PJ}
            className="px-4 py-2.5 rounded-lg text-[13px] font-bold text-[#475569] hover:bg-[#f1f3f5] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            style={PJ}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-bold text-white bg-[#1e4f49] hover:bg-[#163a35] shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  )
}
