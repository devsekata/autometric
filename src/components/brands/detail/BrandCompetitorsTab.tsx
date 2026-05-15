'use client'

import { useState } from 'react'
import { useBrandDetail } from './BrandDetailContext'
import { PLATFORM_CONFIG } from '@/lib/brands/types'
import CompetitorModal from '../modals/CompetitorModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function BrandCompetitorsTab() {
  const { brand, addCompetitor, removeCompetitor } = useBrandDetail()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="max-w-3xl">

      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Competitors</h2>
          <p className="text-[13px] text-[#6b7280] mt-0.5">
            {brand.competitors.length === 0
              ? 'No competitors tracked yet.'
              : `Tracking ${brand.competitors.length} competitor${brand.competitors.length !== 1 ? 's' : ''}.`}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={PJB}
          className="flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors shadow-[0_2px_8px_rgba(61,126,150,0.22)]"
        >
          <span className="material-symbols-outlined text-[15px]">add</span>
          Add Competitor
        </button>
      </div>

      {/* Competitor list */}
      {brand.competitors.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-[#e5e7eb] rounded-xl flex flex-col items-center justify-center py-16 gap-3">
          <span className="material-symbols-outlined text-[44px] text-[#d1d5db]">flag</span>
          <p style={PJB} className="text-[15px] font-bold text-[#374151]">No competitors yet</p>
          <p className="text-[13px] text-[#6b7280]">Track competitors to benchmark your brand's performance</p>
          <button
            onClick={() => setShowAdd(true)}
            style={PJB}
            className="mt-1 flex items-center gap-1.5 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">add</span>
            Add Competitor
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {brand.competitors.map(comp => {
            const initials = comp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
            return (
              <div key={comp.id} className="bg-white border border-[#e5e7eb] rounded-xl px-5 py-4 flex items-start gap-4 group hover:border-[#c5dce5] hover:shadow-sm transition-all">
                {/* Avatar */}
                <div
                  style={{ width: 40, height: 40, background: comp.color, borderRadius: '50%', fontSize: 13, flexShrink: 0 }}
                  className="flex items-center justify-center font-bold text-white leading-none"
                >
                  {initials}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p style={PJB} className="text-[14px] font-bold text-[#111827]">{comp.name}</p>

                  {comp.accounts.length === 0 ? (
                    <p className="text-[12.5px] text-[#6b7280] mt-1">No accounts added</p>
                  ) : (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {comp.accounts.map((a, i) => {
                        const cfg = PLATFORM_CONFIG[a.platform]
                        return (
                          <div key={i} className="flex items-center gap-1.5">
                            <div
                              style={{ width: 18, height: 18, borderRadius: 4, background: cfg.bg, fontSize: 7, fontWeight: 900, color: cfg.textColor, flexShrink: 0 }}
                              className="flex items-center justify-center leading-none"
                            >
                              {cfg.short}
                            </div>
                            <span className="text-[12.5px] text-[#374151]">{a.handle}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Remove */}
                <button
                  onClick={() => removeCompetitor(comp.id)}
                  title="Remove competitor"
                  className="w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] transition-all text-[#9ca3af] hover:text-[#ef4444] flex-shrink-0"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <CompetitorModal
          brandName={brand.name}
          onClose={() => setShowAdd(false)}
          onAdded={comp => { addCompetitor(comp); setShowAdd(false) }}
        />
      )}
    </div>
  )
}
