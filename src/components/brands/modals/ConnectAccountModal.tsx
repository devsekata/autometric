'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Platform, SocialAccount } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import { useOAuthConnect, CONNECT_OPTIONS } from '@/hooks/useOAuthConnect'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface SessionAccount {
  account: SocialAccount
  is_new:  boolean
}

interface Props {
  brandId:        string
  brandName:      string
  usedPlatforms?: Platform[]
  onClose:        () => void
  onConnected:    (account: SocialAccount) => void
}

export default function ConnectAccountModal({ brandId, brandName, usedPlatforms = [], onClose, onConnected }: Props) {
  const { loading, error, pending, connect, reset, save } = useOAuthConnect(brandId)
  const [sessionConnected, setSessionConnected] = useState<SessionAccount[]>([])

  const allConnectedPlatforms: Platform[] = [
    ...usedPlatforms,
    ...sessionConnected.map(s => s.account.platform),
  ]

  // ── Confirm step ──────────────────────────────────────────────────
  if (pending) {
    const { payload } = pending
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/25" />

        <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">
          <div className="px-6 pt-5 pb-4">
            <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Confirm Account</h2>
            <p className="text-[13px] text-[#9ca3af] mt-0.5">
              Connect this account to <span className="font-medium text-[#374151]">{brandName}</span>?
            </p>
          </div>
          <div className="border-t border-[#f3f4f6]" />

          <div className="px-6 py-6 flex flex-col items-center gap-4">
            <div className="flex items-center gap-4 w-full bg-[#f9fafb] rounded-xl px-4 py-3.5 border border-[#f3f4f6]">
              {payload.avatarUrl ? (
                <Image src={payload.avatarUrl} alt={payload.username} width={44} height={44}
                  className="rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-[#e5e7eb] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[22px] text-[#9ca3af]">person</span>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span style={PJB} className="text-[13px] font-semibold text-[#111827] truncate">
                  @{payload.username}
                </span>
                <span style={PJB} className="text-[11px] text-[#9ca3af] capitalize">{payload.platform}</span>
              </div>
              <div className="ml-auto shrink-0">
                <PlatformIcon platform={payload.platform as Platform} size={24} />
              </div>
            </div>

            {error && <p className="text-[12px] text-red-500 self-start">{error}</p>}
          </div>

          <div className="border-t border-[#f3f4f6]" />
          <div className="px-6 py-4 flex justify-between items-center">
            <button type="button" onClick={reset} disabled={loading} style={PJB}
              className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
              Ganti Akun
            </button>

            <button type="button" disabled={loading} style={PJB}
              onClick={() => save((account, is_new) => {
                setSessionConnected(prev => [...prev, { account, is_new }])
                reset()
              })}
              className="h-8 px-4 text-[13px] font-semibold bg-[#111827] text-white rounded-lg hover:bg-[#1f2937] transition-colors disabled:opacity-50 flex items-center gap-2">
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Menghubungkan...
                </>
              ) : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Platform list ─────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">
        <div className="px-6 pt-5 pb-4">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Connect Account</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Link a social account to <span className="font-medium text-[#374151]">{brandName}</span>
          </p>
        </div>
        <div className="border-t border-[#f3f4f6]" />

        <div className="px-6 py-5 flex flex-col gap-2">
          {CONNECT_OPTIONS.map(opt => {
            const taken = allConnectedPlatforms.includes(opt.platform)
            return (
              <div key={opt.id} className={`rounded-xl border transition-colors ${
                taken ? 'border-[#e5e7eb] opacity-40 pointer-events-none' : 'border-[#e5e7eb] bg-white'
              }`}>
                <div className="flex items-center gap-3 px-4 h-[54px]">
                  <PlatformIcon platform={opt.platform} size={30} />
                  <span style={PJB} className="text-[13px] font-semibold text-[#111827] flex-1 leading-tight">
                    {opt.label}
                  </span>
                  {taken ? (
                    <span style={PJB} className="text-[11px] text-[#9ca3af] flex-shrink-0">Already connected</span>
                  ) : (
                    <button type="button" disabled={loading} style={PJB}
                      onClick={() => connect(opt.method)}
                      className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#3d7e96] disabled:opacity-40 flex-shrink-0">
                      Connect
                      <span className="material-symbols-outlined text-[15px]">chevron_right</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex justify-between items-center">
          <button type="button" onClick={onClose} style={PJB}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
            {sessionConnected.length > 0 ? 'Tutup' : 'Close'}
          </button>

          {sessionConnected.length > 0 && (
            <button type="button" style={PJB}
              onClick={() => {
                for (const { account } of sessionConnected) {
                  onConnected(account)
                }
                onClose()
              }}
              className="h-8 px-4 text-[13px] font-semibold bg-[#3d7e96] text-white rounded-lg hover:bg-[#2d6e85] transition-colors flex items-center gap-1.5">
              Simpan
              <span className="material-symbols-outlined text-[14px]">check</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
