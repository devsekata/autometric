'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useBrandDetail } from './BrandDetailContext'
import { SocialAccount } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import ConnectAccountModal from '../modals/ConnectAccountModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrandAccountsTab() {
  const { brand, addAccount, disconnectAccount } = useBrandDetail()
  const [showConnect,    setShowConnect]    = useState(false)
  const [confirmAccount, setConfirmAccount] = useState<SocialAccount | null>(null)
  const [disconnecting,  setDisconnecting]  = useState(false)

  async function handleDisconnect() {
    if (!confirmAccount) return
    setDisconnecting(true)
    try {
      await disconnectAccount(confirmAccount.id)
      setConfirmAccount(null)
    } finally {
      setDisconnecting(false)
    }
  }

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
          className="flex items-center gap-1.5 h-9 px-4 bg-[#285D6E] hover:bg-[#1E4A58] text-white text-[13px] font-semibold rounded-lg transition-colors">
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
            className="mt-1 flex items-center gap-1.5 h-9 px-4 bg-[#285D6E] hover:bg-[#1E4A58] text-white text-[13px] font-semibold rounded-lg transition-colors">
            <span className="material-symbols-outlined text-[15px]">add</span>
            Connect Account
          </button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[28px_1fr_1fr_44px] px-0 py-2.5 border-b border-[#e5e7eb] gap-x-4">
            {['', 'Account', 'Connected', ''].map((h, i) => (
              <span key={i} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
            ))}
          </div>

          {brand.accounts.map(acc => (
            <div key={acc.id} className="grid grid-cols-[28px_1fr_1fr_44px] items-center py-3 gap-x-4 hover:bg-[#fafafa] transition-colors">
              <PlatformIcon platform={acc.platform} size={24} />
              <div className="flex items-center gap-2.5 min-w-0">
                {acc.avatar_url
                  ? <img src={acc.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  : <PlatformIcon platform={acc.platform} size={24} />
                }
                <span className="text-[13px] text-[#111827] font-medium truncate">{acc.username}</span>
              </div>
              <span style={PJB} className="text-[12.5px] text-[#6b7280]">
                {acc.connected_at ? formatDate(acc.connected_at) : '—'}
              </span>
              <button onClick={() => setConfirmAccount(acc)} title="Disconnect"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#fee2e2] transition-colors text-[#d1d5db] hover:text-[#ef4444]">
                <span className="material-symbols-outlined text-[16px]">link_off</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {showConnect && (
        <ConnectAccountModal
          brandId={brand.id}
          brandName={brand.name}
          usedPlatforms={brand.accounts.map(a => a.platform)}
          onClose={() => setShowConnect(false)}
          onConnected={(account) => { addAccount(account); setShowConnect(false) }}
        />
      )}

      {confirmAccount && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ width: '100%', maxWidth: 440, margin: '0 16px' }}>

            {/* Header */}
            <div className="flex flex-col items-center text-center px-8 pt-8 pb-6 border-b border-[#f3f4f6]">
              <div className="w-14 h-14 rounded-full bg-[#fef2f2] flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-[28px] text-[#ef4444]">link_off</span>
              </div>
              <p style={PJB} className="text-[17px] font-bold text-[#111827]">Disconnect account?</p>
              <p className="text-[13px] text-[#9ca3af] mt-1.5 leading-relaxed">
                This account will be removed from this brand.<br />You can reconnect it anytime.
              </p>
            </div>

            {/* Account info */}
            <div className="px-8 py-5">
              <div className="flex items-center gap-4 px-4 py-4 bg-[#f9fafb] rounded-xl border border-[#f3f4f6]">
                {confirmAccount.avatar_url
                  ? <img src={confirmAccount.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                  : <div className="w-11 h-11 rounded-full bg-[#e5e7eb] flex items-center justify-center flex-shrink-0">
                      <PlatformIcon platform={confirmAccount.platform} size={22} />
                    </div>
                }
                <div className="min-w-0">
                  <p style={PJB} className="text-[14px] font-semibold text-[#111827] truncate">{confirmAccount.username}</p>
                  <p className="text-[12px] text-[#9ca3af] capitalize mt-0.5">{confirmAccount.platform}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 px-8 pb-7">
              <button onClick={() => setConfirmAccount(null)} disabled={disconnecting} style={PJB}
                className="flex-1 h-11 rounded-xl border border-[#e5e7eb] text-[14px] font-semibold text-[#374151] hover:bg-[#f9fafb] transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDisconnect} disabled={disconnecting} style={PJB}
                className="flex-1 h-11 rounded-xl bg-[#ef4444] hover:bg-[#dc2626] text-white text-[14px] font-semibold transition-colors disabled:opacity-70 flex items-center justify-center gap-2">
                {disconnecting
                  ? <><span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Disconnecting…</>
                  : <><span className="material-symbols-outlined text-[16px]">link_off</span> Disconnect</>
                }
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
