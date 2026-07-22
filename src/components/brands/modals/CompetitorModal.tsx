'use client'

import { useState } from 'react'
import { Platform, PLATFORM_CONFIG, PLATFORM_LIST } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  brandName: string
  onClose: () => void
  onAdded: (platform: Platform, username: string) => Promise<void>
}

export default function CompetitorModal({ brandName, onClose, onAdded }: Props) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [username, setUsername] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!platform) { setError('Select a platform.'); return }
    const trimmed = username.trim().replace(/^@/, '')
    if (!trimmed) { setError('Enter a username.'); return }

    setLoading(true)
    try {
      await onAdded(platform, trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        <div className="px-6 pt-5 pb-4 sticky top-0 bg-white border-b border-[#f3f4f6] z-10">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Add Competitor Account</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Track a competitor account for <span className="font-medium text-[#374151]">{brandName}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">

          {/* Platform */}
          <div className="flex flex-col gap-2">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">Platform</label>
            <div className="grid grid-cols-5 gap-2">
              {PLATFORM_LIST.map(p => {
                const cfg = PLATFORM_CONFIG[p]
                const active = platform === p
                return (
                  <button key={p} type="button" onClick={() => { setPlatform(p); setError('') }}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-lg border-2 transition-all ${
                      active ? 'border-[#1B8A80] bg-[#f0f7fa]' : 'border-[#f3f4f6] hover:border-[#e5e7eb]'
                    }`}>
                    <PlatformIcon platform={p} size={32} />
                    <span style={PJB} className={`text-[10px] font-semibold ${active ? 'text-[#2C3079]' : 'text-[#9ca3af]'}`}>
                      {cfg.label.replace(' (Twitter)', '')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Username */}
          <div className="flex flex-col gap-1.5">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Competitor Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#9ca3af]">@</span>
              <input
                type="text"
                value={username.replace(/^@/, '')}
                onChange={e => { setUsername(e.target.value); setError('') }}
                placeholder={platform ? `competitor.${platform}.handle` : 'select a platform first'}
                disabled={!platform}
                maxLength={60}
                className="w-full h-9 pl-7 pr-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none transition-all focus:border-[#1B8A80] focus:ring-2 focus:ring-[#1B8A80]/10 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {error && <p className="text-[12px] text-red-500 -mt-2">{error}</p>}
        </form>

        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!platform || !username.trim() || loading} style={PJB}
            className="h-8 px-4 bg-[#1B8A80] hover:bg-[#177A70] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors">
            {loading ? 'Adding…' : 'Add Competitor'}
          </button>
        </div>
      </div>
    </div>
  )
}
