'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Brand, PLATFORM_CONFIG } from '@/lib/brands/types'
import CreateBrandModal from '../modals/CreateBrandModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function BrandAvatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div
      style={{ width: 32, height: 32, background: color, borderRadius: 9, fontSize: 12 }}
      className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none"
    >
      {initials}
    </div>
  )
}

function PlatformIcon({ platform }: { platform: Brand['accounts'][0]['platform'] }) {
  const cfg = PLATFORM_CONFIG[platform]
  return (
    <div
      title={cfg.label}
      style={{ width: 22, height: 22, borderRadius: 5, background: cfg.bg, fontSize: 7.5, fontWeight: 900, color: cfg.textColor }}
      className="flex items-center justify-center leading-none select-none flex-shrink-0"
    >
      {cfg.short}
    </div>
  )
}

function CompetitorDot({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div
      title={name}
      style={{ width: 22, height: 22, background: color, fontSize: 8 }}
      className="rounded-full flex items-center justify-center font-bold text-white leading-none border-2 border-white flex-shrink-0"
    >
      {initials}
    </div>
  )
}

function StatusBadge({ accounts }: { accounts: Brand['accounts'] }) {
  if (accounts.length === 0) {
    return (
      <span
        style={PJB}
        className="inline-flex items-center gap-1 h-[22px] px-2.5 rounded-full text-[10.5px] font-semibold bg-[#f3f4f6] text-[#9ca3af]"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#d1d5db] flex-shrink-0" />
        No accounts
      </span>
    )
  }
  return (
    <span
      style={PJB}
      className="inline-flex items-center gap-1 h-[22px] px-2.5 rounded-full text-[10.5px] font-semibold bg-[#ecfdf5] text-[#059669]"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0" />
      Active
    </span>
  )
}

interface Props {
  orgId: string
  orgName: string
  initialBrands: Brand[]
}

export default function BrandsPage({ orgId, orgName, initialBrands }: Props) {
  const params = useParams()
  const orgSlug = params?.orgSlug as string
  const [brands, setBrands] = useState<Brand[]>(initialBrands)
  const [showCreate, setShowCreate] = useState(false)

  const totalAccounts    = brands.reduce((s, b) => s + b.accounts.length, 0)
  const totalCompetitors = brands.reduce((s, b) => s + b.competitors.length, 0)
  const totalFollowers   = brands.reduce((s, b) => s + b.accounts.reduce((ss, a) => ss + a.followers, 0), 0)

  return (
    <div>

      {/* ── Header ── */}
      <div className="bg-white px-8 pt-8 pb-6 border-b border-[#e5e7eb]">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={PJB} className="text-[26px] font-bold text-[#111827] tracking-[-0.03em] leading-none">
              Brands
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{brands.length}</span> brands
              </span>
              <span className="text-[#d1d5db] select-none">·</span>
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{fmt(totalFollowers)}</span> total followers
              </span>
              <span className="text-[#d1d5db] select-none">·</span>
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{totalAccounts}</span> accounts
              </span>
              <span className="text-[#d1d5db] select-none">·</span>
              <span className="text-[13px] text-[#9ca3af]">
                <span style={PJB} className="font-bold text-[#374151]">{totalCompetitors}</span> competitors
              </span>
            </div>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            style={PJB}
            className="flex items-center gap-2 h-10 px-5 bg-[#3d7e96] hover:bg-[#2d6e85] active:bg-[#1e6278] text-white text-[13.5px] font-semibold rounded-lg transition-colors shadow-[0_2px_10px_rgba(61,126,150,0.28)]"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Brand
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="px-8 pt-6 pb-10">
        {brands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <span className="material-symbols-outlined text-[52px] text-[#d1d5db] mb-4">storefront</span>
            <p style={PJB} className="text-[17px] font-bold text-[#374151]">No brands yet</p>
            <p className="text-[13px] text-[#9ca3af] mt-1 mb-6">Create your first brand to start tracking performance</p>
            <button
              onClick={() => setShowCreate(true)}
              style={PJB}
              className="flex items-center gap-2 h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-semibold rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              New Brand
            </button>
          </div>
        ) : (
          <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">

            {/* Table head */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] bg-[#f9fafb] border-b-2 border-[#e5e7eb] px-5 py-2.5">
              {['Brand', 'Total Followers', 'Platforms', 'Competitors', 'Created', 'Status'].map((h, i) => (
                <span key={i} style={PJB} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">
                  {h}
                </span>
              ))}
            </div>

            {/* Table rows */}
            {brands.map((brand, idx) => {
              const brandFollowers = brand.accounts.reduce((s, a) => s + a.followers, 0)
              return (
                <Link
                  key={brand.id}
                  href={`/organizations/${orgSlug}/brands/${brand.id}/overview`}
                  className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center px-5 py-3.5 hover:bg-[#f5fafc] transition-colors group ${
                    idx < brands.length - 1 ? 'border-b border-[#f3f4f6]' : ''
                  }`}
                >
                  {/* Brand */}
                  <div className="flex items-center gap-3 min-w-0 pr-6">
                    <BrandAvatar name={brand.name} color={brand.color} />
                    <span style={PJB} className="text-[13.5px] font-semibold text-[#111827] truncate group-hover:text-[#3d7e96] transition-colors">
                      {brand.name}
                    </span>
                  </div>

                  {/* Total Followers */}
                  <div className="pr-4">
                    {brandFollowers === 0 ? (
                      <span className="text-[13px] text-[#6b7280]">—</span>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span style={PJB} className="text-[14px] font-bold text-[#111827] tabular-nums leading-none">
                          {fmt(brandFollowers)}
                        </span>
                        <span className="text-[10px] text-[#6b7280]">followers</span>
                      </div>
                    )}
                  </div>

                  {/* Platforms */}
                  <div className="flex items-center gap-1 pr-4">
                    {brand.accounts.length === 0 ? (
                      <span className="text-[13px] text-[#6b7280]">—</span>
                    ) : (
                      <>
                        {brand.accounts.slice(0, 4).map(acc => (
                          <PlatformIcon key={acc.id} platform={acc.platform} />
                        ))}
                        {brand.accounts.length > 4 && (
                          <span className="text-[11px] font-semibold text-[#6b7280] ml-0.5">
                            +{brand.accounts.length - 4}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {/* Competitors */}
                  <div className="flex items-center gap-1 pr-4">
                    {brand.competitors.length === 0 ? (
                      <span className="text-[13px] text-[#6b7280]">—</span>
                    ) : (
                      <>
                        <div className="flex -space-x-1.5">
                          {brand.competitors.slice(0, 4).map(c => (
                            <CompetitorDot key={c.id} name={c.name} color={c.color} />
                          ))}
                        </div>
                        {brand.competitors.length > 4 && (
                          <span className="text-[11px] font-semibold text-[#6b7280] ml-1">
                            +{brand.competitors.length - 4}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {/* Created */}
                  <span style={PJB} className="text-[12.5px] font-medium text-[#374151] tabular-nums pr-4">
                    {formatDate(brand.created_at)}
                  </span>

                  {/* Status */}
                  <div>
                    <StatusBadge accounts={brand.accounts} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showCreate && (
        <CreateBrandModal
          orgId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={brand => setBrands(prev => [brand, ...prev])}
        />
      )}

    </div>
  )
}
