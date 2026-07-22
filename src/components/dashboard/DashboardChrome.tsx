'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import BrandSwitcher from './BrandSwitcher'
import BrandAvatar from './BrandAvatar'
import {
  PLATFORM_META, PLATFORM_FILTERS, PERIODS, fmtNum, fmtRangeLabel,
  type PlatformFilter, type Period, type DashBrand,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const DATE_INPUT =
  'text-[12px] font-semibold text-[#374151] bg-white border border-[#e5e7eb] rounded-lg px-2.5 py-2 cursor-pointer hover:border-[#d1d5db] outline-none [color-scheme:light]'

const platformParam = (p: PlatformFilter) => (p === 'All' ? 'all' : p)

// Default custom range = last 30 days of available data, clamped to the earliest
// date present (so short-history brands don't start before their first datapoint).
function defaultRange(min: string, max: string): { start: string; end: string } {
  const end = new Date(max + 'T00:00:00Z')
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 29)
  const minD = new Date(min + 'T00:00:00Z')
  return { start: start < minD ? min : start.toISOString().slice(0, 10), end: max }
}

// Dashboard filter selection persisted across all tabs of one org via localStorage.
// Picking a brand/platform/period on any tab carries to the sibling tabs (each tab
// is a separate route that would otherwise reset to the first brand) and survives a
// refresh. Keyed by org slug so different orgs don't cross-contaminate.
interface SavedFilters {
  brandId?: string
  platform?: PlatformFilter
  period?: Period
  customStart?: string
  customEnd?: string
}
const FILTER_KEY = (slug: string) => `autometric:dashboard-filters:${slug}`

function readFilters(slug: string): SavedFilters | null {
  if (typeof window === 'undefined' || !slug) return null
  try {
    const raw = window.localStorage.getItem(FILTER_KEY(slug))
    return raw ? (JSON.parse(raw) as SavedFilters) : null
  } catch { return null }
}
function writeFilters(slug: string, f: SavedFilters) {
  if (typeof window === 'undefined' || !slug) return
  try { window.localStorage.setItem(FILTER_KEY(slug), JSON.stringify(f)) } catch { /* quota / private mode — ignore */ }
}

export interface ChromeState {
  brand: DashBrand
  platform: PlatformFilter
  period: Period
  start: string | null   // custom-range start (YYYY-MM-DD); null unless period === 'Custom'
  end: string | null     // custom-range end (YYYY-MM-DD); null unless period === 'Custom'
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
  const pathname = usePathname()
  const orgSlug = pathname?.split('/').filter(Boolean)[1] ?? '' // /organizations/<slug>/dashboard/...

  const [platform, setPlatform] = useState<PlatformFilter>('All')
  const [period, setPeriod] = useState<Period>('30 days')
  const [brands, setBrands] = useState<DashBrand[] | null>(null)
  const [brand, setBrand] = useState<DashBrand | null>(null)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null)
  // Brand id restored from localStorage; applied once the brands list arrives.
  const wantBrandId = useRef<string | null>(null)

  // Restore the shared selection on mount / org change. Runs before the brands
  // fetch resolves, so wantBrandId is ready when the list comes back.
  useEffect(() => {
    const saved = readFilters(orgSlug)
    wantBrandId.current = saved?.brandId ?? null
    if (saved?.platform && PLATFORM_FILTERS.includes(saved.platform)) setPlatform(saved.platform)
    if (saved?.period && PERIODS.includes(saved.period)) setPeriod(saved.period)
    if (saved?.customStart) setCustomStart(saved.customStart)
    if (saved?.customEnd) setCustomEnd(saved.customEnd)
  }, [orgSlug])

  useEffect(() => {
    if (!orgSlug) return
    let cancelled = false
    fetch(`/api/dashboard/brands?org=${encodeURIComponent(orgSlug)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { brands: DashBrand[] }) => {
        if (cancelled) return
        setBrands(d.brands)
        // prefer the brand carried over from another tab, else the first brand
        setBrand(prev => prev ?? d.brands.find(b => b.id === wantBrandId.current) ?? d.brands[0] ?? null)
      })
      .catch(() => { if (!cancelled) setBrands([]) })
    return () => { cancelled = true }
  }, [orgSlug])

  // Earliest/latest metric_date for the current brand + platform, so the custom
  // picker can't select empty days. Refetched when the scope changes; the range is
  // seeded to a sensible default and re-clamped if it falls outside the new bounds.
  const brandId = brand?.id
  useEffect(() => {
    if (!orgSlug || !brandId) { setBounds(null); return }
    let cancelled = false
    const q = new URLSearchParams({ org: orgSlug, brand: brandId, platform: platformParam(platform) })
    fetch(`/api/dashboard/date-range?${q.toString()}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { min: string | null; max: string | null }) => {
        if (cancelled) return
        if (d.min && d.max) {
          const { min, max } = d as { min: string; max: string }
          setBounds({ min, max })
          const def = defaultRange(min, max)
          setCustomStart(s => (s && s >= min && s <= max ? s : def.start))
          setCustomEnd(e => (e && e >= min && e <= max ? e : def.end))
        } else {
          setBounds(null)
        }
      })
      .catch(() => { if (!cancelled) setBounds(null) })
    return () => { cancelled = true }
  }, [orgSlug, brandId, platform])

  // Persist the selection so sibling tabs (and a refresh) pick up the same filters.
  useEffect(() => {
    if (!orgSlug || !brand) return
    writeFilters(orgSlug, { brandId: brand.id, platform, period, customStart, customEnd })
  }, [orgSlug, brand, platform, period, customStart, customEnd])

  // Custom range is active only when the user is on "Custom" and both ends are set.
  const customActive = period === 'Custom' && !!customStart && !!customEnd
  const start = customActive ? customStart : null
  const end = customActive ? customEnd : null

  return (
    <div className="min-h-screen bg-[#f7f8f9]">
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-[#e5e7eb] px-7 py-3.5 flex items-center justify-between">
        <div>
          <h1 style={PJ} className="text-[17px] font-bold text-[#111827] tracking-[-0.02em] leading-none">{title}</h1>
          <p className="text-[11px] text-[#9ca3af] mt-1">{subtitle} · {customActive ? fmtRangeLabel(customStart, customEnd) : `last ${period}`}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-[#f3f4f6] rounded-lg p-0.5">
            {PLATFORM_FILTERS.map(p => {
              const active = platform === p
              return (
                <button key={p} onClick={() => setPlatform(p)} style={PJ} title={p === 'All' ? 'All platforms' : PLATFORM_META[p].label}
                  className={`flex items-center justify-center h-7 rounded-md text-[12px] font-semibold transition-colors ${
                    p === 'All' ? 'px-3' : 'w-9'
                  } ${active ? 'bg-white text-[#2C3079] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'}`}>
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
          {period === 'Custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customStart} min={bounds?.min} max={customEnd || bounds?.max}
                onChange={e => setCustomStart(e.target.value)} style={PJ} className={DATE_INPUT} title="Dari tanggal" />
              <span className="text-[12px] text-[#9ca3af]">–</span>
              <input type="date" value={customEnd} min={customStart || bounds?.min} max={bounds?.max}
                onChange={e => setCustomEnd(e.target.value)} style={PJ} className={DATE_INPUT} title="Sampai tanggal" />
            </div>
          )}
          <button className="w-9 h-9 flex items-center justify-center bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:text-[#1B8A80] hover:border-[#d1d5db] transition-colors">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </header>

      <div className="px-7 py-6">
        {!brand ? (
          brands === null ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <span className="material-symbols-outlined text-[34px] text-[#cbd1d8] animate-spin mb-2">progress_activity</span>
              <p className="text-[13px] text-[#9ca3af]">Memuat brand…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <span className="material-symbols-outlined text-[40px] text-[#d1d5db] mb-2">storefront</span>
              <p className="text-[13px] text-[#6b7280]">Belum ada brand di organisasi ini.</p>
            </div>
          )
        ) : (
          <>
            <div className="mb-6">
              <BrandSwitcher value={brand} brands={brands ?? []} onChange={setBrand}>
            <div className="group flex items-center gap-4 pr-3 py-1">
              <BrandAvatar logo={brand.logo} initials={brand.initials} color={brand.color} name={brand.name}
                className="w-14 h-14 rounded-2xl" textClass="text-[19px]" />
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

            {children({ brand, platform, period, start, end })}
          </>
        )}
      </div>
    </div>
  )
}
