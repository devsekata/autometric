'use client'

/**
 * KOL Directory — the module's primary surface.
 *
 * Card and Table views over the enriched roster, with the full filter set,
 * bulk selection, shortlist, export, and a credibility badge on every modelled
 * number. Filter state is persisted per org (see useDirectoryFilters) so moving
 * to a KOL and back does not throw away a search someone spent a minute
 * building — the single most common complaint about directory screens.
 *
 * Filtering runs client-side over the whole roster on purpose: the roster is
 * account-sized (tens, not thousands) and every filter then responds instantly
 * without a round trip. If an org ever tracks thousands of accounts this moves
 * behind the API, which is why the filter shape is a plain serialisable object.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Btn, Chip, EmptyState, ErrorState, PJ, PLATFORM_ICON, SelectPill, Spinner,
  fmtNum, gradientFor,
} from './ui'
import { ConfidenceBadge, ConfidenceLegend, MetricValue } from './credibility'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import { useDiscoverSelection } from './useDiscoverSelection'
import { useDiscoverCart } from './useDiscoverCart'
import { AGE_BANDS, CATEGORIES, LIFESTYLES, LOCATIONS, TIERS } from '@/lib/discover/vocab'
import type { KolProfile } from '@/lib/discover/profile'
import type { DirectoryAccount } from '@/lib/discover/types'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

export interface DirectoryFilters {
  q: string
  platform: string
  relation: string
  category: string
  lifestyle: string
  location: string
  tier: string
  age: string
  gender: string
  format: string
  followersMin: number
  erMin: number
  reachMin: number
  authMin: number
  brandFitMin: number
  paidMax: number
  verifiedOnly: boolean
  ratedOnly: boolean
  sort: SortKey
  view: 'card' | 'table'
  /**
   * Table columns the user switched off, stored as the exclusion rather than the
   * inclusion: a column added to the catalogue later then appears for everyone
   * instead of staying invisible to whoever had already saved a column set.
   */
  hiddenColumns: string[]
}

/**
 * The table's column catalogue — the source platform's column chooser, whose
 * point is that a directory serves several jobs. Someone sizing a budget wants
 * EMV and rate; someone vetting quality wants authenticity and paid ratio; both
 * on screen at once is a wall of numbers.
 */
const TABLE_COLUMNS: {
  id: string; label: string; right?: boolean; defaultOff?: boolean
  cell: (p: KolProfile) => string
}[] = [
  { id: 'category',  label: 'Kategori',  cell: p => p.category.value },
  { id: 'location',  label: 'Lokasi',    cell: p => p.location.value },
  { id: 'tier',      label: 'Tier',      cell: p => p.tier.value },
  { id: 'followers', label: 'Followers', right: true, cell: p => fmtNum(p.followers.value) },
  { id: 'er',        label: 'ER',        right: true, cell: p => `${p.erPct.value.toFixed(2)}%` },
  { id: 'reach',     label: 'Reach',     right: true, cell: p => fmtNum(p.estimatedReach.value) },
  { id: 'auth',      label: 'Auth',      right: true, cell: p => String(p.authenticity.value) },
  { id: 'fit',       label: 'Fit',       right: true, cell: p => String(p.brandFit.value) },
  { id: 'paid',      label: 'Paid %',    right: true, cell: p => `${p.paidRatio.value.toFixed(0)}%` },
  { id: 'emv',       label: 'EMV',       right: true, cell: p => fmtNum(p.emv.value) },
  // Off by default — useful, but only to some of the jobs above.
  { id: 'quality',   label: 'Aud. quality', right: true, defaultOff: true, cell: p => String(p.audienceQuality.value) },
  { id: 'posts',     label: 'Posts',     right: true, defaultOff: true, cell: p => fmtNum(p.posts.value) },
  { id: 'campaign',  label: 'Campaign',  right: true, defaultOff: true,
    cell: p => (p.campaignPosts.value === 0 ? '—' : `${p.campaignPosts.value} post`) },
  { id: 'lift',      label: 'Lift',      right: true, defaultOff: true,
    cell: p => (p.campaignLift.value === null ? '—' : `${p.campaignLift.value.toFixed(2)}×`) },
  { id: 'rate',      label: 'Rate',      right: true, defaultOff: true, cell: p => (p.hasRate ? idr(p.baseRate) : '—') },
]

const DEFAULT_HIDDEN = TABLE_COLUMNS.filter(c => c.defaultOff).map(c => c.id)

type SortKey =
  | 'brandFit' | 'followers' | 'er' | 'reach' | 'auth' | 'emv' | 'posts' | 'name'
  | 'campaignBest' | 'campaignWorst'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'campaignBest', label: 'Best in campaign' },
  { id: 'campaignWorst', label: 'Least in campaign' },
  { id: 'brandFit', label: 'Best brand fit' },
  { id: 'followers', label: 'Most followers' },
  { id: 'reach', label: 'Highest reach' },
  { id: 'er', label: 'Highest ER' },
  { id: 'auth', label: 'Most authentic' },
  { id: 'emv', label: 'Highest EMV' },
  { id: 'posts', label: 'Most posts' },
  { id: 'name', label: 'Name A–Z' },
]

export const DEFAULT_FILTERS: DirectoryFilters = {
  q: '', platform: 'all', relation: 'all', category: 'all', lifestyle: 'all',
  location: 'all', tier: 'all', age: 'all', gender: 'all', format: 'all',
  followersMin: 0, erMin: 0, reachMin: 0, authMin: 0, brandFitMin: 0, paidMax: 100,
  verifiedOnly: false, ratedOnly: false, sort: 'brandFit', view: 'card',
  hiddenColumns: DEFAULT_HIDDEN,
}

/**
 * Fills in anything a stored filter set predates or got wrong.
 *
 * Filters are persisted and also embedded in saved lists, so old shapes outlive
 * the code that wrote them — a list saved before `hiddenColumns` existed would
 * otherwise set it to undefined and every column lookup would throw.
 */
function merge(stored: unknown): DirectoryFilters {
  const next = { ...DEFAULT_FILTERS, ...(stored as Partial<DirectoryFilters> | null) }
  if (!Array.isArray(next.hiddenColumns)) next.hiddenColumns = DEFAULT_HIDDEN
  return next
}

/** Filters survive navigation; a rebuilt search is a wasted minute. */
function useDirectoryFilters(orgId: string) {
  const key = `autometric:discover:dirfilters:${orgId}`
  const [filters, setFilters] = useState<DirectoryFilters>(DEFAULT_FILTERS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) setFilters(merge(JSON.parse(raw)))
    } catch { /* ignore */ }
    setReady(true)
  }, [key])

  const update = useCallback((patch: Partial<DirectoryFilters>) => {
    setFilters(prev => {
      const next = { ...prev, ...patch }
      try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [key])

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
  }, [key])

  return { filters, update, reset, ready }
}

/**
 * Saved searches, per org.
 *
 * A useful shortlist query is a dozen filter decisions — tier, ER floor,
 * location, authenticity, paid ratio — and rebuilding it next month from memory
 * produces a *different* set of creators, which quietly breaks the "use last
 * campaign's learnings on the next one" half of the flow. Saving the filter
 * object makes the search itself the reusable artifact.
 *
 * The filters are stored, not the resulting accounts: a saved list should track
 * the roster as it grows, not freeze whoever qualified on the day it was made.
 */
export interface SavedList {
  id: string
  name: string
  filters: DirectoryFilters
}

function useSavedLists(orgId: string) {
  const key = `autometric:discover:dirlists:${orgId}`
  const [lists, setLists] = useState<SavedList[]>([])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        setLists(parsed.filter((l): l is SavedList =>
          !!l && typeof l.id === 'string' && typeof l.name === 'string' && !!l.filters))
      }
    } catch { /* ignore */ }
  }, [key])

  const persist = useCallback((next: SavedList[]) => {
    setLists(next)
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* quota / privacy mode */ }
  }, [key])

  const save = useCallback((name: string, filters: DirectoryFilters) => {
    setLists(prev => {
      // Same name overwrites rather than accumulating near-duplicates, which is
      // what "save" means everywhere else in the product.
      const without = prev.filter(l => l.name.toLowerCase() !== name.toLowerCase())
      const next = [...without, { id: `${name}-${without.length}`, name, filters }]
      try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [key])

  const remove = useCallback(
    (id: string) => persist(lists.filter(l => l.id !== id)), [lists, persist])

  return { lists, save, remove }
}

const FOLLOWER_OPTS = [
  { label: 'Semua follower', value: 0 }, { label: '≥ 10K', value: 10_000 },
  { label: '≥ 100K', value: 100_000 }, { label: '≥ 1M', value: 1_000_000 },
]
const ER_OPTS = [
  { label: 'Semua ER', value: 0 }, { label: '≥ 1%', value: 1 },
  { label: '≥ 3%', value: 3 }, { label: '≥ 5%', value: 5 },
]
const REACH_OPTS = [
  { label: 'Semua reach', value: 0 }, { label: '≥ 50K', value: 50_000 },
  { label: '≥ 250K', value: 250_000 }, { label: '≥ 1M', value: 1_000_000 },
]
const AUTH_OPTS = [
  { label: 'Semua autentisitas', value: 0 }, { label: '≥ 75%', value: 75 },
  { label: '≥ 85%', value: 85 }, { label: '≥ 90%', value: 90 },
]
const FIT_OPTS = [
  { label: 'Semua brand fit', value: 0 }, { label: '≥ 50', value: 50 },
  { label: '≥ 65', value: 65 }, { label: '≥ 80', value: 80 },
]
const PAID_OPTS = [
  { label: 'Semua rasio paid', value: 100 }, { label: 'Paid ≤ 25%', value: 25 },
  { label: 'Paid ≤ 50%', value: 50 }, { label: 'Paid ≤ 75%', value: 75 },
]

export default function DiscoverDirectoryView({
  orgId, orgSlug, onAddToCampaign, onSelectKol, onOrderKol,
}: {
  orgId: string; orgSlug: string
  /** Handed the selected account ids when the user pushes them into a campaign. */
  onAddToCampaign?: (ids: string[]) => void
  /** Opening a KOL makes it the workspace active creator. */
  onSelectKol?: (id: string, relation: 'owned' | 'competitor', username: string) => void
  /** Order button on the card: selects the creator and enters the ordering flow. */
  onOrderKol?: (id: string, relation: 'owned' | 'competitor', username: string) => void
}) {
  const [profiles, setProfiles] = useState<KolProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [panelOpen, setPanelOpen] = useState(true)
  const [bulk, setBulk] = useState<Set<string>>(new Set())
  const [listsOpen, setListsOpen] = useState(false)
  const [colsOpen, setColsOpen] = useState(false)

  const { filters, update, reset, ready } = useDirectoryFilters(orgId)
  const savedLists = useSavedLists(orgId)
  const shortlist = useDiscoverSelection(orgId, 'compare')
  const bookmarks = useDiscoverSelection(orgId, 'fav')
  const cart = useDiscoverCart(orgId)

  const PAGE_SIZE = filters.view === 'card' ? 12 : 20

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/profiles`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { profiles: KolProfile[] }) => { if (!cancelled) setProfiles(d.profiles) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])

  const rows = useMemo(() => {
    if (!profiles) return []
    const needle = filters.q.trim().toLowerCase()
    const out = profiles.filter(p => {
      const a = p.account
      if (filters.platform !== 'all' && a.platform !== filters.platform) return false
      if (filters.relation !== 'all' && a.relation !== filters.relation) return false
      if (filters.category !== 'all' && p.category.value !== filters.category) return false
      if (filters.lifestyle !== 'all' && p.lifestyle.value !== filters.lifestyle) return false
      if (filters.location !== 'all' && p.location.value !== filters.location) return false
      if (filters.tier !== 'all' && p.tier.value !== filters.tier) return false
      if (filters.format !== 'all' && p.topFormat.value !== filters.format) return false
      if (filters.age !== 'all' && p.topAge.value !== filters.age) return false
      if (filters.gender === 'female' && p.genderSplit.value.female < 50) return false
      if (filters.gender === 'male' && p.genderSplit.value.male < 50) return false
      if (p.followers.value < filters.followersMin) return false
      if (p.erPct.value < filters.erMin) return false
      if (p.estimatedReach.value < filters.reachMin) return false
      if (p.authenticity.value < filters.authMin) return false
      if (p.brandFit.value < filters.brandFitMin) return false
      if (p.paidRatio.value > filters.paidMax) return false
      if (filters.verifiedOnly && !p.verified.value) return false
      if (filters.ratedOnly && !p.hasRate) return false
      if (needle && !(
        a.username.toLowerCase().includes(needle) ||
        (a.brandName ?? '').toLowerCase().includes(needle) ||
        p.category.value.toLowerCase().includes(needle) ||
        p.location.value.toLowerCase().includes(needle) ||
        p.lifestyle.value.toLowerCase().includes(needle)
      )) return false
      return true
    })

    /**
     * Campaign lift, with profiles that have never run one sorted last in *both*
     * directions. An account with no campaign posts is not the worst performer;
     * it is an unknown, and burying it under "Least in campaign" would read as a
     * verdict the data never gave.
     */
    const byLift = (x: KolProfile, y: KolProfile, dir: 1 | -1) => {
      const a = x.campaignLift.value
      const b = y.campaignLift.value
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return dir * (b - a)
    }

    const cmp: Record<SortKey, (x: KolProfile, y: KolProfile) => number> = {
      campaignBest: (x, y) => byLift(x, y, 1),
      campaignWorst: (x, y) => byLift(x, y, -1),
      brandFit: (x, y) => y.brandFit.value - x.brandFit.value,
      followers: (x, y) => y.followers.value - x.followers.value,
      er: (x, y) => y.erPct.value - x.erPct.value,
      reach: (x, y) => y.estimatedReach.value - x.estimatedReach.value,
      auth: (x, y) => y.authenticity.value - x.authenticity.value,
      emv: (x, y) => y.emv.value - x.emv.value,
      posts: (x, y) => y.posts.value - x.posts.value,
      name: (x, y) => x.account.username.localeCompare(y.account.username),
    }
    return [...out].sort(cmp[filters.sort])
  }, [profiles, filters])

  useEffect(() => { setPage(1) }, [filters])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const activeCount = useMemo(() => {
    const d = DEFAULT_FILTERS
    return (['platform', 'relation', 'category', 'lifestyle', 'location', 'tier', 'age',
      'gender', 'format', 'followersMin', 'erMin', 'reachMin', 'authMin', 'brandFitMin',
      'paidMax', 'verifiedOnly', 'ratedOnly'] as const)
      .filter(k => filters[k] !== d[k]).length
  }, [filters])

  const toggleBulk = (id: string) => setBulk(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const allOnPageSelected = pageRows.length > 0 && pageRows.every(p => bulk.has(p.account.id))
  const toggleAllOnPage = () => setBulk(s => {
    const n = new Set(s)
    if (allOnPageSelected) pageRows.forEach(p => n.delete(p.account.id))
    else pageRows.forEach(p => n.add(p.account.id))
    return n
  })

  const EXPORT_COLS: ExportColumn<KolProfile>[] = [
    { key: 'username', header: 'Akun', value: p => p.account.username },
    { key: 'platform', header: 'Platform', value: p => p.account.platform },
    { key: 'relation', header: 'Tipe', value: p => (p.account.relation === 'owned' ? 'Brand' : 'Kompetitor') },
    { key: 'category', header: 'Kategori (est)', value: p => p.category.value },
    { key: 'lifestyle', header: 'Lifestyle (est)', value: p => p.lifestyle.value },
    { key: 'location', header: 'Lokasi (est)', value: p => p.location.value },
    { key: 'tier', header: 'Tier', value: p => p.tier.value },
    { key: 'followers', header: 'Followers (est)', value: p => p.followers.value },
    { key: 'posts', header: 'Posts (live)', value: p => p.posts.value },
    { key: 'views', header: 'Total views (live)', value: p => p.totalViews.value },
    { key: 'er', header: 'ER % (live)', value: p => p.erPct.value.toFixed(2) },
    { key: 'reach', header: 'Est. reach (calc)', value: p => p.estimatedReach.value },
    { key: 'auth', header: 'Authenticity (est)', value: p => p.authenticity.value },
    { key: 'quality', header: 'Audience quality (calc)', value: p => p.audienceQuality.value },
    { key: 'fit', header: 'Brand fit (calc)', value: p => p.brandFit.value },
    { key: 'paid', header: 'Paid ratio % (live)', value: p => p.paidRatio.value.toFixed(1) },
    { key: 'campaignPosts', header: 'Post campaign (live)', value: p => String(p.campaignPosts.value) },
    { key: 'campaignEr', header: 'ER campaign % (live)', value: p => (p.campaignErPct.value === null ? '' : p.campaignErPct.value.toFixed(2)) },
    { key: 'campaignLift', header: 'Campaign lift x baseline', value: p => (p.campaignLift.value === null ? '' : p.campaignLift.value.toFixed(2)) },
    { key: 'paidEr', header: 'Paid ER % (live)', value: p => p.paidErPct.value.toFixed(2) },
    { key: 'organicEr', header: 'Organic ER % (live)', value: p => p.organicErPct.value.toFixed(2) },
    { key: 'format', header: 'Top format (live)', value: p => p.topFormat.value },
    { key: 'emv', header: 'EMV IDR (calc)', value: p => p.emv.value },
    { key: 'rate', header: 'Base rate IDR', value: p => p.baseRate },
    { key: 'source', header: 'Data source', value: p => p.dataSource },
    { key: 'sync', header: 'Last sync', value: p => p.lastSyncAt?.slice(0, 10) ?? '' },
  ]

  const exportRows = () => (bulk.size > 0 ? rows.filter(p => bulk.has(p.account.id)) : rows)

  if (error) return <ErrorState message={error} />
  if (!profiles || !ready) return <Spinner />

  return (
    <div>
      {/* toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[#9ca3af]">search</span>
          <input value={filters.q} onChange={e => update({ q: e.target.value })}
            placeholder="Cari akun, kategori, lokasi, lifestyle…"
            className="w-[300px] max-w-full h-8 pl-8 pr-3 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] placeholder:text-[#9ca3af] focus:outline-none focus:border-[#327488]" />
        </div>
        <span className="text-[11px] text-[#9ca3af]">
          {rows.length} dari {profiles.length} KOL{activeCount > 0 && ` · ${activeCount} filter aktif`}
        </span>
        {(activeCount > 0 || filters.q) && (
          <Btn variant="ghost" size="sm" onClick={reset}>
            <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>Reset
          </Btn>
        )}

        <div className="relative">
          <Btn variant="secondary" size="sm" onClick={() => setListsOpen(o => !o)}>
            <span className="material-symbols-outlined text-[14px]">bookmark</span>
            Saved Lists
            {savedLists.lists.length > 0 && (
              <span style={PJ}
                className="ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-[#285D6E] text-white text-[9px] font-extrabold">
                {savedLists.lists.length}
              </span>
            )}
          </Btn>
          {listsOpen && (
            <SavedListsMenu
              lists={savedLists.lists}
              onApply={l => { update(merge(l.filters)); setListsOpen(false) }}
              onDelete={savedLists.remove}
              onSave={name => savedLists.save(name, filters)}
              onClose={() => setListsOpen(false)}
            />
          )}
        </div>

        <div className="flex-1" />
        <select value={filters.sort} onChange={e => update({ sort: e.target.value as SortKey })} style={PJ}
          className="h-8 px-2 rounded-lg border border-[#e5e7eb] text-[11.5px] font-semibold text-[#6b7280] focus:outline-none focus:border-[#327488]">
          {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {(filters.sort === 'campaignBest' || filters.sort === 'campaignWorst') && (
          <span className="text-[10.5px] text-[#9ca3af] max-w-[290px] leading-snug">
            Diurutkan menurut ER post campaign dibanding ER post non-campaign akun itu sendiri.
            Profil yang belum pernah menjalankan campaign ada di urutan paling akhir.
          </span>
        )}
        {filters.view === 'table' && (
          <div className="relative">
            <Btn variant="secondary" size="sm" onClick={() => setColsOpen(o => !o)}>
              <span className="material-symbols-outlined text-[14px]">view_column</span>Kolom
            </Btn>
            {colsOpen && (
              <ColumnsMenu
                hidden={filters.hiddenColumns}
                onToggle={id => update({
                  hiddenColumns: filters.hiddenColumns.includes(id)
                    ? filters.hiddenColumns.filter(x => x !== id)
                    : [...filters.hiddenColumns, id],
                })}
                onReset={() => update({ hiddenColumns: DEFAULT_HIDDEN })}
                onClose={() => setColsOpen(false)}
              />
            )}
          </div>
        )}
        <div className="flex rounded-lg border border-[#e5e7eb] overflow-hidden">
          {(['card', 'table'] as const).map(v => (
            <button key={v} type="button" onClick={() => update({ view: v })} style={PJ}
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 h-8 ${
                filters.view === v ? 'bg-[#f0f7fa] text-[#285D6E]' : 'bg-white text-[#9ca3af] hover:text-[#374151]'
              }`}>
              <span className="material-symbols-outlined text-[15px]">{v === 'card' ? 'grid_view' : 'table_rows'}</span>
              {v === 'card' ? 'Card' : 'Table'}
            </button>
          ))}
        </div>
        <Btn size="sm" onClick={() => exportCsv(exportRows(), EXPORT_COLS, 'kol-directory')}>
          <span className="material-symbols-outlined text-[14px]">download</span>CSV
        </Btn>
        <Btn size="sm" onClick={() => exportExcel(exportRows(), EXPORT_COLS, 'kol-directory')}>
          <span className="material-symbols-outlined text-[14px]">table_view</span>Excel
        </Btn>
        {!panelOpen && (
          <Btn size="sm" variant="secondary" onClick={() => setPanelOpen(true)}>
            <span className="material-symbols-outlined text-[14px]">tune</span>
            Filter{activeCount > 0 && ` (${activeCount})`}
          </Btn>
        )}
      </div>

      {/* Category quick-chips — the source's `#catChips` strip. Category is also
          in the filter panel, but it is the filter people reach for first, and a
          panel you have to open is not "first". */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        <Chip label="Semua kategori" on={filters.category === 'all'}
          onClick={() => update({ category: 'all' })} />
        {CATEGORIES.map(c => (
          <Chip key={c} label={c} on={filters.category === c}
            onClick={() => update({ category: filters.category === c ? 'all' : c })} />
        ))}
      </div>

      <ConfidenceLegend />

      {/* bulk action bar */}
      {bulk.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-[#f0f7fa] border border-[#A7C8D4] rounded-xl px-3.5 py-2 mt-3">
          <span className="material-symbols-outlined text-[16px] text-[#285D6E]">check_circle</span>
          <b style={PJ} className="text-[12px] text-[#285D6E]">{bulk.size} dipilih</b>
          <div className="flex-1" />
          <Btn size="sm" onClick={() => { bulk.forEach(id => { if (!shortlist.ids.has(id)) shortlist.toggle(id) }) }}>
            <span className="material-symbols-outlined text-[14px]">compare</span>Tambah ke shortlist
          </Btn>
          <Btn size="sm" onClick={() => { bulk.forEach(id => { if (!bookmarks.ids.has(id)) bookmarks.toggle(id) }) }}>
            <span className="material-symbols-outlined text-[14px]">bookmark_add</span>Bookmark
          </Btn>
          {onAddToCampaign && (
            <Btn size="sm" variant="primary" onClick={() => onAddToCampaign([...bulk])}>
              <span className="material-symbols-outlined text-[14px]">campaign</span>Add to campaign
            </Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setBulk(new Set())}>
            <span className="material-symbols-outlined text-[14px]">close</span>Bersihkan
          </Btn>
        </div>
      )}

      <div className="grid items-start gap-4 mt-3"
        style={{ gridTemplateColumns: panelOpen ? 'minmax(0,1fr) 250px' : 'minmax(0,1fr)' }}>
        <div className="min-w-0">
          {pageRows.length === 0 ? (
            <EmptyState icon="person_search" title="Tidak ada KOL yang cocok"
              body="Longgarkan filter atau ganti kata kunci pencarian."
              action={<Btn size="sm" onClick={reset}>Reset filter</Btn>} />
          ) : filters.view === 'card' ? (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))' }}>
              {pageRows.map(p => (
                <KolCard key={`${p.account.relation}:${p.account.id}`} profile={p} orgSlug={orgSlug}
                  onOpen={onSelectKol ? () => onSelectKol(p.account.id, p.account.relation, p.account.username) : undefined}
                  onOrder={onOrderKol ? () => onOrderKol(p.account.id, p.account.relation, p.account.username) : undefined}
                  cartUnits={cart.lines.filter(l => l.socialAccountId === p.account.id).reduce((n, l) => n + l.qty, 0)}
                  selected={bulk.has(p.account.id)} onSelect={() => toggleBulk(p.account.id)}
                  shortlisted={shortlist.ids.has(p.account.id)} onShortlist={() => shortlist.toggle(p.account.id)}
                  bookmarked={bookmarks.ids.has(p.account.id)} onBookmark={() => bookmarks.toggle(p.account.id)} />
              ))}
            </div>
          ) : (
            <KolTable rows={pageRows} orgSlug={orgSlug} bulk={bulk} onToggle={toggleBulk} onOpen={onSelectKol}
              onOrder={onOrderKol} cart={cart}
              allSelected={allOnPageSelected} onToggleAll={toggleAllOnPage}
              hiddenColumns={filters.hiddenColumns}
              shortlist={shortlist} bookmarks={bookmarks} />
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-2 mt-5">
              <Btn size="sm" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>
                <span className="material-symbols-outlined text-[14px]">chevron_left</span>Prev
              </Btn>
              <span style={PJ} className="text-[11.5px] font-bold text-[#6b7280]">{safePage} / {pageCount}</span>
              <Btn size="sm" disabled={safePage >= pageCount} onClick={() => setPage(p => p + 1)}>
                Next<span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </Btn>
            </div>
          )}
        </div>

        {panelOpen && (
          <FilterPanel filters={filters} update={update} onReset={reset}
            onClose={() => setPanelOpen(false)}
            formats={[...new Set(profiles.map(p => p.topFormat.value))]}
            platforms={[...new Set(profiles.map(p => p.account.platform))]} />
        )}
      </div>
    </div>
  )
}

/* ── filter panel ─────────────────────────────────────────────────────────── */

function FilterPanel({
  filters, update, onReset, onClose, formats, platforms,
}: {
  filters: DirectoryFilters; update: (p: Partial<DirectoryFilters>) => void
  onReset: () => void; onClose: () => void; formats: string[]; platforms: string[]
}) {
  return (
    <aside className="bg-white border border-[#e5e7eb] rounded-xl p-3 sticky top-4 self-start">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[17px] text-[#327488]">tune</span>
        <span style={PJ} className="flex-1 text-[12.5px] font-extrabold text-[#111827]">Filter</span>
        <button type="button" onClick={onReset} className="text-[10.5px] font-bold text-[#327488] hover:underline">Reset</button>
        <button type="button" onClick={onClose} title="Tutup"
          className="material-symbols-outlined text-[17px] text-[#9ca3af] hover:text-[#374151] cursor-pointer">chevron_right</button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto pr-1 flex flex-col gap-3">
        <Group title="Tipe akun" icon="inventory_2">
          {([['all', 'Semua'], ['owned', 'Brand'], ['competitor', 'Kompetitor']] as const).map(([v, l]) => (
            <Chip key={v} label={l} on={filters.relation === v} onClick={() => update({ relation: v })} />
          ))}
        </Group>

        <Group title="Platform" icon="hub">
          <Chip label="Semua" on={filters.platform === 'all'} onClick={() => update({ platform: 'all' })} />
          {platforms.map(p => (
            <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} on={filters.platform === p}
              onClick={() => update({ platform: p })} icon={PLATFORM_ICON[p]} />
          ))}
        </Group>

        <Group title="Kategori" icon="category" estimated>
          <Chip label="Semua" on={filters.category === 'all'} onClick={() => update({ category: 'all' })} />
          {CATEGORIES.map(c => (
            <Chip key={c} label={c} on={filters.category === c} onClick={() => update({ category: c })} />
          ))}
        </Group>

        <Group title="Lifestyle" icon="diversity_3" estimated>
          <Chip label="Semua" on={filters.lifestyle === 'all'} onClick={() => update({ lifestyle: 'all' })} />
          {LIFESTYLES.map(c => (
            <Chip key={c} label={c} on={filters.lifestyle === c} onClick={() => update({ lifestyle: c })} />
          ))}
        </Group>

        <Group title="Lokasi" icon="location_on" estimated>
          <Chip label="Semua" on={filters.location === 'all'} onClick={() => update({ location: 'all' })} />
          {LOCATIONS.map(c => (
            <Chip key={c} label={c} on={filters.location === c} onClick={() => update({ location: c })} />
          ))}
        </Group>

        <Group title="Tier" icon="workspace_premium">
          <Chip label="Semua" on={filters.tier === 'all'} onClick={() => update({ tier: 'all' })} />
          {TIERS.map(c => (
            <Chip key={c} label={c} on={filters.tier === c} onClick={() => update({ tier: c })} />
          ))}
        </Group>

        <Group title="Umur dominan" icon="cake" estimated>
          <Chip label="Semua" on={filters.age === 'all'} onClick={() => update({ age: 'all' })} />
          {AGE_BANDS.map(c => (
            <Chip key={c} label={c} on={filters.age === c} onClick={() => update({ age: c })} />
          ))}
        </Group>

        <Group title="Gender mayoritas" icon="wc" estimated>
          {([['all', 'Semua'], ['female', 'Perempuan'], ['male', 'Laki-laki']] as const).map(([v, l]) => (
            <Chip key={v} label={l} on={filters.gender === v} onClick={() => update({ gender: v })} />
          ))}
        </Group>

        <Group title="Format konten" icon="movie">
          <Chip label="Semua" on={filters.format === 'all'} onClick={() => update({ format: 'all' })} />
          {formats.map(c => (
            <Chip key={c} label={c} on={filters.format === c} onClick={() => update({ format: c })} />
          ))}
        </Group>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">filter_alt</span>
            <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">Ambang metrik</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <SelectPill icon="group" label="Followers" value={filters.followersMin}
              options={FOLLOWER_OPTS} onChange={v => update({ followersMin: v })} />
            <SelectPill icon="bolt" label="Engagement rate" value={filters.erMin}
              options={ER_OPTS} onChange={v => update({ erMin: v })} />
            <SelectPill icon="visibility" label="Est. reach" value={filters.reachMin}
              options={REACH_OPTS} onChange={v => update({ reachMin: v })} />
            <SelectPill icon="verified_user" label="Authenticity" value={filters.authMin}
              options={AUTH_OPTS} onChange={v => update({ authMin: v })} />
            <SelectPill icon="handshake" label="Brand fit" value={filters.brandFitMin}
              options={FIT_OPTS} onChange={v => update({ brandFitMin: v })} />
            <SelectPill icon="sell" label="Rasio paid" value={filters.paidMax}
              options={PAID_OPTS} onChange={v => update({ paidMax: v })} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Toggle label="Hanya terverifikasi" on={filters.verifiedOnly}
            onClick={() => update({ verifiedOnly: !filters.verifiedOnly })} />
          <Toggle label="Hanya yang punya rate card" on={filters.ratedOnly}
            onClick={() => update({ ratedOnly: !filters.ratedOnly })} />
        </div>
      </div>
    </aside>
  )
}

function Group({
  title, icon, children, estimated,
}: { title: string; icon: string; children: React.ReactNode; estimated?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">{icon}</span>
        <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{title}</span>
        {estimated && <ConfidenceBadge confidence="estimated" basis="Atribut ini dimodelkan — sumber datanya belum ada" compact />}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={PJ}
      className={`flex items-center gap-2 h-8 px-2.5 rounded-lg border text-[11.5px] font-bold transition-colors ${
        on ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]' : 'bg-white border-[#e5e7eb] text-[#6b7280]'
      }`}>
      <span className="material-symbols-outlined text-[14px]">{on ? 'check_box' : 'check_box_outline_blank'}</span>
      {label}
    </button>
  )
}

/* ── card ─────────────────────────────────────────────────────────────────── */

const initials = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'

function KolCard({
  profile: p, orgSlug, selected, onSelect, shortlisted, onShortlist, bookmarked, onBookmark,
  onOpen, onOrder, cartUnits = 0,
}: {
  profile: KolProfile; orgSlug: string; selected: boolean; onSelect: () => void
  shortlisted: boolean; onShortlist: () => void; bookmarked: boolean; onBookmark: () => void
  onOpen?: () => void
  onOrder?: () => void
  cartUnits?: number
}) {
  const a = p.account
  const inCart = cartUnits > 0
  const href = `/organizations/${orgSlug}/discover/kol/${a.id}?relation=${a.relation}`
  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-all ${
      selected ? 'border-[#327488] shadow-sm' : 'border-[#e5e7eb] hover:shadow-md hover:border-[#A7C8D4]'
    }`}>
      <div className="relative h-[58px]" style={{ background: gradientFor(a.id) }}>
        <label className="absolute top-2 left-2 cursor-pointer">
          <input type="checkbox" checked={selected} onChange={onSelect}
            className="accent-[#327488] w-3.5 h-3.5 cursor-pointer" />
        </label>
        {/* Favourite · Compare · Order — the third one is the entry into the
            ordering flow, the same trio the source platform's creator card had. */}
        <div className="absolute top-2 right-2 flex gap-1.5">
          <IconBtn on={bookmarked} onClick={onBookmark} icon="bookmark" title="Bookmark" />
          <IconBtn on={shortlisted} onClick={onShortlist} icon={shortlisted ? 'check' : 'add'} title="Shortlist" />
          {onOrder && (
            <IconBtn on={inCart} onClick={onOrder}
              icon={inCart ? 'shopping_cart_checkout' : 'add_shopping_cart'}
              title={inCart ? `Di keranjang (${cartUnits}) — buka Rate Card` : 'Order KOL ini'} />
          )}
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="flex items-end gap-2 -mt-6 mb-1.5">
          <div style={{ ...PJ, background: gradientFor(a.username) }}
            className="w-12 h-12 rounded-xl border-[3px] border-white flex items-center justify-center text-white text-[14px] font-extrabold shadow-sm">
            {initials(a.username)}
          </div>
          <div className="mb-1 flex items-center gap-1">
            <span style={PJ} className={`rounded-md text-[9px] font-extrabold uppercase px-1.5 py-0.5 ${
              a.relation === 'owned' ? 'bg-[#eaf5ef] text-[#3d8a5f]' : 'bg-[#f3f0fb] text-[#6b5bb5]'
            }`}>{a.relation === 'owned' ? 'Brand' : 'Competitor'}</span>
            {p.verified.value && (
              <span className="material-symbols-outlined text-[14px] text-[#327488]" title="Terverifikasi (estimated)">verified</span>
            )}
          </div>
        </div>

        {onOpen ? (
          <button type="button" onClick={onOpen} className="block text-left w-full group">
            <div style={PJ} className="text-[13px] font-extrabold text-[#111827] truncate group-hover:text-[#285D6E]">
              {a.username}
            </div>
          </button>
        ) : (
          <Link href={href} className="block group">
            <div style={PJ} className="text-[13px] font-extrabold text-[#111827] truncate group-hover:text-[#285D6E]">
              {a.username}
            </div>
          </Link>
        )}
        <div className="flex items-center gap-1 text-[10.5px] text-[#9ca3af] mt-0.5 flex-wrap">
          <span className="material-symbols-outlined text-[12px]">{PLATFORM_ICON[a.platform] ?? 'public'}</span>
          <span className="capitalize">{a.platform}</span>
          <span className="text-[#d1d5db]">·</span>
          <span>{p.category.value}</span>
          <span className="text-[#d1d5db]">·</span>
          <span>{p.location.value}</span>
        </div>

        <div className="grid grid-cols-3 gap-1 mt-2.5 pt-2.5 border-t border-[#f3f4f6]">
          <Stat label="Followers" node={<MetricValue metric={p.followers} format={fmtNum} />} />
          <Stat label="ER" node={<MetricValue metric={p.erPct} format={v => `${v.toFixed(1)}%`} />} />
          <Stat label="Est. reach" node={<MetricValue metric={p.estimatedReach} format={fmtNum} />} />
        </div>

        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[#f3f4f6]">
          <span className="inline-flex items-center gap-1 text-[10.5px] text-[#9ca3af]">
            <span className="material-symbols-outlined text-[13px]">handshake</span>
            Brand fit
            <b style={PJ} className="text-[12px] text-[#285D6E]">{p.brandFit.value}</b>
            <ConfidenceBadge confidence={p.brandFit.confidence} basis={p.brandFit.basis} compact />
          </span>
          <span className="text-[10.5px] text-[#9ca3af]">
            {p.hasRate ? idr(p.baseRate) : <span className="text-[#b5761f]">no rate</span>}
          </span>
        </div>

        {p.campaignPosts.value > 0 && (
          <div className="flex items-center justify-between mt-1.5">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[#9ca3af]">
              <span className="material-symbols-outlined text-[13px]">campaign</span>
              Campaign
              <b style={PJ} className="text-[11px] text-[#374151]">{p.campaignPosts.value} post</b>
            </span>
            <CampaignLift lift={p.campaignLift.value} />
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          {onOrder && (
            <Btn size="sm" variant={inCart ? 'secondary' : 'primary'} onClick={onOrder}>
              <span className="material-symbols-outlined text-[14px]">
                {inCart ? 'shopping_cart_checkout' : 'add_shopping_cart'}
              </span>
              {inCart ? `Keranjang (${cartUnits})` : 'Order'}
            </Btn>
          )}
          {onOpen ? (
            <Btn size="sm" variant="secondary" onClick={onOpen}>
              <span className="material-symbols-outlined text-[14px]">insights</span>Analisis
            </Btn>
          ) : (
            <Link href={href}>
              <Btn size="sm" variant="secondary">
                <span className="material-symbols-outlined text-[14px]">insights</span>Detail &amp; pesan
              </Btn>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Campaign lift as a chip: how this profile's campaign posts did against its own
 * ordinary ones. Above 1× means paying it to post moved its numbers; below means
 * its campaign work underperforms what it does unpaid, which is the thing worth
 * knowing before booking it again.
 */
function CampaignLift({ lift }: { lift: number | null }) {
  if (lift === null) {
    return <span className="text-[10.5px] text-[#9ca3af]">belum terukur</span>
  }
  const tone = lift >= 1.2
    ? { bg: '#eaf5ef', fg: '#3d8a5f', icon: 'trending_up' }
    : lift >= 0.8
      ? { bg: '#f3f4f6', fg: '#6b7280', icon: 'trending_flat' }
      : { bg: '#fdf3e7', fg: '#b5761f', icon: 'trending_down' }

  return (
    <span style={{ ...PJ, background: tone.bg, color: tone.fg }}
      title="ER post campaign dibanding ER post non-campaign akun ini"
      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9.5px] font-extrabold">
      <span className="material-symbols-outlined text-[12px]">{tone.icon}</span>
      {lift.toFixed(2)}× baseline
    </span>
  )
}

function IconBtn({ on, onClick, icon, title }: { on: boolean; onClick: () => void; icon: string; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
        on ? 'bg-[#327488] text-white' : 'bg-white/90 text-[#6b7280] hover:text-[#285D6E]'
      }`}>
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
    </button>
  )
}

function Stat({ label, node }: { label: string; node: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="text-[12px] font-extrabold text-[#111827] flex justify-center">{node}</div>
      <div className="text-[9.5px] text-[#9ca3af] mt-0.5">{label}</div>
    </div>
  )
}

/* ── table ────────────────────────────────────────────────────────────────── */

function KolTable({
  rows, orgSlug, bulk, onToggle, allSelected, onToggleAll, shortlist, bookmarks, onOpen, onOrder, cart,
  hiddenColumns,
}: {
  rows: KolProfile[]; orgSlug: string; bulk: Set<string>; onToggle: (id: string) => void
  allSelected: boolean; onToggleAll: () => void
  hiddenColumns: string[]
  onOpen?: (id: string, relation: 'owned' | 'competitor', username: string) => void
  onOrder?: (id: string, relation: 'owned' | 'competitor', username: string) => void
  cart?: ReturnType<typeof useDiscoverCart>
  shortlist: ReturnType<typeof useDiscoverSelection>
  bookmarks: ReturnType<typeof useDiscoverSelection>
}) {
  const cols = TABLE_COLUMNS.filter(c => !hiddenColumns.includes(c.id))
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-x-auto">
      {/* Width scales with the column count so hiding columns actually reclaims
          the horizontal scroll instead of stretching the survivors. */}
      <table className="w-full" style={{ minWidth: 320 + cols.length * 78 }}>
        <thead>
          <tr className="border-b border-[#e5e7eb]">
            <th className="px-3 py-2.5">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                className="accent-[#327488] w-3.5 h-3.5 cursor-pointer" />
            </th>
            <th style={PJ} className="text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 text-left">
              Akun
            </th>
            {cols.map(c => (
              <th key={c.id} style={PJ}
                className={`text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 ${c.right ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const a = p.account
            const href = `/organizations/${orgSlug}/discover/kol/${a.id}?relation=${a.relation}`
            return (
              <tr key={`${a.relation}:${a.id}`} className={`border-b border-[#f3f4f6] last:border-0 ${
                bulk.has(a.id) ? 'bg-[#f0f7fa]' : 'hover:bg-[#f9fafb]'
              }`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={bulk.has(a.id)} onChange={() => onToggle(a.id)}
                    className="accent-[#327488] w-3.5 h-3.5 cursor-pointer" />
                </td>
                <td className="px-3 py-2">
                  <NameCell account={a} href={href}
                    onOpen={onOpen ? () => onOpen(a.id, a.relation, a.username) : undefined} />
                </td>
                {cols.map(c => (c.right
                  ? <Num key={c.id}>{c.cell(p)}</Num>
                  : <td key={c.id} className="px-3 py-2 text-[11px] text-[#6b7280]">{c.cell(p)}</td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    <IconBtn on={bookmarks.ids.has(a.id)} onClick={() => bookmarks.toggle(a.id)} icon="bookmark" title="Bookmark" />
                    <IconBtn on={shortlist.ids.has(a.id)} onClick={() => shortlist.toggle(a.id)}
                      icon={shortlist.ids.has(a.id) ? 'check' : 'add'} title="Shortlist" />
                    {onOrder && (() => {
                      const units = (cart?.lines ?? [])
                        .filter(l => l.socialAccountId === a.id)
                        .reduce((n, l) => n + l.qty, 0)
                      return (
                        <IconBtn on={units > 0}
                          onClick={() => onOrder(a.id, a.relation, a.username)}
                          icon={units > 0 ? 'shopping_cart_checkout' : 'add_shopping_cart'}
                          title={units > 0 ? `Di keranjang (${units})` : 'Order KOL ini'} />
                      )
                    })()}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ColumnsMenu({
  hidden, onToggle, onReset, onClose,
}: {
  hidden: string[]
  onToggle: (id: string) => void
  onReset: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-20 w-[220px] bg-white border border-[#e5e7eb] rounded-xl shadow-lg p-2">
        <div style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af] px-1 pb-1.5">
          Kolom tabel
        </div>
        <div className="flex flex-col max-h-[280px] overflow-y-auto">
          {TABLE_COLUMNS.map(c => (
            <label key={c.id}
              className="flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-[#f9fafb] cursor-pointer">
              <input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => onToggle(c.id)}
                className="accent-[#327488] w-3.5 h-3.5 cursor-pointer" />
              <span style={PJ} className="text-[11.5px] font-bold text-[#374151]">{c.label}</span>
            </label>
          ))}
        </div>
        <div className="border-t border-[#f3f4f6] mt-1.5 pt-1.5">
          <Btn size="sm" variant="ghost" onClick={onReset}>
            <span className="material-symbols-outlined text-[14px]">restart_alt</span>Kembalikan default
          </Btn>
        </div>
      </div>
    </>
  )
}

function SavedListsMenu({
  lists, onApply, onDelete, onSave, onClose,
}: {
  lists: SavedList[]
  onApply: (l: SavedList) => void
  onDelete: (id: string) => void
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
  }

  return (
    <>
      {/* Click-away layer. A menu that only closes via its own button strands
          itself open behind whatever the user clicks next. */}
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-20 w-[262px] bg-white border border-[#e5e7eb] rounded-xl shadow-lg p-2">
        <div style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af] px-1 pb-1.5">
          Saved Lists
        </div>

        {lists.length === 0 ? (
          <p className="text-[11px] text-[#9ca3af] px-1 pb-2">
            Belum ada. Simpan kombinasi filter yang sedang aktif supaya bisa dipakai lagi.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto">
            {lists.map(l => (
              <div key={l.id} className="flex items-center gap-1 rounded-lg hover:bg-[#f9fafb] group">
                <button type="button" onClick={() => onApply(l)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left px-1.5 py-1.5">
                  <span className="material-symbols-outlined text-[15px] text-[#4E96AC]">bookmark</span>
                  <span style={PJ} className="text-[11.5px] font-bold text-[#374151] truncate">{l.name}</span>
                </button>
                <button type="button" onClick={() => onDelete(l.id)} aria-label={`Hapus ${l.name}`}
                  className="w-6 h-6 mr-1 flex items-center justify-center rounded text-[#d1d5db] hover:text-[#c2553f] hover:bg-[#fcefec]">
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-[#f3f4f6] mt-1.5 pt-1.5 flex items-center gap-1">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Nama list…"
            className="flex-1 min-w-0 h-7 px-2 rounded-lg border border-[#e5e7eb] text-[11.5px] text-[#374151] placeholder:text-[#9ca3af] focus:outline-none focus:border-[#327488]"
          />
          <Btn size="sm" variant="primary" disabled={!name.trim()} onClick={submit}>
            <span className="material-symbols-outlined text-[14px]">save</span>Simpan
          </Btn>
        </div>
      </div>
    </>
  )
}

function Num({ children }: { children: React.ReactNode }) {
  return <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{children}</td>
}

function NameCell({
  account: a, href, onOpen,
}: { account: DirectoryAccount; href: string; onOpen?: () => void }) {
  const inner = (
    <>
      <div style={{ ...PJ, background: gradientFor(a.username) }}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold">
        {initials(a.username)}
      </div>
      <div className="min-w-0">
        <div style={PJ} className="text-[12px] font-bold text-[#111827] group-hover:text-[#285D6E] truncate">
          {a.username}
        </div>
        <div className="text-[9.5px] text-[#9ca3af] capitalize">{a.platform}</div>
      </div>
    </>
  )
  return onOpen
    ? <button type="button" onClick={onOpen} className="flex items-center gap-2 group text-left">{inner}</button>
    : <Link href={href} className="flex items-center gap-2 group">{inner}</Link>
}
