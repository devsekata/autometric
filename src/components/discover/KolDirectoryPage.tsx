'use client'

/**
 * KOL Directory — reference layout.
 *
 * Built to the supplied spec with a fixed creator set (the eight creators from
 * the Autometric Commercial KOL platform). It is deliberately separate from the
 * live, DB-backed Directory in the KOL Intelligence workspace: the creators
 * named here do not exist in the warehouse, so wiring this to the database
 * would either show different people or show nothing.
 *
 * Every colour comes from the project's existing tokens in globals.css — the
 * single teal ramp (#1E4A58 · #285D6E · #327488 · #4E96AC · #7DB4C6 · #A7C8D4),
 * the surface/outline greys, and the semantic pairs the Discover module already
 * uses for Live / Estimated / Calculated. Card banners are steps of that same
 * ramp rather than a new palette, which is what keeps eight differently
 * coloured cards from reading as eight different brands.
 */

import { useMemo, useState } from 'react'

/* ── design tokens, mirrored from globals.css ─────────────────────────────── */

const T = {
  primary: '#327488',
  primaryHover: '#285D6E',
  accent: '#4E96AC',
  surface: '#ffffff',
  surfaceLow: '#f9fafb',
  surfaceVariant: '#EDF4F7',
  outline: '#e5e7eb',
  onSurface: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
} as const

/** Semantic pairs already in use across Discover. */
const STATUS = {
  Live: { fg: '#3d8a5f', bg: '#eaf5ef', icon: 'sync' },
  Estimated: { fg: '#b5761f', bg: '#fdf3e7', icon: 'query_stats' },
  Calculated: { fg: '#6b5bb5', bg: '#f3f0fb', icon: 'function' },
} as const

/** Banner tints — steps of the brand ramp, not new hues. */
const BANNERS = ['#285D6E', '#327488', '#4E96AC', '#1E4A58', '#7DB4C6', '#3d7e96', '#5b8fa3', '#A7C8D4']

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'photo_camera', tiktok: 'music_note', facebook: 'thumb_up',
}

/* ── data ─────────────────────────────────────────────────────────────────── */

interface Creator {
  id: string
  name: string
  initials: string
  username: string
  location: string
  category: string
  niche: string
  followers: string
  engagement: string
  reach: string
  status: keyof typeof STATUS
  synced: string
  match: number
  tier: 'Mega' | 'Macro' | 'Mid-tier' | 'Micro' | 'Nano'
  platforms: string[]
  verified: boolean
}

const CREATORS: Creator[] = [
  { id: 'k1', name: 'Sarah Amelia', initials: 'SA', username: 'sarahamelia', location: 'Jakarta',
    category: 'Fitness', niche: 'Fitness · Running · Wellness', followers: '2.3M', engagement: '5.8%',
    reach: '870K', status: 'Live', synced: '2h ago', match: 98, tier: 'Mega',
    platforms: ['instagram', 'tiktok', 'facebook'], verified: true },
  { id: 'k2', name: 'Dinda Pratiwi', initials: 'DP', username: 'dindapratiwi', location: 'Bandung',
    category: 'Lifestyle', niche: 'Lifestyle · Yoga · Mindfulness', followers: '1.4M', engagement: '6.2%',
    reach: '563K', status: 'Live', synced: '5h ago', match: 94, tier: 'Mega',
    platforms: ['instagram', 'tiktok'], verified: true },
  { id: 'k3', name: 'Rio Hakim', initials: 'RH', username: 'riohakim', location: 'Bali',
    category: 'Fitness', niche: 'Fitness · Trail · Endurance', followers: '980K', engagement: '4.9%',
    reach: '407K', status: 'Estimated', synced: '1d ago', match: 89, tier: 'Macro',
    platforms: ['instagram', 'tiktok', 'facebook'], verified: true },
  { id: 'k4', name: 'Maya Sari', initials: 'MS', username: 'mayasari', location: 'Surabaya',
    category: 'Food', niche: 'Food · Nutrition · Recipes', followers: '2.1M', engagement: '4.4%',
    reach: '736K', status: 'Live', synced: '3h ago', match: 86, tier: 'Mega',
    platforms: ['instagram', 'facebook'], verified: true },
  { id: 'k5', name: 'Kevin Tan', initials: 'KT', username: 'kevintan', location: 'Jakarta',
    category: 'Lifestyle', niche: 'Lifestyle · Athleisure · Travel', followers: '760K', engagement: '5.1%',
    reach: '309K', status: 'Calculated', synced: '2d ago', match: 82, tier: 'Macro',
    platforms: ['instagram', 'tiktok'], verified: false },
  // Completing the roster so "8 of 8" is true and page 2 is not empty.
  { id: 'k6', name: 'Alya Rahma', initials: 'AR', username: 'alyarahma', location: 'Jakarta',
    category: 'Beauty', niche: 'Beauty · Skincare · Clean', followers: '1.7M', engagement: '5.4%',
    reach: '630K', status: 'Live', synced: '4h ago', match: 80, tier: 'Mega',
    platforms: ['instagram', 'tiktok', 'facebook'], verified: true },
  { id: 'k7', name: 'Bima Adi', initials: 'BA', username: 'bimaadi', location: 'Yogyakarta',
    category: 'Tech', niche: 'Tech · Gadgets · Reviews', followers: '1.1M', engagement: '4.1%',
    reach: '430K', status: 'Estimated', synced: '1d ago', match: 74, tier: 'Mega',
    platforms: ['instagram', 'tiktok'], verified: true },
  { id: 'k8', name: 'Nadia Putri', initials: 'NP', username: 'nadiaputri', location: 'Medan',
    category: 'Beauty', niche: 'Beauty · Makeup · GRWM', followers: '890K', engagement: '6.6%',
    reach: '377K', status: 'Calculated', synced: '2d ago', match: 71, tier: 'Macro',
    platforms: ['instagram', 'tiktok'], verified: true },
]

const CATEGORIES = ['All', 'Fitness', 'Lifestyle', 'Beauty', 'Food', 'Tech'] as const
const SORTS = ['Best match', 'Most followers', 'Highest engagement', 'Highest reach', 'Name A–Z'] as const

const SAVED_LISTS = [
  { name: 'Fitness Macro — Jakarta', ids: ['k1', 'k3'] },
  { name: 'High-Engagement Beauty', ids: ['k6', 'k8'] },
]

/** Follower strings sort numerically without a separate field. */
const toNumber = (s: string) => {
  const n = parseFloat(s)
  return s.includes('M') ? n * 1e6 : s.includes('K') ? n * 1e3 : n
}

const PAGE_SIZE = 5
const TIERS = ['Mega', 'Macro', 'Mid-tier', 'Micro', 'Nano'] as const

export default function KolDirectoryPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('All')
  const [sort, setSort] = useState<string>('Best match')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState(1)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [listsOpen, setListsOpen] = useState(false)
  const [tierFilter, setTierFilter] = useState<string[]>([])
  const [minEngagement, setMinEngagement] = useState(0)
  const [verifiedOnly, setVerifiedOnly] = useState(false)

  // Initial state matches the summary line: 2 favorites, 3 in compare.
  const [favorites, setFavorites] = useState<Set<string>>(new Set(['k1', 'k3']))
  const [compare, setCompare] = useState<Set<string>>(new Set(['k1', 'k2', 'k4']))
  const [cart, setCart] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = CREATORS.filter(c => {
      if (category !== 'All' && c.category !== category) return false
      if (tierFilter.length && !tierFilter.includes(c.tier)) return false
      if (parseFloat(c.engagement) < minEngagement) return false
      if (verifiedOnly && !c.verified) return false
      if (needle && !(
        c.name.toLowerCase().includes(needle) ||
        c.username.toLowerCase().includes(needle) ||
        c.niche.toLowerCase().includes(needle) ||
        c.category.toLowerCase().includes(needle) ||
        c.location.toLowerCase().includes(needle)
      )) return false
      return true
    })
    const cmp: Record<string, (a: Creator, b: Creator) => number> = {
      'Best match': (a, b) => b.match - a.match,
      'Most followers': (a, b) => toNumber(b.followers) - toNumber(a.followers),
      'Highest engagement': (a, b) => parseFloat(b.engagement) - parseFloat(a.engagement),
      'Highest reach': (a, b) => toNumber(b.reach) - toNumber(a.reach),
      'Name A–Z': (a, b) => a.name.localeCompare(b.name),
    }
    return [...filtered].sort(cmp[sort])
  }, [query, category, sort, tierFilter, minEngagement, verifiedOnly])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const reset = () => {
    setQuery(''); setCategory('All'); setTierFilter([]); setMinEngagement(0)
    setVerifiedOnly(false); setPage(1)
  }
  const onFilterChange = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1) }

  return (
    <div className="min-h-full" style={{ background: T.surfaceLow }}>
      <div className="max-w-[1200px] mx-auto px-5 py-5">

        {/* ── header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1 style={{ ...PJ, color: T.onSurface }} className="text-[22px] font-extrabold tracking-[-0.03em]">
              KOL Directory
            </h1>
            <p className="text-[12.5px] mt-1" style={{ color: T.muted }}>
              {rows.length} of {CREATORS.length} creators · {favorites.size} favorites · {compare.size} in compare
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => flash(`${compare.size} creator dibandingkan`)}
              style={{ ...PJ, borderColor: T.outline, color: T.onSurface }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border bg-white text-[12.5px] font-bold transition-colors hover:bg-[#f9fafb]">
              <span className="material-symbols-outlined text-[17px]" style={{ color: T.muted }}>compare</span>
              Compare
              {compare.size > 0 && (
                <span style={{ ...PJ, background: T.primary }}
                  className="text-white rounded-full text-[10px] px-1.5 py-0.5 font-extrabold leading-none">
                  {compare.size}
                </span>
              )}
            </button>
            <button type="button" onClick={() => flash('Form tambah KOL dibuka')} style={{ ...PJ, background: T.primary }}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-white text-[12.5px] font-bold transition-colors hover:brightness-95">
              <span className="material-symbols-outlined text-[17px]">person_add</span>
              Add KOL
            </button>
          </div>
        </div>

        {/* ── toolbar ── */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-[230px] max-w-[320px]">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px]"
              style={{ color: T.faint }}>search</span>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1) }}
              placeholder="Search creators, niches, categories..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border text-[12.5px] bg-white focus:outline-none"
              style={{ borderColor: T.outline, color: T.onSurface }}
              onFocus={e => { e.currentTarget.style.borderColor = T.primary }}
              onBlur={e => { e.currentTarget.style.borderColor = T.outline }}
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {CATEGORIES.map(c => {
              const on = category === c
              return (
                <button key={c} type="button" onClick={() => { setCategory(c); setPage(1) }} style={{
                  ...PJ,
                  background: on ? T.surfaceVariant : T.surface,
                  borderColor: on ? T.primary : T.outline,
                  color: on ? T.primaryHover : T.muted,
                }}
                  className="h-9 px-3 rounded-lg border text-[12px] font-bold transition-colors">
                  {c}
                </button>
              )
            })}
          </div>

          <div className="flex-1" />

          <button type="button" onClick={() => setFiltersOpen(true)}
            style={{ ...PJ, borderColor: T.outline }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border bg-white text-[12px] font-bold transition-colors hover:bg-[#f9fafb]">
            <span className="material-symbols-outlined text-[16px]" style={{ color: T.muted }}>tune</span>
            <span style={{ color: T.muted }}>Filters</span>
            {(tierFilter.length > 0 || minEngagement > 0 || verifiedOnly) && (
              <span style={{ ...PJ, background: T.primary }}
                className="text-white rounded-full text-[10px] px-1.5 py-0.5 font-extrabold leading-none">
                {tierFilter.length + (minEngagement > 0 ? 1 : 0) + (verifiedOnly ? 1 : 0)}
              </span>
            )}
          </button>

          <button type="button" onClick={() => setListsOpen(o => !o)}
            style={{ ...PJ, borderColor: T.outline }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border bg-white text-[12px] font-bold transition-colors hover:bg-[#f9fafb]">
            <span className="material-symbols-outlined text-[16px]" style={{ color: T.muted }}>bookmarks</span>
            <span style={{ color: T.muted }}>Saved Lists</span>
            <span style={{ ...PJ, background: T.primary }}
              className="text-white rounded-full text-[10px] px-1.5 py-0.5 font-extrabold leading-none">
              {SAVED_LISTS.length}
            </span>
          </button>

          <div className="relative">
            <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }} style={{ ...PJ, borderColor: T.outline, color: T.muted }}
              className="h-9 pl-3 pr-8 rounded-lg border bg-white text-[12px] font-bold appearance-none cursor-pointer focus:outline-none">
              {SORTS.map(s => <option key={s} value={s}>Sort: {s}</option>)}
            </select>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[16px] pointer-events-none"
              style={{ color: T.faint }}>expand_more</span>
          </div>
        </div>

        {/* saved lists dropdown */}
        {listsOpen && (
          <div className="rounded-xl border bg-white p-2.5 mb-3" style={{ borderColor: T.outline }}>
            <div style={{ ...PJ, color: T.faint }} className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5">
              Saved Lists
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SAVED_LISTS.map(l => (
                <button key={l.name} type="button"
                  style={{ ...PJ, borderColor: T.outline }}
                  onClick={() => { setCompare(new Set(l.ids)); setListsOpen(false); flash(`List ${l.name} dimuat ke compare`) }}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border bg-white text-[11.5px] font-bold transition-colors hover:bg-[#f9fafb]">
                  <span className="material-symbols-outlined text-[14px]" style={{ color: T.faint }}>list_alt</span>
                  <span style={{ color: T.muted }}>{l.name}</span>
                  <span className="text-[10px]" style={{ color: T.faint }}>{l.ids.length}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── grid / list toggle ── */}
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: T.outline }}>
            {(['grid', 'list'] as const).map(v => {
              const on = view === v
              return (
                <button key={v} type="button" onClick={() => setView(v)} style={{
                  ...PJ,
                  background: on ? T.surfaceVariant : T.surface,
                  color: on ? T.primaryHover : T.faint,
                }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-[11.5px] font-bold transition-colors">
                  <span className="material-symbols-outlined text-[15px]">{v === 'grid' ? 'grid_view' : 'view_list'}</span>
                  {v === 'grid' ? 'Grid' : 'List'}
                </button>
              )
            })}
          </div>
          {(query || category !== 'All' || tierFilter.length || minEngagement > 0 || verifiedOnly) && (
            <button type="button" onClick={reset} style={{ ...PJ, color: T.primary }}
              className="text-[11.5px] font-bold hover:underline">
              Reset filters
            </button>
          )}
        </div>

        {/* ── content ── */}
        {pageRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined text-[44px]" style={{ color: '#cfe0f1' }}>person_search</span>
            <h4 style={PJ} className="text-[14px] font-bold mt-2">No creators match</h4>
            <p className="text-[12px] mt-1" style={{ color: T.faint }}>Try another keyword or clear the filters.</p>
            <button type="button" onClick={reset} style={{ ...PJ, background: T.primary }}
              className="mt-3 h-8 px-3 rounded-lg text-white text-[11.5px] font-bold">Reset filters</button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {pageRows.map(c => (
              <CreatorCard key={c.id} creator={c} banner={BANNERS[CREATORS.indexOf(c) % BANNERS.length]}
                fav={favorites.has(c.id)} inCompare={compare.has(c.id)} inCart={cart.has(c.id)}
                onFav={() => { setFavorites(s => toggle(s, c.id)); flash(favorites.has(c.id) ? 'Dihapus dari favorit' : 'Ditambahkan ke favorit') }}
                onCompare={() => { setCompare(s => toggle(s, c.id)); flash(compare.has(c.id) ? 'Dihapus dari compare' : 'Ditambahkan ke compare') }}
                onCart={() => { setCart(s => toggle(s, c.id)); flash(cart.has(c.id) ? 'Dihapus dari campaign' : `${c.name} ditambahkan ke campaign`) }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: T.outline }}>
            {pageRows.map((c, i) => (
              <CreatorRow key={c.id} creator={c} banner={BANNERS[CREATORS.indexOf(c) % BANNERS.length]}
                last={i === pageRows.length - 1}
                fav={favorites.has(c.id)} inCompare={compare.has(c.id)} inCart={cart.has(c.id)}
                onFav={() => setFavorites(s => toggle(s, c.id))}
                onCompare={() => setCompare(s => toggle(s, c.id))}
                onCart={() => setCart(s => toggle(s, c.id))}
              />
            ))}
          </div>
        )}

        {/* ── pagination ── */}
        <div className="flex items-center justify-center gap-1.5 mt-5">
          <PageBtn disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <span className="material-symbols-outlined text-[16px]">chevron_left</span>
          </PageBtn>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
            <PageBtn key={n} active={n === safePage} onClick={() => setPage(n)}>{n}</PageBtn>
          ))}
          <PageBtn disabled={safePage >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </PageBtn>
        </div>
      </div>

      {/* ── filter drawer ── */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setFiltersOpen(false)}>
          <div className="absolute inset-0 bg-black/20" />
          <aside onClick={e => e.stopPropagation()}
            className="relative w-[300px] max-w-full h-full bg-white border-l overflow-y-auto"
            style={{ borderColor: T.outline }}>
            <div className="flex items-center gap-2 px-4 h-14 border-b" style={{ borderColor: T.outline }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: T.primary }}>tune</span>
              <span style={PJ} className="flex-1 text-[13px] font-extrabold">Filters</span>
              <button type="button" onClick={() => { setTierFilter([]); setMinEngagement(0); setVerifiedOnly(false) }}
                style={{ ...PJ, color: T.primary }} className="text-[11px] font-bold hover:underline">Clear</button>
              <button type="button" onClick={() => setFiltersOpen(false)}
                className="material-symbols-outlined text-[18px] cursor-pointer" style={{ color: T.faint }}>close</button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <div>
                <Label>Tier</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TIERS.map(t => {
                    const on = tierFilter.includes(t)
                    return (
                      <button key={t} type="button" style={{
                        ...PJ,
                        background: on ? T.surfaceVariant : T.surface,
                        borderColor: on ? T.primary : T.outline,
                        color: on ? T.primaryHover : T.muted,
                      }}
                        onClick={() => onFilterChange<string[]>(setTierFilter)(
                          on ? tierFilter.filter(x => x !== t) : [...tierFilter, t])}
                        className="h-7 px-2.5 rounded-full border text-[11px] font-bold">
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label>Minimum engagement rate</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 4, 5, 6].map(v => {
                    const on = minEngagement === v
                    return (
                      <button key={v} type="button" style={{
                        ...PJ,
                        background: on ? T.surfaceVariant : T.surface,
                        borderColor: on ? T.primary : T.outline,
                        color: on ? T.primaryHover : T.muted,
                      }}
                        onClick={() => onFilterChange<number>(setMinEngagement)(v)}
                        className="h-7 px-2.5 rounded-full border text-[11px] font-bold">
                        {v === 0 ? 'Any' : `≥ ${v}%`}
                      </button>
                    )
                  })}
                </div>
              </div>

              <button type="button" onClick={() => onFilterChange<boolean>(setVerifiedOnly)(!verifiedOnly)}
                style={{
                  ...PJ,
                  background: verifiedOnly ? T.surfaceVariant : T.surface,
                  borderColor: verifiedOnly ? T.primary : T.outline,
                  color: verifiedOnly ? T.primaryHover : T.muted,
                }}
                className="flex items-center gap-2 h-9 px-2.5 rounded-lg border text-[11.5px] font-bold">
                <span className="material-symbols-outlined text-[15px]">
                  {verifiedOnly ? 'check_box' : 'check_box_outline_blank'}
                </span>
                Verified only
              </button>

              <button type="button" onClick={() => setFiltersOpen(false)}
                style={{ ...PJ, background: T.primary }}
                className="h-9 rounded-lg text-white text-[12px] font-bold">
                Show {rows.length} creators
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div style={{ ...PJ, background: T.onSurface }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 text-white text-[12px] font-bold px-3.5 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ── card ─────────────────────────────────────────────────────────────────── */

function CreatorCard({
  creator: c, banner, fav, inCompare, inCart, onFav, onCompare, onCart,
}: {
  creator: Creator; banner: string
  fav: boolean; inCompare: boolean; inCart: boolean
  onFav: () => void; onCompare: () => void; onCart: () => void
}) {
  const st = STATUS[c.status]
  return (
    <article
      className="rounded-2xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md"
      style={{ background: T.surface, borderColor: T.outline, boxShadow: '0 1px 2px rgba(17,24,39,0.04)' }}
    >
      {/* banner + actions */}
      <div className="relative h-[58px]" style={{ background: banner }}>
        <div className="absolute top-2 right-2 flex gap-1">
          <IconBtn on={fav} onClick={onFav} icon="favorite" title="Favorite" activeColor={T.accent} />
          <IconBtn on={inCompare} onClick={onCompare} icon={inCompare ? 'check' : 'compare'} title="Compare" activeColor={T.primary} />
          <IconBtn on={inCart} onClick={onCart} icon={inCart ? 'shopping_cart_checkout' : 'add_shopping_cart'}
            title="Add to campaign" activeColor={T.primary} />
        </div>
      </div>

      <div className="px-3 pb-3 flex flex-col flex-1">
        {/* avatar overlapping the banner */}
        <div className="flex items-end gap-2 -mt-7 mb-2">
          <div className="relative">
            <div style={{ ...PJ, background: banner, borderColor: T.surface }}
              className="w-14 h-14 rounded-xl border-[3px] flex items-center justify-center text-white text-[15px] font-extrabold">
              {c.initials}
            </div>
            {c.verified && (
              <span style={{ background: T.primary, borderColor: T.surface }}
                className="absolute -bottom-0.5 -right-0.5 w-[17px] h-[17px] rounded-full border-2 flex items-center justify-center">
                <span className="material-symbols-outlined fill text-[10px] text-white">verified</span>
              </span>
            )}
          </div>
        </div>

        <h3 style={{ ...PJ, color: T.onSurface }} className="text-[13.5px] font-extrabold truncate">{c.name}</h3>
        <p className="text-[11px] truncate" style={{ color: T.muted }}>@{c.username} · {c.location}</p>

        <span className="inline-flex items-center gap-1 self-start mt-1.5 rounded-full px-2 py-[3px] text-[10px] font-semibold"
          style={{ background: T.surfaceVariant, color: '#1E4A58' }}>
          <span className="material-symbols-outlined text-[11px]">category</span>
          <span className="truncate max-w-[190px]">{c.niche}</span>
        </span>

        {/* metrics */}
        <div className="grid grid-cols-3 gap-1.5 mt-2.5">
          <Metric label="Followers" value={c.followers} />
          <Metric label="Eng. Rate" value={c.engagement} />
          <Metric label="Est. Reach" value={c.reach} />
        </div>

        {/* data status + match */}
        <div className="flex items-center justify-between gap-2 mt-2.5">
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[9.5px] font-bold"
            style={{ background: st.bg, color: st.fg }}>
            <span className="material-symbols-outlined text-[11px]">{st.icon}</span>
            {c.status} · {c.synced}
          </span>
          <span style={{ ...PJ, color: '#3d8a5f' }} className="text-[11px] font-extrabold">
            {c.match}% match
          </span>
        </div>

        <div className="flex-1" />

        {/* footer */}
        <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t" style={{ borderColor: '#f3f4f6' }}>
          <div className="flex items-center gap-1">
            {c.platforms.map(p => (
              <span key={p} title={p} className="w-[22px] h-[22px] rounded-md flex items-center justify-center"
                style={{ background: T.surfaceVariant }}>
                <span className="material-symbols-outlined text-[12px]" style={{ color: '#285D6E' }}>
                  {PLATFORM_ICON[p] ?? 'public'}
                </span>
              </span>
            ))}
          </div>
          <span style={{ ...PJ, background: T.surfaceLow, color: T.muted }}
            className="rounded-md px-2 py-[3px] text-[10px] font-bold">
            {c.tier}
          </span>
        </div>
      </div>
    </article>
  )
}

function CreatorRow({
  creator: c, banner, last, fav, inCompare, inCart, onFav, onCompare, onCart,
}: {
  creator: Creator; banner: string; last: boolean
  fav: boolean; inCompare: boolean; inCart: boolean
  onFav: () => void; onCompare: () => void; onCart: () => void
}) {
  const st = STATUS[c.status]
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 flex-wrap ${last ? '' : 'border-b'}`}
      style={{ borderColor: '#f3f4f6' }}>
      <div style={{ ...PJ, background: banner }}
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[12px] font-extrabold flex-shrink-0">
        {c.initials}
      </div>
      <div className="min-w-[160px]">
        <div className="flex items-center gap-1">
          <span style={{ ...PJ, color: T.onSurface }} className="text-[12.5px] font-extrabold">{c.name}</span>
          {c.verified && <span className="material-symbols-outlined fill text-[13px]" style={{ color: T.primary }}>verified</span>}
        </div>
        <div className="text-[10.5px]" style={{ color: T.muted }}>@{c.username} · {c.location}</div>
      </div>
      <div className="text-[11px] min-w-[150px]" style={{ color: T.muted }}>{c.niche}</div>
      <div className="flex-1" />
      <Cell label="Followers" value={c.followers} />
      <Cell label="Eng. Rate" value={c.engagement} />
      <Cell label="Est. Reach" value={c.reach} />
      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[9.5px] font-bold"
        style={{ background: st.bg, color: st.fg }}>
        <span className="material-symbols-outlined text-[11px]">{st.icon}</span>{c.status}
      </span>
      <span style={{ ...PJ, color: '#3d8a5f' }} className="text-[11px] font-extrabold w-[74px] text-right">
        {c.match}% match
      </span>
      <span style={{ ...PJ, background: T.surfaceLow, color: T.muted }}
        className="rounded-md px-2 py-[3px] text-[10px] font-bold">{c.tier}</span>
      <div className="flex items-center gap-1">
        <IconBtn on={fav} onClick={onFav} icon="favorite" title="Favorite" activeColor={T.accent} outlined />
        <IconBtn on={inCompare} onClick={onCompare} icon={inCompare ? 'check' : 'compare'} title="Compare" activeColor={T.primary} outlined />
        <IconBtn on={inCart} onClick={onCart} icon={inCart ? 'shopping_cart_checkout' : 'add_shopping_cart'}
          title="Add to campaign" activeColor={T.primary} outlined />
      </div>
    </div>
  )
}

/* ── bits ─────────────────────────────────────────────────────────────────── */

function IconBtn({
  on, onClick, icon, title, activeColor, outlined,
}: {
  on: boolean; onClick: () => void; icon: string; title: string
  activeColor: string; outlined?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors"
      style={{
        background: on ? activeColor : outlined ? T.surface : 'rgba(255,255,255,0.9)',
        border: outlined ? `1px solid ${on ? activeColor : T.outline}` : 'none',
        color: on ? '#ffffff' : T.muted,
      }}
    >
      <span className={`material-symbols-outlined text-[14px] ${on && icon === 'favorite' ? 'fill' : ''}`}>{icon}</span>
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-1.5 py-1.5 text-center" style={{ background: T.surfaceLow }}>
      <div style={{ ...PJ, color: T.onSurface }} className="text-[12.5px] font-extrabold tabular-nums">{value}</div>
      <div className="text-[8.5px] font-bold uppercase tracking-wider mt-0.5" style={{ color: T.faint }}>{label}</div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right min-w-[72px]">
      <div style={{ ...PJ, color: T.onSurface }} className="text-[12px] font-extrabold tabular-nums">{value}</div>
      <div className="text-[8.5px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>{label}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...PJ, color: T.faint }} className="text-[10px] font-bold uppercase tracking-wider mb-1.5">
      {children}
    </div>
  )
}

function PageBtn({
  children, active, disabled, onClick,
}: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...PJ,
        background: active ? T.primary : T.surface,
        borderColor: active ? T.primary : T.outline,
        color: active ? '#ffffff' : disabled ? '#d1d5db' : T.muted,
      }}
      className={`min-w-[32px] h-8 px-2 rounded-lg border text-[12px] font-bold inline-flex items-center justify-center transition-colors ${
        disabled ? 'cursor-not-allowed' : 'hover:brightness-95'
      }`}
    >
      {children}
    </button>
  )
}
