'use client'

/**
 * KOL Directory — filter model and the persistent filter sidebar.
 *
 * Ported from the Autometric Commercial KOL platform's `directory-filters.js`:
 * a sticky 248px panel with accordion sections that stays open while you browse
 * (never a blocking overlay), collapsing to a vertical tab on the right edge.
 *
 * The reference panel offers sections this roster has no columns for — brand
 * fit, campaigns run, audience age. Those are left out rather than shipped as
 * controls that filter nothing; what remains is what the roster and its L2 card
 * can answer: platform, tier, followers, engagement, category, connected,
 * content format.
 */

import { PJ, TOKENS as T, fmtNum } from './ui'
import type { KolDirectoryFacets } from '@/lib/discover/kolDirectory'

export interface KolFilters {
  /** '' means "all" for every string filter, mirroring the source's 'all'. */
  category: string
  platform: string
  tier: string
  /** Absolute follower count, picked from FOLLOWER_STEPS. */
  follMin: number
  /** Percentage points. */
  erMin: number
  /**
   * The source panel's "Max. rate card" slider, in IDR. 0 means no ceiling.
   * Setting one also excludes creators with no rate card at all — asking for a
   * price under a number cannot be satisfied by the absence of a price.
   */
  maxRate: number
  /**
   * Business Connected: the creator linked the account through OAuth
   * (`social_account.platform_user_id` AND `oauth_token`). NOT the
   * platform's blue tick — that badge was dropped from Discovery.
   */
  connectedOnly: boolean
  verifiedOnly: boolean
  /** Refreshed within N days. 0 = no limit. */
  updatedWithin: number
  agency: string
  /**
   * Follower-growth band, as a preset key rather than a slider.
   *
   * A slider cannot express this filter: every other numeric filter here uses
   * 0 to mean "no bound", but 0% growth is a real, common value — eight of the
   * twenty-five measured creators sit exactly at 0.0000%. Presets keep "no
   * bound" and "exactly flat" distinguishable without a nullable slider.
   */
  growth: GrowthKey
  /**
   * Calculated metrics (migrations 037/038).
   *
   * The numeric four use 0 to mean "no bound", the convention every other
   * slider here already follows. That is safe for these in a way it was not
   * for growth: a female share, paid ratio or post frequency of exactly 0 is
   * either meaningless or indistinguishable from unfiltered, so no real
   * answer is lost by spending 0 on "Any".
   *
   * `paidMax` is a CEILING — the question is "not mostly ads", not "at least
   * this much advertising" — so its "no bound" value is 100, not 0.
   */
  femaleMin: number
  maleMin: number
  paidMax: number
  postFreqMin: number
  shareMin: number
  /** Label filters. Empty string = Any. */
  growthClass: string
  freqReliability: string
  priority: string
  /**
   * Discovery filters, migration 039. Same convention as the block above:
   * 0 means "no bound" for the two numeric ones, empty string means Any for
   * the label ones.
   */
  saveMin: number
  viralMin: number
  risingOnly: boolean
  contentTopic: string
  formatDominant: string
  audQuality: string
  stability: string
  audInterest: string
  /** Audience location. The level is sent alongside the key so a province
   *  named like a city cannot answer a city question. */
  geoKey: string
  geoLevel: string
  /**
   * My Creators only: the derived profiling status (see `PROFILING_STATUS` in
   * `@/lib/discover/kolDirectory`). Empty string = Any Status.
   */
  profilingStatus: ProfilingStatusKey
}

/** Values are the API's `profiling` param; kept here so the client bundle does not import the query module. */
export const PROFILING_STATUS_OPTIONS = [
  { value: '', label: 'Any Status' },
  { value: 'ready', label: 'Ready' },
  { value: 'profiling', label: 'Profiling' },
  { value: 'failed', label: 'Failed' },
] as const
export type ProfilingStatusKey = (typeof PROFILING_STATUS_OPTIONS)[number]['value']

/** Label vocabularies, in step with the warehouse. Display only. */
/**
 * Content-topic and audience-interest vocabulary. Both filters draw on the
 * SAME list because the warehouse classifies both with the same lexicon
 * (`audience_inference.INTEREST`) - that is what makes "creator posts about
 * food" and "audience is interested in food" comparable at all.
 */
export const TOPIC_OPTIONS = [
  '', 'beauty', 'business', 'education', 'entertainment', 'fashion', 'finance',
  'fitness', 'food', 'gaming', 'health', 'music', 'parenting', 'photography',
  'religion', 'sports', 'technology', 'travel',
] as const
export const FORMAT_OPTIONS = ['', 'Video', 'Carousel', 'Image'] as const
/**
 * The three values `l2_gold.kol_profile_card.format_dominant` actually holds —
 * the same list `FORMAT_OPTIONS` offers, without the "Any" entry, so the chips
 * and the dropdown filter on one vocabulary (D078). The platform's own names
 * (Reels, Story, Feed, Photo) are deliberately absent: the roster has no
 * authoritative mapping to them.
 */
export const FORMAT_VALUES = FORMAT_OPTIONS.filter(Boolean)
export const STABILITY_OPTIONS = [
  '', 'High Stability', 'Medium Stability', 'Low Stability',
] as const
export const GEO_LEVEL_OPTIONS = ['', 'city', 'province', 'island', 'country'] as const

/**
 * The label vocabularies, kept in step with `metrics_thresholds.py`. They are
 * display strings only — the thresholds that produce them live in the
 * warehouse, and nothing here recomputes a label.
 */
export const GROWTH_CLASS_OPTIONS = [
  '', 'High Growth', 'Medium Growth', 'Low Growth', 'Negative Growth',
] as const
export const TINGKAT_OPTIONS = ['', 'High', 'Medium', 'Low'] as const

/**
 * Growth bands. Bounds are percentage points of change since the account's
 * PREVIOUS snapshot — not a month. `min`/`max` are inclusive and `null` means
 * unbounded on that side.
 */
export const GROWTH_PRESETS = [
  { key: '',     label: 'Any',            min: null, max: null },
  { key: 'up',   label: 'Naik (> 0%)',    min: 0.0001, max: null },
  { key: 'flat', label: 'Datar (0%)',     min: 0, max: 0 },
  { key: 'down', label: 'Turun (< 0%)',   min: null, max: -0.0001 },
  { key: 'up05', label: 'Naik >= 0,5%',   min: 0.5, max: null },
  { key: 'up1',  label: 'Naik >= 1%',     min: 1, max: null },
] as const
export type GrowthKey = (typeof GROWTH_PRESETS)[number]['key']

export const KOL_FILTERS_DEFAULT: KolFilters = {
  category: '', platform: '', tier: '', follMin: 0, erMin: 0, maxRate: 0,
  connectedOnly: false, verifiedOnly: false, updatedWithin: 0, agency: '', growth: '',
  femaleMin: 0, maleMin: 0, paidMax: 100, postFreqMin: 0, shareMin: 0,
  growthClass: '', freqReliability: '', priority: '',
  saveMin: 0, viralMin: 0, risingOnly: false, contentTopic: '',
  formatDominant: '', audQuality: '', stability: '', audInterest: '',
  geoKey: '', geoLevel: '',
  profilingStatus: '',
}

/**
 * Followers span five orders of magnitude here (0 to ~695M), so the slider
 * steps through a scale instead of a linear range — a linear 0–3M slider would
 * spend its whole travel inside the smallest tier.
 */
/**
 * Rate-card ceilings, stepped like the follower scale and for the same reason:
 * the roster's prices span Rp370K to Rp1 miliar, so a linear slider would spend
 * its whole travel above where almost every creator sits.
 */
export const RATE_STEPS = [
  0, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000,
  50_000_000, 100_000_000, 250_000_000, 500_000_000, 1_000_000_000,
]

/** Same short scale the directory table prints, kept local to avoid a cycle. */
function idrShortFilter(n: number): string {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(n % 1_000_000_000 ? 1 : 0)} mlr`
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} jt`
  if (n >= 1_000) return `Rp${Math.round(n / 1_000)}rb`
  return `Rp${n}`
}

export const FOLLOWER_STEPS = [
  0, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000, 5_000_000, 10_000_000,
]

/**
 * Sources whose data is empty today, so the controls that filter on them can
 * only ever return nothing (UI data-availability cleanup, 2026-09-21 audit).
 *
 * Visibility switches only. Every parameter, query, saved list and D124 relax
 * hint keeps working exactly as before; a control whose value is already set
 * (from a saved list) is still drawn so it can be seen and cleared. Flip a flag
 * when its source is filled and the control comes back unchanged.
 *
 *   rateCard     l1_silver.unified_rate_card — 0 rows, intentionally emptied by
 *                the approved migrations 048/050 (2026-09-17).
 *   creatorCity  public.kol_directory.creator_city — 0 of 1,980 active creators.
 *   connected    social_account with platform_user_id AND oauth_token — 0; the
 *                OAuth connect flow has not shipped.
 *
 * Not covered here on purpose: Audience age/gender, Creator location and the
 * Other Filters sliders (D079-D083) — their requirements ask for them to be
 * shown disabled, so they stay drawn.
 */
export const DATA_AVAILABLE = {
  rateCard: false,
  creatorCity: false,
  connected: false,
} as const

/**
 * My Creators' Followers dropdown (D090): exactly the six thresholds the
 * requirement names. The Creator Database keeps the FOLLOWER_STEPS slider
 * (D074). Both write the same `follMin`, so the API parameter, the SQL and the
 * D124 relax hint are shared and unchanged.
 */
export const MY_CREATORS_FOLLOWER_OPTIONS = [
  { value: 0, label: 'Any' },
  { value: 1_000, label: '1K+' },
  { value: 10_000, label: '10K+' },
  { value: 50_000, label: '50K+' },
  { value: 100_000, label: '100K+' },
  { value: 1_000_000, label: '1M+' },
] as const

/**
 * Category is excluded on purpose: it has its own chips in the toolbar and its
 * own badge there, exactly as in the source, so counting it here would show the
 * same filter twice.
 */
export function activeFilterCount(f: KolFilters): number {
  return [
    f.platform !== '', f.tier !== '', f.follMin > 0, f.erMin > 0, f.maxRate > 0,
    f.connectedOnly, f.verifiedOnly, f.updatedWithin > 0, f.agency !== '', f.growth !== '',
    f.femaleMin > 0, f.maleMin > 0, f.paidMax < 100, f.postFreqMin > 0,
    f.shareMin > 0, f.growthClass !== '', f.freqReliability !== '', f.priority !== '',
    f.saveMin > 0, f.viralMin > 0, f.risingOnly, f.contentTopic !== '',
    f.formatDominant !== '', f.audQuality !== '', f.stability !== '',
    f.audInterest !== '', f.geoKey !== '', f.profilingStatus !== '',
  ].filter(Boolean).length
}

export const filtersToParams = (f: KolFilters): Record<string, string> => {
  const p: Record<string, string> = {}
  if (f.category) p.category = f.category
  if (f.platform) p.platform = f.platform
  if (f.tier) p.tier = f.tier
  if (f.follMin > 0) p.follMin = String(f.follMin)
  if (f.erMin > 0) p.minEr = String(f.erMin)
  if (f.maxRate > 0) p.maxRate = String(f.maxRate)
  if (f.connectedOnly) p.connected = '1'
  if (f.verifiedOnly) p.verified = '1'
  if (f.updatedWithin > 0) p.updatedWithin = String(f.updatedWithin)
  if (f.agency) p.agency = f.agency
  if (f.growth) {
    const g = GROWTH_PRESETS.find(x => x.key === f.growth)
    if (g?.min != null) p.growthMin = String(g.min)
    if (g?.max != null) p.growthMax = String(g.max)
  }
  if (f.femaleMin > 0) p.femaleMin = String(f.femaleMin)
  if (f.maleMin > 0) p.maleMin = String(f.maleMin)
  // Only sent when it actually bounds something: 100 is the whole range.
  if (f.paidMax < 100) p.paidMax = String(f.paidMax)
  if (f.postFreqMin > 0) p.postFreqMin = String(f.postFreqMin)
  if (f.shareMin > 0) p.shareMin = String(f.shareMin)
  if (f.growthClass) p.growthClass = f.growthClass
  if (f.freqReliability) p.freqReliability = f.freqReliability
  if (f.priority) p.priority = f.priority
  if (f.saveMin > 0) p.saveMin = String(f.saveMin)
  if (f.viralMin > 0) p.viralMin = String(f.viralMin)
  if (f.risingOnly) p.rising = '1'
  if (f.contentTopic) p.topic = f.contentTopic
  if (f.formatDominant) p.format = f.formatDominant
  if (f.audQuality) p.audQuality = f.audQuality
  if (f.stability) p.stability = f.stability
  if (f.audInterest) p.interest = f.audInterest
  if (f.geoKey) {
    p.geoKey = f.geoKey
    // Level only travels with a key; on its own it would filter nothing.
    if (f.geoLevel) p.geoLevel = f.geoLevel
  }
  if (f.profilingStatus) p.profiling = f.profilingStatus
  return p
}

/**
 * One way out of an empty result: release one active filter (`patch`), or
 * clear the keyword (`clearQuery`).
 */
export type RelaxSuggestion =
  | { id: string; label: string; patch: Partial<KolFilters> }
  | { id: string; label: string; clearQuery: true }

/**
 * The active filters most likely to have emptied the list, first — D124.
 *
 * Pure and client-side: it asks the database nothing, so labels name the
 * filter and never a count. The order follows how sparse each filter's data is
 * on the KOL server (audit 17 Sep 2026): rate card and Connected have no rows
 * at all, a handful of creators carry the calculated metrics, most carry ER,
 * and almost all carry followers, tier, category and platform. The keyword
 * comes last.
 *
 * Pass the filters the page actually applies (`scopedFilters`), so a value the
 * current scope ignores is never offered. Each patch sets exactly the default
 * that `activeFilterCount` treats as "off"; Audience location releases
 * `geoKey` and `geoLevel` together because the level only filters with a key,
 * and Platform also clears Tier, as the panel's own "All Platform" chip does.
 */
export function relaxSuggestions(f: KolFilters, query: string, max = 3): RelaxSuggestion[] {
  const d = KOL_FILTERS_DEFAULT
  const all: (RelaxSuggestion | false)[] = [
    f.maxRate > 0 && { id: 'maxRate', label: 'Lepas batas rate card', patch: { maxRate: d.maxRate } },
    f.connectedOnly && { id: 'connectedOnly', label: 'Matikan "Connected creators only"', patch: { connectedOnly: false } },
    f.risingOnly && { id: 'risingOnly', label: 'Matikan "Rising creator saja"', patch: { risingOnly: false } },
    f.profilingStatus !== '' && { id: 'profilingStatus', label: 'Lepas filter profiling status', patch: { profilingStatus: d.profilingStatus } },
    f.updatedWithin > 0 && { id: 'updatedWithin', label: 'Lepas batas "Last updated"', patch: { updatedWithin: d.updatedWithin } },
    f.shareMin > 0 && { id: 'shareMin', label: 'Lepas minimum share rate', patch: { shareMin: d.shareMin } },
    f.saveMin > 0 && { id: 'saveMin', label: 'Lepas minimum save rate', patch: { saveMin: d.saveMin } },
    f.stability !== '' && { id: 'stability', label: 'Lepas filter performance stability', patch: { stability: d.stability } },
    f.growth !== '' && { id: 'growth', label: 'Lepas filter growth', patch: { growth: d.growth } },
    f.growthClass !== '' && { id: 'growthClass', label: 'Lepas filter growth class', patch: { growthClass: d.growthClass } },
    f.femaleMin > 0 && { id: 'femaleMin', label: 'Lepas minimum female %', patch: { femaleMin: d.femaleMin } },
    f.maleMin > 0 && { id: 'maleMin', label: 'Lepas minimum male %', patch: { maleMin: d.maleMin } },
    f.audQuality !== '' && { id: 'audQuality', label: 'Lepas filter audience quality', patch: { audQuality: d.audQuality } },
    f.audInterest !== '' && { id: 'audInterest', label: 'Lepas filter audience interest', patch: { audInterest: d.audInterest } },
    f.geoKey !== '' && { id: 'geo', label: 'Lepas filter audience location', patch: { geoKey: d.geoKey, geoLevel: d.geoLevel } },
    f.contentTopic !== '' && { id: 'contentTopic', label: 'Lepas filter content topic', patch: { contentTopic: d.contentTopic } },
    f.formatDominant !== '' && { id: 'formatDominant', label: 'Lepas filter content format', patch: { formatDominant: d.formatDominant } },
    f.paidMax < 100 && { id: 'paidMax', label: 'Lepas batas paid ratio', patch: { paidMax: d.paidMax } },
    f.postFreqMin > 0 && { id: 'postFreqMin', label: 'Lepas minimum post / bulan', patch: { postFreqMin: d.postFreqMin } },
    f.freqReliability !== '' && { id: 'freqReliability', label: 'Lepas filter post frequency reliability', patch: { freqReliability: d.freqReliability } },
    f.viralMin > 0 && { id: 'viralMin', label: 'Lepas minimum viral frequency', patch: { viralMin: d.viralMin } },
    f.verifiedOnly && { id: 'verifiedOnly', label: 'Matikan "Verified creators only"', patch: { verifiedOnly: false } },
    f.erMin > 0 && { id: 'erMin', label: 'Turunkan minimum engagement rate', patch: { erMin: d.erMin } },
    f.priority !== '' && { id: 'priority', label: 'Lepas filter monitoring priority', patch: { priority: d.priority } },
    f.follMin > 0 && { id: 'follMin', label: 'Turunkan minimum followers', patch: { follMin: d.follMin } },
    f.tier !== '' && { id: 'tier', label: 'Lepas filter tier', patch: { tier: d.tier } },
    f.category !== '' && { id: 'category', label: 'Lepas filter kategori', patch: { category: d.category } },
    f.platform !== '' && { id: 'platform', label: 'Lepas filter platform', patch: { platform: d.platform, tier: d.tier } },
    f.agency !== '' && { id: 'agency', label: 'Lepas filter agency', patch: { agency: d.agency } },
    query.trim() !== '' && { id: 'query', label: 'Hapus kata kunci pencarian', clearQuery: true },
  ]
  return all.filter((s): s is RelaxSuggestion => s !== false).slice(0, max)
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook',
}

/**
 * The two platforms the roster carries, listed statically as in the reference
 * panel rather than derived from the facet counts: the facets arrive one round
 * trip after the first paint, and a Platform section that renders empty until
 * they land reads as "this roster has no platforms". Counts are filled in from
 * the facets once they arrive.
 */
const PLATFORMS = ['instagram', 'tiktok'] as const

/** The reference panel's audience age bands. */
const AGE_BANDS = ['All', '13–17', '18–24', '25–34', '35–44', '45–54', '55+']

/**
 * Sections the reference panel carries that this roster cannot answer, each with
 * the reason, shown under the section so the greyed-out controls explain
 * themselves instead of looking broken:
 *
 *   audience  no demographic columns exist at all — not age, not gender split,
 *             not audience location
 *   location  `creator_city` exists but is empty for all 7.718 active rows
 *   other     authenticity, brand fit and paid ratio have no columns; campaigns
 *             run would come from `campaign_kols`, which has no rows yet
 */
const UNAVAILABLE = 'Belum tersedia'

const tierRange = (min: number, max: number | null) =>
  `${fmtNum(min)} – ${max === null ? '∞' : fmtNum(max)}`

/* ── bits ─────────────────────────────────────────────────────────────────── */

function Chip({
  label, on, onClick, count, full, disabled,
}: {
  label: string; on: boolean; onClick: () => void
  count?: number; full?: boolean; disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      ...PJ,
      background: disabled ? '#f5f6f7' : on ? T.surfaceVariant : T.surface,
      borderColor: disabled ? T.outlineSoft : on ? T.primary : T.outline,
      color: disabled ? T.t4 : on ? T.primaryDeep : T.t2,
      width: full ? '100%' : undefined,
      justifyContent: full ? 'center' : undefined,
    }}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] border text-[11.5px] font-semibold transition-colors ${
        disabled ? 'cursor-not-allowed' : 'hover:brightness-[.98]'}`}>
      {label}
      {count !== undefined && (
        <span className="text-[9.5px] font-bold" style={{ color: on ? T.accent : T.t4 }}>
          {count.toLocaleString('id-ID')}
        </span>
      )}
    </button>
  )
}

function Section({
  id, icon, label, badge, open, onToggle, children,
}: {
  id: string; icon: string; label: string; badge?: string | null
  open: boolean; onToggle: (id: string) => void; children: React.ReactNode
}) {
  return (
    <div style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
      <div onClick={() => onToggle(id)}
        className="flex items-center gap-[7px] cursor-pointer select-none py-2.5 px-0.5">
        <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>{icon}</span>
        <span style={{ ...PJ, color: T.t2 }}
          className="flex-1 text-[11.5px] font-extrabold uppercase tracking-[.04em]">
          {label}
        </span>
        {badge && (
          <span style={{ ...PJ, color: T.primaryDeep, background: T.surfaceVariant, borderColor: '#dbeaf7' }}
            className="text-[9.5px] font-bold rounded-full border px-2 py-0.5 max-w-[108px] truncate">
            {badge}
          </span>
        )}
        <span className="material-symbols-outlined text-[18px] transition-transform"
          style={{ color: T.t4, transform: open ? 'rotate(180deg)' : undefined }}>expand_more</span>
      </div>
      {open && <div className="px-0.5 pb-3 pt-0.5">{children}</div>}
    </div>
  )
}

/** Slider row: label left, live value right — the source's fpRange(). */
function Range({
  label, value, display, min, max, step, onChange, disabled,
}: {
  label: string; value: number; display: string
  min: number; max: number; step: number; onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="my-[7px] mb-2.5" style={disabled ? { opacity: 0.55 } : undefined}>
      <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
        <span>{label}</span>
        <span style={{ ...PJ, color: disabled ? T.t4 : T.primaryDeep }} className="font-extrabold">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full ${disabled ? 'cursor-not-allowed' : ''}`}
        style={{ accentColor: disabled ? '#c7ccd1' : T.primary }} />
    </div>
  )
}

/** The one-line reason under a section whose controls are greyed out. */
function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9.5px] leading-[1.4] mt-2" style={{ color: T.t4 }}>{children}</p>
  )
}

/* ── panel ────────────────────────────────────────────────────────────────── */

export function KolFilterPanel({
  filters, facets, open, onToggleSection, onChange, onClear, onCollapse, scope = 'database',
}: {
  /** `mine` adds the My Creators-only Profiling Status control. */
  scope?: 'database' | 'mine'
  filters: KolFilters
  facets: KolDirectoryFacets | null
  open: Set<string>
  onToggleSection: (id: string) => void
  onChange: (patch: Partial<KolFilters>) => void
  onClear: () => void
  onCollapse: () => void
}) {
  const count = activeFilterCount(filters)
  const follIdx = Math.max(0, FOLLOWER_STEPS.indexOf(filters.follMin))
  const rateIdx = Math.max(0, RATE_STEPS.indexOf(filters.maxRate))
  const reachActive = [filters.follMin > 0, filters.erMin > 0, filters.maxRate > 0,
    filters.growth !== '']
    .filter(Boolean).length

  return (
    <aside
      className="rounded-[18px] border sticky top-0 self-start px-[13px] pt-[13px] pb-1.5"
      style={{
        background: 'linear-gradient(180deg,#fff,#fbfdfe)',
        borderColor: T.outline, boxShadow: T.shadow,
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="material-symbols-outlined text-[18px]" style={{ color: T.primary }}>tune</span>
        <span style={{ ...PJ, color: T.t1 }} className="flex-1 text-[13px] font-extrabold">Filters</span>
        {count > 0 && (
          <span style={{ ...PJ, background: T.primary }}
            className="w-[17px] h-[17px] rounded-full text-white text-[9.5px] font-extrabold inline-flex items-center justify-center">
            {count}
          </span>
        )}
        <button type="button" onClick={onClear} style={{ ...PJ, color: T.primary }}
          className="text-[11.5px] font-bold hover:underline">Clear all</button>
        <button type="button" onClick={onCollapse} title="Collapse filter sidebar"
          className="material-symbols-outlined text-[18px] cursor-pointer" style={{ color: T.t4 }}>
          chevron_right
        </button>
      </div>

      <div className="max-h-[620px] overflow-y-auto pr-1">
        {scope === 'mine' && (
          <div className="py-2.5 px-0.5" style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
            <label htmlFor="kol-filter-profiling" style={{ ...PJ, color: T.t2 }}
              className="block text-[11.5px] font-extrabold uppercase tracking-[.04em] mb-1.5">
              Profiling status
            </label>
            <select id="kol-filter-profiling" value={filters.profilingStatus}
              onChange={e => onChange({ profilingStatus: e.target.value as ProfilingStatusKey })}
              className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
              style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
              {PROFILING_STATUS_OPTIONS.map(o => (
                <option key={o.value || 'any'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        <Section id="platform" icon="hub" label="Platform" open={open.has('platform')} onToggle={onToggleSection}
          badge={filters.platform ? PLATFORM_LABEL[filters.platform] ?? filters.platform : null}>
          <div className="flex flex-wrap gap-[7px]">
            {/* Clearing the platform also clears Tier: the section it lives in
                disappears, and a tier left set behind it would keep filtering
                the grid with no visible control to undo it. */}
            <Chip label="All Platform" on={!filters.platform}
              onClick={() => onChange({ platform: '', tier: '' })} />
            {PLATFORMS.map(key => (
              <Chip key={key} label={PLATFORM_LABEL[key]}
                count={facets?.platforms.find(p => p.key === key)?.count}
                on={filters.platform === key} onClick={() => onChange({ platform: key })} />
            ))}
          </div>
          <p className="text-[9.5px] leading-[1.4] mt-2" style={{ color: T.t4 }}>
            {filters.platform
              ? 'Opsi Tier sudah terbuka di bawah.'
              : 'Pilih platform dulu untuk membuka opsi Tier.'}
          </p>
        </Section>

        {/* Dependent section, as in the reference panel: narrow to a platform
            first, then to a band inside it. The counts beside each band are
            roster-wide, not per platform — they come from `kol_tiers` joined to
            the whole active roster, which is also what makes them stable while
            you click around. */}
        {filters.platform && (
          <Section id="tier" icon="military_tech" label="Tier" open={open.has('tier')} onToggle={onToggleSection}
            badge={filters.tier || null}>
            <div className="flex flex-col gap-1.5">
              <Chip label="All tiers" full on={!filters.tier} onClick={() => onChange({ tier: '' })} />
              {(facets?.tiers ?? []).map(t => {
                const on = filters.tier === t.name
                return (
                  <button key={t.name} type="button" onClick={() => onChange({ tier: on ? '' : t.name })}
                    style={{
                      borderColor: on ? T.primary : T.outline,
                      background: on ? 'linear-gradient(160deg,#EDF4F7,#fff)' : T.surface,
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-[14px] border-[1.5px] transition-colors">
                    <span style={{ ...PJ, color: on ? T.primary : T.t2 }} className="text-[12px] font-extrabold">
                      {t.name}
                    </span>
                    <span className="text-[10px] whitespace-nowrap" style={{ color: T.t4 }}>
                      {tierRange(t.min, t.max)} · {t.count.toLocaleString('id-ID')}
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {/* Format is not a platform question — the card names one dominant
            format per creator — so this section stands on its own rather than
            waiting for a platform the way Tier does. */}
        <Section id="format" icon="video_library" label="Format" open={open.has('format')} onToggle={onToggleSection}
          badge={filters.formatDominant || null}>
          <div className="flex flex-wrap gap-[7px]">
            <Chip label="All formats" on={!filters.formatDominant}
              onClick={() => onChange({ formatDominant: '' })} />
            {FORMAT_VALUES.map(f => (
              <Chip key={f} label={f} on={filters.formatDominant === f}
                onClick={() => onChange({ formatDominant: filters.formatDominant === f ? '' : f })} />
            ))}
          </div>
          <p className="text-[9.5px] leading-[1.4] mt-2" style={{ color: T.t4 }}>
            Format dominan baru terukur untuk sebagian kecil roster; memilih satu
            format menyembunyikan creator yang belum pernah diukur.
          </p>
        </Section>

        <Section id="reach" icon="bar_chart" label="Reach & Engagement" open={open.has('reach')} onToggle={onToggleSection}
          badge={reachActive ? `${reachActive} active` : null}>
          {scope === 'mine' ? (
            /* D090: My Creators gets the dropdown the requirement names, over the
               same `follMin` the Creator Database slider writes. A saved list can
               carry a value from that slider (25K, say); it is kept and shown as
               its own marked option rather than snapped to a neighbour, so the
               list still means what it meant when it was saved. */
            <div className="my-[7px] mb-2.5">
              <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
                <label htmlFor="kol-filter-followers">Followers</label>
              </div>
              <select id="kol-filter-followers" value={filters.follMin}
                onChange={e => onChange({ follMin: Number(e.target.value) })}
                className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
                style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
                {MY_CREATORS_FOLLOWER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {!MY_CREATORS_FOLLOWER_OPTIONS.some(o => o.value === filters.follMin) && (
                  <option value={filters.follMin}>{fmtNum(filters.follMin)}+ (saved filter)</option>
                )}
              </select>
            </div>
          ) : (
            <Range label="Min. followers" min={0} max={FOLLOWER_STEPS.length - 1} step={1} value={follIdx}
              display={filters.follMin ? fmtNum(filters.follMin) : 'Any'}
              onChange={i => onChange({ follMin: FOLLOWER_STEPS[i] })} />
          )}
          <Range label="Min. engagement" min={0} max={10} step={0.1} value={filters.erMin}
            display={filters.erMin ? `${filters.erMin.toFixed(1)}%` : 'Any'}
            onChange={v => onChange({ erMin: v })} />
          {/* D076: no rate card exists (intentionally empty), so any ceiling
              empties the list. Drawn only when a saved list already carries one,
              so that value stays visible and clearable. */}
          {(DATA_AVAILABLE.rateCard || filters.maxRate > 0) && (
            <Range label="Max. rate card" min={0} max={RATE_STEPS.length - 1} step={1} value={rateIdx}
              display={filters.maxRate ? `≤ ${idrShortFilter(filters.maxRate)}` : 'Any'}
              onChange={i => onChange({ maxRate: RATE_STEPS[i] })} />
          )}
          <div className="my-[7px] mb-2.5">
            <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
              <span>Growth</span>
            </div>
            <select value={filters.growth}
              onChange={e => onChange({ growth: e.target.value as GrowthKey })}
              className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
              style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
              {GROWTH_PRESETS.map(g => (
                <option key={g.key || 'any'} value={g.key}>{g.label}</option>
              ))}
            </select>
          </div>
          {/* Calculated metrics (037/038). Ranges follow the existing Range
              component; the three label filters follow the Growth select. No
              new filter pattern is introduced. */}
          <Range label="Min. female %" min={0} max={100} step={1} value={filters.femaleMin}
            display={filters.femaleMin ? `>= ${filters.femaleMin}%` : 'Any'}
            onChange={v => onChange({ femaleMin: v })} />
          <Range label="Min. male %" min={0} max={100} step={1} value={filters.maleMin}
            display={filters.maleMin ? `>= ${filters.maleMin}%` : 'Any'}
            onChange={v => onChange({ maleMin: v })} />
          <Range label="Max. paid ratio" min={0} max={100} step={1} value={filters.paidMax}
            display={filters.paidMax < 100 ? `<= ${filters.paidMax}%` : 'Any'}
            onChange={v => onChange({ paidMax: v })} />
          <Range label="Min. post / bulan" min={0} max={60} step={1} value={filters.postFreqMin}
            display={filters.postFreqMin ? `>= ${filters.postFreqMin}` : 'Any'}
            onChange={v => onChange({ postFreqMin: v })} />
          <Range label="Min. share rate" min={0} max={20} step={0.5} value={filters.shareMin}
            display={filters.shareMin ? `>= ${filters.shareMin}%` : 'Any'}
            onChange={v => onChange({ shareMin: v })} />
          <div className="my-[7px] mb-2.5">
            <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
              <span>Growth class</span>
            </div>
            <select value={filters.growthClass}
              onChange={e => onChange({ growthClass: e.target.value })}
              className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
              style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
              {GROWTH_CLASS_OPTIONS.map(k => (
                <option key={k || 'any'} value={k}>{k || 'Any'}</option>
              ))}
            </select>
          </div>
          <div className="my-[7px] mb-2.5">
            <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
              <span>Post frequency reliability</span>
            </div>
            <select value={filters.freqReliability}
              onChange={e => onChange({ freqReliability: e.target.value })}
              className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
              style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
              {TINGKAT_OPTIONS.map(k => (
                <option key={k || 'any'} value={k}>{k || 'Any'}</option>
              ))}
            </select>
          </div>
          <div className="my-[7px] mb-2.5">
            <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
              <span>Monitoring priority</span>
            </div>
            <select value={filters.priority}
              onChange={e => onChange({ priority: e.target.value })}
              className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
              style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
              {TINGKAT_OPTIONS.map(k => (
                <option key={k || 'any'} value={k}>{k || 'Any'}</option>
              ))}
            </select>
          </div>
          {/* Discovery filters, migration 039. Same Range + select patterns
              as everything above; no new component is introduced. */}
          <Range label="Min. save rate" min={0} max={20} step={0.5} value={filters.saveMin}
            display={filters.saveMin ? `>= ${filters.saveMin}%` : 'Any'}
            onChange={v => onChange({ saveMin: v })} />
          <Range label="Min. viral frequency" min={0} max={100} step={5} value={filters.viralMin}
            display={filters.viralMin ? `>= ${filters.viralMin}%` : 'Any'}
            onChange={v => onChange({ viralMin: v })} />
          <label className="flex items-center gap-2 text-[10.5px] my-[7px]"
            style={{ color: T.t1 }}>
            <input type="checkbox" checked={filters.risingOnly}
              onChange={e => onChange({ risingOnly: e.target.checked })} />
            <span>Rising creator saja (Growth &gt;= 5%)</span>
          </label>
          {([
            ['Content topic', 'contentTopic', TOPIC_OPTIONS],
            ['Content format', 'formatDominant', FORMAT_OPTIONS],
            ['Audience quality', 'audQuality', TINGKAT_OPTIONS],
            ['Performance stability', 'stability', STABILITY_OPTIONS],
            ['Audience interest', 'audInterest', TOPIC_OPTIONS],
          ] as const).map(([label, key, opsi]) => (
            <div className="my-[7px] mb-2.5" key={key}>
              <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
                <span>{label}</span>
              </div>
              <select value={filters[key] as string}
                onChange={e => onChange({ [key]: e.target.value } as Partial<KolFilters>)}
                className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
                style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
                {opsi.map(k => (
                  <option key={k || 'any'} value={k}>{k || 'Any'}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="my-[7px] mb-2.5">
            <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
              <span>Audience location</span>
            </div>
            <div className="flex gap-1.5">
              <input value={filters.geoKey} placeholder="mis. Bandung / Bali"
                onChange={e => onChange({ geoKey: e.target.value })}
                className="flex-1 text-[10.5px] rounded-md px-2 py-1.5 border"
                style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }} />
              <select value={filters.geoLevel}
                onChange={e => onChange({ geoLevel: e.target.value })}
                className="text-[10.5px] rounded-md px-2 py-1.5 border"
                style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
                {GEO_LEVEL_OPTIONS.map(k => (
                  <option key={k || 'any'} value={k}>{k || 'Semua tingkat'}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[9.5px] leading-[1.4] mt-1" style={{ color: T.t4 }}>
            Save rate hanya ada di TikTok. Topik konten diklasifikasi dari caption
            dan hashtag post nyata; bila tidak ada post yang terbaca, kategori
            roster dipakai sebagai cadangan dan ditandai berbeda. Audience
            location dipisah per tingkat -- Bali dan Lampung adalah provinsi,
            bukan kota.
          </p>
          <p className="text-[9.5px] leading-[1.4] mt-1" style={{ color: T.t4 }}>
            Gender, paid ratio, post frequency dan share rate baru terukur untuk
            sebagian kecil roster; memasang minimum akan menyembunyikan creator
            yang belum pernah diukur — bukan menandainya nol. Share rate hanya
            ada di TikTok: Instagram publik tidak melaporkan share.
          </p>
          <p className="text-[9.5px] leading-[1.4] mt-1" style={{ color: T.t4 }}>
            Engagement rate hanya terukur pada sebagian roster — memasang minimum
            akan menyembunyikan creator yang belum pernah diukur. Rate card ada
            untuk 7.230 dari 7.718 creator; memasang plafon harga menyembunyikan
            sisanya. Growth dihitung dari perubahan followers sejak snapshot
            sebelumnya (bukan 30 hari) dan baru terukur untuk 25 creator yang
            sudah punya dua snapshot — memasang filter menyembunyikan sisanya.
          </p>
        </Section>

        <Section id="audience" icon="groups" label="Audience" open={open.has('audience')} onToggle={onToggleSection}
          badge={UNAVAILABLE}>
          <div className="text-[10.5px] font-semibold mb-1.5" style={{ color: T.t3 }}>
            Age (top audience group)
          </div>
          <div className="flex flex-wrap gap-[7px]">
            {AGE_BANDS.map(a => <Chip key={a} label={a} on={false} disabled onClick={() => {}} />)}
          </div>
          <div className="h-2" />
          <Range label="Major Female (%)" min={0} max={100} step={5} value={0} display="≥ 0%" disabled
            onChange={() => {}} />
          <Range label="Major Male (%)" min={0} max={100} step={5} value={0} display="≥ 0%" disabled
            onChange={() => {}} />
          <Unavailable>
            Roster KOL tidak menyimpan data audiens — umur, gender maupun lokasi
            pengikut. Semua kontrol di sini menunggu sumber datanya.
          </Unavailable>
        </Section>

        <Section id="category" icon="category" label="Category" open={open.has('category')} onToggle={onToggleSection}
          badge={filters.category || null}>
          <div className="flex flex-wrap gap-[7px]">
            <Chip label="All" on={!filters.category} onClick={() => onChange({ category: '' })} />
            {(facets?.categories ?? []).map(c => (
              <Chip key={c.name} label={c.name} count={c.count}
                on={filters.category === c.name} onClick={() => onChange({ category: c.name })} />
            ))}
          </div>
        </Section>

        <Section id="location" icon="location_on" label="Location" open={open.has('location')} onToggle={onToggleSection}
          badge={UNAVAILABLE}>
          {['Creator location', 'Audience location'].map(label => (
            <div key={label} className="mb-2">
              <div className="text-[10.5px] mb-1" style={{ color: T.t3 }}>{label}</div>
              <select disabled defaultValue="all"
                className="w-full h-8 rounded-[10px] border px-2 text-[11.5px] cursor-not-allowed"
                style={{ background: '#f5f6f7', borderColor: T.outlineSoft, color: T.t4 }}>
                <option value="all">All cities</option>
              </select>
            </div>
          ))}
          <Unavailable>
            Kolom kota creator sudah ada di roster, tapi belum terisi untuk satu
            pun creator aktif — jadi tidak ada kota yang bisa dipilih. Lokasi
            audiens tidak punya kolom sama sekali.
          </Unavailable>
        </Section>

        <Section id="other" icon="tune" label="Other Filters" open={open.has('other')} onToggle={onToggleSection}
          badge={UNAVAILABLE}>
          <Range label="Min. authenticity" min={0} max={100} step={1} value={0} display="0%" disabled onChange={() => {}} />
          <Range label="Min. brand fit" min={0} max={100} step={1} value={0} display="0" disabled onChange={() => {}} />
          <Range label="Max. paid ratio" min={0} max={100} step={1} value={100} display="100%" disabled onChange={() => {}} />
          <Range label="Min. campaigns" min={0} max={15} step={1} value={0} display="0" disabled onChange={() => {}} />
          <Unavailable>
            Authenticity, brand fit dan paid ratio tidak punya kolom di roster.
            Jumlah campaign akan datang dari tabel campaign platform KOL, yang
            sampai sekarang masih kosong.
          </Unavailable>
        </Section>

        {/* Agency — the roster's own listing, chips built from the facet so the
            count beside a name is the number the filter returns. */}
        <Section id="agency" icon="apartment" label="Agency" open={open.has('agency')}
          onToggle={onToggleSection} badge={filters.agency || null}>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="All" on={!filters.agency} onClick={() => onChange({ agency: '' })} />
            {(facets?.agencies ?? []).map(a => (
              <Chip key={a.name} label={`${a.name} (${a.count})`}
                on={filters.agency === a.name} onClick={() => onChange({ agency: a.name })} />
            ))}
          </div>
        </Section>

        {/* Last updated — how recently the roster row was refreshed. 7 days is
            the same boundary the Live status chip uses. Creators that were
            never refreshed carry no date and drop out while this is set. */}
        <Section id="updated" icon="update" label="Last updated" open={open.has('updated')}
          onToggle={onToggleSection}
          badge={filters.updatedWithin ? `${filters.updatedWithin} hari` : null}>
          <div className="flex flex-wrap gap-1.5">
            {[[0, 'Kapan saja'], [7, '7 hari'], [30, '30 hari'], [90, '90 hari']].map(
              ([v, label]) => (
                <Chip key={String(v)} label={String(label)}
                  on={filters.updatedWithin === v}
                  onClick={() => onChange({ updatedWithin: v as number })} />
              ))}
          </div>
        </Section>

        {/* Verified and Connected are two switches on purpose. Verified is the
            platform's own badge; Connected is whether the creator linked the
            account to us through OAuth. Measured 8 Sep: 572 creators carry a
            badge and 0 are Connected, so one has never been a usable stand-in
            for the other. */}
        <div className="pt-2.5 px-0.5 pb-0.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div style={{ ...PJ, color: T.t1 }} className="text-[12px] font-bold">Verified creators only</div>
              <div className="text-[9.5px] mt-0.5" style={{ color: T.t4 }}>
                Verified = centang biru dari platform. Bukan Connected.
                572 creator punya badge ini.
              </div>
            </div>
            <button type="button" role="switch" aria-checked={filters.verifiedOnly}
              onClick={() => onChange({ verifiedOnly: !filters.verifiedOnly })}
              className="w-[38px] h-[22px] rounded-xl relative flex-shrink-0 transition-colors"
              style={{ background: filters.verifiedOnly ? T.gradient : '#d1d5db' }}>
              <span className="absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-all"
                style={{ left: filters.verifiedOnly ? 18 : 2, boxShadow: '0 1px 3px rgba(0,0,0,.18)' }} />
            </button>
          </div>
        </div>

        {/* No creator has connected an account yet, so this switch can only
            return an empty list. Drawn when a saved list has it on, so it can
            be switched off. */}
        {(DATA_AVAILABLE.connected || filters.connectedOnly) && (
        <div className="pt-2.5 px-0.5 pb-0.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div style={{ ...PJ, color: T.t1 }} className="text-[12px] font-bold">Connected creators only</div>
              <div className="text-[9.5px] mt-0.5" style={{ color: T.t4 }}>
                Connected = creator sudah menghubungkan akunnya lewat OAuth.
                Belum ada creator yang terhubung, jadi filter ini masih
                mengembalikan 0 hasil sampai connect flow berjalan.
              </div>
            </div>
            <button type="button" role="switch" aria-checked={filters.connectedOnly}
              onClick={() => onChange({ connectedOnly: !filters.connectedOnly })}
              className="w-[38px] h-[22px] rounded-xl relative flex-shrink-0 transition-colors"
              style={{ background: filters.connectedOnly ? T.gradient : '#d1d5db' }}>
              <span className="absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-all"
                style={{ left: filters.connectedOnly ? 18 : 2, boxShadow: '0 1px 3px rgba(0,0,0,.18)' }} />
            </button>
          </div>
        </div>
        )}
      </div>
    </aside>
  )
}

/** The collapsed state: a vertical tab clinging to the right edge. */
export function KolFilterTab({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <div className="sticky top-[110px] flex justify-end">
      <div onClick={onOpen} title="Open the filter sidebar"
        style={{
          writingMode: 'vertical-rl', background: T.gradient, boxShadow: T.shadowMd, ...PJ,
        }}
        className="flex items-center gap-[7px] py-[13px] px-[7px] rounded-l-xl text-white text-[11.5px] font-extrabold tracking-[.05em] cursor-pointer select-none">
        <span className="material-symbols-outlined text-[16px]" style={{ writingMode: 'horizontal-tb' }}>tune</span>
        Filters
        {count > 0 && (
          <span style={{ writingMode: 'horizontal-tb', color: T.primaryDeep }}
            className="bg-white rounded-full text-[9.5px] px-1.5 py-px font-extrabold">
            {count}
          </span>
        )}
      </div>
    </div>
  )
}
