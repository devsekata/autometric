'use client'

import { useState } from 'react'
import { useBrandDetail } from './BrandDetailContext'
import { Platform } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import CompetitorModal from '../modals/CompetitorModal'
import { COMPETITOR_ADD_ENABLED } from '@/lib/featureFlags'
import { MAX_COMPETITORS_PER_PLATFORM } from '@/lib/quotas'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const ADD_DISABLED_TITLE = 'Penambahan competitor dinonaktifkan sementara'

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
              ? `No competitors tracked yet. Up to ${MAX_COMPETITORS_PER_PLATFORM} per platform.`
              : `Tracking ${brand.competitors.length} competitor account${brand.competitors.length !== 1 ? 's' : ''} · max ${MAX_COMPETITORS_PER_PLATFORM} per platform.`}
          </p>
        </div>
        <button onClick={() => COMPETITOR_ADD_ENABLED && setShowAdd(true)} disabled={!COMPETITOR_ADD_ENABLED} style={PJB}
          title={COMPETITOR_ADD_ENABLED ? undefined : ADD_DISABLED_TITLE}
          className={`flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold rounded-lg transition-colors ${
            COMPETITOR_ADD_ENABLED ? 'bg-[#1B8A80] hover:bg-[#177A70] text-white' : 'bg-[#e5e7eb] text-[#9ca3af] cursor-not-allowed'
          }`}>
          <span className="material-symbols-outlined text-[15px]">add</span>
          Add Competitor
        </button>
      </div>

      {brand.competitors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="material-symbols-outlined text-[44px] text-[#e5e7eb]">flag</span>
          <p style={PJB} className="text-[14px] font-bold text-[#374151]">No competitors yet</p>
          <p className="text-[13px] text-[#9ca3af]">Track competitor accounts to benchmark your brand's performance</p>
          <button onClick={() => COMPETITOR_ADD_ENABLED && setShowAdd(true)} disabled={!COMPETITOR_ADD_ENABLED} style={PJB}
            title={COMPETITOR_ADD_ENABLED ? undefined : ADD_DISABLED_TITLE}
            className={`mt-1 flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold rounded-lg transition-colors ${
              COMPETITOR_ADD_ENABLED ? 'bg-[#1B8A80] hover:bg-[#177A70] text-white' : 'bg-[#e5e7eb] text-[#9ca3af] cursor-not-allowed'
            }`}>
            <span className="material-symbols-outlined text-[15px]">add</span>
            Add Competitor
          </button>
          {!COMPETITOR_ADD_ENABLED && <p className="text-[11.5px] text-[#bcc2c9]">Fitur ini dinonaktifkan sementara.</p>}
        </div>
      ) : (
        brand.competitors.map(comp => (
          <div key={comp.social_account_id} className="flex items-center gap-4 py-3.5 border-b border-[#f3f4f6] hover:bg-[#fafafa] transition-colors group">
            <div className="relative flex-shrink-0">
              {comp.avatar_url ? (
                <img src={comp.avatar_url} alt={comp.username}
                  className="w-9 h-9 rounded-full object-cover bg-[#f3f4f6]" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[#f3f4f6] flex items-center justify-center">
                  <PlatformIcon platform={comp.platform} size={20} />
                </div>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white flex items-center justify-center">
                <PlatformIcon platform={comp.platform} size={12} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p style={PJB} className="text-[13.5px] font-bold text-[#111827]">{comp.username}</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5 capitalize">{comp.platform}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
              {comp.profile_url && (
                <a href={comp.profile_url} target="_blank" rel="noopener noreferrer"
                  title="View profile"
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#e0f0f5] transition-colors text-[#9ca3af] hover:text-[#1B8A80]">
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                </a>
              )}
              <button onClick={() => removeCompetitor(comp.social_account_id)} title="Remove competitor"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#fee2e2] transition-colors text-[#9ca3af] hover:text-[#ef4444]">
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </div>
        ))
      )}

      {showAdd && (
        <CompetitorModal
          brandName={brand.name}
          competitors={brand.competitors}
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
