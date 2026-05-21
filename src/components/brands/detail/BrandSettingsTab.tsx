'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useBrandDetail } from './BrandDetailContext'
import BrandAvatar from '../BrandAvatar'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function BrandSettingsTab() {
  const { brand, updateBrandName, deleteBrand } = useBrandDetail()
  const router  = useRouter()
  const params  = useParams()
  const orgSlug = params?.orgSlug as string

  const [name,        setName]        = useState(brand.name)
  const [saved,       setSaved]       = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const isDirty = name.trim() !== brand.name

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateBrandName(name.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    await deleteBrand()
    router.push(`/organizations/${orgSlug}/brands`)
  }

  return (
    <div className="w-full max-w-3xl">

      {/* General */}
      <div className="w-full border-b border-[#e5e7eb] pb-6">
        <div className="py-5">
          <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af]">General</span>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <BrandAvatar brand={{ ...brand, name }} size={48} />
          <div>
            <p style={PJB} className="text-[16px] font-bold text-[#111827]">{name || 'Brand name'}</p>
            <p className="text-[12px] text-[#9ca3af] mt-0.5">{brand.accounts.length} channels · {brand.competitors.length} competitors</p>
          </div>
        </div>

        <div className="w-full mb-5">
          <label style={PJB} className="block text-[12px] font-semibold text-[#374151] mb-1.5">Brand Name</label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setSaved(false) }}
            style={{ ...PJB, width: '100%', maxWidth: '24rem' }}
            className="h-9 px-3 text-[13.5px] border border-[#e5e7eb] rounded-lg focus:outline-none focus:border-[#3d7e96] focus:ring-1 focus:ring-[#3d7e96]/20 transition"
          />
        </div>

        <button onClick={handleSave} disabled={(!isDirty && !saved) || saving} style={PJB}
          className={`flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold transition-all ${
            saved
              ? 'bg-[#ecfdf5] text-[#059669] border border-[#059669]/20'
              : isDirty
              ? 'bg-[#3d7e96] hover:bg-[#2d6e85] text-white'
              : 'bg-[#f3f4f6] text-[#9ca3af] cursor-not-allowed'
          }`}>
          {saved
            ? <><span className="material-symbols-outlined text-[15px]">check</span> Saved</>
            : <><span className="material-symbols-outlined text-[15px]">save</span> {saving ? 'Saving…' : 'Save Changes'}</>
          }
        </button>
      </div>

      {/* Danger Zone */}
      <div className="py-5">
        <span style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#dc2626]">Danger Zone</span>

        <div className="mt-4 border border-[#fca5a5] rounded-xl px-5 py-4 flex items-center justify-between gap-6">
          <div className="flex-1 min-w-0">
            <p style={PJB} className="text-[13.5px] font-semibold text-[#111827]">Delete this brand</p>
            <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
              Permanently remove <span className="font-medium text-[#6b7280]">{brand.name}</span> and all its data. This cannot be undone.
            </p>
          </div>

          {!showConfirm ? (
            <button onClick={() => setShowConfirm(true)} style={PJB}
              className="flex-shrink-0 flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold border border-[#fca5a5] text-[#dc2626] hover:bg-[#fef2f2] transition-colors">
              <span className="material-symbols-outlined text-[15px]">delete</span>
              Delete Brand
            </button>
          ) : (
            <div className="flex-shrink-0 flex items-center gap-2">
              <span style={PJB} className="text-[12px] text-[#9ca3af]">Are you sure?</span>
              <button onClick={() => setShowConfirm(false)} style={PJB}
                className="h-8 px-3 text-[12px] font-medium text-[#6b7280] border border-[#e5e7eb] rounded-lg hover:bg-[#f9fafb] transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} style={PJB}
                className="h-8 px-3 text-[12px] font-semibold text-white bg-[#dc2626] hover:bg-[#b91c1c] rounded-lg transition-colors">
                Yes, delete
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
