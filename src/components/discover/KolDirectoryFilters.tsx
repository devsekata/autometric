'use client'

/**
 * KOL Directory — filter model and the persistent filter sidebar.
 *
 * Ported from the Autometric Commercial KOL platform's `directory-filters.js`:
 * a sticky 248px panel with accordion sections that stays open while you browse
 * (never a blocking overlay), collapsing to a vertical tab on the right edge.
 *
 * The reference panel offers sections this roster has no data for. They are
 * rendered disabled with the reason rather than shipped as controls that filter
 * nothing — and the reason is a measured number, taken 8 Sep 2026 against the
 * 7.720 active creators:
 *
 *   * audience age / gender / location / interest — 23 creators
 *     (`l2_gold.audience_*_daily`, `feature.ig|tt_audience_analysis`)
 *   * authenticity & audience quality — the same 23
 *   * brand fit — `feature.brand_fit_analysis` holds 0 rows
 *   * content format — 56 creators (`l2_gold.content_format_daily`)
 *   * creator location — `kol_directory.creator_city` is non-null for 0
 *   * campaigns run — `public.campaign_kols` holds 0 rows
 *
 * Rate card used to head that list and no longer does: `l1_silver.unified_rate_card`
 * holds 8.856 priced deliverables over 6.959 creators since 13 Sep 2026. The
 * `kol_profile_card.rate_card_*` columns are still null for every row, which is
 * by design — the directory reads L1 directly and those Gold columns are not a
 * second source for the same figure.
 *
 * What remains is what the roster answers for a usable share of itself:
 * platform, category, tier, followers (min AND max), engagement rate, rate card,
 * follower growth, and the two recency bounds the Section Tabs use.
 *
 * Two of those carry a caveat rather than a disabled state. Growth is real but
 * thin — it needs two profile snapshots and only ~25 creators have them — and
 * Connected, which replaced the platform's blue tick, is real but currently
 * false for everyone, because no creator has been through the connect flow yet.
 * Both are shown with the number written on them: a control that narrows to
 * nothing is defensible when it says so, and indefensible when it does not.
 */

import { PJ, TOKENS as T, fmtNum } from './ui'
import type { KolDirectoryFacets } from '@/lib/discover/kolDirectory'

export interface KolFilters {
  /**
   * Category names, unioned. Empty means "all".
   *
   * Multi-select because a creator can hold up to five categories (1.183 of the
   * roster hold more than one), and the backend matches by array overlap — so
   * picking Beauty and Lifestyle means either, not both. The `UNCATEGORIZED`
   * sentinel joins the same union to ask for the 3.546 creators with none.
   */
  categories: string[]
  /** '' means "all", mirroring the source's 'all'. */
  platform: string
  /** Tier names, unioned, plus the `UNTIERED` sentinel. Empty means "all". */
  tiers: string[]
  /** Absolute follower count, picked from FOLLOWER_STEPS. */
  follMin: number
  /**
   * Upper follower bound, from the same scale. 0 means no ceiling.
   *
   * The reference panel has had `follMax` since the beginning; this one only
   * ever carried the lower half, which made "show me creators under 100K" a
   * question you could not ask. It is the filter behind Emerging Creators.
   */
  follMax: number
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
   * (`social_account.platform_user_id` AND `oauth_token`). NOT the platform's
   * blue tick — that badge was dropped from Discovery entirely.
   */
  connectedOnly: boolean
  /**
   * Follower-growth band, as a preset key rather than a slider.
   *
   * A slider cannot express this filter. Every other numeric control here uses
   * 0 to mean "no bound", but 0% growth is a real and common value — several of
   * the measured creators sit exactly at 0.0000%. Presets keep "no bound" and
   * "exactly flat" apart without a nullable slider.
   */
  growth: GrowthKey
}

/**
 * Growth bands. Bounds are percentage points of change since the account's
 * PREVIOUS snapshot — not a month. `min`/`max` are inclusive, and `null` means
 * unbounded on that side.
 */
export const GROWTH_PRESETS = [
  { key: '', label: 'Any', min: null, max: null },
  { key: 'up', label: 'Naik (> 0%)', min: 0.0001, max: null },
  { key: 'flat', label: 'Datar (0%)', min: 0, max: 0 },
  { key: 'down', label: 'Turun (< 0%)', min: null, max: -0.0001 },
  { key: 'up05', label: 'Naik ≥ 0,5%', min: 0.5, max: null },
  { key: 'up1', label: 'Naik ≥ 1%', min: 1, max: null },
] as const
export type GrowthKey = (typeof GROWTH_PRESETS)[number]['key']

export const KOL_FILTERS_DEFAULT: KolFilters = {
  categories: [], platform: '', tiers: [], follMin: 0, follMax: 0, erMin: 0,
  maxRate: 0, connectedOnly: false, growth: '',
}

/**
 * Why the rate-card control is live again.
 *
 * It was inert, and that was a measurement rather than a design decision: the
 * table it reads held 0 rows, so the server-side ceiling was correct SQL that
 * could only ever return nothing. That measurement expired on 13 Sep 2026, when
 * the roster rate cards were synced through to `l1_silver.unified_rate_card` —
 * 8.856 priced deliverables over 6.959 of the 7.432 roster creators. The ceiling
 * now narrows rather than empties: ≤Rp1jt keeps 5.073 creators, ≤Rp10jt keeps
 * 6.673. Nothing about the SQL changed; only the table under it.
 */

/**
 * The two sentinels the directory API understands for "carries none of this".
 *
 * Copied from `UNCATEGORIZED` / `UNTIERED` in `@/lib/discover/kolDirectory`
 * rather than imported: that module opens a `pg` pool and must never reach the
 * browser bundle, while this file is the one that serialises filters into the
 * query string. They have to stay equal — if they drift, the chip silently
 * stops matching instead of erroring.
 */
export const UNCATEGORIZED = '__uncategorized'
export const UNTIERED = '__untiered'

/**
 * Coerces a stored filter object into the current shape.
 *
 * Saved Lists predate multi-select, so lists saved before that change hold
 * `category: 'Beauty'` and `tier: 'Micro'` as plain strings. Spreading one of
 * those over the defaults would put a string where the panel expects an array
 * and break on the first `.map`. Anything unreadable falls back to the default
 * rather than throwing — a stale saved list should lose its filter, not the
 * page.
 *
 * Lists saved before Connected replaced Verified are the one case where a value
 * is dropped on purpose rather than translated. See `connectedOnly` below.
 */
export function normalizeKolFilters(raw: unknown): KolFilters {
  const f = (raw ?? {}) as Record<string, unknown>
  const many = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '')
      : typeof v === 'string' && v !== '' ? [v]
      : []
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    // `category`/`tier` are the pre-multi-select names, still read so old lists
    // keep working; `categories`/`tiers` win when both are present.
    categories: many(f.categories ?? f.category),
    platform: typeof f.platform === 'string' ? f.platform : '',
    tiers: many(f.tiers ?? f.tier),
    follMin: num(f.follMin, 0),
    follMax: num(f.follMax, 0),
    erMin: num(f.erMin, 0),
    maxRate: num(f.maxRate, 0),
    // An old list's `verifiedOnly` is deliberately NOT carried over. The two
    // flags ask different questions — one was the platform's blue tick, this is
    // an OAuth link — and `connected` is false for the entire roster today, so
    // honouring the old flag as this one would silently empty a list that used
    // to return creators. Dropping it widens the list instead, which is the
    // failure a user can see and correct.
    connectedOnly: f.connectedOnly === true,
    growth: GROWTH_PRESETS.some(g => g.key === f.growth) ? (f.growth as GrowthKey) : '',
  }
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
 * Category is excluded on purpose: it has its own chips in the toolbar and its
 * own badge there, exactly as in the source, so counting it here would show the
 * same filter twice.
 */
export function activeFilterCount(f: KolFilters): number {
  return [
    f.platform !== '', f.tiers.length > 0, f.follMin > 0, f.follMax > 0,
    f.erMin > 0, f.connectedOnly, f.growth !== '', f.maxRate > 0,
  ].filter(Boolean).length
}

export const filtersToParams = (f: KolFilters): Record<string, string> => {
  const p: Record<string, string> = {}
  // Comma-separated, which the route splits back into a union. Safe as a
  // delimiter here: no category name in `kol_categories` contains a comma.
  if (f.categories.length) p.category = f.categories.join(',')
  if (f.platform) p.platform = f.platform
  if (f.tiers.length) p.tier = f.tiers.join(',')
  if (f.follMin > 0) p.follMin = String(f.follMin)
  if (f.follMax > 0) p.follMax = String(f.follMax)
  if (f.erMin > 0) p.minEr = String(f.erMin)
  if (f.maxRate > 0) p.maxRate = String(f.maxRate)
  if (f.connectedOnly) p.connected = '1'
  // Only the bounds the chosen band actually sets are sent, so "Naik" leaves
  // growthMax absent rather than pinning it to some arbitrary ceiling.
  if (f.growth) {
    const g = GROWTH_PRESETS.find(x => x.key === f.growth)
    if (g?.min != null) p.growthMin = String(g.min)
    if (g?.max != null) p.growthMax = String(g.max)
  }
  return p
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

/**
 * Content formats per platform, from the reference panel's `igF` / `ttF`.
 *
 * Rendered disabled: `kol_directory` has no content-format column — nor does
 * any other table in the KOL database — so nothing here can filter the roster.
 * The section is kept visible, in the reference's shape and position, so the
 * panel reads the same and the control is ready the day the column lands; it is
 * greyed out rather than shipped as a chip that quietly filters nothing.
 */
const FORMATS: Record<string, string[]> = {
  instagram: ['All formats', 'Feed Post', 'Reels', 'Story', 'Carousel', 'Content'],
  tiktok: ['All formats', 'Video', 'Photo'],
}

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
  id, icon, label, badge, open, onToggle, onReset, children,
}: {
  id: string; icon: string; label: string; badge?: string | null
  open: boolean; onToggle: (id: string) => void
  /**
   * Clears just this section — the reference panel's `fpResetGrp`. Passed only
   * for sections that hold something clearable, and only rendered once
   * something in them is set, so it never appears as a control that does
   * nothing.
   */
  onReset?: () => void
  children: React.ReactNode
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
        {onReset && (
          <span
            role="button"
            tabIndex={0}
            title={`Reset ${label}`}
            aria-label={`Reset ${label}`}
            onClick={e => { e.stopPropagation(); onReset() }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onReset() }
            }}
            className="material-symbols-outlined text-[15px] cursor-pointer hover:opacity-70"
            style={{ color: T.t4 }}>
            restart_alt
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

/** Adds or removes one member of a multi-select filter, preserving order. */
const toggle = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter(x => x !== value) : [...list, value]

/* ── panel ────────────────────────────────────────────────────────────────── */

export function KolFilterPanel({
  filters, facets, open, onToggleSection, onChange, onClear, onCollapse,
}: {
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
  /**
   * The ceiling's slider sits on the same scale as the floor, but its "off"
   * position is the far right rather than the far left — no ceiling is the
   * widest question, not the narrowest.
   */
  const follMaxIdx = filters.follMax > 0
    ? Math.max(0, FOLLOWER_STEPS.indexOf(filters.follMax))
    : FOLLOWER_STEPS.length - 1
  const rateIdx = Math.max(0, RATE_STEPS.indexOf(filters.maxRate))
  const reachActive = [filters.follMin > 0, filters.follMax > 0, filters.erMin > 0,
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
        <Section id="platform" icon="hub" label="Platform" open={open.has('platform')} onToggle={onToggleSection}
          onReset={filters.platform ? () => onChange({ platform: '' }) : undefined}
          badge={filters.platform ? PLATFORM_LABEL[filters.platform] ?? filters.platform : null}>
          <div className="flex flex-wrap gap-[7px]">
            {/* Clearing the platform also clears Tier: the section it lives in
                disappears, and a tier left set behind it would keep filtering
                the grid with no visible control to undo it. */}
            <Chip label="All Platform" on={!filters.platform}
              onClick={() => onChange({ platform: '', tiers: [] })} />
            {PLATFORMS.map(key => (
              <Chip key={key} label={PLATFORM_LABEL[key]}
                count={facets?.platforms.find(p => p.key === key)?.count}
                on={filters.platform === key} onClick={() => onChange({ platform: key })} />
            ))}
          </div>
          <p className="text-[9.5px] leading-[1.4] mt-2" style={{ color: T.t4 }}>
            {filters.platform
              ? 'Opsi Tier & Format sudah terbuka di bawah.'
              : 'Pilih platform dulu untuk membuka opsi Tier & Format.'}
          </p>
        </Section>

        {/* Dependent section, as in the reference panel: narrow to a platform
            first, then to a band inside it. The counts beside each band are
            roster-wide, not per platform — they come from `kol_tiers` joined to
            the whole active roster, which is also what makes them stable while
            you click around. */}
        {filters.platform && (
          <Section id="tier" icon="military_tech" label="Tier" open={open.has('tier')} onToggle={onToggleSection}
            onReset={filters.tiers.length ? () => onChange({ tiers: [] }) : undefined}
            badge={filters.tiers.length ? `${filters.tiers.length} dipilih` : null}>
            <div className="flex flex-col gap-1.5">
              <Chip label="All tiers" full on={!filters.tiers.length} onClick={() => onChange({ tiers: [] })} />
              {(facets?.tiers ?? []).map(t => {
                const on = filters.tiers.includes(t.name)
                return (
                  <button key={t.name} type="button"
                    onClick={() => onChange({ tiers: toggle(filters.tiers, t.name) })}
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

              {/* The 526 creators no band claims — 222 with no follower count at
                  all and 304 below the smallest band's floor. Without this chip
                  they are reachable only by clearing Tier entirely, so a filter
                  meant to narrow the roster was quietly hiding part of it. */}
              {facets && facets.untiered > 0 && (() => {
                const on = filters.tiers.includes(UNTIERED)
                return (
                  <button type="button"
                    onClick={() => onChange({ tiers: toggle(filters.tiers, UNTIERED) })}
                    style={{
                      borderColor: on ? T.primary : T.outline,
                      background: on ? 'linear-gradient(160deg,#EDF4F7,#fff)' : T.surface,
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-[14px] border-[1.5px] transition-colors">
                    <span style={{ ...PJ, color: on ? T.primary : T.t2 }} className="text-[12px] font-extrabold">
                      Untiered
                    </span>
                    <span className="text-[10px] whitespace-nowrap" style={{ color: T.t4 }}>
                      &lt; {fmtNum(facets.tiers[facets.tiers.length - 1]?.min ?? 1000)} atau kosong
                      {' · '}{facets.untiered.toLocaleString('id-ID')}
                    </span>
                  </button>
                )
              })()}
            </div>
            <p className="text-[9.5px] leading-[1.4] mt-2" style={{ color: T.t4 }}>
              Bisa pilih lebih dari satu tier — hasilnya gabungan, bukan irisan.
              Angka di samping mengikuti platform yang sedang dipilih.
            </p>
          </Section>
        )}

        {filters.platform && (
          <Section id="format" icon="video_library" label="Format" open={open.has('format')} onToggle={onToggleSection}
            badge={UNAVAILABLE}>
            <div className="flex flex-wrap gap-[7px]">
              {(FORMATS[filters.platform] ?? []).map(f => (
                <Chip key={f} label={f} on={false} disabled onClick={() => {}} />
              ))}
            </div>
            <Unavailable>
              Format konten belum ada datanya di roster KOL, jadi filter ini
              belum bisa dipakai.
            </Unavailable>
          </Section>
        )}

        <Section id="reach" icon="bar_chart" label="Reach & Engagement" open={open.has('reach')} onToggle={onToggleSection}
          onReset={reachActive
            ? () => onChange({ follMin: 0, follMax: 0, erMin: 0, growth: '' })
            : undefined}
          badge={reachActive ? `${reachActive} active` : null}>
          <Range label="Min. followers" min={0} max={FOLLOWER_STEPS.length - 1} step={1} value={follIdx}
            display={filters.follMin ? fmtNum(filters.follMin) : 'Any'}
            onChange={i => onChange({ follMin: FOLLOWER_STEPS[i] })} />
          {/* The ceiling the reference panel always had. Selecting the last
              step clears it rather than setting a 10M cap, so "no maximum" is
              reachable from the slider itself. */}
          <Range label="Max. followers" min={0} max={FOLLOWER_STEPS.length - 1} step={1} value={follMaxIdx}
            display={filters.follMax ? `≤ ${fmtNum(filters.follMax)}` : 'Any'}
            onChange={i => onChange({
              follMax: i === FOLLOWER_STEPS.length - 1 ? 0 : FOLLOWER_STEPS[i],
            })} />
          <Range label="Min. engagement" min={0} max={10} step={0.1} value={filters.erMin}
            display={filters.erMin ? `${filters.erMin.toFixed(1)}%` : 'Any'}
            onChange={v => onChange({ erMin: v })} />
          {/* Step 0 of RATE_STEPS is 0 itself, so "Any" is reachable from the
              low end of the slider — no last-step-clears trick needed here. */}
          <Range label="Max. rate card" min={0} max={RATE_STEPS.length - 1} step={1} value={rateIdx}
            display={filters.maxRate ? `≤ ${idrShortFilter(filters.maxRate)}` : 'Any'}
            onChange={i => onChange({ maxRate: RATE_STEPS[i] })} />
          {/* A select rather than a Range: see `growth` on KolFilters — 0% is a
              real value here, so the 0-means-any convention the sliders use
              would make "flat" unaskable. */}
          <div className="my-[7px] mb-2.5">
            <div className="flex justify-between text-[10.5px] mb-[3px]" style={{ color: T.t3 }}>
              <span>Growth</span>
              {filters.growth !== '' && (
                <button type="button" className="underline" style={{ color: T.t4 }}
                  onClick={() => onChange({ growth: '' })}>reset</button>
              )}
            </div>
            <select value={filters.growth} aria-label="Follower growth"
              onChange={e => onChange({ growth: e.target.value as GrowthKey })}
              className="w-full text-[10.5px] rounded-md px-2 py-1.5 border"
              style={{ borderColor: '#d8dde1', color: T.t1, background: '#fff' }}>
              {GROWTH_PRESETS.map(g => (
                <option key={g.key || 'any'} value={g.key}>{g.label}</option>
              ))}
            </select>
          </div>
          <p className="text-[9.5px] leading-[1.4] mt-1" style={{ color: T.t4 }}>
            Engagement rate terpakai untuk 1.744 dari 7.721 creator (22,6%):
            kolomnya terisi 1.757 kali, tapi 7 nilai di atas 100% dan 6 nilai nol
            dibuang karena tidak mungkin. Memasang minimum menyembunyikan yang
            belum pernah diukur. Follower terukur untuk 7.499, jadi batas atas
            dan bawah bekerja untuk hampir seluruh roster. Growth dihitung dari
            perubahan followers sejak snapshot sebelumnya — bukan 30 hari — dan
            baru terukur untuk creator yang sudah punya dua snapshot; memasang
            band menyembunyikan sisanya.
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
          onReset={filters.categories.length ? () => onChange({ categories: [] }) : undefined}
          badge={filters.categories.length ? `${filters.categories.length} dipilih` : null}>
          <div className="flex flex-wrap gap-[7px]">
            <Chip label="All" on={!filters.categories.length}
              onClick={() => onChange({ categories: [] })} />
            {(facets?.categories ?? []).map(c => (
              <Chip key={c.name} label={c.name} count={c.count}
                on={filters.categories.includes(c.name)}
                onClick={() => onChange({ categories: toggle(filters.categories, c.name) })} />
            ))}
            {/* 3.546 creators — 46% of the roster — carry no category at all, so
                every chip above hides them. This is the only way to see them. */}
            {facets && facets.uncategorized > 0 && (
              <Chip label="Tanpa kategori" count={facets.uncategorized}
                on={filters.categories.includes(UNCATEGORIZED)}
                onClick={() => onChange({ categories: toggle(filters.categories, UNCATEGORIZED) })} />
            )}
          </div>
          <p className="text-[9.5px] leading-[1.4] mt-2" style={{ color: T.t4 }}>
            Bisa pilih lebih dari satu kategori — hasilnya gabungan. Satu creator
            bisa punya sampai lima kategori, jadi ia muncul di setiap kategori
            yang ia bawa.
          </p>
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

        <div className="pt-2.5 px-0.5 pb-0.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div style={{ ...PJ, color: T.t1 }} className="text-[12px] font-bold">Connected creators only</div>
              <div className="text-[9.5px] mt-0.5" style={{ color: T.t4 }}>
                Connected = creator sudah menghubungkan akunnya lewat OAuth.
                Belum ada satu pun yang terhubung, jadi filter ini masih
                mengosongkan hasil sampai connect flow berjalan.
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

/* ── applied filters, as removable chips ──────────────────────────────────── */

export interface AppliedFilter {
  /** Stable key for React, and the field it clears. */
  key: string
  label: string
  /** The patch that removes just this one. */
  clear: Partial<KolFilters>
}

/**
 * Every active filter as one removable chip — the reference panel's
 * `fpChipsHTML`, which this directory had no equivalent of.
 *
 * Without it the only readout of what is applied is a number ("3 filters
 * applied") and the only way back is Clear All, so removing one filter of three
 * meant rebuilding the other two. Category is included here even though the
 * toolbar has its own chips for it: this row answers "what is narrowing this
 * list", and a category is narrowing it.
 *
 * Ordered as the panel is, so the chips and the sections read in the same
 * sequence.
 */
export function appliedFilters(f: KolFilters): AppliedFilter[] {
  const out: AppliedFilter[] = []
  if (f.platform) {
    out.push({
      key: 'platform',
      label: PLATFORM_LABEL[f.platform] ?? f.platform,
      clear: { platform: '' },
    })
  }
  for (const c of f.categories) {
    out.push({
      key: `category:${c}`,
      label: c === UNCATEGORIZED ? 'Belum berkategori' : c,
      clear: { categories: f.categories.filter(x => x !== c) },
    })
  }
  for (const t of f.tiers) {
    out.push({
      key: `tier:${t}`,
      label: t === UNTIERED ? 'Tanpa tier' : t,
      clear: { tiers: f.tiers.filter(x => x !== t) },
    })
  }
  if (f.follMin > 0) {
    out.push({ key: 'follMin', label: `Followers ≥ ${fmtNum(f.follMin)}`, clear: { follMin: 0 } })
  }
  if (f.follMax > 0) {
    out.push({ key: 'follMax', label: `Followers ≤ ${fmtNum(f.follMax)}`, clear: { follMax: 0 } })
  }
  if (f.erMin > 0) {
    out.push({ key: 'erMin', label: `ER ≥ ${f.erMin.toFixed(1)}%`, clear: { erMin: 0 } })
  }
  if (f.maxRate > 0) {
    out.push({
      key: 'maxRate',
      label: `Rate ≤ ${idrShortFilter(f.maxRate)}`,
      clear: { maxRate: 0 },
    })
  }
  if (f.growth !== '') {
    out.push({
      key: 'growth',
      label: `Growth: ${GROWTH_PRESETS.find(g => g.key === f.growth)?.label ?? f.growth}`,
      clear: { growth: '' },
    })
  }
  if (f.connectedOnly) {
    out.push({ key: 'connectedOnly', label: 'Connected only', clear: { connectedOnly: false } })
  }
  return out
}
