'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Brand, Platform, SocialAccount, getColorFromId } from '@/lib/brands/types'
import ChannelRow from './ChannelRow'
import ConnectAccountModal from '../modals/ConnectAccountModal'

type StatusFilter = 'all' | 'connected' | 'disconnected'

const ACTIVE_PLATFORMS: Platform[] = ['instagram', 'tiktok', 'facebook']
const COL_HEADERS = ['CHANNEL', 'USERNAME', 'COMPETITORS', 'STATUS', 'CONNECTED AT', 'CREATED AT']
const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function BrandAvatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ width: 20, height: 20, background: color, borderRadius: 5, fontSize: 8 }}
      className="flex items-center justify-center font-bold text-white leading-none select-none flex-shrink-0">
      {initials}
    </div>
  )
}

interface Props {
  brand: Brand
  orgSlug: string
  statusFilter: StatusFilter
  defaultOpen?: boolean
  onAccountAdded: (brandId: string, account: SocialAccount) => void
}

export default function BrandGroup({ brand, orgSlug, statusFilter, defaultOpen = false, onAccountAdded }: Props) {
  const [open,           setOpen]           = useState(defaultOpen)
  const [showAddChannel, setShowAddChannel] = useState(false)

  const allAccounts      = brand.accounts.filter(a => ACTIVE_PLATFORMS.includes(a.platform))
  const usedPlatforms    = allAccounts.map(a => a.platform)
  const allPlatformsFull = ACTIVE_PLATFORMS.every(p => usedPlatforms.includes(p))
  const accounts         = allAccounts.filter(a => {
    if (statusFilter === 'connected')    return a.connected
    if (statusFilter === 'disconnected') return !a.connected
    return true
  })
  const disconnectedCount = allAccounts.filter(a => !a.connected).length
  const color = getColorFromId(brand.id)

  return (
    <div className="border-b border-[#e5e7eb] last:border-0">

      <div className="flex items-center gap-2.5 px-6 py-2.5 cursor-pointer select-none bg-[#f9fafb]"
        onClick={() => setOpen(o => !o)}>
        <span className="material-symbols-outlined text-[17px] text-[#9ca3af] transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          expand_more
        </span>

        <BrandAvatar name={brand.name} color={color} />

        <Link href={`/organizations/${orgSlug}/brands/${brand.id}/overview`}
          onClick={e => e.stopPropagation()} style={PJB}
          className="text-[13.5px] font-bold text-[#111827] hover:text-[#3d7e96] hover:underline transition-colors">
          {brand.name}
        </Link>

        <span style={PJB} className="text-[12.5px] font-semibold text-[#9ca3af]">{allAccounts.length}</span>

        {disconnectedCount > 0 && (
          <span style={PJB} className="text-[11px] font-medium text-[#dc2626] bg-[#fef2f2] px-2 py-0.5 rounded-full ml-1">
            {disconnectedCount} disconnected
          </span>
        )}

        <span style={PJB} className="text-[11px] font-medium text-[#9ca3af] ml-auto">
          {brand.competitors.length} {brand.competitors.length === 1 ? 'competitor' : 'competitors'}
        </span>
      </div>

      {open && (
        <div>
          <div className="grid grid-cols-[1.6fr_1.4fr_1.2fr_1fr_1.3fr_1.3fr] px-6 py-2 bg-white border-b border-[#e5e7eb]">
            {COL_HEADERS.map(h => (
              <span key={h} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
            ))}
          </div>

          {accounts.length === 0 ? (
            <div className="px-6 py-4 text-[13px] text-[#9ca3af] border-b border-[#e5e7eb]" style={PJB}>
              No channels match this filter
            </div>
          ) : (
            accounts.map(account => (
              <ChannelRow key={account.id} account={account} competitors={brand.competitors} brandCreatedAt={brand.created_at} />
            ))
          )}

          {!allPlatformsFull && (
            <button
              onClick={e => { e.stopPropagation(); setShowAddChannel(true) }}
              className="w-full flex items-center gap-1.5 px-6 py-2.5 border-b border-[#e5e7eb] hover:bg-[#f9fafb] transition-colors group/add"
            >
              <span className="material-symbols-outlined text-[14px] text-[#d1d5db] group-hover/add:text-[#3d7e96] transition-colors">add</span>
              <span style={PJB} className="text-[12px] text-[#d1d5db] group-hover/add:text-[#3d7e96] transition-colors">Add channel</span>
            </button>
          )}
        </div>
      )}

      {showAddChannel && (
        <ConnectAccountModal
          brandName={brand.name}
          usedPlatforms={usedPlatforms}
          onClose={() => setShowAddChannel(false)}
          onConnected={async (platform, username) => {
            const res  = await fetch(`/api/brands/${brand.id}/accounts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ platform, username }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Failed to connect account.')
            onAccountAdded(brand.id, json.data)
            setShowAddChannel(false)
          }}
        />
      )}
    </div>
  )
}
