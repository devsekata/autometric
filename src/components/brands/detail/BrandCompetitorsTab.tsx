'use client'

import { useState } from 'react'
import { useBrandDetail } from './BrandDetailContext'
import { Platform } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import CompetitorModal from '../modals/CompetitorModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function BrandCompetitorsTab() {
  const { brand, addCompetitor, removeCompetitor } = useBrandDetail()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="max-w-3xl">

      <div className="flex items-center justify-between py-4 border-b border-[#e5e7eb]">
        <div>
          <h2 style={PJB} className="text-[14px] font-bold text-[#111827]">Competitors</h2>
          <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
            {brand.competitors.length === 0
              ? 'No competitors tracked yet.'
              : `Tracking ${brand.competitors.length} competitor account${brand.competitors.length !== 1 ? 's' : ''}.`}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={PJB}
          className="flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors">
          <span className="material-symbols-outlined text-[15px]">add</span>
          Add Competitor
        </button>
      </div>

      {brand.competitors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="material-symbols-outlined text-[44px] text-[#e5e7eb]">flag</span>
          <p style={PJB} className="text-[14px] font-bold text-[#374151]">No competitors yet</p>
          <p className="text-[13px] text-[#9ca3af]">Track competitor accounts to benchmark your brand's performance</p>
          <button onClick={() => setShowAdd(true)} style={PJB}
            className="mt-1 flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors">
            <span className="material-symbols-outlined text-[15px]">add</span>
            Add Competitor
          </button>
        </div>
      ) : (
        brand.competitors.map(comp => (
          <div key={comp.social_account_id} className="flex items-center gap-4 py-3.5 border-b border-[#f3f4f6] hover:bg-[#fafafa] transition-colors group">
            <PlatformIcon platform={comp.platform} size={32} />
            <div className="flex-1 min-w-0">
              <p style={PJB} className="text-[13.5px] font-bold text-[#111827]">{comp.username}</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5 capitalize">{comp.platform}</p>
            </div>
            <button onClick={() => removeCompetitor(comp.social_account_id)} title="Remove competitor"
              className="w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] transition-all text-[#9ca3af] hover:text-[#ef4444] flex-shrink-0">
              <span className="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>
        ))
      )}

      {showAdd && (
        <CompetitorModal
          brandName={brand.name}
          onClose={() => setShowAdd(false)}
          onAdded={async (platform: Platform, username: string) => {
            await addCompetitor(platform, username)
            setShowAdd(false)
          }}
        />
      )}
    </div>
  )
}
