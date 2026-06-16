'use client'

import { useState } from 'react'
import BrandSwitcher from './BrandSwitcher'
import {
  BRANDS, PLATFORM_META, PLATFORM_FILTERS, PERIODS, fmtNum,
  type PlatformFilter, type Period, type DashBrand,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export interface ChromeState {
  brand: DashBrand
  platform: PlatformFilter
  period: Period
}

/**
 * Shared shell for every dashboard tab: sticky topbar (title + platform switcher +
 * period + refresh) and the clickable brand hero. Owns brand/platform/period state
 * and hands it to the page via a render-prop child.
 */
export default function DashboardChrome({ title, subtitle, children }: {
  title: string
  subtitle: string
  children: (state: ChromeState) => React.ReactNode
}) {
  const [platform, setPlatform] = useState<PlatformFilter>('All')
  const [period, setPeriod] = useState<Period>('30 days')
  const [brand, setBrand] = useState(BRANDS[0])

  return (
    <div className="min-h-screen bg-[#f7f8f9]">
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-[#e5e7eb] px-7 py-3.5 flex items-center justify-between">
        <div>
          <h1 style={PJ} className="text-[17px] font-bold text-[#111827] tracking-[-0.02em] leading-none">{title}</h1>
          <p className="text-[11px] text-[#9ca3af] mt-1">{subtitle} · last {period}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-[#f3f4f6] rounded-lg p-0.5">
            {PLATFORM_FILTERS.map(p => {
              const active = platform === p
              return (
                <button key={p} onClick={() => setPlatform(p)} style={PJ} title={p === 'All' ? 'All platforms' : PLATFORM_META[p].label}
                  className={`flex items-center justify-center h-7 rounded-md text-[12px] font-semibold transition-colors ${
                    p === 'All' ? 'px-3' : 'w-9'
                  } ${active ? 'bg-white text-[#1e4f49] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'}`}>
                  {p === 'All'
                    ? 'All'
                    : <img src={PLATFORM_META[p].logo} alt={PLATFORM_META[p].label}
                        className={`w-[17px] h-[17px] object-contain transition-opacity ${active ? 'opacity-100' : 'opacity-55'}`} />}
                </button>
              )
            })}
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value as Period)} style={PJ}
            className="text-[12px] font-semibold text-[#374151] bg-white border border-[#e5e7eb] rounded-lg px-3 py-2 cursor-pointer hover:border-[#d1d5db] outline-none">
            {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="w-9 h-9 flex items-center justify-center bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:text-[#3d7e96] hover:border-[#d1d5db] transition-colors">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </header>

      <div className="px-7 py-6">
        <div className="mb-6">
          <BrandSwitcher value={brand} onChange={setBrand}>
            <div className="group flex items-center gap-4 pr-3 py-1">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-[19px] font-bold flex-shrink-0"
                style={{ background: brand.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {brand.initials}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 style={PJ} className="text-[24px] font-bold text-[#111827] tracking-[-0.03em] leading-none">{brand.name}</h2>
                  <div className="flex items-center gap-1.5">
                    {brand.platforms.map(p => (
                      <img key={p} src={PLATFORM_META[p].logo} alt={PLATFORM_META[p].label}
                        className="w-[18px] h-[18px] object-contain" title={PLATFORM_META[p].label} />
                    ))}
                  </div>
                  <span className="material-symbols-outlined text-[20px] text-[#cbd1d8] group-hover:text-[#9ca3af] transition-colors">unfold_more</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[12.5px] text-[#6b7280] font-medium">{brand.handle}</span>
                  <span className="text-[#d1d5db]">·</span>
                  <span className="text-[12.5px] text-[#6b7280]">
                    <span style={PJ} className="font-bold text-[#374151]">{fmtNum(brand.followers)}</span> followers
                  </span>
                </div>
              </div>
            </div>
          </BrandSwitcher>
        </div>

        {children({ brand, platform, period })}
      </div>
    </div>
  )
}
