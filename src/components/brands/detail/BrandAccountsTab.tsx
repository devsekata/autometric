'use client'

import { useState } from 'react'
import { useBrandDetail } from './BrandDetailContext'
import { Platform } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import ConnectAccountModal from '../modals/ConnectAccountModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrandAccountsTab() {
  const { brand, connectAccount, disconnectAccount } = useBrandDetail()
  const [showConnect, setShowConnect] = useState(false)

  return (
    <div className="max-w-3xl">

      <div className="flex items-center justify-between py-4 border-b border-[#e5e7eb] mb-0">
        <div>
          <h2 style={PJB} className="text-[14px] font-bold text-[#111827]">Connected Accounts</h2>
          <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
            {brand.accounts.length === 0
              ? 'No accounts connected yet.'
              : `${brand.accounts.length} account${brand.accounts.length !== 1 ? 's' : ''} connected.`}
          </p>
        </div>
        <button onClick={() => setShowConnect(true)} style={PJB}
          className="flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors">
          <span className="material-symbols-outlined text-[15px]">add_link</span>
          Connect Account
        </button>
      </div>

      {brand.accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="material-symbols-outlined text-[44px] text-[#e5e7eb]">add_link</span>
          <p style={PJB} className="text-[14px] font-bold text-[#374151]">No accounts yet</p>
          <p className="text-[13px] text-[#9ca3af]">Connect a social account to start tracking performance</p>
          <button onClick={() => setShowConnect(true)} style={PJB}
            className="mt-1 flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors">
            <span className="material-symbols-outlined text-[15px]">add</span>
            Connect Account
          </button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[36px_1fr_1fr_44px] px-0 py-2.5 border-b border-[#e5e7eb] gap-x-4">
            {['', 'Username', 'Connected', ''].map((h, i) => (
              <span key={i} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
            ))}
          </div>

          {brand.accounts.map(acc => (
            <div key={acc.id} className="grid grid-cols-[36px_1fr_1fr_44px] items-center py-3 gap-x-4 hover:bg-[#fafafa] transition-colors group">
              <PlatformIcon platform={acc.platform} size={28} />
              <span className="text-[13px] text-[#111827] font-medium truncate">{acc.username}</span>
              <span style={PJB} className="text-[12.5px] text-[#6b7280]">
                {acc.connected_at ? formatDate(acc.connected_at) : '—'}
              </span>
              <button onClick={() => disconnectAccount(acc.id)} title="Disconnect"
                className="w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] transition-all text-[#9ca3af] hover:text-[#ef4444]">
                <span className="material-symbols-outlined text-[16px]">link_off</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {showConnect && (
        <ConnectAccountModal
          brandName={brand.name}
          onClose={() => setShowConnect(false)}
          onConnected={async (platform: Platform, username: string) => {
            await connectAccount(platform, username)
            setShowConnect(false)
          }}
        />
      )}
    </div>
  )
}
