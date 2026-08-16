'use client'

/**
 * KOL Directory — filter model and the persistent filter sidebar.
 *
 * Ported from the Autometric Commercial KOL platform's `directory-filters.js`:
 * a sticky 248px panel with accordion sections that stays open while you browse
 * (never a blocking overlay), collapsing to a vertical tab on the right edge.
 *
 * The reference panel offers sections this roster has no columns for —
 * audience demographics, authenticity, brand fit, paid ratio, campaigns run,
 * rate card, format. Those are left out rather than shipped as controls that
 * filter nothing; what remains is exactly what `public.kol_directory` can
 * answer: platform, tier, followers, engagement, category, verified.
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
  verifiedOnly: boolean
}

export const KOL_FILTERS_DEFAULT: KolFilters = {
  category: '', platform: '', tier: '', follMin: 0, erMin: 0, verifiedOnly: false,
}

/**
 * Followers span five orders of magnitude here (0 to ~695M), so the slider
 * steps through a scale instead of a linear range — a linear 0–3M slider would
 * spend its whole travel inside the smallest tier.
 */
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
    f.platform !== '', f.tier !== '', f.follMin > 0, f.erMin > 0, f.verifiedOnly,
  ].filter(Boolean).length
}

export const filtersToParams = (f: KolFilters): Record<string, string> => {
  const p: Record<string, string> = {}
  if (f.category) p.category = f.category
  if (f.platform) p.platform = f.platform
  if (f.tier) p.tier = f.tier
  if (f.follMin > 0) p.follMin = String(f.follMin)
  if (f.erMin > 0) p.minEr = String(f.erMin)
  if (f.verifiedOnly) p.verified = '1'
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
  const reachActive = [filters.follMin > 0, filters.erMin > 0].filter(Boolean).length

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
          badge={reachActive ? `${reachActive} active` : null}>
          <Range label="Min. followers" min={0} max={FOLLOWER_STEPS.length - 1} step={1} value={follIdx}
            display={filters.follMin ? fmtNum(filters.follMin) : 'Any'}
            onChange={i => onChange({ follMin: FOLLOWER_STEPS[i] })} />
          <Range label="Min. engagement" min={0} max={10} step={0.1} value={filters.erMin}
            display={filters.erMin ? `${filters.erMin.toFixed(1)}%` : 'Any'}
            onChange={v => onChange({ erMin: v })} />
          <p className="text-[9.5px] leading-[1.4] mt-1" style={{ color: T.t4 }}>
            Engagement rate hanya terukur pada sebagian roster — memasang minimum
            akan menyembunyikan creator yang belum pernah diukur.
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

        <div className="pt-2.5 px-0.5 pb-0.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div style={{ ...PJ, color: T.t1 }} className="text-[12px] font-bold">Verified creators only</div>
              <div className="text-[9.5px] mt-0.5" style={{ color: T.t4 }}>
                Terisi untuk sebagian roster — creator yang belum pernah dicek
                ikut tersembunyi saat ini dinyalakan.
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
