'use client'

import { useState } from 'react'
import { useBrandDetail } from './BrandDetailContext'
import { PLATFORM_CONFIG } from '@/lib/brands/types'
import ConnectAccountModal from '../modals/ConnectAccountModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrandAccountsTab() {
  const { brand, connectAccount, disconnectAccount } = useBrandDetail()
  const [showConnect, setShowConnect] = useState(false)

  return (
    <div className="max-w-3xl">

      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Connected Accounts</h2>
          <p className="text-[13px] text-[#6b7280] mt-0.5">
            {brand.accounts.length === 0
              ? 'No accounts connected yet.'
              : `${brand.accounts.length} account${brand.accounts.length !== 1 ? 's' : ''} connected.`}
          </p>
        </div>
        <button
          onClick={() => setShowConnect(true)}
          style={PJB}
          className="flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors shadow-[0_2px_8px_rgba(61,126,150,0.22)]"
        >
          <span className="material-symbols-outlined text-[15px]">add_link</span>
          Connect Account
        </button>
      </div>

      {/* Account list */}
      {brand.accounts.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-[#e5e7eb] rounded-xl flex flex-col items-center justify-center py-16 gap-3">
          <span className="material-symbols-outlined text-[44px] text-[#d1d5db]">add_link</span>
          <p style={PJB} className="text-[15px] font-bold text-[#374151]">No accounts yet</p>
          <p className="text-[13px] text-[#6b7280]">Connect a social account to start tracking performance</p>
          <button
            onClick={() => setShowConnect(true)}
            style={PJB}
            className="mt-1 flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">add</span>
            Connect Account
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">

          {/* Table head */}
          <div className="grid grid-cols-[36px_1fr_1fr_1fr_44px] bg-[#f9fafb] border-b-2 border-[#e5e7eb] px-5 py-2.5 gap-x-4">
            {['', 'Handle', 'Followers', 'Connected', ''].map((h, i) => (
              <span key={i} style={PJB} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{h}</span>
            ))}
          </div>

          <div className="divide-y divide-[#f3f4f6]">
            {brand.accounts.map(acc => {
              const cfg = PLATFORM_CONFIG[acc.platform]
              return (
                <div key={acc.id} className="grid grid-cols-[36px_1fr_1fr_1fr_44px] items-center px-5 py-3.5 gap-x-4 hover:bg-[#fafafa] transition-colors group">
                  {/* Platform icon */}
                  <div
                    style={{ width: 30, height: 30, borderRadius: 8, background: cfg.bg, fontSize: 9.5, fontWeight: 900, color: cfg.textColor }}
                    className="flex items-center justify-center leading-none flex-shrink-0"
                    title={cfg.label}
                  >
                    {cfg.short}
                  </div>

                  {/* Handle */}
                  <span className="text-[13.5px] text-[#111827] font-medium truncate">{acc.handle}</span>

                  {/* Followers */}
                  <span style={PJB} className="text-[13px] font-bold text-[#374151] tabular-nums">{fmt(acc.followers)}</span>

                  {/* Connected date */}
                  <span style={PJB} className="text-[12.5px] font-medium text-[#374151]">{formatDate(acc.connected_at)}</span>

                  {/* Disconnect */}
                  <button
                    onClick={() => disconnectAccount(acc.id)}
                    title="Disconnect"
                    className="w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] transition-all text-[#9ca3af] hover:text-[#ef4444]"
                  >
                    <span className="material-symbols-outlined text-[16px]">link_off</span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showConnect && (
        <ConnectAccountModal
          brandName={brand.name}
          onClose={() => setShowConnect(false)}
          onConnected={acc => { connectAccount(acc); setShowConnect(false) }}
        />
      )}
    </div>
  )
}
