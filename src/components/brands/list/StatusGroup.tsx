'use client'

import { useState } from 'react'
import { Brand, SocialAccount } from '@/lib/brands/types'
import AccountRow from './AccountRow'

type StatusType = 'connected' | 'disconnected'

export interface AccountEntry { brand: Brand; account: SocialAccount }

const CONFIG = {
  connected:    { label: 'Connected',    color: '#059669', bg: '#f0fdf4', dot: '#10b981' },
  disconnected: { label: 'Disconnected', color: '#dc2626', bg: '#fff5f5', dot: '#ef4444' },
}

const COL_HEADERS = ['BRAND', 'CHANNEL', 'USERNAME', 'COMPETITORS', 'CONNECTED AT', 'CREATED AT']
const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  statusType: StatusType
  entries: AccountEntry[]
  orgSlug: string
  defaultOpen?: boolean
}

export default function StatusGroup({ statusType, entries, orgSlug, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const cfg = CONFIG[statusType]

  return (
    <div className="border-b border-[#e5e7eb] last:border-0">

      {/* Group header */}
      <div
        className="flex items-center gap-2.5 px-6 py-2.5 cursor-pointer select-none bg-[#f9fafb]"
        onClick={() => setOpen(o => !o)}
      >
        <span
          className="material-symbols-outlined text-[17px] text-[#9ca3af] transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>
        <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 border-2"
          style={{ background: cfg.dot, borderColor: cfg.dot + '55' }} />
        <span style={PJB} className="text-[13.5px] font-bold text-[#111827]">{cfg.label}</span>
        <span style={PJB} className="text-[12.5px] font-semibold text-[#9ca3af]">{entries.length}</span>
      </div>

      {open && (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-[1.6fr_1.2fr_1.4fr_1.2fr_1.3fr_1.3fr] px-6 py-2 bg-white border-b border-[#f0f0f0]">
            {COL_HEADERS.map(h => (
              <span key={h} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
            ))}
          </div>

          {entries.length === 0 ? (
            <div className="px-6 py-5 text-[13px] text-[#9ca3af]" style={PJB}>No accounts</div>
          ) : (
            entries.map(({ brand, account }) => (
              <AccountRow key={account.id} brand={brand} account={account} orgSlug={orgSlug} />
            ))
          )}

          <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-[#f3f4f6]">
            <span className="material-symbols-outlined text-[14px] text-[#d1d5db]">add</span>
            <span style={PJB} className="text-[12px] text-[#d1d5db]">Add</span>
          </div>
        </div>
      )}

    </div>
  )
}
