'use client'

import { useRef, useState } from 'react'
import { useBrandDetail } from './BrandDetailContext'
import { Platform } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import CompetitorModal from '../modals/CompetitorModal'
import { COMPETITOR_ADD_ENABLED } from '@/lib/featureFlags'
import { MAX_COMPETITORS_PER_PLATFORM } from '@/lib/quotas'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const ADD_DISABLED_TITLE = 'Penambahan competitor dinonaktifkan sementara'

export default function BrandCompetitorsTab() {
  const {
    brand, addCompetitor, awaitCompetitorVerification, removeCompetitor,
    competitorNotice, clearCompetitorNotice,
  } = useBrandDetail()
  const [showAdd, setShowAdd] = useState(false)
  // Ref, bukan state: dibaca dari dalam promise verifikasi yang sudah berjalan,
  // yang masih memegang closure lama dan tidak akan melihat state terbaru.
  const addOpen = useRef(false)
  const toggleAdd = (open: boolean) => { addOpen.current = open; setShowAdd(open) }

  return (
    <div className="max-w-3xl">

      {competitorNotice && (() => {
        const warn = competitorNotice.tone === 'warn'
        const c = warn
          ? { bg: 'bg-[#fffbeb]', border: 'border-[#fde68a]', icon: 'text-[#b45309]', text: 'text-[#92400e]', hover: 'hover:bg-[#fef3c7]', glyph: 'person_off' }
          : { bg: 'bg-[#f0f7f5]', border: 'border-[#cfe6e1]', icon: 'text-[#1B8A80]', text: 'text-[#22615c]', hover: 'hover:bg-[#e2efec]', glyph: 'schedule' }
        return (
          <div className={`flex items-start gap-2.5 mt-4 px-4 py-3 ${c.bg} border ${c.border} rounded-lg`}>
            <span className={`material-symbols-outlined text-[18px] ${c.icon} flex-shrink-0`}>{c.glyph}</span>
            <p className={`text-[12.5px] ${c.text} flex-1 leading-relaxed`}>{competitorNotice.text}</p>
            <button onClick={clearCompetitorNotice} title="Tutup"
              className={`w-6 h-6 flex items-center justify-center rounded ${c.icon} ${c.hover} flex-shrink-0`}>
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )
      })()}

      <div className="flex items-center justify-between py-4 border-b border-[#e5e7eb]">
        <div>
          <h2 style={PJB} className="text-[14px] font-bold text-[#111827]">Competitors</h2>
          <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
            {brand.competitors.length === 0
              ? `No competitors tracked yet. Up to ${MAX_COMPETITORS_PER_PLATFORM} per platform.`
              : `Tracking ${brand.competitors.length} competitor account${brand.competitors.length !== 1 ? 's' : ''} · max ${MAX_COMPETITORS_PER_PLATFORM} per platform.`}
          </p>
        </div>
        <button onClick={() => COMPETITOR_ADD_ENABLED && toggleAdd(true)} disabled={!COMPETITOR_ADD_ENABLED} style={PJB}
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
          <button onClick={() => COMPETITOR_ADD_ENABLED && toggleAdd(true)} disabled={!COMPETITOR_ADD_ENABLED} style={PJB}
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
              {comp.verification_status === 'pending' ? (
                <p className="flex items-center gap-1 text-[12px] text-[#9ca3af] mt-0.5">
                  <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
                  Memverifikasi akun…
                </p>
              ) : (
                <p className="text-[12px] text-[#9ca3af] mt-0.5 capitalize">{comp.platform}</p>
              )}
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
          onClose={() => toggleAdd(false)}
          // Modal yang menutup dirinya sendiri: hanya dia yang tahu apakah
          // hasilnya layak ditutup ('verified'/'timeout') atau harus tetap
          // terbuka supaya username-nya diperbaiki ('not_found').
          onAdded={async (platform: Platform, username: string) => {
            const comp = await addCompetitor(platform, username)
            // Akun yang sudah pernah di-sync langsung 'verified' — tidak ada
            // yang perlu ditunggu.
            if (comp.verification_status !== 'pending') return 'verified'
            return awaitCompetitorVerification(comp, () => addOpen.current)
          }}
        />
      )}
    </div>
  )
}
