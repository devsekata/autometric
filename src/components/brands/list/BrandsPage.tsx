'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Brand, Platform, SocialAccount } from '@/lib/brands/types'
import BrandGroup from './BrandGroup'
import ChannelGroup from './ChannelGroup'
import StatusGroup, { AccountEntry } from './StatusGroup'
import CreateBrandModal from '../modals/CreateBrandModal'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const ACTIVE_PLATFORMS: Platform[] = ['instagram', 'tiktok', 'facebook']

type GroupBy      = 'brand' | 'channel' | 'status'
type StatusFilter = 'all' | 'connected' | 'disconnected'

interface Props {
  orgId: string
  orgName: string
  initialBrands: Brand[]
}

const GROUP_OPTIONS: { value: GroupBy; label: string; icon: string }[] = [
  { value: 'brand',   label: 'Brand',   icon: 'storefront' },
  { value: 'channel', label: 'Channel', icon: 'hub'        },
  { value: 'status',  label: 'Status',  icon: 'radio_button_checked' },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',          label: 'All'          },
  { value: 'connected',    label: 'Connected'    },
  { value: 'disconnected', label: 'Disconnected' },
]

export default function BrandsPage({ orgId, orgName, initialBrands }: Props) {
  const params  = useParams()
  const orgSlug = params?.orgSlug as string

  const [brands,          setBrands]          = useState<Brand[]>(initialBrands)
  const [showCreate,      setShowCreate]       = useState(false)
  const [search,          setSearch]           = useState('')
  const [groupBy,         setGroupBy]          = useState<GroupBy>('brand')
  const [statusFilter,    setStatusFilter]     = useState<StatusFilter>('all')
  const [showGroupMenu,   setShowGroupMenu]    = useState(false)
  const [showStatusMenu,  setShowStatusMenu]   = useState(false)

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? brands.filter(b => b.name.toLowerCase().includes(q)) : brands
  }, [brands, search])

  const totalChannels    = brands.reduce((s, b) => s + b.accounts.filter(a => ACTIVE_PLATFORMS.includes(a.platform)).length, 0)
  const totalCompetitors = brands.reduce((s, b) => s + b.competitors.length, 0)
  const totalConnected   = brands.reduce((s, b) => s + b.accounts.filter(a => ACTIVE_PLATFORMS.includes(a.platform) && a.connected).length, 0)

  const connectedEntries = useMemo<AccountEntry[]>(() =>
    filteredBrands.flatMap(b =>
      b.accounts.filter(a => ACTIVE_PLATFORMS.includes(a.platform) && a.connected).map(a => ({ brand: b, account: a }))
    ), [filteredBrands])

  const disconnectedEntries = useMemo<AccountEntry[]>(() =>
    filteredBrands.flatMap(b =>
      b.accounts.filter(a => ACTIVE_PLATFORMS.includes(a.platform) && !a.connected).map(a => ({ brand: b, account: a }))
    ), [filteredBrands])

  const currentGroup  = GROUP_OPTIONS.find(o => o.value === groupBy)!
  const currentStatus = STATUS_OPTIONS.find(o => o.value === statusFilter)!

  const hasFilter = search || statusFilter !== 'all'

  return (
    <div className="min-h-screen bg-white">

      {/* ── Page header ── */}
      <div className="px-6 pt-7 pb-5 border-b border-[#f0f0f0]">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={PJB} className="text-[22px] font-bold text-[#111827] tracking-tight">Brands</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {[
                { val: brands.length,    label: 'brands'      },
                { val: totalChannels,    label: 'channels'    },
                { val: totalCompetitors, label: 'competitors' },
              ].map((s, i) => (
                <span key={i} className="flex items-center gap-1 text-[12.5px] text-[#9ca3af]">
                  {i > 0 && <span className="text-[#e5e7eb] mr-1">·</span>}
                  <span style={PJB} className="font-bold text-[#374151]">{s.val}</span> {s.label}
                </span>
              ))}
              <span className="text-[#e5e7eb]">·</span>
              <span className="flex items-center gap-1 text-[12.5px] text-[#9ca3af]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                <span style={PJB} className="font-bold text-[#374151]">{totalConnected}</span> connected
              </span>
            </div>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            style={PJB}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-[#1B8A80] hover:bg-[#177A70] transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Brand
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#ebebeb] px-6 py-2 flex items-center gap-2 flex-wrap">

        {/* Group By pill */}
        <div className="relative">
          <button
            onClick={() => { setShowGroupMenu(m => !m); setShowStatusMenu(false) }}
            style={PJB}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-md border text-[12.5px] font-medium transition-colors ${
              showGroupMenu ? 'border-[#1B8A80] bg-[#f0f7fa] text-[#1B8A80]' : 'border-[#e5e7eb] bg-white text-[#374151] hover:bg-[#f9fafb]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">{currentGroup.icon}</span>
            Group: {currentGroup.label}
            <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">arrow_drop_down</span>
          </button>

          {showGroupMenu && (
            <div className="absolute left-0 top-[calc(100%+4px)] bg-white border border-[#e5e7eb] rounded-lg shadow-lg py-1 z-20 min-w-[150px]">
              {GROUP_OPTIONS.map(o => (
                <button key={o.value} onClick={() => { setGroupBy(o.value); setShowGroupMenu(false) }}
                  style={PJB}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-medium text-left transition-colors ${
                    groupBy === o.value ? 'bg-[#f0f7fa] text-[#1B8A80]' : 'text-[#374151] hover:bg-[#f9fafb]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">{o.icon}</span>
                  {o.label}
                  {groupBy === o.value && <span className="material-symbols-outlined text-[13px] ml-auto">check</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status pill (hidden when group by status) */}
        {groupBy !== 'status' && (
          <div className="relative">
            <button
              onClick={() => { setShowStatusMenu(m => !m); setShowGroupMenu(false) }}
              style={PJB}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-md border text-[12.5px] font-medium transition-colors ${
                statusFilter !== 'all' || showStatusMenu
                  ? 'border-[#1B8A80] bg-[#f0f7fa] text-[#1B8A80]'
                  : 'border-[#e5e7eb] bg-white text-[#374151] hover:bg-[#f9fafb]'
              }`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: statusFilter === 'connected' ? '#10b981' : statusFilter === 'disconnected' ? '#ef4444' : '#d1d5db' }} />
              {currentStatus.label}
              <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">arrow_drop_down</span>
            </button>

            {showStatusMenu && (
              <div className="absolute left-0 top-[calc(100%+4px)] bg-white border border-[#e5e7eb] rounded-lg shadow-lg py-1 z-20 min-w-[150px]">
                {STATUS_OPTIONS.map(o => (
                  <button key={o.value} onClick={() => { setStatusFilter(o.value); setShowStatusMenu(false) }}
                    style={PJB}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-medium text-left transition-colors ${
                      statusFilter === o.value ? 'bg-[#f0f7fa] text-[#1B8A80]' : 'text-[#374151] hover:bg-[#f9fafb]'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: o.value === 'connected' ? '#10b981' : o.value === 'disconnected' ? '#ef4444' : '#d1d5db' }} />
                    {o.label}
                    {statusFilter === o.value && <span className="material-symbols-outlined text-[13px] ml-auto">check</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {hasFilter && (
          <button onClick={() => { setSearch(''); setStatusFilter('all') }}
            style={PJB} className="flex items-center gap-1 h-8 px-2.5 text-[12px] font-medium text-[#9ca3af] hover:text-[#374151] hover:bg-[#f9fafb] rounded-md transition-colors">
            <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
            Clear
          </button>
        )}

        {/* Search — pojok kanan */}
        <div className="relative ml-auto">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-[#c4c9d4] pointer-events-none">search</span>
          <input type="text" placeholder="Search brands…" value={search} onChange={e => setSearch(e.target.value)}
            style={PJB}
            className="h-8 w-[200px] pl-8 pr-3 text-[12.5px] border border-[#e5e7eb] rounded-md bg-white focus:outline-none focus:border-[#1B8A80] focus:ring-1 focus:ring-[#1B8A80]/20 placeholder:text-[#d1d5db] transition"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#374151]">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div
        className="relative"
        onClick={() => { setShowGroupMenu(false); setShowStatusMenu(false) }}
      >
        {brands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32">
            <span className="material-symbols-outlined text-[48px] text-[#e5e7eb] mb-4">storefront</span>
            <p style={PJB} className="text-[16px] font-bold text-[#374151]">No brands yet</p>
            <p className="text-[13px] text-[#9ca3af] mt-1 mb-5">Create your first brand to start tracking</p>
            <button onClick={() => setShowCreate(true)} style={PJB}
              className="flex items-center gap-1.5 h-9 px-4 bg-[#1B8A80] hover:bg-[#177A70] text-white text-[13px] font-semibold rounded-lg transition-colors">
              <span className="material-symbols-outlined text-[15px]">add</span>
              New Brand
            </button>
          </div>
        ) : filteredBrands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28">
            <span className="material-symbols-outlined text-[40px] text-[#e5e7eb] mb-3">search_off</span>
            <p style={PJB} className="text-[14px] font-bold text-[#374151]">No results</p>
            <p className="text-[12.5px] text-[#9ca3af] mt-1">Try adjusting your search or filters</p>
          </div>
        ) : groupBy === 'brand' ? (
          filteredBrands.map(brand => (
            <BrandGroup key={brand.id} brand={brand} orgSlug={orgSlug} statusFilter={statusFilter} defaultOpen={false}
              onAccountAdded={(brandId, account) => {
                setBrands(prev => prev.map(b =>
                  b.id === brandId
                    ? { ...b, profile_url: b.profile_url ?? account.avatar_url, accounts: [...b.accounts, account] }
                    : b
                ))
              }}
            />
          ))
        ) : groupBy === 'channel' ? (
          ACTIVE_PLATFORMS.map(platform => {
            const brandsOnPlatform = filteredBrands.filter(b => b.accounts.some(a => a.platform === platform))
            if (brandsOnPlatform.length === 0) return null
            return (
              <ChannelGroup key={platform} platform={platform} brands={brandsOnPlatform}
                orgSlug={orgSlug} statusFilter={statusFilter} defaultOpen={false} />
            )
          })
        ) : (
          <>
            <StatusGroup statusType="connected"    entries={connectedEntries}    orgSlug={orgSlug} defaultOpen={false} />
            <StatusGroup statusType="disconnected" entries={disconnectedEntries} orgSlug={orgSlug} defaultOpen={false} />
          </>
        )}
      </div>

      {showCreate && (
        <CreateBrandModal orgId={orgId} onClose={() => setShowCreate(false)}
          onCreated={brand => setBrands(prev => [brand, ...prev])} />
      )}

    </div>
  )
}
