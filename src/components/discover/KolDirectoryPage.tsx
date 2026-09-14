'use client'

/**
 * KOL Directory — the commercial KOL platform's roster.
 *
 * Layout, interactions and card anatomy are ported from that platform's
 * `directory.js`: the header count line, the search + category chips + pills
 * toolbar, the persistent filter sidebar (see KolDirectoryFilters), the card
 * grid with banner/avatar/stat trio, the sortable table with a column chooser
 * and a bulk action bar, and the paging strip.
 *
 * What differs is the data. The source ran over eight hardcoded creators in the
 * browser; this reads ~7.7k rows from `public.kol_directory` in the KOL database
 * through `/api/organizations/[id]/discover/kol-directory`, so search, filters,
 * sorting and paging all happen in SQL. Anything the source showed that the
 * roster has no column for — EMV, authenticity, growth, brand-fit match, agency,
 * rate card — is left out rather than invented.
 *
 * Colours are autometric's teal ramp from globals.css via TOKENS, not the source
 * platform's blue; the shapes, spacing and type scale are the source's.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PJ, TOKENS as T, fmtNum, initialsOf, RosterAvatar } from './ui'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import AddKolDirectoryModal from './AddKolDirectoryModal'
import {
  KOL_FILTERS_DEFAULT, KolFilterPanel, KolFilterTab, activeFilterCount, appliedFilters, filtersToParams,
  normalizeKolFilters,
  type KolFilters,
} from './KolDirectoryFilters'
import { useDiscoverCart } from './useDiscoverCart'
import CreatorQuickInsight from './CreatorQuickInsight'
import { useCreatorLinks } from './useCreatorLinks'
import {
  CREATOR_PRESETS, creatorBadges, creatorSignals, presetById, relaxSuggestions,
  type CreatorBadge, type CreatorSignals, type MatchCriteria, type PresetId,
} from '@/lib/discover/creatorMatch'
import { selectionKey, useDiscoverSelection } from './useDiscoverSelection'
import { useDiscoverFavorites } from './useDiscoverFavorites'
import { useSavedLists } from './useSavedLists'
import { tabHref } from '@/lib/discover/tabs'
import type {
  KolDataStatus, KolDirectoryFacets, KolDirectoryMatch, KolDirectoryPayload, KolDirectoryRow,
} from '@/lib/discover/kolDirectory'
import type { MatchExplanation } from '@/lib/discover/brandMatch/explain'
import { MatchBadge, NoBrandProfileNotice } from './MatchBadge'
import type { Deliverable, RosterRateCard } from '@/lib/discover/vocab'
import type { TrackingStatus } from '@/lib/discover/types'

/* ── tokens & vocabulary ──────────────────────────────────────────────────── */

/** Semantic pairs already in use across Discover for data provenance. */
const STATUS: Record<KolDataStatus, { fg: string; bg: string; icon: string }> = {
  Live: { fg: '#3d8a5f', bg: '#eaf5ef', icon: 'sync' },
  Estimated: { fg: '#b5761f', bg: '#fdf3e7', icon: 'query_stats' },
  Calculated: { fg: '#6b5bb5', bg: '#f3f0fb', icon: 'function' },
}
/**
 * Never index STATUS directly. A value the SQL CASE does not produce today (a
 * label added on the KOL platform's side, say) would otherwise be `undefined`
 * here, and reading `.bg` off it throws inside render — which unmounts the whole
 * page rather than degrading one badge.
 */
const statusOf = (s: KolDataStatus) => STATUS[s] ?? STATUS.Estimated

/** Banner tints — steps of the brand ramp, not new hues. */
const BANNERS = ['#285D6E', '#327488', '#4E96AC', '#1E4A58', '#3d7e96', '#5b8fa3']

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'photo_camera', tiktok: 'music_note', facebook: 'thumb_up',
}
const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook',
}

/**
 * The Section Tabs that have a source (BE-04).
 *
 * Each is an ordering over a column the roster actually fills, so none of them
 * can render empty. `all` is the page's default ordering, kept as a tab so the
 * strip has a way back.
 */
const SECTION_TABS: { id: string; label: string; icon: string; sort: SortKey; hint: string }[] = [
  { id: 'all', label: 'Semua creator', icon: 'grid_view', sort: 'followers',
    hint: 'Seluruh roster aktif, terbesar dulu.' },
  { id: 'added', label: 'Baru ditambahkan', icon: 'person_add', sort: 'created',
    hint: 'Urut dari yang paling baru masuk database (kol_directory.created_at).' },
  { id: 'updated', label: 'Baru diperbarui', icon: 'update', sort: 'recent',
    hint: 'Urut dari yang angkanya paling baru diukur (kol_directory.last_refreshed_at).' },
]

/** The source's SORTOPTS, minus the keys this roster cannot rank on. */
export const SORTOPTS: [SortKey, string][] = [
  ['followers', 'Followers'],
  ['engagement', 'Engagement'],
  ['recent', 'Last updated'],
  // Exposed by BE-04. The backend has ordered by `created_at` since before this
  // page shipped — it was simply never offered, so "who is new here" could only
  // be asked from the Discovery landing's shelf.
  ['created', 'Recently added'],
  ['growth', 'Growth'],
  ['name', 'Name'],
  /**
   * Brand Match. The label names its own scope on purpose.
   *
   * The score is computed for the creators on the loaded page and the page is
   * re-ranked by it, so this orders ~20 creators, not the 7.432-row roster.
   * Calling it plain "Match Score" beside "Followers" — which really does rank
   * the whole directory — would read as a roster-wide ranking, and the top of
   * the list would look like "the best match in the database" when it is only
   * the best match among the twenty that happened to load.
   */
  ['match', 'Match Score · halaman ini'],
]
export type SortKey =
  'followers' | 'engagement' | 'recent' | 'created' | 'growth' | 'name' | 'match'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

/**
 * Whether the directory should adopt Match Score as its ordering by itself.
 *
 * Three conditions, and each one is a rule the product asked for:
 *
 *   scoreable    There is a saved Brand Profile, so there are scores to order
 *                by. Without one the route returns before it computes anything
 *                and the ordering would be over a page of nulls.
 *   !userPicked  Nobody has chosen an ordering yet. A default may fill a blank;
 *                it may never overrule a choice. This is what stops a workspace
 *                with a profile from snapping back to Match Score every time a
 *                response lands, which would make "Sort: Followers" look broken.
 *   != 'match'   Already there — nothing to do, and re-setting it would loop.
 *
 * Pure and exported so `verify:match-sort` can pin the latch without mounting
 * React, following `normalizeKolFilters` in `KolDirectoryFilters`.
 */
export function shouldDefaultToMatch(
  scoreable: boolean,
  userPicked: boolean,
  current: SortKey,
): boolean {
  return scoreable && !userPicked && current !== 'match'
}

/** Optional table columns — the source's COLDEFS. */
const COLDEFS: Record<string, { label: string; get: (r: KolDirectoryRow) => string; sort?: SortKey }> = {
  tier: { label: 'Tier', get: r => r.tier ?? '—' },
  growth: { label: 'Growth', get: r => growthLabel(r.growthPct), sort: 'growth' },
  reach: { label: 'Est. Reach', get: r => reachLabel(r) },
  platform: { label: 'Platform', get: r => (r.platform ? PLATFORM_LABEL[r.platform] ?? r.platform : '—') },
  category: { label: 'Category', get: r => (r.categories.length ? r.categories.join(' · ') : '—') },
  updated: { label: 'Updated', get: r => sinceLabel(r.lastRefreshedAt), sort: 'recent' },
  // The source's `agency` and `rate` columns. Both were dropped from this port
  // as unbacked; both are in fact backed — see `attachRosterExtras`.
  agency: { label: 'Agency', get: r => r.agency ?? '—' },
  rate: { label: 'Rate card', get: r => rateLabel(r) },
}
type ColKey = keyof typeof COLDEFS

const PAGE_SIZE = 12

/* ── row helpers ──────────────────────────────────────────────────────────── */

/** A creator keeps the same banner across pages and sorts. */
function bannerFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return BANNERS[h % BANNERS.length]
}
const gradOf = (c: string) => `linear-gradient(135deg,${c},${c}bb)`

/** "2h ago" / "3mo ago" from the last refresh the KOL platform recorded. */
function sinceLabel(iso: string | null): string {
  if (!iso) return 'never synced'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

const followersLabel = (n: number | null) => (n === null ? '—' : fmtNum(n))

/**
 * Change in followers since the account's PREVIOUS snapshot — 10-13 days apart
 * today, not a month. Never label this "monthly" or "30d". Null for creators
 * the pipeline has scraped only once, which is most of the roster.
 */
const growthLabel = (n: number | null) =>
  (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`)
const erLabel = (er: number | null) => (er === null ? '—' : `${er.toFixed(2)}%`)

/**
 * The engagement rate with the backend's own quality verdict attached.
 *
 * `erQuality` is decided server-side (`ER_SUSPECT_MIN`) and simply rendered
 * here — the threshold is a Product decision and must not be re-stated in the
 * UI, or the two would drift. `suspect` means the figure is inside the possible
 * range but implausibly high; it is still shown, marked, and still filterable.
 * Values that cannot be an engagement rate at all never arrive: `erPct` is null
 * for those and the raw number stays in `erRaw` for auditing.
 */
function ErValue({ row }: { row: KolDirectoryRow }) {
  if (row.erQuality !== 'suspect') return <>{erLabel(row.erPct)}</>
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color: '#b45309' }}
      title={`Engagement rate ${erLabel(row.erPct)} luar biasa tinggi untuk roster ini — `
        + 'ditandai perlu dicek, bukan dibuang. Nilai mentah: '
        + (row.erRaw === null ? '—' : `${row.erRaw}%`)}>
      {erLabel(row.erPct)}
      <span className="material-symbols-outlined text-[12px]">error</span>
    </span>
  )
}

/**
 * Est. Reach is followers × engagement rate — the roster stores no reach column,
 * so it is derived, and the card says so: rows carrying a measured rate are
 * badged Calculated, rows without one show no reach at all rather than a guess.
 */
/**
 * "from Rp1,4 jt" — the source's `'from ' + money(min(deliverables))`, in rupiah
 * and abbreviated, because the roster's prices run from Rp370K to Rp1 miliar and
 * a full number in a table cell pushes every other column off a laptop screen.
 */
export function rateLabel(r: KolDirectoryRow): string {
  if (r.rateFrom === null) return '—'
  return `from ${idrShort(r.rateFrom)}`
}

/** Rp1,4 jt · Rp95 jt · Rp1 mlr — Indonesian short scale, one decimal at most. */
export function idrShort(n: number): string {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(n % 1_000_000_000 ? 1 : 0)} mlr`
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} jt`
  if (n >= 1_000) return `Rp${Math.round(n / 1_000)}rb`
  return `Rp${n}`
}

function reachLabel(r: KolDirectoryRow): string {
  return r.followers === null || r.erPct === null ? '—' : fmtNum((r.followers * r.erPct) / 100)
}

/** 1 … 4 5 [6] 7 8 … 644 — the roster is far too long for a button per page. */
function pageWindow(current: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(count - 1, current + 1)
  if (from > 2) out.push('…')
  for (let n = from; n <= to; n++) out.push(n)
  if (to < count - 1) out.push('…')
  out.push(count)
  return out
}

const EXPORT_COLUMNS: ExportColumn<KolDirectoryRow>[] = [
  { key: 'username', header: 'Username', value: r => r.username },
  { key: 'name', header: 'Name', value: r => r.displayName ?? '' },
  { key: 'platform', header: 'Platform', value: r => (r.platform ? PLATFORM_LABEL[r.platform] ?? r.platform : '') },
  { key: 'followers', header: 'Followers', value: r => r.followers ?? '' },
  { key: 'er', header: 'Engagement rate (%)', value: r => r.erPct ?? '' },
  { key: 'tier', header: 'Tier', value: r => r.tier ?? '' },
  // The header carries the window because the number cannot: an export outlives
  // the screen that explained it.
  { key: 'growth', header: 'Growth % (sejak snapshot terakhir)',
    value: r => (r.growthPct === null ? '' : r.growthPct) },
  { key: 'categories', header: 'Categories', value: r => r.categories.join(' · ') },
  { key: 'status', header: 'Data status', value: r => r.status },
  { key: 'updated', header: 'Last refreshed', value: r => r.lastRefreshedAt ?? '' },
  { key: 'profile', header: 'Profile URL', value: r => r.profileUrl ?? '' },
]


/* ── page ─────────────────────────────────────────────────────────────────── */

/**
 * `embedded` drops the page chrome — the tinted full-height background, the
 * centring wrapper and the `<h2>` — for the KOL Intelligence workspace, which
 * already renders a breadcrumb and a page header above this. The count line and
 * the actions beside it stay: they describe the result set, not the page.
 */
export default function KolDirectoryPage({
  orgId, orgSlug, embedded = false, initialQuery = '', onAddCreator, onFindSimilar,
}: {
  orgId: string
  orgSlug: string
  embedded?: boolean
  /**
   * What to search for on arrival — the Discovery hub's search box hands its
   * query over this way. Seeded into both `query` and `search` so the first
   * fetch already carries it, rather than firing an unfiltered request and then
   * a second one 350ms later when the debounce catches up.
   */
  initialQuery?: string
  /**
   * Historically, where `Add KOL` handed off to — My Creators, which owns the
   * `discover_creators` intake flow (validation, duplicate check, profiling).
   * The `Add KOL` button on this page no longer calls this: it now owns its
   * own intake flow straight into `kol_directory` (see `AddKolDirectoryModal`),
   * because adding to the commercial roster is a different action against a
   * different table than adding a tracked creator to this org. The prop stays
   * on the signature for any other caller that still wants a hand-off hook.
   */
  onAddCreator?: () => void
  /**
   * Smart Discovery's second entry point: take this row as the reference and
   * go looking for creators like it.
   *
   * It matters that this is offered *here*. Smart Discovery used to be reachable
   * only from the creators an org had added by hand, which quietly made the
   * feature about the roster — you could not ask "find me more like this" about
   * one of the 7.7k creators in the database unless you first adopted them. The
   * reference only has to be somebody whose shape you want more of, so every row
   * on this page can be one.
   */
  onFindSimilar?: (kolId: string) => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [search, setSearch] = useState(initialQuery)
  const [filters, setFilters] = useState<KolFilters>(KOL_FILTERS_DEFAULT)
  /**
   * The active smart preset. It is held beside the filters rather than folded
   * into them because it does two things a filter cannot: it applies its own
   * real filters *and* it ranks what comes back. Clearing filters clears it too.
   */
  const [preset, setPreset] = useState<PresetId | null>(null)
  /** Which creator's quick-insight panel is open, if any. */
  const [insightId, setInsightId] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState>({ key: 'followers', dir: 'desc' })
  /**
   * Whether the ordering on screen is the user's choice or ours.
   *
   * A workspace with a Brand Profile opens on Match Score (see the effect below),
   * but that is a DEFAULT and not a preference: the moment someone picks an
   * ordering — from the Sort dropdown, a column header, or a section tab — this
   * latches and the default never reasserts itself. Without it, choosing
   * "Followers" would be undone by the next response that carries scores, and
   * the control would look broken.
   *
   * A ref rather than state: nothing renders from it, and it must not schedule a
   * render of its own.
   */
  const sortPicked = useRef(false)
  const [view, setView] = useState<'card' | 'table'>('card')
  const [page, setPage] = useState(1)

  const [filtPanel, setFiltPanel] = useState(false)
  const [fpOpen, setFpOpen] = useState<Set<string>>(new Set(['platform']))
  const [cols, setCols] = useState<Record<ColKey, boolean>>({
    tier: true, growth: true, reach: true, platform: true, category: false, updated: false,
    // Rate card is on by default: it is the column a buyer opens the table for.
    rate: true, agency: false,
  })
  const [colOpen, setColOpen] = useState(false)
  const [listsOpen, setListsOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  const [rows, setRows] = useState<KolDirectoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<KolDirectoryFacets | null>(null)
  /**
   * The real Brand Match for this page, from `@/lib/discover/brandMatch`.
   *
   * Server-computed and carried on the payload rather than derived here: the
   * engine reads six medallion tables the browser has no access to, and the
   * score has to be the same number Compare and the creator report show.
   *
   * `null` until the first response. `match.scoreable === false` means the
   * workspace has not saved a Brand Profile, which is a different state from
   * "this creator could not be scored" and is drawn differently.
   */
  const [match, setMatch] = useState<KolDirectoryMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by the retry button — the KOL host is remote and can blip. */
  const [reload, setReload] = useState(0)
  /**
  * Filter options describe the whole roster, so they are fetched once — except
  * that the tier counts are now scoped to the selected platform (BE-02), so they
  * are fetched again when the platform changes. Holds the platform the current
  * facets were built for; `null` before the first load, `''` for "all platforms".
  */
  const facetsFor = useRef<string | null>(null)

  /**
   * Selection keeps whole rows, not just ids: the grid only ever holds one page,
   * and Export / Compare have to work on creators picked across several pages.
   */
  const [selected, setSelected] = useState<Map<string, KolDirectoryRow>>(new Map())
  /**
   * Favourites are server-backed — see `useDiscoverFavorites`. They used to be a
   * bare `useState` here, which meant the heart filled, a toast said "added to
   * favourites", and the whole set was gone on the next navigation. Compare
   * below stays in the browser on purpose: it is one sitting's working set.
   */
  const favorites = useDiscoverFavorites(orgId)
  const compare = useDiscoverSelection(orgId, 'compare')
  /**
   * My Creators and tracking — the two decisions the whole workspace shares.
   *
   * Beside `compare` (this sitting) and `favorites` (this person) rather than
   * folded into either: adopting a creator into the org's roster and putting
   * them under monitoring are things a colleague sees, and the grid has to draw
   * all three states on one card.
   */
  const links = useCreatorLinks(orgId)
  const cart = useDiscoverCart(orgId)
  /**
   * Prices this org has stated for roster creators, keyed by creator id.
   *
   * The roster carries no price of its own, so Add to Cart cannot work until
   * somebody sets one — this is what the button checks before it can do anything
   * but ask. Loaded once with the page rather than per row.
   */
  const [rosterRates, setRosterRates] = useState<Record<string, RosterRateCard>>({})
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  /** The creator whose price is being set, when the rate dialog is open. */
  const [pricing, setPricing] = useState<KolDirectoryRow | null>(null)
  /**
   * Saved lists live in the database now — see `useSavedLists`. They were kept
   * in `localStorage` under `autometric.kolDirectory.lists.<org>`; the hook
   * adopts anything still stored there on first load, then drops it.
   */
  const savedLists = useSavedLists<KolFilters>(orgId, 'database')
  const [toast, setToast] = useState<string | null>(null)
  /** The Add New KOL dialog — this page's own intake flow into `kol_directory`. */
  const [addOpen, setAddOpen] = useState(false)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  /**
   * Compare selection, shared with the Compare tab through localStorage.
   *
   * Was a local Set until now, which meant the button lit an icon and the
   * comparison never saw the creator — the same dead end Add to Cart had. Roster
   * ids are stored prefixed, so Compare can tell them from tracked accounts.
   */
  const inCompare = useCallback(
    (id: string) => compare.ids.has(selectionKey('roster', id)),
    [compare.ids])

  const toggleCompare = useCallback((r: KolDirectoryRow) => {
    const was = compare.ids.has(selectionKey('roster', r.id))
    compare.toggle(selectionKey('roster', r.id))
    flash(was ? `@${r.username} dihapus dari compare` : `@${r.username} ditambahkan ke compare`)
  }, [compare, flash])


  /* data */
  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(query.trim()); setPage(1) }, 350)
    return () => window.clearTimeout(t)
  }, [query])

  /**
   * Roster prices and the deliverable catalogue, fetched once.
   *
   * The grid shows a price badge per row and Add to Cart needs the platform's
   * headline deliverable, so both have to be here before the first click. A
   * failure leaves Add to Cart offering to set a price, which is the same thing
   * it does for a creator nobody has priced — no worse a state than the truth.
   */
  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/rates`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rosterRates?: Record<string, RosterRateCard>; deliverables: Deliverable[] }) => {
        if (cancelled) return
        setRosterRates(d.rosterRates ?? {})
        setDeliverables(d.deliverables ?? [])
      })
      .catch(() => { /* Add to Cart still works, it just always asks for a price */ })
    return () => { cancelled = true }
  }, [orgId])

  const filterParams = filtersToParams(filters)
  const filterKey = JSON.stringify(filterParams)

  useEffect(() => {
    const params = new URLSearchParams({
      ...JSON.parse(filterKey) as Record<string, string>,
      sort: sort.key, dir: sort.dir, page: String(page), pageSize: String(PAGE_SIZE),
    })
    if (search) params.set('q', search)
    if (facetsFor.current !== filters.platform) params.set('facets', '1')
    /**
     * Ask for the real Brand Match alongside the page.
     *
     * Always, rather than only when a profile exists: the client cannot know
     * whether one does without asking, and the route returns early — before it
     * queries anything — for a workspace that has not saved one. So the cost is
     * a boolean for those orgs, and the scores for the rest.
     */
    params.set('match', '1')

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/organizations/${orgId}/discover/kol-directory?${params}`)
      .then(async r => {
        if (r.ok) return r.json()
        // The route explains itself in development (unreachable KOL host,
        // missing PG_*_KOL, bad credentials); a bare status code would not.
        const body = await r.json().catch(() => null)
        throw new Error(body?.detail || body?.error || `HTTP ${r.status}`)
      })
      .then((d: KolDirectoryPayload) => {
        if (cancelled) return
        setRows(d.rows)
        setTotal(d.total)
        setMatch(d.match ?? null)
        if (d.facets) { setFacets(d.facets); facetsFor.current = filters.platform }
      })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [orgId, search, filterKey, sort, page, reload])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fCount = activeFilterCount(filters)
  /**
   * Which section tab is lit, derived from the sort rather than held beside it.
   * A second state would let the tab strip and the Sort dropdown disagree about
   * the same list.
   */
  const sectionTab = sort.dir === 'desc'
    ? (SECTION_TABS.find(t => t.sort === sort.key)?.id ?? null)
    : null

  const dirty = Boolean(query || filters.categories.length || fCount)
  const rosterTotal = facets?.rosterTotal ?? total

  const patchFilters = (patch: Partial<KolFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1) }
  const clearFilters = () => { setFilters(KOL_FILTERS_DEFAULT); setPreset(null); setPage(1) }
  const resetAll = () => { setQuery(''); setSearch(''); clearFilters() }

  /* ── intelligence over the loaded page ───────────────────────────────── */

  /**
   * Whether this page carries real match scores.
   *
   * It used to be `hasCriteria(filters)` — "has the user set any filter" — back
   * when the score measured the filters. It now asks the only question that
   * matters for a brand match: has this workspace said who it is? A filtered
   * list with no Brand Profile has no scores, and an unfiltered list with one
   * has a score for every creator on it.
   */
  const scored = !!match?.scoreable

  /**
   * A workspace that has said who it is opens on Match Score, High to Low.
   *
   * Why it happens here and not in `useState`: whether an organization has a
   * saved Brand Profile is only known once the first response comes back —
   * `match.scoreable` is the answer, and the client cannot have it before it
   * asks. So the page opens on the follower ordering and moves to match as soon
   * as it learns there is something to match against.
   *
   * That costs exactly one refetch, once per mount, and only for workspaces with
   * a profile. It is not a wasted page: `SORT_COLUMNS.match` aliases to
   * `followers`, so the second request runs the SAME `ORDER BY` and returns the
   * SAME creators — the page does not change, only its order does. Re-ranking
   * the rows already in hand would mean a second copy of the ordering living in
   * the client, and two orderings are how a card grid and a table start
   * disagreeing about one page. One implementation, in `rankByMatch`, applied by
   * the route.
   *
   * Runs at most once: `sortPicked` latches on the first deliberate choice, and
   * the `sort.key` guard stops it re-firing on later responses.
   */
  useEffect(() => {
    if (!shouldDefaultToMatch(scored, sortPicked.current, sort.key)) return
    setSort({ key: 'match', dir: 'desc' })
  }, [scored, sort.key])

  /**
   * The active filters, in the shape `relaxSuggestions` reads.
   *
   * All that survives of the old criteria scorer, and the one job it was
   * genuinely right for: when a filter set returns nothing, naming which clause
   * to loosen is a question about the FILTERS, not about any creator. It scores
   * nothing and is not passed to the match engine.
   */
  const criteria = useMemo<MatchCriteria>(() => ({ ...filters, preset }), [filters, preset])

  /**
   * Signals per row, computed once per page.
   *
   * Keyed by id rather than recomputed inline so a re-render from opening the
   * insight panel does not re-run the generator for every visible card.
   */
  const signals = useMemo(() => {
    const map = new Map<string, CreatorSignals>()
    // `match.measured` is what the server read out of the medallion tables for
    // this exact page. Absent while the first response is in flight, which
    // leaves every measured field null — the same thing the UI draws for a
    // creator nobody has analysed, and the correct thing to draw before the
    // answer arrives.
    for (const r of rows) map.set(r.id, creatorSignals(r, match?.measured[r.id] ?? null))
    return map
  }, [rows, match])

  const badgesOf = useCallback(
    (id: string): CreatorBadge[] => {
      const s = signals.get(id)
      return s ? creatorBadges(s) : []
    },
    [signals],
  )

  /**
   * The authoritative brand match for one row.
   *
   * This used to be `matchScore(row, signals, criteria)` — a score for how well
   * a creator answered the FILTERS the user had just set, which is a restatement
   * of the query rather than a judgement about the creator, and which drew part
   * of its number from figures `kolSample` invents. It is gone.
   *
   * What replaces it is the Brand Match Engine's Final Match Score: the creator
   * against the workspace's saved Brand Profile, computed on the server from
   * `public.kol_directory` and the medallion tables, by the same model the
   * published comparison workbook runs. `null` means either no profile is saved
   * or this creator was not in the scored set — `match.scoreable` tells the UI
   * which, and the two are drawn differently.
   */
  const matchOf = useCallback(
    (r: KolDirectoryRow): MatchExplanation | null => match?.rows[r.id] ?? null,
    [match],
  )

  /**
   * Match ordering is no longer applied here.
   *
   * The card grid used to re-rank itself by match score on every render where a
   * Brand Profile existed, which silently overrode the sort the user had
   * picked: choosing "Sort: Followers" changed the table and left the cards
   * ranked by match, and the two views disagreed about the same page. It also
   * had no way to express "lowest match first".
   *
   * It is now the `match` entry in `SORTOPTS` — one ordering, chosen by the
   * user, applied once by the route right after the scores are computed, and
   * shared by both views. `rows` therefore arrives in the order it should be
   * rendered in, whichever sort is active.
   */

  /**
   * Applying a preset narrows what is already on screen — it does not replace
   * it.
   *
   * This used to reset the panel to defaults and keep only category and
   * platform, so picking `High Engagement` silently threw away a follower
   * range or a tier the user had set. A preset is one more clause, so
   * `High Engagement` + `Beauty` + `Macro` now means all three, which is what
   * the chip beside a filled-in panel looks like it should mean.
   *
   * Where both name the same field, the preset wins — it is the thing just
   * pressed — but only upward: a preset asking for ER ≥ 3% cannot loosen a
   * panel already asking for ER ≥ 5%.
   */
  const applyPreset = (id: PresetId) => {
    if (preset === id) { setPreset(null); setPage(1); return }
    const def = presetById(id)
    if (!def || def.unavailable) return
    setPreset(id)
    setFilters(f => {
      const next = { ...f, ...def.filters }
      // Keep the stricter bound wherever the two overlap.
      if (def.filters.erMin != null) next.erMin = Math.max(f.erMin, def.filters.erMin)
      if (def.filters.follMin != null) next.follMin = Math.max(f.follMin, def.filters.follMin)
      if (def.filters.follMax != null) {
        next.follMax = f.follMax > 0 ? Math.min(f.follMax, def.filters.follMax) : def.filters.follMax
      }
      return next
    })
    setPage(1)
  }

  const insightRow = insightId ? rows.find(r => r.id === insightId) ?? null : null

  const toggleSection = (id: string) => setFpOpen(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  /** Header sort: same key flips the direction, a new key starts at its default. */
  const sortBy = (key: SortKey) => {
    sortPicked.current = true
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' })
    setPage(1)
  }

  const toggleRow = (r: KolDirectoryRow) => setSelected(m => {
    const next = new Map(m)
    if (next.has(r.id)) next.delete(r.id); else next.set(r.id, r)
    return next
  })
  const pageAllSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAllOnPage = () => setSelected(m => {
    const next = new Map(m)
    if (pageAllSelected) rows.forEach(r => next.delete(r.id))
    else rows.forEach(r => next.set(r.id, r))
    return next
  })
  const selectedRows = useMemo(() => [...selected.values()], [selected])

  const bulkCompare = () => {
    const next = new Set(compare.ids)
    for (const id of selected.keys()) next.add(selectionKey('roster', id))
    compare.setIds(next)
    flash(`${selected.size} creator ditambahkan ke compare`)
  }

  /**
   * The two org-wide decisions, applied to a selection.
   *
   * Sequential rather than `Promise.all`: each write returns the whole link set
   * and the hook settles on the last response it sees, so firing twenty at once
   * would have nineteen of them racing to be the one that lands. Twenty
   * sequential writes to a database is also the honest cost of the button.
   *
   * Creators that already hold the state are skipped rather than re-sent — the
   * count in the toast then means "this many changed", which is what a bulk
   * action is being asked.
   */
  const bulkLink = useCallback(async (
    apply: (r: KolDirectoryRow) => Promise<boolean> | null,
    done: (n: number, skipped: number) => string,
  ) => {
    const rows = [...selected.values()]
    let changed = 0
    let skipped = 0
    for (const r of rows) {
      const call = apply(r)
      if (!call) { skipped += 1; continue }
      if (await call) changed += 1
    }
    flash(done(changed, skipped))
  }, [selected, flash])

  const bulkRoster = () => bulkLink(
    r => (links.inRoster('roster', r.id) ? null : links.setRoster('roster', r.id, true)),
    (n, skipped) => skipped
      ? `${n} creator ditambahkan ke My Creators · ${skipped} sudah ada di sana`
      : `${n} creator ditambahkan ke My Creators`,
  )

  const bulkTrack = () => bulkLink(
    r => (links.trackingOf('roster', r.id) === 'active' ? null : links.setTracking('roster', r.id, 'active')),
    (n, skipped) => skipped
      ? `${n} creator mulai dipantau · ${skipped} sudah dipantau`
      : `${n} creator mulai dipantau — lihat di Tracked Accounts`,
  )
  /**
   * Adds one unit of the platform's headline deliverable to the real cart.
   *
   * A roster creator can only be carted once the org has priced them, so an
   * unpriced one opens the rate dialog instead of failing quietly. That is the
   * whole difference between this and the icon-toggle it replaced: the cart, the
   * badge in the header and the checkout all read the same store now.
   */
  const addToCart = useCallback((r: KolDirectoryRow) => {
    if (!r.platform) { flash('Creator ini tidak punya platform — belum bisa dipesan'); return }
    const first = deliverables.find(d => d.platform === r.platform)
    if (!first) { flash(`Belum ada deliverable untuk ${r.platform}`); return }
    if (!rosterRates[r.id] || rosterRates[r.id].baseRate <= 0) { setPricing(r); return }

    cart.add({ socialAccountId: r.id, relation: 'roster', deliverableId: first.id })
    flash(`@${r.username} masuk keranjang · ${first.label}`)
  }, [cart, deliverables, rosterRates, flash])

  const removeFromCart = useCallback((r: KolDirectoryRow) => {
    cart.removeAccount(r.id)
    flash(`@${r.username} dihapus dari keranjang`)
  }, [cart, flash])

  const inCart = useCallback(
    (id: string) => cart.lines.some(
      (l: { relation: string; socialAccountId: string }) =>
        l.relation === 'roster' && l.socialAccountId === id),
    [cart.lines])

  const bulkCart = () => {
    const rows = [...selected.values()]
    const priced = rows.filter(r => r.platform && (rosterRates[r.id]?.baseRate ?? 0) > 0)
    for (const r of priced) {
      const first = deliverables.find(d => d.platform === r.platform)
      if (first) cart.add({ socialAccountId: r.id, relation: 'roster', deliverableId: first.id })
    }
    const skipped = rows.length - priced.length
    flash(
      skipped === 0
        ? `${priced.length} creator masuk keranjang`
        : `${priced.length} masuk keranjang · ${skipped} dilewati karena belum ada harga`,
    )
  }

  /**
   * Opening a creator goes to their Creator Intelligence Workspace, not out to
   * Instagram — the external profile is still one click away, from the platform
   * chips in that page's header.
   */
  const openProfile = (r: KolDirectoryRow) => {
    router.push(`/organizations/${orgSlug}/discover/kol-directory/${r.id}`)
  }

  const cardProps = (r: KolDirectoryRow) => ({
    creator: r,
    signals: signals.get(r.id) ?? null,
    badges: badgesOf(r.id),
    match: matchOf(r),
    fav: favorites.has('roster', r.id), inCompare: inCompare(r.id), inCart: inCart(r.id),
    inRoster: links.inRoster('roster', r.id),
    tracking: links.trackingOf('roster', r.id),
    linkBusy: links.busy.has(selectionKey('roster', r.id)),
    // Opening the panel rather than the profile: the list is for narrowing, and
    // a navigation per creator is the wrong cost for a decision this small. The
    // panel carries "View Full Profile" for when it is the right cost.
    onOpen: () => setInsightId(r.id),
    onFav: () => {
      const was = favorites.has('roster', r.id)
      favorites.toggle('roster', r.id)
      flash(was ? 'Dihapus dari favorit' : 'Ditambahkan ke favorit')
    },
    onCompare: () => toggleCompare(r),
    onCart: () => (inCart(r.id) ? removeFromCart(r) : addToCart(r)),
    onSimilar: onFindSimilar ? () => onFindSimilar(r.id) : null,
    onRoster: () => toggleRoster(r),
    onTracking: () => cycleTracking(r),
  })

  /**
   * Save to, or remove from, My Creators.
   *
   * Removing does not touch the creator: they stay in the Creator Database,
   * which is the whole point of My Creators being a link and not a copy. The
   * toast says so, because "remove" on a directory screen otherwise reads as a
   * deletion.
   */
  const toggleRoster = useCallback(async (r: KolDirectoryRow) => {
    const was = links.inRoster('roster', r.id)
    const ok = await links.setRoster('roster', r.id, !was)
    if (!ok) { flash('Gagal memperbarui My Creators'); return }
    flash(was
      ? `@${r.username} dikeluarkan dari My Creators — creator-nya tetap ada di Creator Database`
      : `@${r.username} ditambahkan ke My Creators`)
  }, [links, flash])

  /**
   * Start, pause or resume monitoring.
   *
   * One button rather than three because the three states form a cycle a reader
   * already holds in their head: not watching → watching → paused → watching.
   * Stopping outright lives on the Tracked Accounts screen, where the list of
   * what you are watching is in front of you and removing one from it is the
   * obvious act.
   */
  const cycleTracking = useCallback(async (r: KolDirectoryRow) => {
    const now = links.trackingOf('roster', r.id)
    const next = now === 'active' ? 'paused' : 'active'
    const ok = await links.setTracking('roster', r.id, next)
    if (!ok) { flash('Gagal memperbarui tracking'); return }
    flash(next === 'active'
      ? (now === 'paused'
          ? `Tracking @${r.username} dilanjutkan`
          : `@${r.username} mulai dipantau — lihat di Tracked Accounts`)
      : `Tracking @${r.username} dijeda`)
  }, [links, flash])

  /** Active filters as removable chips. Cheap — six comparisons over one object. */
  const applied = useMemo(() => appliedFilters(filters), [filters])

  const topCategories = (facets?.categories ?? []).slice(0, 6)

  return (
    <div className={embedded ? '' : 'min-h-full'} style={embedded ? undefined : { background: T.surfaceLow }}>
      <div className={embedded ? '' : 'max-w-[1280px] mx-auto px-5 py-5'}>

        {/* Nothing is broken — something has not been said yet. Shown once, above
            the list, rather than as an empty badge on every card. */}
        {match && !match.scoreable && (
          <NoBrandProfileNotice href={`${tabHref(orgSlug, 'settings')}&view=discover`} />
        )}

        {/* ── page head ── */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-1.5">
          <div>
            {!embedded && (
              <h2 style={{ ...PJ, color: T.t1 }} className="text-[21px] font-extrabold tracking-[-0.03em]">
                KOL Directory
              </h2>
            )}
            <p className="text-[12.5px] mt-[5px]" style={{ color: T.t3 }}>
              {loading && !rows.length ? 'Memuat direktori…' : (
                <>
                  {total.toLocaleString('id-ID')} of {rosterTotal.toLocaleString('id-ID')} creators
                  {fCount > 0 && ` · ${fCount} filter${fCount > 1 ? 's' : ''} applied`}
                  {/*
                    Claimed only when the match ordering is the one actually in
                    effect, and in both views, because both now render the same
                    order. It used to be claimed in card view on every page with
                    a Brand Profile — including pages the user had sorted by
                    followers — which described an ordering that was not the one
                    on screen.

                    "halaman ini" is load-bearing: the scores rank the ~20
                    creators that loaded, not the roster.
                  */}
                  {scored && sort.key === 'match' && (
                    match?.brandCategory
                      ? ` · halaman ini diurutkan dari yang paling cocok untuk brand ${match.brandCategory}`
                      : ' · halaman ini diurutkan dari yang paling cocok'
                  )}
                  {` · ${favorites.keys.size} favorites · ${compare.ids.size} in compare`}
                  {links.counts.roster > 0 && ` · ${links.counts.roster} in My Creators`}
                  {links.counts.tracked > 0 && ` · ${links.counts.tracked} tracked`}
                </>
              )}
            </p>
          </div>
          <div className="flex gap-[9px]">
            <Btn kind="ghost" icon="compare" onClick={() => router.push(tabHref(orgSlug, 'compare'))}
              title="Bandingkan creator yang dipilih berdampingan">
              Compare{compare.ids.size > 0 && <Count n={compare.ids.size} />}
            </Btn>
            <Btn
              kind="primary"
              icon="person_add"
              onClick={() => setAddOpen(true)}
              title="Tambahkan KOL baru ke directory berdasarkan username atau URL profil">
              Add KOL
            </Btn>
          </div>
        </div>

        {/* ── smart presets ──
            Eight questions the panel below can express but nobody wants to
            assemble by hand. Each sets real filters *and* a ranking; the note
            under an active one says which is which, because the difference
            decides whether the result count can be trusted. */}
        <div className="mt-3.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {CREATOR_PRESETS.map(p => {
              const on = preset === p.id
              const off = !!p.unavailable
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  disabled={off}
                  title={off ? `${p.label} — belum bisa dipakai. ${p.unavailable}` : p.desc}
                  style={{
                    ...PJ,
                    background: off ? '#f5f6f7' : on ? T.primary : '#fff',
                    color: off ? T.t4 : on ? '#fff' : T.t3,
                    borderColor: off ? T.outlineSoft : on ? T.primary : T.outline,
                    cursor: off ? 'not-allowed' : 'pointer',
                  }}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 h-[28px] text-[11px] font-bold transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">{p.icon}</span>
                  {p.label}
                  {off && <span className="material-symbols-outlined text-[12px]">block</span>}
                </button>
              )
            })}
          </div>
          {preset && (
            <p className="text-[10.5px] mt-1.5 leading-relaxed" style={{ color: T.t4 }}>
              {presetById(preset)?.desc}{' '}
              {/* Every surviving preset now filters and ranks on the same
                  measured column, so the caveat this used to carry — a ranking
                  computed over one page from signals the database does not
                  hold — no longer applies to any of them. The ones it did
                  apply to are disabled instead. */}
              <span style={{ color: T.t4 }}>
                Difilter di server pada seluruh {rosterTotal.toLocaleString('id-ID')} creator;
                peringkat memakai kolom yang sama dengan filternya.
              </span>
            </p>
          )}
        </div>

        {/* ── section tabs (BE-04) ──────────────────────────────────────────
            Two of the seven tabs the reference header carries have a source in
            this roster and are wired here: `created_at` (99,7% filled) and
            `last_refreshed_at` (97,1%). The other five have no Product
            definition yet — not a missing column, a missing decision — so they
            are neither named nor guessed at.

            Ordering, not a date window. The backend also accepts `createdAfter`
            and `refreshedAfter`, but the size of the window is itself a Product
            decision, and picking one here would invent it: the roster has taken
            no new creator since 2026-08-28, so a "last 7 days" tab would render
            permanently empty. Ordering answers the same question ("who is
            newest") and cannot go empty. */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
          {SECTION_TABS.map(t => {
            const on = sectionTab === t.id
            return (
              <button key={t.id} type="button"
                onClick={() => {
                  // Picking a section tab IS picking an ordering — it sets the
                  // sort — so it latches the same way the dropdown does.
                  sortPicked.current = true
                  setSort({ key: t.sort, dir: 'desc' })
                  setPage(1)
                }}
                title={t.hint}
                style={{
                  ...PJ,
                  background: on ? T.surfaceVariant : '#fff',
                  color: on ? T.primaryDeep : T.t3,
                  borderColor: on ? T.primary : T.outline,
                }}
                className="inline-flex items-center gap-1 rounded-full border px-3 h-[30px] text-[11.5px] font-bold transition-colors">
                <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
                {t.label}
              </button>
            )
          })}
          <span
            title={'Lima tab lain dari panel referensi belum punya definisi Product — '
              + 'nama, kriteria dan sumbernya belum ditetapkan. Sengaja tidak ditebak.'}
            style={{ ...PJ, borderColor: T.outlineSoft, color: T.t4 }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 h-[30px] text-[11px] font-semibold cursor-help">
            <span className="material-symbols-outlined text-[14px]">pending</span>
            5 tab menunggu Product
          </span>
        </div>

        {/* ── toolbar ── */}
        <div className="flex items-center gap-2.5 flex-wrap my-4">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined absolute left-[11px] text-[17px]" style={{ color: '#b4c3d0' }}>
              search
            </span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search creators by username…"
              className="h-[38px] w-[280px] pl-[34px] pr-9 rounded-xl border text-[13px] bg-white outline-none"
              style={{ borderColor: T.outline, color: T.t1 }}
              onFocus={e => { e.currentTarget.style.borderColor = T.primary }}
              onBlur={e => { e.currentTarget.style.borderColor = T.outline }}
            />
            {query && (
              <span onClick={() => setQuery('')} title="Clear search"
                className="material-symbols-outlined absolute right-2.5 text-[16px] cursor-pointer"
                style={{ color: T.t4 }}>close</span>
            )}
          </div>

          {/* the six biggest categories inline; the rest live in the sidebar */}
          <div className="flex gap-[7px] flex-wrap">
            <Chip label="All" on={!filters.categories.length}
              onClick={() => patchFilters({ categories: [] })} />
            {topCategories.map(c => (
              <Chip key={c.name} label={c.name} on={filters.categories.includes(c.name)}
                onClick={() => patchFilters({
                  categories: filters.categories.includes(c.name)
                    ? filters.categories.filter(x => x !== c.name)
                    : [...filters.categories, c.name],
                })} />
            ))}
          </div>

          <Pill icon="tune" onClick={() => setFiltPanel(o => !o)}
            title="Show or hide the filter panel — filters stay visible while you browse">
            Filters{fCount > 0 && <Count n={fCount} />}
          </Pill>

          {fCount > 0 && (
            <Chip label="Clear" icon="filter_alt_off" on={false}
              onClick={() => { clearFilters(); flash('Filters cleared') }} />
          )}

          <div className="relative">
            <Pill icon="bookmark" onClick={() => setListsOpen(o => !o)}
              title="Save the current search & filters, or reapply a saved list">
              Saved Lists{savedLists.lists.length > 0 && <Count n={savedLists.lists.length} />}
            </Pill>
            {listsOpen && (
              <Popover onClose={() => setListsOpen(false)} width={260}>
                <div style={{ ...PJ, color: T.t4 }}
                  className="text-[11px] font-extrabold uppercase tracking-[.05em] px-1 pb-2">
                  Saved Lists
                </div>
                {/* Four states, not one: still loading, failed to load, loaded
                    and empty, loaded with lists. Before this they all rendered
                    as "No saved lists yet", so a failed request looked like an
                    empty account. */}
                {savedLists.error ? (
                  <div className="px-1 pb-1">
                    <div className="text-[11.5px]" style={{ color: '#b45252' }}>{savedLists.error}</div>
                    <Btn kind="ghost" icon="refresh" full onClick={savedLists.retry}>Coba lagi</Btn>
                  </div>
                ) : !savedLists.ready ? (
                  <div className="text-[11.5px] px-1 pb-1" style={{ color: T.t4 }}>Memuat…</div>
                ) : savedLists.lists.length === 0 ? (
                  <div className="text-[11.5px] px-1 pb-1" style={{ color: T.t4 }}>No saved lists yet.</div>
                ) : savedLists.lists.map(l => (
                  <div key={l.id}
                    className="flex items-center gap-2 px-1 py-[7px] rounded-lg cursor-pointer hover:bg-[#f7fafc]"
                    onClick={() => {
                      // Normalised, not spread: lists saved before multi-select
                      // hold `category`/`tier` as plain strings.
                      setFilters(normalizeKolFilters({ ...KOL_FILTERS_DEFAULT, ...l.filters }))
                      setPage(1); setListsOpen(false); flash(`Applied "${l.name}"`)
                    }}>
                    <span className="material-symbols-outlined text-[16px]" style={{ color: T.primary }}>bookmark</span>
                    <span style={{ ...PJ, color: T.t1 }} className="flex-1 text-[12px] font-bold truncate">{l.name}</span>
                    <span className="material-symbols-outlined text-[15px] hover:opacity-70" style={{ color: T.t4 }}
                      title="Rename"
                      onClick={async e => {
                        e.stopPropagation()
                        const name = window.prompt('Rename this list:', l.name)
                        if (!name || name.trim() === l.name) return
                        if (await savedLists.rename(l.id, name.trim())) flash(`Renamed to "${name.trim()}"`)
                      }}>
                      edit
                    </span>
                    <span className="material-symbols-outlined text-[15px] hover:opacity-70" style={{ color: T.t4 }}
                      title="Overwrite with the filters on screen now"
                      onClick={async e => {
                        e.stopPropagation()
                        if (await savedLists.update(l.id, filters)) flash(`Updated "${l.name}"`)
                      }}>
                      save
                    </span>
                    <span className="material-symbols-outlined text-[15px] hover:opacity-70" style={{ color: T.t4 }}
                      title="Delete"
                      onClick={async e => {
                        e.stopPropagation()
                        if (await savedLists.remove(l.id)) flash(`Deleted "${l.name}"`)
                      }}>
                      delete
                    </span>
                  </div>
                ))}
                <div className="mt-1.5 pt-2" style={{ borderTop: `1px solid ${T.outlineSoft}` }}>
                  <Btn kind="ghost" icon="add" full onClick={async () => {
                    const name = window.prompt('Name this saved list:', `Custom List ${savedLists.lists.length + 1}`)
                    if (!name?.trim()) return
                    setListsOpen(false)
                    if (await savedLists.save(name.trim(), filters)) flash(`Saved list "${name.trim()}"`)
                  }}>
                    Save current filters
                  </Btn>
                </div>
              </Popover>
            )}
          </div>

          <div className="relative ml-auto">
            <Pill icon="sort" onClick={() => setSortOpen(o => !o)} title="Change result ordering">
              Sort: {SORTOPTS.find(s => s[0] === sort.key)?.[1]}
            </Pill>
            {sortOpen && (
              <Popover onClose={() => setSortOpen(false)} width={200}>
                {SORTOPTS.map(([key, label]) => {
                  /**
                   * Match ordering needs a saved Brand Profile — with none there
                   * is no score to order by, and the route returns before it
                   * computes one. Offered disabled WITH the reason rather than
                   * hidden or silently inert, which is how this page already
                   * treats every control its data cannot answer (see the
                   * disabled sections in `KolDirectoryFilters`).
                   */
                  const off = key === 'match' && !scored
                  return (
                    <div key={key}
                      onClick={() => { if (off) return; sortBy(key); setSortOpen(false) }}
                      title={off ? 'Atur Brand Profile dulu untuk mengurutkan berdasarkan match score' : undefined}
                      style={off ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                      className={`flex items-center gap-2 px-2 py-[7px] rounded-lg ${
                        off ? '' : 'cursor-pointer hover:bg-[#f7fafc]'}`}>
                      <span style={{ ...PJ, color: sort.key === key ? T.primaryDeep : T.t2 }}
                        className="flex-1 text-[12px] font-bold">{label}</span>
                      {sort.key === key && !off && (
                        <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>
                          {sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </Popover>
            )}
          </div>

          {view === 'table' && (
            <div className="relative">
              <Pill icon="view_column" onClick={() => setColOpen(o => !o)} title="Choose visible table columns">
                Columns
              </Pill>
              {colOpen && (
                <Popover onClose={() => setColOpen(false)} width={190}>
                  {(Object.keys(COLDEFS) as ColKey[]).map(c => (
                    <label key={c} className="flex items-center gap-2 px-1 py-[5px] text-[12px] cursor-pointer"
                      style={{ color: T.t2 }}>
                      <input type="checkbox" checked={cols[c]} style={{ accentColor: T.primary }}
                        onChange={e => setCols(s => ({ ...s, [c]: e.target.checked }))} />
                      {COLDEFS[c].label}
                    </label>
                  ))}
                </Popover>
              )}
            </div>
          )}

          {/* card / table segmented control */}
          <div className="flex rounded-[10px] p-[3px] gap-0.5" style={{ background: '#eef1f3' }}>
            {([['card', 'grid_view'], ['table', 'table_rows']] as const).map(([v, icon]) => (
              <button key={v} type="button" onClick={() => setView(v)}
                title={v === 'card' ? 'Card view' : 'Table view — sortable columns & bulk actions'}
                style={{
                  ...PJ,
                  background: view === v ? '#fff' : 'transparent',
                  color: view === v ? T.primaryDeep : T.t3,
                  boxShadow: view === v ? T.shadow : undefined,
                }}
                className="w-[38px] h-8 rounded-lg inline-flex items-center justify-center">
                <span className="material-symbols-outlined text-[16px]">{icon}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── applied filters ──
            One removable chip per active filter, so what is narrowing the list
            is readable without opening the panel and removable without
            rebuilding the rest. The preset rides along as a chip of its own —
            it is a filter now that it composes with the panel rather than
            replacing it. */}
        {(applied.length > 0 || preset) && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3.5">
            <span style={{ ...PJ, color: T.t4 }}
              className="text-[10px] font-bold uppercase tracking-[.06em] mr-0.5">
              Applied
            </span>
            {preset && (
              <FilterChip
                label={presetById(preset)?.label ?? preset}
                icon={presetById(preset)?.icon}
                onRemove={() => { setPreset(null); setPage(1) }} />
            )}
            {applied.map(a => (
              <FilterChip key={a.key} label={a.label}
                onRemove={() => patchFilters(a.clear)} />
            ))}
            <button type="button" onClick={() => { clearFilters(); flash('Filters cleared') }}
              style={{ ...PJ, color: T.t3 }}
              className="text-[10.5px] font-bold underline underline-offset-2 hover:opacity-80 ml-0.5">
              Clear all
            </button>
          </div>
        )}

        {/* ── content + filter sidebar ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `minmax(0,1fr) ${filtPanel ? '248px' : '30px'}`,
          gap: filtPanel ? 16 : 6,
          alignItems: 'start',
        }}>
          <div className="min-w-0">
            {error ? (
              <Empty icon="error" tint="#e6b8b8" title="Direktori gagal dimuat" body={error}
                action={<Btn kind="primary" onClick={() => setReload(n => n + 1)}>Coba lagi</Btn>} />
            ) : loading && !rows.length ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="material-symbols-outlined text-[30px] animate-spin" style={{ color: T.primary }}>
                  progress_activity
                </span>
                <p className="text-[12px] mt-2" style={{ color: T.t4 }}>Memuat…</p>
              </div>
            ) : rows.length === 0 ? (
              /* Named criteria and a way out, rather than "no data". What is too
                 tight is something only the user's own filters can say. */
              <Empty icon="person_search" tint="#cfe0f1"
                title="Tidak ada creator yang cocok dengan filter ini"
                body={relaxSuggestions(criteria).join('  ·  ')
                  || 'Coba kata kunci lain, atau longgarkan filternya.'}
                action={<Btn kind="secondary" onClick={resetAll}>Clear filters</Btn>} />
            ) : (
              <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}>
                {view === 'card' ? (
                  <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 ${filtPanel ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>
                    {rows.map(r => <CreatorCard key={r.id} {...cardProps(r)} />)}
                  </div>
                ) : (
                  <DirectoryTable
                    rows={rows} cols={cols} sort={sort} onSort={sortBy}
                    selected={selected} onToggleRow={toggleRow}
                    allOnPage={pageAllSelected} onToggleAll={toggleAllOnPage}
                    inCart={inCart}
                    onCart={r => (inCart(r.id) ? removeFromCart(r) : addToCart(r))}
                    onOpen={openProfile}
                    onSimilar={onFindSimilar ? r => onFindSimilar(r.id) : null}
                    inRoster={id => links.inRoster('roster', id)}
                    trackingOf={id => links.trackingOf('roster', id)}
                    onRoster={toggleRoster}
                    onTracking={cycleTracking}
                  />
                )}

                {/* paging */}
                <div className="flex items-center justify-center gap-1.5 mt-[22px]">
                  <PgBtn disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                  </PgBtn>
                  {pageWindow(page, pageCount).map((n, i) =>
                    n === '…'
                      ? <span key={`gap${i}`} className="text-[12px] px-1" style={{ color: T.t4 }}>…</span>
                      : <PgBtn key={n} on={n === page} onClick={() => setPage(n)}>{n}</PgBtn>,
                  )}
                  <PgBtn disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                  </PgBtn>
                </div>

                {/* bulk bar — table view only, as in the source */}
                {view === 'table' && selected.size > 0 && (
                  <div className="sticky bottom-3.5 flex items-center gap-3 mt-3.5 rounded-2xl px-[18px] py-3 text-white"
                    style={{ background: 'linear-gradient(120deg,#1E4A58,#285D6E)', boxShadow: T.shadowLg }}>
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    <b style={PJ} className="text-[12.5px]">{selected.size} selected</b>
                    <div className="flex-1" />
                    <BulkBtn icon="compare" onClick={bulkCompare}>Add to Compare</BulkBtn>
                    <BulkBtn icon="create_new_folder" onClick={bulkRoster}>Add to My Creators</BulkBtn>
                    <BulkBtn icon="monitor_heart" onClick={bulkTrack}>Start Tracking</BulkBtn>
                    <BulkBtn icon="add_shopping_cart" onClick={bulkCart}>Add to Cart</BulkBtn>
                    <BulkBtn icon="ios_share" onClick={() => { exportCsv(selectedRows, EXPORT_COLUMNS, 'kol-directory'); flash(`Exporting ${selected.size} creators as CSV`) }}>
                      CSV
                    </BulkBtn>
                    <BulkBtn icon="ios_share" onClick={() => { exportExcel(selectedRows, EXPORT_COLUMNS, 'kol-directory'); flash(`Exporting ${selected.size} creators as Excel`) }}>
                      Excel
                    </BulkBtn>
                    <BulkBtn icon="close" onClick={() => setSelected(new Map())}>Clear</BulkBtn>
                  </div>
                )}
              </div>
            )}
          </div>

          {filtPanel ? (
            <KolFilterPanel
              filters={filters} facets={facets} open={fpOpen}
              onToggleSection={toggleSection} onChange={patchFilters}
              onClear={clearFilters} onCollapse={() => setFiltPanel(false)}
            />
          ) : (
            <KolFilterTab count={fCount} onOpen={() => setFiltPanel(true)} />
          )}
        </div>
      </div>

      {pricing && (
        <RosterRateDialog
          orgId={orgId}
          creator={pricing}
          current={rosterRates[pricing.id]?.baseRate ?? 0}
          onClose={() => setPricing(null)}
          onSaved={(rates, creator) => {
            setRosterRates(rates)
            setPricing(null)
            // Straight into the cart: setting a price was the only thing in the
            // way, and asking the user to press Add to Cart a second time would
            // be making them repeat themselves.
            const first = deliverables.find(d => d.platform === creator.platform)
            if (first) {
              cart.add({ socialAccountId: creator.id, relation: 'roster', deliverableId: first.id })
              flash(`@${creator.username} masuk keranjang · ${first.label}`)
            }
          }}
        />
      )}

      {insightRow && (
        <CreatorQuickInsight
          creator={insightRow}
          match={matchOf(insightRow)}
          measured={match?.measured[insightRow.id] ?? null}
          inShortlist={favorites.has('roster', insightRow.id)}
          inCompare={inCompare(insightRow.id)}
          inRoster={links.inRoster('roster', insightRow.id)}
          tracking={links.trackingOf('roster', insightRow.id)}
          linkBusy={links.busy.has(selectionKey('roster', insightRow.id))}
          onRoster={() => toggleRoster(insightRow)}
          // The panel offers the same cycle the card does, so it hands the row
          // to the same writer rather than carrying its own copy of the rule.
          onTracking={() => cycleTracking(insightRow)}
          onClose={() => setInsightId(null)}
          onShortlist={() => {
            const was = favorites.has('roster', insightRow.id)
            favorites.toggle('roster', insightRow.id)
            flash(was ? 'Dihapus dari shortlist' : 'Ditambahkan ke shortlist')
          }}
          onCompare={() => toggleCompare(insightRow)}
          onOpenProfile={() => { setInsightId(null); openProfile(insightRow) }}
          // Starting a collaboration is the same step the card's cart action
          // takes — priced from the rate card, then on into the ordering flow.
          onCollaborate={() => { setInsightId(null); addToCart(insightRow) }}
        />
      )}

      {addOpen && (
        <AddKolDirectoryModal
          onClose={() => setAddOpen(false)}
          onKolAdded={kolId => {
            setAddOpen(false)
            // Same trigger the retry button uses — re-runs the list fetch so
            // the newly added row shows up once its scrape has caught up.
            setReload(n => n + 1)
            /**
             * A creator this workspace went to the trouble of adding is a
             * creator it works with, so it lands in My Creators as well as in
             * the database — which is what "Add KOL" is read as meaning, and
             * the reason the two screens felt disconnected before. It is a
             * link, so taking it back out from My Creators costs one press and
             * leaves the creator in the database where they now belong.
             */
            void links.setRoster('roster', kolId, true).then(ok => {
              if (ok) flash('Creator ditambahkan ke Creator Database dan My Creators')
            })
          }}
        />
      )}

      {toast && (
        <div style={{ ...PJ, background: T.t1 }}
          className="fixed bottom-[30px] left-1/2 -translate-x-1/2 z-50 text-white text-[12.5px] font-semibold px-[18px] py-[11px] rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ── card ─────────────────────────────────────────────────────────────────── */

function CreatorCard({
  creator: c, signals, badges, match,
  fav, inCompare, inCart, inRoster, tracking, linkBusy,
  onOpen, onFav, onCompare, onCart, onSimilar, onRoster, onTracking,
}: {
  creator: KolDirectoryRow
  /** Derived intelligence for this row; null only while the page is loading. */
  signals: CreatorSignals | null
  badges: CreatorBadge[]
  /**
   * The Brand Match Engine's verdict on this creator, or null when the
   * workspace has no saved Brand Profile to compare them against.
   */
  match: MatchExplanation | null
  fav: boolean; inCompare: boolean; inCart: boolean
  /** In this organization's My Creators — an org-wide state, unlike `fav`. */
  inRoster: boolean
  /** Whether this organization monitors the creator, and how. */
  tracking: TrackingStatus
  /** A roster or tracking write is in flight for this creator. */
  linkBusy: boolean
  onOpen: () => void; onFav: () => void; onCompare: () => void; onCart: () => void
  /** Null when the page was mounted without a Smart Discovery destination. */
  onSimilar: (() => void) | null
  onRoster: () => void
  onTracking: () => void
}) {
  const st = statusOf(c.status)
  const banner = gradOf(bannerFor(c.id))
  /**
   * The handle joins the subtitle only when the real name has taken the title
   * line, so the card never prints the same string twice.
   */
  const subtitle = [
    c.displayName ? `@${c.username}` : null,
    c.platform ? PLATFORM_LABEL[c.platform] ?? c.platform : null,
    c.city,
  ].filter(Boolean).join(' · ')

  return (
    <article onClick={onOpen}
      className="relative rounded-[18px] border overflow-hidden bg-white transition-all hover:-translate-y-[3px]"
      style={{ borderColor: T.outline, boxShadow: T.shadow, cursor: 'pointer' }}
      title="Lihat insight singkat creator ini"
    >
      <div className="h-14 relative overflow-hidden" style={{ background: banner }}>
        <span className="absolute rounded-full" style={{ width: 90, height: 90, top: -40, right: 20, background: 'rgba(255,255,255,.16)' }} />
        <span className="absolute rounded-full" style={{ width: 50, height: 50, bottom: -24, right: 90, background: 'rgba(255,255,255,.16)' }} />
        <div className="absolute top-[9px] right-[9px] flex gap-1.5 z-[3]">
          <IconToggle on={fav} onClick={onFav} icon="favorite" title="Favorite" activeColor={T.accent} filled />
          <IconToggle on={inCompare} onClick={onCompare} icon={inCompare ? 'check' : 'add'} title="Add to compare"
            activeColor={T.primary} solid />
          <IconToggle on={inCart} onClick={onCart} icon={inCart ? 'shopping_cart_checkout' : 'add_shopping_cart'}
            title={inCart ? 'In cart' : 'Add to cart'} activeColor="#3d8a5f" solid />
          {/* The two organization-wide states, beside the personal ones. Save
              puts the creator in My Creators without copying them out of the
              database; Track starts monitoring and is what fills Tracked
              Accounts — neither happens merely by the creator existing here. */}
          <IconToggle on={inRoster} onClick={linkBusy ? () => {} : onRoster}
            icon={inRoster ? 'folder_shared' : 'create_new_folder'}
            title={inRoster ? 'Di My Creators — klik untuk mengeluarkan' : 'Add to My Creators'}
            activeColor={T.primaryDeep} solid />
          <IconToggle on={tracking !== 'none'} onClick={linkBusy ? () => {} : onTracking}
            icon={tracking === 'active' ? 'monitor_heart' : tracking === 'paused' ? 'pause_circle' : 'radar'}
            title={
              tracking === 'active' ? 'Dipantau — klik untuk menjeda'
                : tracking === 'paused' ? 'Pemantauan dijeda — klik untuk melanjutkan'
                : 'Start Tracking'
            }
            activeColor={tracking === 'paused' ? '#b5761f' : '#3d8a5f'} solid />
          {/* Find Similar sits with the other per-row actions rather than inside
              the opened profile, so "more like this one" is answerable while
              scanning the list — which is when the thought occurs. */}
          {onSimilar && (
            <IconToggle on={false} onClick={onSimilar} icon="auto_awesome"
              title="Find similar creators" activeColor="#6b5bb5" solid />
          )}
        </div>
      </div>

      <div className="w-[60px] h-[60px] rounded-[17px] border-4 border-white -mt-[34px] ml-4 flex items-center justify-center relative overflow-hidden"
        style={{ background: banner, boxShadow: T.shadow }}>
        <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[22px]" />
        {/* Connected — the creator linked the account through OAuth. Not the
            platform's blue tick: that badge was dropped from Discovery, so the
            glyph is a link rather than a check to avoid reading as one. */}
        {c.connected && (
          <span title="Connected" aria-label="Connected"
            className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-[2.5px] border-white flex items-center justify-center"
            style={{ background: T.primary }}>
            <span className="material-symbols-outlined fill text-[11px] text-white">link</span>
          </span>
        )}
      </div>

      {/* The score sits over the banner rather than in the body: when the list is
          ranked, "how well does this answer my question" is the first thing to
          read, before the name. */}
      {match && (
        <div className="absolute top-[9px] left-[9px] z-[3] rounded-lg"
          style={{ background: 'rgba(255,255,255,.92)', boxShadow: T.shadow }}>
          {/* Score AND status, not a bare percentage. "63" alone invites the
              reader to invent their own threshold; "63 Moderate" is the band the
              engine actually assigned. Hovering gives the sentence behind it. */}
          <MatchBadge match={match} size="sm" />
        </div>
      )}

      <div className="px-4 pt-2 pb-[15px]">
        {/* The real name leads when the roster has one — 3.463 creators carry a
            name that differs from their handle, and BE-03 made those searchable,
            so a result found by name has to show that name. Falls back to the
            handle, which is the only identity the other 4.257 have. */}
        <div style={{ ...PJ, color: T.t1 }} className="text-[15px] font-extrabold truncate"
          title={c.displayName ? `${c.displayName} · @${c.username}` : `@${c.username}`}>
          {c.displayName ?? `@${c.username}`}
        </div>
        <div className="text-[11.5px] mt-px truncate" style={{ color: T.t4 }}>{subtitle || '—'}</div>

        {/* Two or three claims, measured ones first — see `creatorBadges`. */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {badges.map(b => (
              <span key={b.id} style={{
                ...PJ,
                background: b.weight === 'strong' ? T.surfaceVariant : '#f3f4f6',
                color: b.weight === 'strong' ? T.primaryDeep : T.t3,
              }} className="inline-flex items-center gap-1 rounded-full px-1.5 h-[19px] text-[9.5px] font-bold">
                <span className="material-symbols-outlined text-[11px]">{b.icon}</span>
                {b.label}
              </span>
            ))}
          </div>
        )}

        <span className="inline-flex items-center gap-1.5 mt-[9px] rounded-lg px-[9px] py-[3px] text-[10.5px] font-bold max-w-full"
          style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}>
          <span className="material-symbols-outlined text-[12px]">category</span>
          <span className="truncate">{c.categories.length ? c.categories.join(' · ') : 'Belum berkategori'}</span>
        </span>

        <div className="flex gap-1.5 mt-[13px]">
          <Stat label="Followers" value={followersLabel(c.followers)} />
          {/* Measured, unlike the growth figure that used to sit in the row
              below: this one comes from l2_gold and is '—' when the pipeline
              has only ever seen this account once. */}
          <Stat label="Growth" value={growthLabel(c.growthPct)} />
          <Stat label="Eng. Rate" value={<ErValue row={c} />} />
          <Stat label="Est. Reach" value={reachLabel(c)} />
        </div>

        {/* The intelligence row. Modelled throughout, so it is set in the
            quieter type and the panel behind the card carries the badge. */}
        {signals && (
          <div className="flex items-center gap-2 mt-2 text-[10px]" style={{ color: T.t4 }}>
            <span className="inline-flex items-center gap-0.5" title="Skor kualitas audiens (estimasi)">
              <span className="material-symbols-outlined text-[12px]">verified_user</span>
              {signals.audienceQuality}
            </span>
            {/* The generated fallback that used to sit here is gone. When a
                creator has no growth reading the card now shows nothing in this
                slot, because most of the roster was scraped once and a number
                invented to fill the gap is worse than the gap. */}
            {signals.topAudience && (
              <>
                <span style={{ color: '#d1d5db' }}>·</span>
                <span className="truncate" title="Kota audiens terbesar yang terukur">
                  {signals.topAudience}
                </span>
              </>
            )}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-extrabold"
            style={{ ...PJ, background: st.bg, color: st.fg }}
            title={`Data ${c.status.toLowerCase()} · last synced ${sinceLabel(c.lastRefreshedAt)}`}>
            <span className="material-symbols-outlined text-[12px]">{st.icon}</span>
            {c.status} · {sinceLabel(c.lastRefreshedAt)}
          </span>

          {/* The source puts its brand-fit "% match" here. That score has no
              source in this roster, but the creator's own price does, and it is
              the number a buyer scanning the grid actually acts on. */}
          {c.rateFrom !== null && (
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold whitespace-nowrap"
              style={{ ...PJ, color: T.primaryDeep }}
              title={`Rate card creator: mulai Rp${c.rateFrom.toLocaleString('id-ID')}`
                + (c.rateCount > 1 ? ` · ${c.rateCount} deliverable` : '')}>
              <span className="material-symbols-outlined text-[12px]">sell</span>
              {idrShort(c.rateFrom)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-[13px]">
          <div className="flex gap-1.5">
            {c.platform && (
              <span title={c.platform} className="w-[22px] h-[22px] rounded-md flex items-center justify-center"
                style={{ background: T.surfaceVariant }}>
                <span className="material-symbols-outlined text-[12px]" style={{ color: T.primaryDeep }}>
                  {PLATFORM_ICON[c.platform] ?? 'public'}
                </span>
              </span>
            )}
          </div>
          <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
            className="rounded-lg px-[9px] py-[3px] text-[10px] font-bold">
            {c.tier ?? 'Untiered'}
          </span>
        </div>
      </div>
    </article>
  )
}

/* ── table ────────────────────────────────────────────────────────────────── */

function DirectoryTable({
  rows, cols, sort, onSort, selected, onToggleRow, allOnPage, onToggleAll, inCart, onCart, onOpen, onSimilar,
  inRoster, trackingOf, onRoster, onTracking,
}: {
  rows: KolDirectoryRow[]
  cols: Record<ColKey, boolean>
  sort: SortState
  onSort: (k: SortKey) => void
  selected: Map<string, KolDirectoryRow>
  onToggleRow: (r: KolDirectoryRow) => void
  allOnPage: boolean
  onToggleAll: () => void
  inCart: (id: string) => boolean
  onCart: (r: KolDirectoryRow) => void
  onOpen: (r: KolDirectoryRow) => void
  /** Null when the page was mounted without a Smart Discovery destination. */
  onSimilar: ((r: KolDirectoryRow) => void) | null
  /** The same two org-wide states the cards draw, asked per row. */
  inRoster: (id: string) => boolean
  trackingOf: (id: string) => TrackingStatus
  onRoster: (r: KolDirectoryRow) => void
  onTracking: (r: KolDirectoryRow) => void
}) {
  const active = (Object.keys(COLDEFS) as ColKey[]).filter(c => cols[c])
  const arrow = (key: SortKey) => sort.key === key
    ? <span className="material-symbols-outlined text-[14px] align-[-3px]" style={{ color: T.primary }}>
        {sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
      </span>
    : null

  const Th = ({ label, sortKey, right }: { label: string; sortKey?: SortKey; right?: boolean }) => (
    <th onClick={sortKey ? () => onSort(sortKey) : undefined}
      style={{
        ...PJ,
        color: sortKey && sort.key === sortKey ? T.primaryDeep : T.t4,
        cursor: sortKey ? 'pointer' : 'default',
        textAlign: right ? 'right' : 'left',
        borderBottom: `1px solid ${T.outlineSoft}`,
      }}
      className="px-[15px] py-2.5 text-[10px] font-bold uppercase tracking-[.05em] whitespace-nowrap select-none">
      {label}{sortKey && arrow(sortKey)}
    </th>
  )

  return (
    <div className="rounded-[18px] border bg-white overflow-x-auto" style={{ borderColor: T.outline, boxShadow: T.shadow }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: 'linear-gradient(180deg,#f7fafc,#f3f7f9)' }}>
            <th className="w-[30px] px-[15px]" style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
              <Check on={allOnPage} onClick={onToggleAll} title="Select every creator on this page" />
            </th>
            <Th label="Creator" sortKey="name" />
            <Th label="Followers" sortKey="followers" right />
            <Th label="Engagement" sortKey="engagement" right />
            {active.map(c => <Th key={c} label={COLDEFS[c].label} sortKey={COLDEFS[c].sort} right />)}
            <Th label="Data" />
            <Th label="" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const st = statusOf(r.status)
            return (
              <tr key={r.id} onClick={() => onOpen(r)}
                className="hover:bg-[#f7fbfd]"
                style={{ cursor: r.profileUrl ? 'pointer' : 'default' }}>
                <td className="px-[15px] py-3" style={{ borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${T.outlineSoft}` }}
                  onClick={e => e.stopPropagation()}>
                  <Check on={selected.has(r.id)} onClick={() => onToggleRow(r)} title="Select creator" />
                </td>
                <Td last={i === rows.length - 1}>
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                      style={{ ...PJ, background: gradOf(bannerFor(r.id)) }}>
                      {initialsOf(r.username)}
                    </span>
                    <div className="min-w-0">
                      <div style={{ ...PJ, color: T.t1 }} className="text-[12.5px] font-bold flex items-center gap-1.5 truncate">
                        {r.displayName ?? `@${r.username}`}
                        {r.connected && <span title="Connected" aria-label="Connected"
                          className="material-symbols-outlined fill text-[13px]" style={{ color: T.primary }}>link</span>}
                      </div>
                      <div className="text-[10.5px] truncate max-w-[220px]" style={{ color: T.t4 }}>
                        {[r.displayName ? `@${r.username}` : null,
                          r.categories.length ? r.categories.join(' · ') : null,
                        ].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td last={i === rows.length - 1} num>{followersLabel(r.followers)}</Td>
                <Td last={i === rows.length - 1} num><ErValue row={r} /></Td>
                {active.map(c => <Td key={c} last={i === rows.length - 1} num>{COLDEFS[c].get(r)}</Td>)}
                <Td last={i === rows.length - 1}>
                  <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-extrabold"
                    style={{ ...PJ, background: st.bg, color: st.fg }}>
                    <span className="material-symbols-outlined text-[11px]">{st.icon}</span>{r.status}
                  </span>
                </Td>
                <Td last={i === rows.length - 1} right>
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    {onSimilar && (
                      <span onClick={e => { e.stopPropagation(); onSimilar(r) }}
                        title="Find similar creators"
                        className="material-symbols-outlined text-[18px] cursor-pointer"
                        style={{ color: T.t4 }}>
                        auto_awesome
                      </span>
                    )}
                    <span onClick={e => { e.stopPropagation(); onRoster(r) }}
                      title={inRoster(r.id) ? 'Di My Creators — klik untuk mengeluarkan' : 'Add to My Creators'}
                      className="material-symbols-outlined text-[18px] cursor-pointer"
                      style={{ color: inRoster(r.id) ? T.primaryDeep : T.t4 }}>
                      {inRoster(r.id) ? 'folder_shared' : 'create_new_folder'}
                    </span>
                    <span onClick={e => { e.stopPropagation(); onTracking(r) }}
                      title={
                        trackingOf(r.id) === 'active' ? 'Dipantau — klik untuk menjeda'
                          : trackingOf(r.id) === 'paused' ? 'Pemantauan dijeda — klik untuk melanjutkan'
                          : 'Start Tracking'
                      }
                      className="material-symbols-outlined text-[18px] cursor-pointer"
                      style={{
                        color: trackingOf(r.id) === 'active' ? '#3d8a5f'
                          : trackingOf(r.id) === 'paused' ? '#b5761f' : T.t4,
                      }}>
                      {trackingOf(r.id) === 'active' ? 'monitor_heart'
                        : trackingOf(r.id) === 'paused' ? 'pause_circle' : 'radar'}
                    </span>
                    <span onClick={e => { e.stopPropagation(); onCart(r) }}
                      title={inCart(r.id) ? 'In cart' : 'Add to cart'}
                      className="material-symbols-outlined text-[18px] cursor-pointer"
                      style={{ color: inCart(r.id) ? T.primary : T.t4 }}>
                      {inCart(r.id) ? 'shopping_cart_checkout' : 'add_shopping_cart'}
                    </span>
                  </span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── bits ─────────────────────────────────────────────────────────────────── */

function Td({
  children, last, num, right,
}: { children: React.ReactNode; last: boolean; num?: boolean; right?: boolean }) {
  return (
    <td className="px-[15px] py-3 text-[12px] whitespace-nowrap"
      style={{
        ...(num ? { ...PJ, fontWeight: 700 } : null),
        color: T.t2,
        textAlign: num || right ? 'right' : 'left',
        borderBottom: last ? 'none' : `1px solid ${T.outlineSoft}`,
      }}>
      {children}
    </td>
  )
}

function Check({ on, onClick, title }: { on: boolean; onClick: () => void; title: string }) {
  return (
    <span onClick={onClick} title={title} role="checkbox" aria-checked={on}
      className="w-4 h-4 rounded-[5px] border-[1.5px] cursor-pointer inline-flex items-center justify-center flex-shrink-0"
      style={{
        background: on ? T.primary : '#fff',
        borderColor: on ? T.primary : '#cdd8e1',
        color: '#fff',
      }}>
      <span className="material-symbols-outlined text-[12px]" style={{ opacity: on ? 1 : 0 }}>check</span>
    </span>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex-1 rounded-[11px] border px-1.5 py-2 text-center"
      style={{ background: T.surfaceLow, borderColor: T.outlineSoft }}>
      <div style={{ ...PJ, color: T.t1 }} className="text-[13.5px] font-extrabold tabular-nums">{value}</div>
      <div className="text-[9px] mt-0.5 uppercase tracking-[.03em] font-semibold" style={{ color: T.t4 }}>{label}</div>
    </div>
  )
}

/**
 * One applied filter. Deliberately not `Chip`: that one is a toggle that shows
 * a filter's state, and this is a statement of an applied filter with a way to
 * take it off — the affordance is the ×, not the whole body.
 */
function FilterChip({
  label, icon, onRemove,
}: { label: string; icon?: string; onRemove: () => void }) {
  return (
    <span style={{ ...PJ, background: T.surfaceVariant, borderColor: '#A7C8D4', color: T.primaryDeep }}
      className="inline-flex items-center gap-1 rounded-full border pl-2 pr-1 h-[24px] text-[10.5px] font-bold">
      {icon && <span className="material-symbols-outlined text-[12px]">{icon}</span>}
      {label}
      <button type="button" onClick={onRemove} title={`Remove ${label}`} aria-label={`Remove ${label}`}
        className="w-[15px] h-[15px] rounded-full inline-flex items-center justify-center hover:bg-white/70">
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </span>
  )
}

function IconToggle({
  on, onClick, icon, title, activeColor, solid, filled,
}: {
  on: boolean; onClick: () => void; icon: string; title: string
  activeColor: string; solid?: boolean; filled?: boolean
}) {
  return (
    <button type="button" title={title} aria-pressed={on}
      onClick={e => { e.stopPropagation(); onClick() }}
      className="w-[30px] h-[30px] rounded-[9px] border flex items-center justify-center transition-colors"
      style={{
        background: on && solid ? activeColor : 'rgba(255,255,255,.9)',
        borderColor: on && solid ? activeColor : 'rgba(255,255,255,.6)',
        color: on ? (solid ? '#fff' : activeColor) : T.t3,
      }}>
      <span className={`material-symbols-outlined text-[15px] ${on && filled ? 'fill' : ''}`}>{icon}</span>
    </button>
  )
}

function Btn({
  children, kind = 'ghost', icon, onClick, title, full,
}: {
  children: React.ReactNode; kind?: 'primary' | 'secondary' | 'ghost'
  icon?: string; onClick?: () => void; title?: string; full?: boolean
}) {
  const style = kind === 'primary'
    ? { background: T.gradient, color: '#fff', border: 'none', boxShadow: '0 4px 12px rgba(50,116,136,.3)' }
    : kind === 'secondary'
      ? { background: T.surfaceVariant, color: T.primaryDeep, border: `1px solid #d0e2f2` }
      : { background: 'rgba(255,255,255,.9)', color: T.t2, border: `1px solid ${T.outline}` }
  return (
    <button type="button" onClick={onClick} title={title} style={{ ...PJ, ...style, width: full ? '100%' : undefined }}
      className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[11px] text-[12.5px] font-bold whitespace-nowrap transition-all hover:brightness-[1.03]">
      {icon && <span className="material-symbols-outlined text-[17px]">{icon}</span>}
      {children}
    </button>
  )
}

/** Ghost-on-dark: the bulk bar sits on the deep teal gradient. */
function BulkBtn({ children, icon, onClick }: { children: React.ReactNode; icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ ...PJ, background: 'rgba(255,255,255,.12)', borderColor: 'rgba(255,255,255,.24)' }}
      className="inline-flex items-center gap-1.5 h-[31px] px-3 rounded-[10px] border text-[11.5px] font-bold text-white transition-colors hover:bg-white/25">
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      {children}
    </button>
  )
}

function Pill({
  children, icon, onClick, title,
}: { children: React.ReactNode; icon: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} style={{ ...PJ, borderColor: T.outline, color: T.t2 }}
      className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[10px] border bg-white/85 text-[12px] font-semibold transition-colors hover:bg-white">
      <span className="material-symbols-outlined text-[16px]" style={{ color: T.t4 }}>{icon}</span>
      {children}
    </button>
  )
}

function Chip({
  label, on, onClick, icon,
}: { label: string; on: boolean; onClick: () => void; icon?: string }) {
  return (
    <button type="button" onClick={onClick} style={{
      ...PJ,
      background: on ? T.surfaceVariant : 'rgba(255,255,255,.85)',
      borderColor: on ? T.primary : T.outline,
      color: on ? T.primaryDeep : T.t2,
    }}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] border text-[12px] font-semibold transition-colors">
      {icon && <span className="material-symbols-outlined text-[14px]" style={{ color: T.t4 }}>{icon}</span>}
      {label}
    </button>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span style={{ ...PJ, background: T.primary }}
      className="ml-1 w-[17px] h-[17px] rounded-full text-white text-[9.5px] font-extrabold inline-flex items-center justify-center">
      {n}
    </span>
  )
}

/** Popover with a click-catcher behind it, so the next click anywhere closes it. */
function Popover({
  children, onClose, width,
}: { children: React.ReactNode; onClose: () => void; width: number }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute top-[42px] right-0 z-20 rounded-[14px] border bg-white p-2.5"
        style={{ width, borderColor: T.outline, boxShadow: T.shadowLg }}>
        {children}
      </div>
    </>
  )
}

function Empty({
  icon, tint, title, body, action,
}: { icon: string; tint: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-[50px] px-5 gap-[5px]">
      <span className="material-symbols-outlined text-[44px]" style={{ color: tint }}>{icon}</span>
      <h4 style={{ ...PJ, color: T.t1 }} className="text-[15px] font-extrabold mt-2.5">{title}</h4>
      <p className="text-[12.5px] max-w-[340px] leading-[1.5]" style={{ color: T.t4 }}>{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

function PgBtn({
  children, on, disabled, onClick,
}: { children: React.ReactNode; on?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        ...PJ,
        background: on ? T.gradient : '#fff',
        borderColor: on ? 'transparent' : T.outline,
        color: on ? '#fff' : disabled ? '#d1d5db' : T.t3,
      }}
      className={`min-w-[34px] h-[34px] px-2 rounded-[10px] border text-[12.5px] font-bold inline-flex items-center justify-center transition-colors ${
        disabled ? 'cursor-not-allowed' : 'hover:brightness-[.97]'
      }`}>
      {children}
    </button>
  )
}

/**
 * Setting a price for a roster creator.
 *
 * The commercial roster carries followers, engagement rate and categories, but
 * no rate — nobody has published one. So before a creator from here can be
 * ordered, the org has to say what it is willing to pay, and this is where that
 * happens: one base rate, from which every deliverable is priced by its usual
 * multiplier. Exactly the model tracked accounts already use.
 *
 * It opens from Add to Cart rather than living in a settings screen, because
 * "no price yet" is discovered at the moment of buying and sending someone
 * elsewhere to fix it is how a cart ends up abandoned.
 */
function RosterRateDialog({
  orgId, creator, current, onClose, onSaved,
}: {
  orgId: string
  creator: KolDirectoryRow
  current: number
  onClose: () => void
  onSaved: (rates: Record<string, RosterRateCard>, creator: KolDirectoryRow) => void
}) {
  const [raw, setRaw] = useState(current > 0 ? String(current) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = Number(raw.replace(/\D/g, '')) || 0

  const save = async () => {
    if (value <= 0) { setError('Masukkan tarif dasar lebih dari nol.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/rates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterKolId: creator.id, baseRate: value }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      onSaved(body?.rosterRates ?? {}, creator)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Atur tarif @${creator.username}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(17,24,39,.45)]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-2xl bg-white border border-[#e5e7eb] shadow-[0_26px_56px_rgba(30,74,88,.18)]"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#e5e7eb]">
          <span style={PJ} className="text-[13px] font-extrabold" >
            Atur tarif @{creator.username}
          </span>
          <button type="button" onClick={onClose} aria-label="Tutup"
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#f3f4f6]">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="px-4 py-3.5">
          <p className="text-[11.5px] text-[#6b7280] leading-relaxed mb-3">
            Creator dari Directory belum punya harga di platform KOL, jadi tarifnya ditetapkan
            oleh organisasi ini. Tiap deliverable dihitung dari tarif dasar dikali pengalinya —
            sama seperti akun yang kamu track.
          </p>

          <span style={PJ} className="block text-[10px] font-bold uppercase tracking-widest text-[#9ca3af] mb-1.5">
            Tarif dasar
          </span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-[#9ca3af]">Rp</span>
            <input
              autoFocus
              inputMode="numeric"
              value={value ? value.toLocaleString('id-ID') : ''}
              placeholder="0"
              onChange={e => setRaw(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              style={PJ}
              className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[#e5e7eb] text-[12px] font-bold text-[#111827] tabular-nums focus:outline-none focus:border-[#327488]"
            />
          </div>

          {value > 0 && (
            <p className="text-[10.5px] text-[#9ca3af] mt-2">
              Contoh: Reels ×1 = {'Rp' + (Math.round(value / 1000) * 1000).toLocaleString('id-ID')},
              {' '}Feed Post ×0,5 = {'Rp' + (Math.round((value * 0.5) / 1000) * 1000).toLocaleString('id-ID')}.
            </p>
          )}

          {error && <p className="text-[11px] text-[#c2553f] mt-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e5e7eb] bg-[#f9fafb] rounded-b-2xl">
          <button type="button" onClick={onClose} style={PJ}
            className="inline-flex items-center rounded-lg px-3 h-8 text-[12px] font-bold text-[#6b7280] hover:bg-[#f3f4f6]">
            Batal
          </button>
          <button type="button" onClick={() => void save()} disabled={saving || value <= 0} style={PJ}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-[12px] font-bold text-white bg-[#327488] hover:bg-[#285D6E] disabled:opacity-50 disabled:cursor-not-allowed">
            <span className="material-symbols-outlined text-[15px]">shopping_cart</span>
            {saving ? 'Menyimpan…' : 'Simpan & masukkan keranjang'}
          </button>
        </div>
      </div>
    </div>
  )
}
