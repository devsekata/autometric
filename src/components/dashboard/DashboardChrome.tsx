'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import BrandSwitcher from './BrandSwitcher'
import BrandAvatar from './BrandAvatar'
import DateRangePicker, {
  fmtSelection, isRangeMode, resolveSelection, withResolved,
  MODE_LABEL, type DateSelection,
} from './DateRangePicker'
import {
  PLATFORM_META, PLATFORM_FILTERS, fmtNum,
  type PlatformFilter, type Period, type DashBrand,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

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
// Picking a brand/platform/range on any tab carries to the sibling tabs (each tab
// is a separate route that would otherwise reset to the first brand) and survives a
// refresh. Keyed by org slug so different orgs don't cross-contaminate.
interface SavedFilters {
  brandId?: string
  platform?: PlatformFilter
  range?: DateSelection
  // Pre-picker shape, still read so an existing localStorage entry doesn't reset
  // the user's dates on first load after deploy. Never written again.
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

const LEGACY_MODE: Record<string, DateSelection['mode']> = {
  '7 days': 'last_7', '30 days': 'last_30', '90 days': 'last_90',
}

// Recover a selection from a stored entry — new shape first, then the old
// period/customStart/customEnd trio. Returns null when there is nothing usable,
// which lets the bounds fetch seed the default instead.
function savedSelection(f: SavedFilters | null): DateSelection | null {
  if (!f) return null
  if (f.range && isRangeMode(f.range.mode)) {
    const r = f.range
    // A relative mode is re-resolved on read: a remembered "Last 7 days" has to
    // mean the last 7 days *now*, not the week it was saved.
    if (r.mode !== 'fixed') return withResolved(r)
    if (r.start && r.end) return { mode: 'fixed', start: r.start, end: r.end }
  }
  if (f.period === 'Custom' && f.customStart && f.customEnd) {
    return { mode: 'fixed', start: f.customStart, end: f.customEnd }
  }
  const legacy = f.period && LEGACY_MODE[f.period]
  return legacy ? withResolved({ mode: legacy, start: '', end: '' }) : null
}

export interface ChromeState {
  brand: DashBrand
  platform: PlatformFilter
  /**
   * Always 'Custom' now — every selection resolves to explicit dates, and the
   * API prefers ?start/&end over this label (see parseCustomRange in
   * src/lib/dashboard/range.ts). Kept so the tabs' query builders don't change.
   */
  period: Period
  start: string | null   // resolved range start (YYYY-MM-DD)
  end: string | null     // resolved range end (YYYY-MM-DD)
}

/**
 * Shared shell for every dashboard tab: sticky topbar (title + platform switcher +
 * date range + refresh) and the clickable brand hero. Owns brand/platform/range
 * state and hands the resolved dates to the page via a render-prop child.
 */
export default function DashboardChrome({ title, subtitle, children }: {
  title: string
  subtitle: string
  children: (state: ChromeState) => React.ReactNode
}) {
  const pathname = usePathname()
  const orgSlug = pathname?.split('/').filter(Boolean)[1] ?? '' // /organizations/<slug>/dashboard/...

  const [platform, setPlatform] = useState<PlatformFilter>('All')
  const [brands, setBrands] = useState<DashBrand[] | null>(null)
  const [brand, setBrand] = useState<DashBrand | null>(null)
  const [range, setRange] = useState<DateSelection | null>(null)
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null)
  // Brand id restored from localStorage; applied once the brands list arrives.
  const wantBrandId = useRef<string | null>(null)
  // True once the range came from the user (restored pick or a fresh one), which
  // stops the bounds fetch from reseeding over a deliberate choice.
  const rangeChosen = useRef(false)

  // Restore the shared selection on mount / org change. Runs before the brands
  // fetch resolves, so wantBrandId is ready when the list comes back.
  useEffect(() => {
    const saved = readFilters(orgSlug)
    wantBrandId.current = saved?.brandId ?? null
    if (saved?.platform && PLATFORM_FILTERS.includes(saved.platform)) setPlatform(saved.platform)
    const restored = savedSelection(saved)
    rangeChosen.current = !!restored
    if (restored) setRange(restored)
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

  // Earliest/latest metric_date for the current brand + platform. Feeds the
  // picker's data-availability hint, and seeds the opening range for a brand the
  // user hasn't picked dates for yet: the last 30 days that actually have data,
  // rather than the last 30 calendar days, so a brand whose scrape lags doesn't
  // open on an empty dashboard.
  const brandId = brand?.id
  useEffect(() => {
    if (!orgSlug || !brandId) { setBounds(null); return }
    let cancelled = false
    const q = new URLSearchParams({ org: orgSlug, brand: brandId, platform: platformParam(platform) })
    fetch(`/api/dashboard/date-range?${q.toString()}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { min: string | null; max: string | null }) => {
        if (cancelled) return
        if (!d.min || !d.max) { setBounds(null); seedFallback(); return }
        const { min, max } = d as { min: string; max: string }
        setBounds({ min, max })
        const def = defaultRange(min, max)
        setRange(prev => {
          if (!prev || !rangeChosen.current) return { mode: 'fixed', ...def }
          if (prev.mode !== 'fixed') return prev // relative modes follow the calendar, not the data
          const start = prev.start >= min && prev.start <= max ? prev.start : def.start
          const end = prev.end >= min && prev.end <= max ? prev.end : def.end
          return start === prev.start && end === prev.end ? prev : { mode: 'fixed', start, end }
        })
      })
      .catch(() => { if (!cancelled) { setBounds(null); seedFallback() } })
    return () => { cancelled = true }
  }, [orgSlug, brandId, platform])

  // No bounds to seed from (no data, or the lookup failed) — fall back to the
  // last 30 calendar days so the tabs still get a concrete range to query.
  function seedFallback() {
    setRange(prev => prev ?? withResolved({ mode: 'last_30', start: '', end: '' }))
  }

  // Persist the selection so sibling tabs (and a refresh) pick up the same filters.
  // The auto-seeded range is deliberately left out: it is scaffolding for one
  // brand, not a choice, and storing it would make every later visit inherit that
  // brand's dates instead of opening on each brand's own latest 30 days of data.
  useEffect(() => {
    if (!orgSlug || !brand) return
    writeFilters(orgSlug, {
      brandId: brand.id,
      platform,
      ...(rangeChosen.current && range ? { range } : {}),
    })
  }, [orgSlug, brand, platform, range])

  // Relative modes are re-resolved on every render so the query dates stay right
  // even if the tab sits open past midnight.
  const resolved = range ? resolveSelection(range) : null
  const start = resolved?.start ?? null
  const end = resolved?.end ?? null

  function handleRange(next: DateSelection) {
    rangeChosen.current = true
    setRange(next)
  }

  return (
    <div className="min-h-screen bg-[#f7f8f9]">
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-[#e5e7eb] px-7 py-3.5 flex items-center justify-between">
        <div>
          <h1 style={PJ} className="text-[17px] font-bold text-[#111827] tracking-[-0.02em] leading-none">{title}</h1>
          <p className="text-[11px] text-[#9ca3af] mt-1">
            {subtitle}
            {range && resolved && ` · ${range.mode === 'fixed' ? fmtSelection(resolved.start, resolved.end) : MODE_LABEL[range.mode]}`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-[#f3f4f6] rounded-lg p-0.5">
            {PLATFORM_FILTERS.map(p => {
              const active = platform === p
              return (
                <button key={p} onClick={() => setPlatform(p)} style={PJ} title={p === 'All' ? 'All platforms' : PLATFORM_META[p].label}
                  className={`flex items-center justify-center h-7 rounded-md text-[12px] font-semibold transition-colors ${
                    p === 'All' ? 'px-3' : 'w-9'
                  } ${active ? 'bg-white text-[#327488] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'}`}>
                  {p === 'All'
                    ? 'All'
                    : <img src={PLATFORM_META[p].logo} alt={PLATFORM_META[p].label}
                        className={`w-[17px] h-[17px] object-contain transition-opacity ${active ? 'opacity-100' : 'opacity-55'}`} />}
                </button>
              )
            })}
          </div>
          {range && <DateRangePicker value={range} onChange={handleRange} bounds={bounds} />}
          <button className="w-9 h-9 flex items-center justify-center bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:text-[#285D6E] hover:border-[#d1d5db] transition-colors">
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

            {/* Hold the tabs until the range is known — firing their fetches
                without start/end would only make the server guess a window and
                force an immediate refetch. */}
            {start && end ? (
              children({ brand, platform, period: 'Custom', start, end })
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="material-symbols-outlined text-[34px] text-[#cbd1d8] animate-spin mb-2">progress_activity</span>
                <p className="text-[13px] text-[#9ca3af]">Menyiapkan rentang tanggal…</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
