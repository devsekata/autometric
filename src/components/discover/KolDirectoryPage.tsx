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
import { Overlay } from './kolViz'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import AddKolDirectoryModal from './AddKolDirectoryModal'
import {
  DATA_AVAILABLE, KOL_FILTERS_DEFAULT, KolFilterPanel, KolFilterTab, PROFILING_STATUS_OPTIONS,
  activeFilterCount, filtersToParams, relaxSuggestions,
  type KolFilters,
} from './KolDirectoryFilters'
import { useDiscoverCart } from './useDiscoverCart'
import { selectionKey, useDiscoverSelection } from './useDiscoverSelection'
import { useKolFavorites } from './useKolFavorites'
import { useSavedFilters } from './useSavedFilters'
import { tabHref } from '@/lib/discover/tabs'
import type {
  KolDataStatus, KolDirectoryFacets, KolDirectoryPayload, KolDirectoryRow,
} from '@/lib/discover/kolDirectory'
import type { Deliverable, RosterRateCard } from '@/lib/discover/vocab'

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

/**
 * My Creators profiling status (D052). A different question from the provenance
 * badge beside it: that one says how the numbers were arrived at, this one says
 * where the creator is in the Add KOL pipeline.
 *
 * Labels come from PROFILING_STATUS_OPTIONS so the badge and the D092 dropdown
 * cannot drift apart. Null — no run of its own and no L2 profile card, which is
 * most of the roster — draws nothing at all.
 */
const PROFILING: Record<string, { fg: string; bg: string; icon: string; spin?: boolean }> = {
  ready: { fg: '#3d8a5f', bg: '#eaf5ef', icon: 'check_circle' },
  profiling: { fg: '#b5761f', bg: '#fdf3e7', icon: 'progress_activity', spin: true },
  failed: { fg: '#a04545', bg: '#fdf2f2', icon: 'error' },
}
const PROFILING_LABEL: Record<string, string> = Object.fromEntries(
  PROFILING_STATUS_OPTIONS.filter(o => o.value).map(o => [o.value, o.label]),
)
/** How often a page holding a profiling creator re-asks the API (D052). */
const PROFILING_POLL_MS = 2_000

/** Banner tints — steps of the brand ramp, not new hues. */
const BANNERS = ['#285D6E', '#327488', '#4E96AC', '#1E4A58', '#3d7e96', '#5b8fa3']

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'photo_camera', tiktok: 'music_note', facebook: 'thumb_up',
}
const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook',
}

/** The source's SORTOPTS, minus the keys this roster cannot rank on. */
const SORTOPTS: [SortKey, string][] = [
  ['followers', 'Followers'],
  ['engagement', 'Engagement'],
  ['growth', 'Growth'],
  // The source's DSORT carries avgviews, medviews and v2f. They were left out
  // of this port while the roster had no view data behind them; migration 036
  // and the feature/L2 columns it added are what make them rankable.
  ['avgviews', 'Avg views'],
  ['medviews', 'Median views'],
  ['v2f', 'View-to-follower'],
  // Calculated metrics (037/038). Only the numeric ones are offered: the
  // three label columns are categories, and sorting them alphabetically would
  // put 'High' before 'Low' by accident rather than by rank.
  ['paidratio', 'Paid ratio'],
  ['sharerate', 'Share rate'],
  ['postfreq', 'Post frequency'],
  ['female', 'Female %'],
  ['male', 'Male %'],
  ['saverate', 'Save rate'],
  ['viralfreq', 'Viral frequency'],
  ['recent', 'Last updated'],
  ['name', 'Name'],
]
type SortKey = 'followers' | 'engagement' | 'growth' | 'avgviews' | 'medviews'
  | 'v2f' | 'paidratio' | 'sharerate' | 'postfreq' | 'female' | 'male'
  | 'saverate' | 'viralfreq' | 'recent' | 'name'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

/** Optional table columns — the source's COLDEFS. */
const COLDEFS: Record<string, { label: string; get: (r: KolDirectoryRow) => string; sort?: SortKey }> = {
  tier: { label: 'Tier', get: r => r.tier ?? '—' },
  growth: { label: 'Growth', get: r => growthLabel(r.growthPct), sort: 'growth' },
  // The source's `avgviews2` and `medviews` columns, and its Performance View
  // preset pairs exactly these two. Shown together on purpose: the gap between
  // the mean and the median is how much one viral post is carrying the account.
  avgviews: { label: 'Avg Views', get: r => viewsLabel(r.avgViews), sort: 'avgviews' },
  medviews: { label: 'Median Views', get: r => viewsLabel(r.medianViews), sort: 'medviews' },
  // The source exposes these two through its advanced-filter registry rather
  // than as columns; this port has no such panel yet, so they surface here
  // under the labels that registry gives them.
  v2f: { label: 'V2F', get: r => ratioLabel(r.v2fPct), sort: 'v2f' },
  l2v: { label: 'L2V', get: r => ratioLabel(r.l2vPct) },
  // Calculated metrics. Every one of them prints an em dash when null — a
  // creator the pipeline could not measure is not a creator scoring zero.
  growthclass: { label: 'Growth class', get: r => r.growthClass ?? '—' },
  paidratio: { label: 'Paid ratio', get: r => ratioLabel(r.paidRatio), sort: 'paidratio' },
  sharerate: { label: 'Share rate', get: r => ratioLabel(r.shareRate), sort: 'sharerate' },
  // Monthly only. The daily basis is deliberately not offered as a column:
  // one agreed unit, so two numbers cannot disagree on screen.
  postfreq: { label: 'Posts / month', get: r => freqLabel(r.postFrequencyMonthly), sort: 'postfreq' },
  postfreqrel: { label: 'Freq. reliability', get: r => r.postFrequencyReliability ?? '—' },
  female: { label: 'Female %', get: r => ratioLabel(r.femalePct), sort: 'female' },
  male: { label: 'Male %', get: r => ratioLabel(r.malePct), sort: 'male' },
  genderrel: { label: 'Gender reliability', get: r => r.genderReliability ?? '—' },
  priority: { label: 'Monitoring priority', get: r => r.monitoringPriority ?? '—' },
  // Discovery filters, migration 039. Topic and interest print their source
  // alongside when it is not the observed one, so an inferred value never
  // reads as a measured one in a table cell.
  topic: { label: 'Content topic', get: r => topikLabel(r.contentTopic, r.contentTopicSource) },
  format: { label: 'Format', get: r => r.formatDominant ?? '—' },
  saverate: { label: 'Save rate', get: r => ratioLabel(r.saveRate), sort: 'saverate' },
  viralfreq: { label: 'Viral freq.', get: r => ratioLabel(r.viralFrequency), sort: 'viralfreq' },
  audquality: { label: 'Audience quality', get: r => r.audienceQualityTier ?? '—' },
  audinterest: { label: 'Audience interest', get: r => topikLabel(r.audienceInterestTop, r.audienceInterestSource) },
  stability: { label: 'Stability', get: r => r.performanceStability ?? '—' },
  rising: { label: 'Rising', get: r => risingLabel(r.risingCreator) },
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

/**
 * Keystrokes to settle before the search becomes a request, per scope. My
 * Creators also searches the creator's name, over a list small enough to answer
 * sooner (D085); the Creator Database keeps the pace it has always had.
 */
const SEARCH_DEBOUNCE_MS = { mine: 300, database: 350 } as const

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
 * Card and table both lead with the creator's own name when the pipeline knows
 * it (`l2_gold.kol_profile_card.display_name`), and fall back to the handle
 * when it does not — roughly 1,774 of the roster carry a real name today.
 *
 * The handle never disappears: when a name takes the first line, `@username`
 * moves to the second one. It is what people search for, paste, and refer to
 * each other by, so dropping it would cost more than the name gains.
 */
const identityOf = (r: KolDirectoryRow): { primary: string; handle: string | null } => ({
  primary: r.displayName ?? `@${r.username}`,
  handle: r.displayName ? `@${r.username}` : null,
})

/**
 * Change in followers since the account's PREVIOUS snapshot — 10-13 days apart
 * today, not a month. Never label this "monthly" or "30d". Null for creators
 * the pipeline has scraped only once, which is most of the roster.
 */
const growthLabel = (n: number | null) =>
  (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`)
const erLabel = (er: number | null) => (er === null ? '—' : `${er.toFixed(2)}%`)

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

/**
 * Views, mean or median. Rounded for display only — the warehouse keeps two
 * decimals because an even number of posts puts the median between two values,
 * and a table cell is not the place to spend them.
 *
 * An em dash, never a zero: a creator whose posts carry no view count has not
 * been measured, and "0 views" would say the opposite. Instagram reports views
 * for video only, so this is the common case, not the edge one.
 */
const viewsLabel = (n: number | null) => (n === null ? '—' : fmtNum(Math.round(n)))

/**
 * V2F and L2V, both percentages straight from the warehouse.
 *
 * NOT clamped at 100. V2F above 100% is ordinary — one video reaching past a
 * small account's following — and capping it would hide exactly the creators
 * the metric exists to find.
 */
const ratioLabel = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)}%`)

/**
 * Posts per month. Two decimals, because an account posting once a quarter
 * lands at 0.33 and rounding it to 0 would read as "never posts".
 *
 * Em dash, never zero: null here means the observation window was a single
 * day or there were no valid posts at all, and neither is a frequency of nil.
 */
const freqLabel = (n: number | null) => (n === null ? '—' : n.toFixed(2))

/**
 * A topic or interest, with a marker when it did not come from the primary
 * source. `creator_category_fallback` means the roster category stood in for
 * real content classification; `content_inferred` means the creator's own
 * content topic stood in for unknown audience interest. Printing either
 * without the marker would present a substitute as a measurement.
 */
const topikLabel = (v: string | null, sumber: string | null) => {
  if (v === null) return '—'
  return sumber === 'content' || sumber === 'audience' ? v : `${v} *`
}

/**
 * Rising creator. Three states, not two: null is "growth never measured",
 * which is not the same as "measured and not rising".
 */
const risingLabel = (v: boolean | null) => (v === null ? '—' : v ? 'Ya' : 'Tidak')

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
  { key: 'displayName', header: 'Display name', value: r => r.displayName ?? '' },
  { key: 'platform', header: 'Platform', value: r => (r.platform ? PLATFORM_LABEL[r.platform] ?? r.platform : '') },
  { key: 'followers', header: 'Followers', value: r => r.followers ?? '' },
  { key: 'er', header: 'Engagement rate (%)', value: r => r.erPct ?? '' },
  { key: 'tier', header: 'Tier', value: r => r.tier ?? '' },
  { key: 'growth', header: 'Growth % (sejak snapshot terakhir)',
    value: r => (r.growthPct === null ? '' : r.growthPct) },
  // Raw numbers, not the table's rounded labels: a spreadsheet is where someone
  // recomputes things, and '1,2 rb' cannot be recomputed. Null exports as an
  // empty cell rather than 0, the same choice `growth` above makes.
  { key: 'avgViews', header: 'Avg views', value: r => r.avgViews ?? '' },
  { key: 'medianViews', header: 'Median views', value: r => r.medianViews ?? '' },
  { key: 'v2f', header: 'V2F (%)', value: r => r.v2fPct ?? '' },
  { key: 'l2v', header: 'L2V (%)', value: r => r.l2vPct ?? '' },
  { key: 'viewsBasis', header: 'Posts with views (basis)', value: r => r.viewsAnalyzedCount ?? '' },
  // Calculated metrics, raw. Each numeric column is followed by the
  // denominator that makes it auditable in a spreadsheet — a 0% paid ratio
  // over 0 known posts is a different fact from 0% over 200.
  { key: 'growthClass', header: 'Growth class', value: r => r.growthClass ?? '' },
  { key: 'dailyGrowth', header: 'Daily growth (followers/day)', value: r => r.dailyGrowth ?? '' },
  // Growth 30D is a PROJECTION from the measured daily rate, not observed
  // thirty-day growth - the headers say so rather than leaving a reader to
  // assume the snapshots were a month apart.
  { key: 'projected30d', header: 'Projected growth 30d (followers)', value: r => r.projected30d ?? '' },
  { key: 'projectedFollowers30d', header: 'Projected followers 30d', value: r => r.projectedFollowers30d ?? '' },
  { key: 'paidRatio', header: 'Paid ratio (%)', value: r => r.paidRatio ?? '' },
  { key: 'paidBasis', header: 'Posts with paid signal (basis)', value: r => r.paidSignalCount ?? '' },
  { key: 'shareRate', header: 'Share rate (%)', value: r => r.shareRate ?? '' },
  { key: 'postFreqMonthly', header: 'Posts / month', value: r => r.postFrequencyMonthly ?? '' },
  { key: 'postFreqCount', header: 'Valid posts (basis)', value: r => r.postFrequencyCount ?? '' },
  { key: 'observationDays', header: 'Observation days (basis)', value: r => r.observationDays ?? '' },
  { key: 'postFreqRel', header: 'Post frequency reliability', value: r => r.postFrequencyReliability ?? '' },
  { key: 'femalePct', header: 'Female (%)', value: r => r.femalePct ?? '' },
  { key: 'malePct', header: 'Male (%)', value: r => r.malePct ?? '' },
  { key: 'genderKnown', header: 'Gender known (%)', value: r => r.genderKnownPct ?? '' },
  { key: 'genderRel', header: 'Gender reliability', value: r => r.genderReliability ?? '' },
  { key: 'monitoringEr', header: 'ER used for priority (%)', value: r => r.monitoringErPct ?? '' },
  { key: 'priority', header: 'Monitoring priority', value: r => r.monitoringPriority ?? '' },
  { key: 'saveRate', header: 'Save rate (%)', value: r => r.saveRate ?? '' },
  { key: 'viralFreq', header: 'Viral frequency (%)', value: r => r.viralFrequency ?? '' },
  { key: 'viralPosts', header: 'Viral posts (basis)', value: r => r.viralPostCount ?? '' },
  { key: 'contentTopic', header: 'Content topic', value: r => r.contentTopic ?? '' },
  { key: 'contentTopicSrc', header: 'Content topic source', value: r => r.contentTopicSource ?? '' },
  { key: 'format', header: 'Dominant format', value: r => r.formatDominant ?? '' },
  { key: 'audQualityScore', header: 'Audience quality score', value: r => r.audienceQualityScore ?? '' },
  { key: 'audQualityTier', header: 'Audience quality', value: r => r.audienceQualityTier ?? '' },
  { key: 'audInterest', header: 'Audience interest', value: r => r.audienceInterestTop ?? '' },
  { key: 'audInterestSrc', header: 'Audience interest source', value: r => r.audienceInterestSource ?? '' },
  { key: 'erStddev', header: 'ER std dev (pp)', value: r => r.erStddevPp ?? '' },
  { key: 'erPeriods', header: 'ER periods (basis)', value: r => r.erPeriods ?? '' },
  { key: 'stability', header: 'Performance stability', value: r => r.performanceStability ?? '' },
  { key: 'rising', header: 'Rising creator', value: r => (r.risingCreator === null ? '' : r.risingCreator ? 'Ya' : 'Tidak') },
  { key: 'categories', header: 'Categories', value: r => r.categories.join(' · ') },
  { key: 'status', header: 'Data status', value: r => r.status },
  { key: 'verified', header: 'Verified', value: r => (r.verified ? 'Ya' : 'Tidak') },
  { key: 'connected', header: 'Connected', value: r => (r.connected ? 'Ya' : 'Tidak') },
  { key: 'agency', header: 'Agency', value: r => r.agency ?? '' },
  { key: 'rateFrom', header: 'Rate card from (IDR)', value: r => r.rateFrom ?? '' },
  { key: 'rateCount', header: 'Priced deliverables', value: r => r.rateCount },
  { key: 'myCreators', header: 'In My Creators', value: r => (r.inMyCreators ? 'Ya' : 'Tidak') },
  { key: 'updated', header: 'Last refreshed', value: r => r.lastRefreshedAt ?? '' },
  { key: 'profile', header: 'Profile URL', value: r => r.profileUrl ?? '' },
]


/**
 * Cart and rate cards still live on the analytics warehouse (and the KOL rate
 * card stays empty), so the cart actions are hidden until Ordering is on KOL.
 */
const ORDERING_AVAILABLE = false

/* ── page ─────────────────────────────────────────────────────────────────── */

/**
 * `embedded` drops the page chrome — the tinted full-height background, the
 * centring wrapper and the `<h2>` — for the KOL Intelligence workspace, which
 * already renders a breadcrumb and a page header above this. The count line and
 * the actions beside it stay: they describe the result set, not the page.
 */
export default function KolDirectoryPage({
  orgId, orgSlug, embedded = false, initialQuery = '', onAddCreator, onFindSimilar, scope = 'database',
}: {
  orgId: string
  orgSlug: string
  embedded?: boolean
  /**
   * `database` is the whole Creator Database; `mine` is this agency's My
   * Creators — the same cards and filters, narrowed server-side to creators the
   * agency holds an active `agency_kol_accounts` link to.
   */
  scope?: 'database' | 'mine'
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
  const [sort, setSort] = useState<SortState>({ key: 'followers', dir: 'desc' })
  const [view, setView] = useState<'card' | 'table'>('card')
  const [page, setPage] = useState(1)

  const [filtPanel, setFiltPanel] = useState(false)
  const [fpOpen, setFpOpen] = useState<Set<string>>(new Set(['platform']))
  const [cols, setCols] = useState<Record<ColKey, boolean>>({
    tier: true, growth: true, reach: true, platform: true, category: false, updated: false,
    // Rate card is on by default: it is the column a buyer opens the table for
    // — when there are rate cards. There are none (intentionally empty), so the
    // column would be a row of dashes; it stays off until DATA_AVAILABLE.rateCard.
    rate: DATA_AVAILABLE.rateCard, agency: false,
  })
  const [colOpen, setColOpen] = useState(false)
  const [listsOpen, setListsOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  const [rows, setRows] = useState<KolDirectoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<KolDirectoryFacets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by the retry button — the KOL host is remote and can blip. */
  const [reload, setReload] = useState(0)
  /**
   * Bumped by the profiling poll (D052). Separate from `reload` because it must
   * not show the skeleton: a creator halfway through Add KOL would otherwise
   * blank the grid every two seconds while the user is reading it. The ref is
   * what the fetch below reads to keep that one round trip silent.
   */
  const [pollTick, setPollTick] = useState(0)
  const silentFetch = useRef(false)
  // Filter options describe the whole roster, so they are fetched once.
  const facetsLoaded = useRef(false)

  /**
   * Selection keeps whole rows, not just ids: the grid only ever holds one page,
   * and Export / Compare have to work on creators picked across several pages.
   */
  const [selected, setSelected] = useState<Map<string, KolDirectoryRow>>(new Map())
  const compare = useDiscoverSelection(orgId, 'compare')
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
  const [toast, setToast] = useState<string | null>(null)
  /** The Add New KOL dialog — this page's own intake flow into `kol_directory`. */
  const [addOpen, setAddOpen] = useState(false)
  /**
   * My Creators toggles made on this page since the last load, so a card flips
   * immediately; the server's `inMyCreators` is the truth underneath.
   */
  const [mineOverride, setMineOverride] = useState<Record<string, boolean>>({})
  /**
   * My Creators Monitored/Paused values the server confirmed since the last
   * load, and the card whose toggle is in flight. Only a successful PATCH
   * changes what a card shows.
   */
  const [monitoringSaved, setMonitoringSaved] = useState<Record<string, boolean>>({})
  const [monitoringBusy, setMonitoringBusy] = useState<string | null>(null)
  /** The creator whose Quick Insight drawer is open. */
  const [quick, setQuick] = useState<KolDirectoryRow | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  /** The signed-in user's favorites in this agency (KOL `agency_kol_favorites`). */
  const fav = useKolFavorites(orgId, flash)
  const isFav = fav.has
  const favCount = fav.count
  const toggleFav = (r: KolDirectoryRow) => {
    void fav.toggle(r.id).then(on => {
      if (on !== null) flash(on ? 'Ditambahkan ke favorit' : 'Dihapus dari favorit')
    })
  }

  /** The signed-in user's Saved Lists in this agency (KOL `agency_kol_saved_filters`). */
  const saved = useSavedFilters<KolFilters>(orgId, flash)
  const savedLists = saved.lists

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
    const t = window.setTimeout(() => { setSearch(query.trim()); setPage(1) }, SEARCH_DEBOUNCE_MS[scope])
    return () => window.clearTimeout(t)
  }, [query, scope])

  /**
   * Roster prices and the deliverable catalogue, fetched once.
   *
   * The grid shows a price badge per row and Add to Cart needs the platform's
   * headline deliverable, so both have to be here before the first click. A
   * failure leaves Add to Cart offering to set a price, which is the same thing
   * it does for a creator nobody has priced — no worse a state than the truth.
   */
  useEffect(() => {
    if (!ORDERING_AVAILABLE) return
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

  /**
   * Profiling status is a My Creators filter. A value that reaches the Creator
   * Database (from a Saved List made on My Creators) is dropped here, so it
   * neither filters nor counts where no control shows it.
   */
  const scopedFilters = scope === 'mine' ? filters : { ...filters, profilingStatus: '' as const }
  const filterParams = filtersToParams(scopedFilters)
  const filterKey = JSON.stringify(filterParams)

  useEffect(() => {
    const params = new URLSearchParams({
      ...JSON.parse(filterKey) as Record<string, string>,
      sort: sort.key, dir: sort.dir, page: String(page), pageSize: String(PAGE_SIZE),
    })
    if (search) params.set('q', search)
    if (scope === 'mine') params.set('scope', 'mine')
    if (!facetsLoaded.current) params.set('facets', '1')

    // A poll round trip repaints the rows and nothing else: no skeleton, and a
    // blip on the KOL host does not replace a readable page with an error
    // block — the next tick asks again.
    const silent = silentFetch.current
    silentFetch.current = false

    let cancelled = false
    if (!silent) {
      setLoading(true)
      setError(null)
    }

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
        if (!silent) {
          // Optimistic toggles survive a poll: the PATCH behind each one may
          // still be in flight, and dropping them would flip the button back
          // under the user's hand.
          setMineOverride({})
          setMonitoringSaved({})
        }
        if (d.facets) { setFacets(d.facets); facetsLoaded.current = true }
      })
      .catch(e => { if (!cancelled && !silent) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled && !silent) setLoading(false) })

    return () => { cancelled = true }
  }, [orgId, search, filterKey, sort, page, reload, pollTick, scope])

  /**
   * D052 — auto refresh status.
   *
   * While a creator on this page is mid-profiling, the list re-asks the API so
   * the badge turns from Profiling into Ready (or Failed) on its own. Driven by
   * what is on screen, not by a timer someone has to remember to stop: the
   * effect only subscribes while at least one visible row says `profiling`, so
   * it unsubscribes the moment the last run finishes, and never runs at all on
   * the Creator Database, which does not carry the status.
   *
   * Counted rather than derived from `rows` so a poll whose answer is unchanged
   * does not tear the interval down and start a fresh two seconds.
   */
  const profilingCount = rows.filter(r => r.profilingStatus === 'profiling').length

  /** Hidden tab = no polling at all, rather than a throttled one. */
  const [tabVisible, setTabVisible] = useState(true)
  useEffect(() => {
    const read = () => setTabVisible(document.visibilityState === 'visible')
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])

  useEffect(() => {
    if (scope !== 'mine' || profilingCount === 0 || !tabVisible) return
    const timer = window.setInterval(() => {
      silentFetch.current = true
      setPollTick(n => n + 1)
    }, PROFILING_POLL_MS)
    return () => {
      window.clearInterval(timer)
      // Nothing in flight should arrive as a silent fetch after the poll stops.
      silentFetch.current = false
    }
  }, [scope, profilingCount, tabVisible])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fCount = activeFilterCount(scopedFilters)
  const dirty = Boolean(query || filters.category || fCount)
  /** Empty-result hints (D124), from the filters this scope actually applies. */
  const relax = relaxSuggestions(scopedFilters, query)
  const rosterTotal = facets?.rosterTotal ?? total

  const patchFilters = (patch: Partial<KolFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1) }
  const clearFilters = () => { setFilters(KOL_FILTERS_DEFAULT); setPage(1) }
  const resetAll = () => { setQuery(''); setSearch(''); clearFilters() }

  const toggleSection = (id: string) => setFpOpen(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  /** Header sort: same key flips the direction, a new key starts at its default. */
  const sortBy = (key: SortKey) => {
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

  const isMine = (r: KolDirectoryRow) => mineOverride[r.id] ?? r.inMyCreators === true

  /**
   * Export from the page head: the selected creators when there is a
   * selection (table view), otherwise the creators on this page.
   */
  const exportCurrent = (format: 'csv' | 'xlsx') => () => {
    const picked = selected.size ? selectedRows : rows
    if (!picked.length) { flash('Tidak ada creator untuk diexport'); return }
    const out = picked.map(r => ({ ...r, inMyCreators: isMine(r) }))
    const file = scope === 'mine' ? 'my-creators' : 'kol-directory'
    if (format === 'csv') exportCsv(out, EXPORT_COLUMNS, file)
    else exportExcel(out, EXPORT_COLUMNS, file)
    flash(`Exporting ${out.length} creators as ${format === 'csv' ? 'CSV' : 'Excel'}`)
  }

  /** Add to / remove from My Creators — `agency_kol_accounts` on the KOL server. */
  const toggleMine = async (r: KolDirectoryRow) => {
    const was = isMine(r)
    setMineOverride(m => ({ ...m, [r.id]: !was }))
    try {
      const res = was
        ? await fetch(`/api/organizations/${orgId}/discover/my-creators/${r.id}`, { method: 'DELETE' })
        : await fetch(`/api/organizations/${orgId}/discover/my-creators`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kolId: r.id }),
          })
      // Removing one that is already gone is the outcome that was asked for.
      if (!res.ok && !(was && res.status === 404)) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      flash(was ? `@${r.username} dihapus dari My Creators` : `@${r.username} ditambahkan ke My Creators`)
      if (scope === 'mine' && was) setReload(n => n + 1)
    } catch (e) {
      setMineOverride(m => ({ ...m, [r.id]: was }))
      flash(`My Creators gagal diperbarui: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * My Creators only: Monitored/Paused for this agency
   * (`agency_kol_accounts.monitoring_enabled`). Null hides the control — on the
   * Creator Database, and for a card no longer in My Creators.
   */
  const monitoringOf = (r: KolDirectoryRow): boolean | null =>
    scope !== 'mine' || !isMine(r) ? null : (monitoringSaved[r.id] ?? r.monitoringEnabled ?? null)

  /** Stored only; the card changes once the server has saved the new value. */
  const toggleMonitoring = async (r: KolDirectoryRow) => {
    const current = monitoringOf(r)
    if (current === null || monitoringBusy) return
    setMonitoringBusy(r.id)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/my-creators/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitoringEnabled: !current }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || typeof body?.monitoringEnabled !== 'boolean') {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const saved = body.monitoringEnabled as boolean
      setMonitoringSaved(m => ({ ...m, [r.id]: saved }))
      flash(saved ? `@${r.username} dipantau (Monitored)` : `Monitoring @${r.username} dijeda (Paused)`)
    } catch (e) {
      flash(`Status monitoring gagal diperbarui: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setMonitoringBusy(null)
    }
  }

  const cardProps = (r: KolDirectoryRow) => ({
    creator: r,
    fav: isFav(r.id), inCompare: inCompare(r.id), inCart: inCart(r.id),
    inMine: isMine(r),
    onMine: () => { void toggleMine(r) },
    monitoring: monitoringOf(r),
    monitoringBusy: monitoringBusy === r.id,
    onMonitoring: () => { void toggleMonitoring(r) },
    onOpen: () => openProfile(r),
    onFav: () => toggleFav(r),
    onCompare: () => toggleCompare(r),
    onCart: () => (inCart(r.id) ? removeFromCart(r) : addToCart(r)),
    onSimilar: onFindSimilar ? () => onFindSimilar(r.id) : null,
    onQuick: () => setQuick(r),
  })

  const topCategories = (facets?.categories ?? []).slice(0, 6)

  return (
    <div className={embedded ? '' : 'min-h-full'} style={embedded ? undefined : { background: T.surfaceLow }}>
      <div className={embedded ? '' : 'max-w-[1280px] mx-auto px-5 py-5'}>

        {/* ── page head ── */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-1.5">
          <div>
            {!embedded && (
              <h2 style={{ ...PJ, color: T.t1 }} className="text-[21px] font-extrabold tracking-[-0.03em]">
                {scope === 'mine' ? 'My Creators' : 'KOL Directory'}
              </h2>
            )}
            <p className="text-[12.5px] mt-[5px]" style={{ color: T.t3 }}>
              {loading && !rows.length ? 'Memuat direktori…' : (
                <>
                  {scope === 'mine'
                    ? `${total.toLocaleString('id-ID')} creators di My Creators`
                    : `${total.toLocaleString('id-ID')} of ${rosterTotal.toLocaleString('id-ID')} creators`}
                  {fCount > 0 && ` · ${fCount} filter${fCount > 1 ? 's' : ''} applied`}
                  {` · ${favCount} favorites · ${compare.ids.size} in compare`}
                </>
              )}
            </p>
          </div>
          <div className="flex gap-[9px]">
            <Btn kind="ghost" icon="download" onClick={exportCurrent('csv')}
              title={selected.size ? `Export ${selected.size} creator terpilih ke CSV` : 'Export creator di halaman ini ke CSV'}>
              CSV
            </Btn>
            <Btn kind="ghost" icon="table_view" onClick={exportCurrent('xlsx')}
              title={selected.size ? `Export ${selected.size} creator terpilih ke Excel` : 'Export creator di halaman ini ke Excel'}>
              Excel
            </Btn>
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

        {/* ── toolbar ── */}
        <div className="flex items-center gap-2.5 flex-wrap my-4">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined absolute left-[11px] text-[17px]" style={{ color: '#b4c3d0' }}>
              search
            </span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={scope === 'mine'
                ? 'Search creators by name or username…'
                : 'Search creators by username…'}
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
            <Chip label="All" on={!filters.category} onClick={() => patchFilters({ category: '' })} />
            {topCategories.map(c => (
              <Chip key={c.name} label={c.name} on={filters.category === c.name}
                onClick={() => patchFilters({ category: filters.category === c.name ? '' : c.name })} />
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
              Saved Lists{savedLists.length > 0 && <Count n={savedLists.length} />}
            </Pill>
            {listsOpen && (
              <Popover onClose={() => setListsOpen(false)} width={260}>
                <div style={{ ...PJ, color: T.t4 }}
                  className="text-[11px] font-extrabold uppercase tracking-[.05em] px-1 pb-2">
                  Saved Lists
                </div>
                {savedLists.length === 0 ? (
                  <div className="text-[11.5px] px-1 pb-1" style={{ color: T.t4 }}>No saved lists yet.</div>
                ) : savedLists.map(l => (
                  <div key={l.id}
                    className="flex items-center gap-2 px-1 py-[7px] rounded-lg cursor-pointer hover:bg-[#f7fafc]"
                    onClick={() => {
                      setFilters({ ...KOL_FILTERS_DEFAULT, ...l.filters })
                      setPage(1); setListsOpen(false); flash(`Applied "${l.name}"`)
                    }}>
                    <span className="material-symbols-outlined text-[16px]" style={{ color: T.primary }}>bookmark</span>
                    <span style={{ ...PJ, color: T.t1 }} className="flex-1 text-[12px] font-bold truncate">{l.name}</span>
                    <span className="material-symbols-outlined text-[15px]" style={{ color: T.t4 }}
                      onClick={e => {
                        e.stopPropagation()
                        void saved.remove(l.id).then(ok => { if (ok) flash(`Deleted "${l.name}"`) })
                      }}>
                      delete
                    </span>
                  </div>
                ))}
                <div className="mt-1.5 pt-2" style={{ borderTop: `1px solid ${T.outlineSoft}` }}>
                  <Btn kind="ghost" icon="add" full onClick={() => {
                    const name = window.prompt('Name this saved list:', `Custom List ${savedLists.length + 1}`)?.trim()
                    if (!name) return
                    setListsOpen(false)
                    void saved.save(name, filters).then(ok => { if (ok) flash(`Saved list "${name}"`) })
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
                {SORTOPTS.map(([key, label]) => (
                  <div key={key} onClick={() => { sortBy(key); setSortOpen(false) }}
                    className="flex items-center gap-2 px-2 py-[7px] rounded-lg cursor-pointer hover:bg-[#f7fafc]">
                    <span style={{ ...PJ, color: sort.key === key ? T.primaryDeep : T.t2 }}
                      className="flex-1 text-[12px] font-bold">{label}</span>
                    {sort.key === key && (
                      <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>
                        {sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                      </span>
                    )}
                  </div>
                ))}
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
                  {(Object.keys(COLDEFS) as ColKey[])
                    // No rate card exists, so the column is not offered (it would only show dashes).
                    .filter(c => c !== 'rate' || DATA_AVAILABLE.rateCard)
                    .map(c => (
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
            ) : rows.length === 0 && scope === 'mine' && !dirty ? (
              <Empty icon="group_add" tint="#cfe0f1" title="Belum ada creator di My Creators"
                body="Tambahkan creator dari Creator Database lewat tombol orang (+) di kartunya, atau daftarkan akun baru dengan Add KOL."
                action={<Btn kind="primary" icon="person_add" onClick={() => setAddOpen(true)}>Add KOL</Btn>} />
            ) : rows.length === 0 ? (
              <Empty icon="person_search" tint="#cfe0f1" title="No creators match your filters"
                body="Try a different keyword or clear filters."
                extra={relax.length > 0 && (
                  // D124: the active filters most likely to have emptied the list.
                  <div className="mt-3 w-full max-w-[360px] text-left">
                    <div style={{ ...PJ, color: T.t4 }}
                      className="text-[10.5px] font-extrabold uppercase tracking-[.05em] mb-1.5">
                      Coba longgarkan
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {relax.map(s => (
                        <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                          style={{ borderColor: T.outline }}>
                          <span className="text-[12px]" style={{ color: T.t2 }}>{s.label}</span>
                          <button type="button"
                            onClick={() => ('clearQuery' in s ? setQuery('') : patchFilters(s.patch))}
                            style={{ ...PJ, color: T.primary }}
                            className="text-[11.5px] font-bold hover:underline flex-shrink-0">
                            Lepas
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                    isMine={isMine}
                    onMine={r => { void toggleMine(r) }}
                    onQuick={setQuick}
                    onOpen={openProfile}
                    onSimilar={onFindSimilar ? r => onFindSimilar(r.id) : null}
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
                    {ORDERING_AVAILABLE && <BulkBtn icon="add_shopping_cart" onClick={bulkCart}>Add to Cart</BulkBtn>}
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
              scope={scope}
              filters={scopedFilters} facets={facets} open={fpOpen}
              onToggleSection={toggleSection} onChange={patchFilters}
              onClear={clearFilters} onCollapse={() => setFiltPanel(false)}
            />
          ) : (
            <KolFilterTab count={fCount} onOpen={() => setFiltPanel(true)} />
          )}
        </div>
      </div>

      {quick && (
        <QuickInsight
          row={quick}
          onClose={() => setQuick(null)}
          onProfile={() => openProfile(quick)}
          inMine={isMine(quick)} onMine={() => { void toggleMine(quick) }}
          fav={isFav(quick.id)}
          onFav={() => toggleFav(quick)}
          inCompare={inCompare(quick.id)} onCompare={() => toggleCompare(quick)}
          onSimilar={onFindSimilar ? () => onFindSimilar(quick.id) : null}
        />
      )}

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

      {addOpen && (
        <AddKolDirectoryModal
          orgId={orgId}
          onClose={() => setAddOpen(false)}
          onKolAdded={() => {
            setAddOpen(false)
            // Same trigger the retry button uses — re-runs the list fetch so
            // the newly added row shows up once its scrape has caught up.
            setReload(n => n + 1)
          }}
          // Already in the directory: close and open that creator (D008).
          onViewExisting={id => {
            setAddOpen(false)
            router.push(`/organizations/${orgSlug}/discover/kol-directory/${id}`)
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
  creator: c, fav, inCompare, inCart, inMine, onOpen, onFav, onCompare, onCart, onMine, onSimilar, onQuick,
  monitoring, monitoringBusy, onMonitoring,
}: {
  creator: KolDirectoryRow
  fav: boolean; inCompare: boolean; inCart: boolean; inMine: boolean
  onOpen: () => void; onFav: () => void; onCompare: () => void; onCart: () => void; onMine: () => void
  onQuick: () => void
  /** My Creators Monitored (true) / Paused (false); null hides the toggle. */
  monitoring: boolean | null
  monitoringBusy: boolean
  onMonitoring: () => void
  /** Null when the page was mounted without a Smart Discovery destination. */
  onSimilar: (() => void) | null
}) {
  const st = statusOf(c.status)
  const banner = gradOf(bannerFor(c.id))
  const ident = identityOf(c)
  const subtitle = [ident.handle, c.platform ? PLATFORM_LABEL[c.platform] ?? c.platform : null, c.city]
    .filter(Boolean).join(' · ')

  /*
   * The whole card opens the creator, and it opens OUR route, which needs no
   * `profile_url` from the platform. Gating the cursor and the tooltip on that
   * column made the 222 active creators without one read as dead cards while
   * the click worked all along, so the affordance no longer depends on it.
   */
  return (
    <article onClick={onOpen}
      className="relative rounded-[18px] border overflow-hidden bg-white transition-all hover:-translate-y-[3px]"
      style={{ borderColor: T.outline, boxShadow: T.shadow, cursor: 'pointer' }}
      title="Buka profil creator"
    >
      <div className="h-14 relative overflow-hidden" style={{ background: banner }}>
        <span className="absolute rounded-full" style={{ width: 90, height: 90, top: -40, right: 20, background: 'rgba(255,255,255,.16)' }} />
        <span className="absolute rounded-full" style={{ width: 50, height: 50, bottom: -24, right: 90, background: 'rgba(255,255,255,.16)' }} />
        <div className="absolute top-[9px] right-[9px] flex gap-1.5 z-[3]">
          <IconToggle on={false} onClick={onQuick} icon="bolt" title="Quick Insight" activeColor={T.primary} solid />
          <IconToggle on={inMine} onClick={onMine} icon={inMine ? 'how_to_reg' : 'person_add'}
            title={inMine ? 'Di My Creators — klik untuk menghapus' : 'Tambahkan ke My Creators'}
            activeColor={T.primary} solid />
          <IconToggle on={fav} onClick={onFav} icon="favorite" title="Favorite" activeColor={T.accent} filled />
          <IconToggle on={inCompare} onClick={onCompare} icon={inCompare ? 'check' : 'add'} title="Add to compare"
            activeColor={T.primary} solid />
          {ORDERING_AVAILABLE && (
            <IconToggle on={inCart} onClick={onCart} icon={inCart ? 'shopping_cart_checkout' : 'add_shopping_cart'}
              title={inCart ? 'In cart' : 'Add to cart'} activeColor="#3d8a5f" solid />
          )}
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
        {/* Connected — the creator linked the account through OAuth. This is
            not the platform's blue tick: that badge was dropped from Discovery,
            so the icon is a link rather than a check to avoid reading as one. */}
        {c.connected && (
          <span title="Connected" aria-label="Connected"
            className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-[2.5px] border-white flex items-center justify-center"
            style={{ background: T.primary }}>
            <span className="material-symbols-outlined fill text-[11px] text-white">link</span>
          </span>
        )}
      </div>

      <div className="px-4 pt-2 pb-[15px]">
        {/* Verified — the platform's blue tick. Deliberately a different mark
            from Connected above: Connected is a link icon on the avatar and
            means the creator authorised us through OAuth, this one is a check
            beside the name and means the platform itself verified them. The
            two are independent, so a creator can carry either, both, or
            neither. */}
        <div style={{ ...PJ, color: T.t1 }} className="text-[15px] font-extrabold flex items-center gap-1 min-w-0"
          title={ident.handle ? `${ident.primary} (${ident.handle})` : ident.primary}>
          <span className="truncate">{ident.primary}</span>
          {c.verified && (
            <span title="Verified oleh platform" aria-label="Verified oleh platform"
              className="material-symbols-outlined fill text-[15px] shrink-0"
              style={{ color: T.primaryDeep }}>verified</span>
          )}
        </div>
        <div className="text-[11.5px] mt-px truncate" style={{ color: T.t4 }}>{subtitle || '—'}</div>

        <span className="inline-flex items-center gap-1.5 mt-[9px] rounded-lg px-[9px] py-[3px] text-[10.5px] font-bold max-w-full"
          style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}>
          <span className="material-symbols-outlined text-[12px]">category</span>
          <span className="truncate">{c.categories.length ? c.categories.join(' · ') : 'Belum berkategori'}</span>
        </span>

        <div className="flex gap-1.5 mt-[13px]">
          <Stat label="Followers" value={followersLabel(c.followers)} />
          <Stat label="Growth" value={growthLabel(c.growthPct)} />
          <Stat label="Eng. Rate" value={erLabel(c.erPct)} />
          <Stat label="Est. Reach" value={reachLabel(c)} />
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 min-w-0 flex-wrap">
            {/* My Creators only, and only when the creator answers one of the
                three (D052). Sits before the provenance badge because it is the
                more volatile of the two. */}
            <ProfilingBadge status={c.profilingStatus} />
            <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-extrabold"
              style={{ ...PJ, background: st.bg, color: st.fg }}
              title={`Data ${c.status.toLowerCase()} · last synced ${sinceLabel(c.lastRefreshedAt)}`}>
              <span className="material-symbols-outlined text-[12px]">{st.icon}</span>
              {c.status} · {sinceLabel(c.lastRefreshedAt)}
            </span>
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
            {/* My Creators monitoring. Stored only for now — no scheduler reads it. */}
            {monitoring !== null && (
              <button type="button" disabled={monitoringBusy} aria-pressed={monitoring}
                onClick={e => { e.stopPropagation(); onMonitoring() }}
                title={monitoring
                  ? 'Monitoring aktif — klik untuk menjeda'
                  : 'Monitoring dijeda — klik untuk mengaktifkan'}
                style={{
                  ...PJ,
                  background: monitoring ? '#eaf5ef' : '#fdf3e7',
                  color: monitoring ? '#3d8a5f' : '#b5761f',
                }}
                className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[10px] font-bold ${
                  monitoringBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}>
                <span className={`material-symbols-outlined text-[12px] ${monitoringBusy ? 'animate-spin' : ''}`}>
                  {monitoringBusy ? 'progress_activity' : monitoring ? 'notifications_active' : 'notifications_off'}
                </span>
                {monitoring ? 'Monitored' : 'Paused'}
              </button>
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

/* ── quick insight ────────────────────────────────────────────────────────── */

/**
 * Creator Quick Insight — the short read on one creator without leaving the
 * list (D39). Everything comes from the row the list already loaded from the
 * KOL database; an unmeasured value says so instead of showing zero.
 */
function QuickInsight({
  row: c, onClose, onProfile, inMine, onMine, fav, onFav, inCompare, onCompare, onSimilar,
}: {
  row: KolDirectoryRow
  onClose: () => void
  onProfile: () => void
  inMine: boolean; onMine: () => void
  fav: boolean; onFav: () => void
  inCompare: boolean; onCompare: () => void
  onSimilar: (() => void) | null
}) {
  const ident = identityOf(c)
  const st = statusOf(c.status)
  const NA = 'Belum terukur'
  const pct = (v: number | null, digits = 1) => (v === null ? NA : `${v.toFixed(digits)}%`)
  const num = (v: number | null) => (v === null ? NA : fmtNum(v))
  const inferred = (value: string | null, source: string | null, flag: string) =>
    value === null ? NA : source === flag ? `${value} (perkiraan)` : value

  const sections: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Performa',
      rows: [
        ['Followers', num(c.followers)],
        ['Growth', c.growthPct === null ? NA : growthLabel(c.growthPct)],
        ['Engagement rate', c.erPct === null ? NA : erLabel(c.erPct)],
        ['Avg views', c.avgViews === null ? NA
          : `${fmtNum(Math.round(c.avgViews))}${c.viewsAnalyzedCount ? ` · ${c.viewsAnalyzedCount} post` : ''}`],
        ['Views / followers', pct(c.v2fPct)],
        ['Likes / views', pct(c.l2vPct)],
        ['Post / bulan', c.postFrequencyMonthly === null ? NA
          : `${c.postFrequencyMonthly.toFixed(1)}${c.postFrequencyReliability ? ` · reliabilitas ${c.postFrequencyReliability}` : ''}`],
        ['Stabilitas performa', c.performanceStability ?? NA],
      ],
    },
    {
      title: 'Audiens',
      rows: [
        ['Kualitas audiens', c.audienceQualityScore === null ? NA
          : `${Math.round(c.audienceQualityScore)}${c.audienceQualityTier ? ` (${c.audienceQualityTier})` : ''}`],
        // Same field Compare and the profile already show (D067), rounded the
        // way the audience-quality row beside it is. Never substituted.
        ['Authenticity', c.authenticityScore === null ? NA : String(Math.round(c.authenticityScore))],
        ['Gender', c.femalePct === null || c.malePct === null ? NA
          : `P ${c.femalePct.toFixed(1)}% · L ${c.malePct.toFixed(1)}%`
            + (c.genderKnownPct !== null ? ` · dari ${c.genderKnownPct.toFixed(0)}% audiens yang diketahui` : '')],
        ['Minat utama', inferred(c.audienceInterestTop, c.audienceInterestSource, 'content_inferred')],
      ],
    },
    {
      title: 'Konten',
      rows: [
        ['Topik', inferred(c.contentTopic, c.contentTopicSource, 'creator_category_fallback')],
        ['Format dominan', c.formatDominant ?? NA],
        ['Konten berbayar', c.paidRatio === null ? NA
          : `${c.paidRatio.toFixed(1)}%${c.paidSignalCount ? ` dari ${c.paidSignalCount} post` : ''}`],
        ['Share rate', pct(c.shareRate)],
      ],
    },
    {
      title: 'Data',
      rows: [
        ['Kategori', c.categories.length ? c.categories.join(' · ') : 'Belum berkategori'],
        ['Tier', c.tier ?? 'Untiered'],
        ['Rate card', c.rateFrom === null ? 'Belum ada' : `mulai ${idrShort(c.rateFrom)}`],
        ['Agency', c.agency ?? '—'],
        ['Status data', `${c.status} · ${sinceLabel(c.lastRefreshedAt)}`],
        // My Creators only, and only when the creator answers one of the three
        // (D052) — the same rule the card badge follows.
        ...(c.profilingStatus
          ? [['Status profiling', PROFILING_LABEL[c.profilingStatus] ?? c.profilingStatus] as [string, string]]
          : []),
      ],
    },
  ]

  return (
    <Overlay open title="Quick Insight" side="right" onClose={onClose}
      footer={
        <div className="flex gap-2 w-full">
          <Btn kind="primary" icon="open_in_new" onClick={onProfile} full>Buka profil lengkap</Btn>
        </div>
      }>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-[14px] overflow-hidden flex items-center justify-center shrink-0"
          style={{ background: gradOf(bannerFor(c.id)) }}>
          <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[17px]" />
        </div>
        <div className="min-w-0">
          <div style={{ ...PJ, color: T.t1 }} className="text-[15px] font-extrabold truncate">{ident.primary}</div>
          <div className="text-[11.5px] truncate" style={{ color: T.t4 }}>
            {[ident.handle, c.platform ? PLATFORM_LABEL[c.platform] ?? c.platform : null, c.city].filter(Boolean).join(' · ') || '—'}
          </div>
          <span className="inline-flex items-center gap-1 mt-1 rounded-[7px] px-2 py-[2px] text-[9.5px] font-extrabold"
            style={{ ...PJ, background: st.bg, color: st.fg }}>
            <span className="material-symbols-outlined text-[12px]">{st.icon}</span>{c.status}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <Btn kind={inMine ? 'secondary' : 'ghost'} icon={inMine ? 'how_to_reg' : 'person_add'} onClick={onMine}>
          {inMine ? 'Di My Creators' : 'Tambah ke My Creators'}
        </Btn>
        <Btn kind={fav ? 'secondary' : 'ghost'} icon="favorite" onClick={onFav}>{fav ? 'Favorit' : 'Favorite'}</Btn>
        <Btn kind={inCompare ? 'secondary' : 'ghost'} icon={inCompare ? 'check' : 'compare'} onClick={onCompare}>Compare</Btn>
        {onSimilar && <Btn kind="ghost" icon="auto_awesome" onClick={onSimilar}>Similar</Btn>}
      </div>

      {c.bio && (
        <p className="text-[12px] leading-relaxed mb-4 whitespace-pre-line" style={{ color: T.t2 }}>{c.bio}</p>
      )}

      <div className="flex flex-col gap-4">
        {sections.map(sec => (
          <section key={sec.title}>
            <h4 style={{ ...PJ, color: T.t4 }} className="text-[10px] font-extrabold uppercase tracking-[.06em] mb-1.5">
              {sec.title}
            </h4>
            <dl className="rounded-xl border divide-y" style={{ borderColor: T.outline }}>
              {sec.rows.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 px-3 py-2">
                  <dt className="text-[11.5px]" style={{ color: T.t3 }}>{k}</dt>
                  <dd className="text-[11.5px] font-bold text-right tabular-nums"
                    style={{ ...PJ, color: v === NA ? T.t4 : T.t1 }}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Overlay>
  )
}

/* ── table ────────────────────────────────────────────────────────────────── */

function DirectoryTable({
  rows, cols, sort, onSort, selected, onToggleRow, allOnPage, onToggleAll, inCart, onCart, isMine, onMine, onQuick, onOpen, onSimilar,
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
  isMine: (r: KolDirectoryRow) => boolean
  onMine: (r: KolDirectoryRow) => void
  onQuick: (r: KolDirectoryRow) => void
  onOpen: (r: KolDirectoryRow) => void
  /** Null when the page was mounted without a Smart Discovery destination. */
  onSimilar: ((r: KolDirectoryRow) => void) | null
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
                        {identityOf(r).primary}
                        {r.connected && <span title="Connected" aria-label="Connected"
                          className="material-symbols-outlined fill text-[13px]" style={{ color: T.primary }}>link</span>}
                        {r.verified && <span title="Verified oleh platform" aria-label="Verified oleh platform"
                          className="material-symbols-outlined fill text-[13px]" style={{ color: T.primaryDeep }}>verified</span>}
                      </div>
                      <div className="text-[10.5px] truncate max-w-[220px]" style={{ color: T.t4 }}>
                        {[identityOf(r).handle, r.categories.length ? r.categories.join(' · ') : null]
                          .filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td last={i === rows.length - 1} num>{followersLabel(r.followers)}</Td>
                <Td last={i === rows.length - 1} num>{erLabel(r.erPct)}</Td>
                {active.map(c => <Td key={c} last={i === rows.length - 1} num>{COLDEFS[c].get(r)}</Td>)}
                <Td last={i === rows.length - 1}>
                  <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-extrabold"
                    style={{ ...PJ, background: st.bg, color: st.fg }}>
                    <span className="material-symbols-outlined text-[11px]">{st.icon}</span>{r.status}
                  </span>
                </Td>
                <Td last={i === rows.length - 1} right>
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <span onClick={e => { e.stopPropagation(); onQuick(r) }}
                      title="Quick Insight"
                      className="material-symbols-outlined text-[18px] cursor-pointer"
                      style={{ color: T.t4 }}>
                      bolt
                    </span>
                    <span onClick={e => { e.stopPropagation(); onMine(r) }}
                      title={isMine(r) ? 'Di My Creators — klik untuk menghapus' : 'Tambahkan ke My Creators'}
                      className="material-symbols-outlined text-[18px] cursor-pointer"
                      style={{ color: isMine(r) ? T.primary : T.t4 }}>
                      {isMine(r) ? 'how_to_reg' : 'person_add'}
                    </span>
                    {onSimilar && (
                      <span onClick={e => { e.stopPropagation(); onSimilar(r) }}
                        title="Find similar creators"
                        className="material-symbols-outlined text-[18px] cursor-pointer"
                        style={{ color: T.t4 }}>
                        auto_awesome
                      </span>
                    )}
                    {ORDERING_AVAILABLE && (
                      <span onClick={e => { e.stopPropagation(); onCart(r) }}
                        title={inCart(r.id) ? 'In cart' : 'Add to cart'}
                        className="material-symbols-outlined text-[18px] cursor-pointer"
                        style={{ color: inCart(r.id) ? T.primary : T.t4 }}>
                        {inCart(r.id) ? 'shopping_cart_checkout' : 'add_shopping_cart'}
                      </span>
                    )}
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

/**
 * Ready / Profiling / Failed for one My Creators row (D052). Renders nothing
 * for a creator the status does not apply to — absent on the Creator Database,
 * null for the 5.384 roster creators with no Add KOL run and no L2 profile card
 * — because an absent answer is not "Ready".
 */
function ProfilingBadge({ status }: { status?: string | null }) {
  if (!status) return null
  // Never index PROFILING directly, for the reason statusOf exists: a value the
  // SQL CASE does not produce today would throw inside render.
  const p = PROFILING[status]
  if (!p) return null
  const label = PROFILING_LABEL[status] ?? status
  return (
    <span className="inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[9.5px] font-extrabold"
      style={{ ...PJ, background: p.bg, color: p.fg }}
      title={status === 'profiling'
        ? 'Add KOL sedang berjalan — status diperbarui otomatis'
        : status === 'failed'
          ? 'Proses Add KOL terakhir gagal'
          : 'Profil creator sudah siap'}>
      <span className={`material-symbols-outlined text-[12px] ${p.spin ? 'animate-spin' : ''}`}>{p.icon}</span>
      {label}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-[11px] border px-1.5 py-2 text-center"
      style={{ background: T.surfaceLow, borderColor: T.outlineSoft }}>
      <div style={{ ...PJ, color: T.t1 }} className="text-[13.5px] font-extrabold tabular-nums">{value}</div>
      <div className="text-[9px] mt-0.5 uppercase tracking-[.03em] font-semibold" style={{ color: T.t4 }}>{label}</div>
    </div>
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
  icon, tint, title, body, action, extra,
}: { icon: string; tint: string; title: string; body: string; action?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-[50px] px-5 gap-[5px]">
      <span className="material-symbols-outlined text-[44px]" style={{ color: tint }}>{icon}</span>
      <h4 style={{ ...PJ, color: T.t1 }} className="text-[15px] font-extrabold mt-2.5">{title}</h4>
      <p className="text-[12.5px] max-w-[340px] leading-[1.5]" style={{ color: T.t4 }}>{body}</p>
      {extra}
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
