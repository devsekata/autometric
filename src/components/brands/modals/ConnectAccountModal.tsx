'use client'

import { useState } from 'react'
import { Platform, PLATFORM_CONFIG, PLATFORM_LIST, SocialAccount } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  brandName: string
  onClose: () => void
  onConnected: (account: SocialAccount) => void
}

export default function ConnectAccountModal({ brandName, onClose, onConnected }: Props) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [handle,   setHandle]   = useState('')
  const [followers, setFollowers] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!platform) { setError('Select a platform.'); return }
    const trimmedHandle = handle.trim()
    if (!trimmedHandle) { setError('Enter a handle or username.'); return }

    onConnected({
      id: crypto.randomUUID(),
      platform,
      handle: trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`,
      followers: parseInt(followers.replace(/[^0-9]/g, ''), 10) || 0,
      connected_at: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        {/* Header */}
        <div className="px-6 pt-5 pb-4">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Connect Account</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Link a social account to <span className="font-medium text-[#374151]">{brandName}</span>
          </p>
        </div>
        <div className="border-t border-[#f3f4f6]" />

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">

          {/* Platform grid */}
          <div className="flex flex-col gap-2">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Platform
            </label>
            <div className="grid grid-cols-5 gap-2">
              {PLATFORM_LIST.map(p => {
                const cfg = PLATFORM_CONFIG[p]
                const active = platform === p
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setPlatform(p); setError('') }}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-lg border-2 transition-all ${
                      active ? 'border-[#3d7e96] bg-[#f0f7fa]' : 'border-[#f3f4f6] hover:border-[#e5e7eb]'
                    }`}
                  >
                    <div
                      style={{ width: 32, height: 32, borderRadius: 9, background: cfg.bg, fontSize: 11, fontWeight: 900, color: cfg.textColor }}
                      className="flex items-center justify-center leading-none"
                    >
                      {cfg.short}
                    </div>
                    <span style={PJB} className={`text-[10px] font-semibold ${active ? 'text-[#1e6278]' : 'text-[#9ca3af]'}`}>
                      {cfg.label.replace(' (Twitter)', '')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Handle */}
          <div className="flex flex-col gap-1.5">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Handle / Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#9ca3af]">@</span>
              <input
                type="text"
                value={handle.replace(/^@/, '')}
                onChange={e => { setHandle(e.target.value); setError('') }}
                placeholder={platform ? `your.${platform}.handle` : 'select a platform first'}
                disabled={!platform}
                maxLength={60}
                className="w-full h-9 pl-7 pr-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none transition-all focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Followers */}
          <div className="flex flex-col gap-1.5">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Followers <span className="normal-case font-normal text-[#9ca3af]">(optional)</span>
            </label>
            <input
              type="text"
              value={followers}
              onChange={e => setFollowers(e.target.value)}
              placeholder="e.g. 48200"
              maxLength={12}
              className="h-9 px-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10 transition-all"
            />
          </div>

          {error && <p className="text-[12px] text-red-500 -mt-2">{error}</p>}
        </form>

        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!platform || !handle.trim()}
            style={PJB}
            className="h-8 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            Connect Account
          </button>
        </div>
      </div>
    </div>
  )
}
