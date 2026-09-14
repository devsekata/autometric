import type { KolDirectoryRow } from './kolDirectory'
import type { MeasuredSignals } from './brandMatch/measured'

/**
 * Creator intelligence for a directory *row* — the signals the list needs to
 * rank, badge and explain a result, rather than just print it.
 *
 * The directory turns a search into a page of creators. Deciding between them
 * meant opening each one, because the row carried five facts and none of them
 * answered "is this person right for me". This module derives the rest from
 * what a row already implies, so the list can lead with a reason.
 *
 * ── Everything here is measured. Nothing here is generated. ─────────────────
 *
 * This module used to have a second half. Reach, views, growth, audience
 * quality, authenticity and brand fit were produced by
 * `@/lib/discover/kolSample`, which derives them deterministically from a
 * creator's real follower count and engagement rate — same creator, same
 * numbers, every time, and badged "modelled" wherever they were drawn.
 *
 * They are gone. Deterministic is not measured: a figure computed from two
 * other figures by a formula nobody validated is a guess with a stable seed,
 * and it was sitting on the same card as real measurements. Where the database
 * genuinely holds one of those numbers it is now read from the database, as
 * `MeasuredSignals` (see `@/lib/discover/brandMatch/measured`); where it does
 * not, the field is `null` and the UI says "not measured" rather than showing a
 * number nobody took.
 *
 * Brand fit left by a different door. It was never a property of a creator —
 * it is a property of a creator AND a brand — so no creator-only number could
 * have meant anything. It now comes from the Brand Match Engine scoring a
 * creator against the workspace's saved Brand Profile.
 *
 * So the intelligence here **ranks and explains**; it never filters silently.
 * A nullable figure used as a hard filter would quietly drop creators for not
 * having been measured, and — because the roster pages server-side — would
 * filter only the rows already fetched, giving a count that means nothing.
 *
 * Everything is pure and client-safe: no `pg`, no fetch. The list computes it
 * per row as it renders, from what the server already sent.
 */

/**
 * Where a signal comes from.
 *
 * Only one value remains. `modelled` used to be the other half of this union
 * and is gone with the figures that carried it — see the note at the top of the
 * file. It is kept as a type rather than deleted so the UI's estimate markers
 * and the preset `basis` field keep their meaning, and so the day a genuinely
 * modelled signal is introduced it has to be declared as one.
 */
export type SignalBasis = 'measured' | 'modelled'

/**
 * One row's signals: what the roster row states, plus what the medallion tables
 * measured for that creator.
 *
 * Every field that can be absent IS nullable, and null means **not measured**.
 * It never means zero. An account with no authenticity reading and an account
 * with an authenticity of 0 are different findings, and collapsing them would
 * make the honest half of this module dishonest again.
 */
export interface CreatorSignals {
  /* from the roster row itself */
  followers: number
  erPct: number
  /**
   * Business Connected, from `KolDirectoryRow.connected` — the creator linked
   * the account through OAuth. It replaced the platform's blue tick, and it is
   * false for the whole roster until the connect flow ships, so any badge or
   * match part reading it scores 0 for everyone today.
   */
  connected: boolean
  rateFrom: number | null
  rateCount: number
  topCategory: string

  /* measured elsewhere, and null for most of the roster — see MeasuredSignals */
  /** `feature.*_audience_analysis.audience_quality_score`. */
  audienceQuality: number | null
  /** `feature.*_audience_analysis.authenticity_score`. */
  authenticity: number | null
  /** `feature.ig_engagement_analysis.avg_views`, else the profile card's. */
  avgViews: number | null
  /**
   * Views per follower. NOT an estimated reach: reach has no column anywhere on
   * this server, and the figure that used to sit in this slot was followers
   * multiplied by a constant.
   */
  viewsPerFollower: number | null
  /**
   * Follower change since the PREVIOUS snapshot, in percentage points. The gap
   * is whatever the scraper produced — 10–13 days today — so it must never be
   * labelled monthly or 30-day.
   */
  growthPct: number | null
  /** Posts per month, null below 21 observed days as well as when absent. */
  postsPerMonth: number | null
  /** The audience's largest known segment, when one was measured. */
  topAudience: string | null
}

/**
 * Which fields rest on a measurement.
 *
 * Every one of them now does, which is the point. The map is kept because the
 * UI reads it to decide whether to print an estimate marker, and a future
 * signal that is genuinely derived has to be added here as `modelled` rather
 * than slipping in unmarked.
 */
export const SIGNAL_BASIS: Record<keyof CreatorSignals, SignalBasis> = {
  followers: 'measured', erPct: 'measured', connected: 'measured',
  rateFrom: 'measured', rateCount: 'measured', topCategory: 'measured',
  audienceQuality: 'measured', authenticity: 'measured', avgViews: 'measured',
  viewsPerFollower: 'measured', growthPct: 'measured', postsPerMonth: 'measured',
  topAudience: 'measured',
}

/**
 * One row's signals.
 *
 * `measured` carries what the server read out of the medallion tables for this
 * creator, and is absent while a page is loading or when the directory was
 * asked for rows without `?match=1`. Absent is not empty: every measured field
 * is null in that case, which is exactly what "we have not looked" should
 * render as.
 *
 * It used to call `sampleIntel(row)` here and take eight numbers out of a
 * generated workspace payload. Nothing generates anything now.
 */
export function creatorSignals(
  row: KolDirectoryRow,
  measured?: MeasuredSignals | null,
): CreatorSignals {
  return {
    followers: row.followers ?? 0,
    erPct: row.erPct ?? 0,
    connected: row.connected,
    rateFrom: row.rateFrom,
    rateCount: row.rateCount,
    topCategory: row.categories[0] ?? '—',

    audienceQuality: measured?.audienceQuality ?? null,
    authenticity: measured?.authenticity ?? null,
    avgViews: measured?.avgViews ?? null,
    viewsPerFollower: measured?.viewsPerFollower ?? null,
    // The roster row carries this column too, and it is the same column the
    // medallion read. Preferring the measured record keeps one creator's growth
    // identical on the card and in the match explanation.
    growthPct: measured?.growthPct ?? row.growthPct ?? null,
    postsPerMonth: measured?.postsPerMonth ?? null,
    topAudience: measured?.topCity ? `${measured.topCity.key} ${measured.topCity.pct}%` : null,
  }
}

/* ── badges ───────────────────────────────────────────────────────────────── */

export interface CreatorBadge {
  id: string
  label: string
  /**
   * `strong` badges rest on measured data. `soft` is retained for a badge that
   * one day rests on something weaker; nothing emits it today, because nothing
   * here is derived any more.
   */
  weight: 'strong' | 'soft'
  icon: string
}

/**
 * The two or three things worth saying about a creator at a glance.
 *
 * Capped deliberately. A card wearing six badges says nothing — every creator
 * ends up decorated and the reader stops reading them. The order below is the
 * priority order, and the measured ones come first so the strongest claim is
 * the one that is actually true.
 */
export function creatorBadges(s: CreatorSignals): CreatorBadge[] {
  const out: CreatorBadge[] = []

  // From the roster row: always available for every creator.
  if (s.erPct >= 4) out.push({ id: 'er', label: 'High Engagement', weight: 'strong', icon: 'bolt' })
  // Both halves are measured, and one of them is currently false roster-wide:
  // no creator has connected an account yet, so this badge is dormant rather
  // than wrong. It starts firing the day the connect flow does.
  if (s.rateCount > 0 && s.connected) {
    out.push({ id: 'ready', label: 'Campaign Ready', weight: 'strong', icon: 'task_alt' })
  }
  if (isCostEfficient(s)) {
    out.push({ id: 'value', label: 'Cost Efficient', weight: 'strong', icon: 'savings' })
  }

  /*
   * From the medallion tables, and therefore absent for most of the roster.
   *
   * Each is guarded on `!== null` rather than compared directly, because `null
   * >= 80` is false in JavaScript but `null >= 0` is TRUE — an unmeasured
   * creator would silently earn any badge with a non-positive threshold. Every
   * one of these is a strong badge now: it rests on a real reading or it does
   * not appear at all.
   *
   * `Strong Brand Fit` used to sit here, at `brandFit >= 80`, where brandFit was
   * a number generated from the creator's own followers and engagement rate with
   * no knowledge of any brand. It is removed rather than rethresholded: brand
   * fit is not a badge a creator wears on their own, it is the Brand Match
   * Engine's verdict against a specific saved Brand Profile, and it is shown as
   * a Match Status beside the card instead.
   */
  if (s.growthPct !== null && s.growthPct >= 5) {
    out.push({ id: 'growth', label: 'Fast Growing', weight: 'strong', icon: 'trending_up' })
  }
  if (s.audienceQuality !== null && s.audienceQuality >= 80) {
    out.push({ id: 'audience', label: 'High Audience Quality', weight: 'strong', icon: 'verified_user' })
  }
  if (s.authenticity !== null && s.authenticity >= 85) {
    out.push({ id: 'authentic', label: 'High Authenticity', weight: 'strong', icon: 'verified' })
  }
  if (s.followers > 0 && s.followers < 50_000 && s.growthPct !== null && s.growthPct >= 4) {
    out.push({ id: 'emerging', label: 'Emerging', weight: 'strong', icon: 'auto_awesome' })
  }

  return out.slice(0, 3)
}

/**
 * Cost per thousand followers, against the roster's own middle.
 *
 * Entirely measured — a real price over a real follower count — which is why it
 * earns a `strong` badge while growth and brand fit do not. Rp25.000 per 1k
 * followers is roughly the median for priced creators on this roster.
 */
const CPM_MEDIAN = 25_000
export function cpmOf(s: CreatorSignals): number | null {
  if (!s.rateFrom || s.followers <= 0) return null
  return (s.rateFrom / s.followers) * 1_000
}
function isCostEfficient(s: CreatorSignals): boolean {
  const cpm = cpmOf(s)
  return cpm !== null && cpm <= CPM_MEDIAN * 0.6
}

/* ── match score ──────────────────────────────────────────────────────────── */

/**
 * What the user asked for. Structurally the filter panel's own shape, restated
 * here so this module does not import a component — the dependency runs the
 * other way.
 */
/**
 * Mirrors `UNTIERED` in `@/lib/discover/kolDirectory`. Repeated rather than
 * imported: that module opens a `pg` pool, and this one is reached from client
 * components — importing the value would pull the driver into the browser
 * bundle. The two must stay equal; the API rejects nothing, it would simply
 * stop matching.
 */
const UNTIERED_TIER = '__untiered'

export interface MatchCriteria {
  /** Category names, unioned — a creator matching any of them matches. */
  categories: string[]
  platform: string
  /** Tier names from `kol_tiers`, unioned, plus the `__untiered` sentinel. */
  tiers: string[]
  follMin: number
  /** Upper follower bound. 0 means no ceiling. */
  follMax: number
  erMin: number
  maxRate: number
  connectedOnly: boolean
  /** The active preset, which contributes its own ranking dimension. */
  preset?: PresetId | null
}

export interface MatchPart {
  label: string
  pct: number
  basis: SignalBasis
}

export interface MatchResult {
  overall: number
  parts: MatchPart[]
}

/** Whether the user has expressed enough for a match score to mean anything. */
export function hasCriteria(c: MatchCriteria): boolean {
  return !!(c.categories.length || c.platform || c.tiers.length || c.follMin
    || c.follMax || c.erMin || c.maxRate || c.connectedOnly || c.preset)
}

/** How far `value` clears `target`, as 0–100. At or above target is 100. */
const reach = (value: number, target: number) =>
  target <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((value / target) * 100)))

/**
 * How well this creator answers the criteria, and why.
 *
 * Returns `null` rather than 100% when nothing has been asked for: a match score
 * against no criteria is not a match, and printing "100% match" over an
 * unfiltered list is exactly the fake precision this product should not have.
 *
 * Every part carries its basis, so the panel can show which half of the score
 * rests on measurements. A score built only from modelled parts is still shown —
 * it is useful for ranking — but it is never presented as a measurement.
 */
export function matchScore(
  row: KolDirectoryRow,
  s: CreatorSignals,
  c: MatchCriteria,
): MatchResult | null {
  if (!hasCriteria(c)) return null

  const parts: MatchPart[] = []

  if (c.categories.length) {
    // Any-of, matching the SQL: the filter unions its members, so a creator who
    // answers one of the chosen chips answers the criterion.
    const want = c.categories.map(x => x.toLowerCase())
    const hit = row.categories.some(x => want.includes(x.toLowerCase()))
    parts.push({ label: 'Category', pct: hit ? 100 : 0, basis: 'measured' })
  }
  if (c.platform) {
    parts.push({
      label: 'Platform',
      pct: row.platform === c.platform ? 100 : 0,
      basis: 'measured',
    })
  }
  if (c.tiers.length) {
    // `row.tier` is null for the 526 creators in no band, which is exactly what
    // the `__untiered` chip asks for — so null is a hit when that chip is on.
    const hit = row.tier === null
      ? c.tiers.includes(UNTIERED_TIER)
      : c.tiers.includes(row.tier)
    parts.push({ label: 'Tier', pct: hit ? 100 : 0, basis: 'measured' })
  }
  if (c.follMin > 0) {
    parts.push({ label: 'Audience size', pct: reach(s.followers, c.follMin), basis: 'measured' })
  }
  if (c.erMin > 0) {
    parts.push({ label: 'Engagement', pct: reach(s.erPct, c.erMin), basis: 'measured' })
  }
  if (c.maxRate > 0) {
    // Cheaper than the ceiling is a full match; over it, the score falls away
    // in proportion to how far over.
    const rate = row.rateFrom
    parts.push({
      label: 'Budget',
      pct: rate == null ? 0 : rate <= c.maxRate ? 100 : reach(c.maxRate, rate),
      basis: 'measured',
    })
  }
  if (c.connectedOnly) {
    parts.push({ label: 'Connected', pct: row.connected ? 100 : 0, basis: 'measured' })
  }

  const preset = c.preset ? PRESET_BY_ID[c.preset] : null
  if (preset) {
    parts.push({
      label: preset.matchLabel,
      pct: Math.max(0, Math.min(100, Math.round(preset.rank(s)))),
      basis: preset.basis,
    })
  }

  if (!parts.length) return null
  const overall = Math.round(parts.reduce((n, p) => n + p.pct, 0) / parts.length)
  return { overall, parts }
}

/* ── smart presets ────────────────────────────────────────────────────────── */

export type PresetId =
  | 'best' | 'growing' | 'engagement' | 'audience' | 'brandfit'
  | 'emerging' | 'ready' | 'value'

export interface CreatorPreset {
  id: PresetId
  label: string
  icon: string
  /** One line saying what it actually does — shown when the preset is active. */
  desc: string
  /** Real filters it applies, so the server narrows the set before ranking. */
  filters: Partial<Pick<MatchCriteria, 'erMin' | 'follMin' | 'follMax' | 'maxRate' | 'connectedOnly'>>
  /** The dimension it ranks by, 0–100. */
  rank: (s: CreatorSignals) => number
  matchLabel: string
  basis: SignalBasis
  /**
   * Set when the KOL database cannot answer this preset, naming the measured
   * coverage. The chip renders disabled and says this rather than ranking the
   * loaded page by a number nobody measured.
   *
   * Four presets carry it. They were not broken code — they were four questions
   * asked of columns that are empty, and the ranking they fell back on came
   * from `sampleIntel`, which invents a deterministic figure per creator id.
   * A chip that reorders twelve rows by an invented growth rate, over a roster
   * of 7.7k, is worse than one that says it cannot answer.
   */
  unavailable?: string
}

/**
 * Presets, because the panel has seven controls and most questions are one of
 * eight shapes.
 *
 * Each is a real filter *plus* a ranking: the filter narrows the set on the
 * server, the ranking orders what comes back. Splitting them that way is what
 * keeps the result count honest — "Fast Growing" cannot claim to have filtered
 * 7,700 creators by a growth figure that does not exist in the database, so it
 * filters by what does and sorts by what it can model.
 */
export const CREATOR_PRESETS: CreatorPreset[] = [
  {
    id: 'best',
    label: 'Best Performing',
    icon: 'workspace_premium',
    desc: 'Engagement rate terukur di atas 3% — ambang "Good ER" di platform sumber.',
    filters: { erMin: 3 },
    // Ranked by the same measured column it filters on, so the ordering and the
    // result count rest on one number. It used to rank by `s.quality`, which
    // `sampleIntel` invents.
    rank: s => Math.min(100, (s.erPct / 8) * 100),
    matchLabel: 'Engagement rate',
    basis: 'measured',
  },
  {
    id: 'engagement',
    label: 'High Engagement',
    icon: 'bolt',
    desc: 'Engagement rate terukur di atas 5,5% — ambang "High ER" di platform sumber.',
    // 5,5% rather than 4%: it is the threshold the source platform uses, and it
    // is what keeps this chip a different question from Best Performing.
    filters: { erMin: 5.5 },
    rank: s => Math.min(100, (s.erPct / 8) * 100),
    matchLabel: 'Engagement rate',
    basis: 'measured',
  },
  {
    id: 'growing',
    label: 'Fast Growing',
    icon: 'trending_up',
    desc: 'Butuh data pertumbuhan follower, yang belum ada untuk hampir seluruh roster.',
    filters: {},
    rank: () => 0,
    matchLabel: 'Growth',
    basis: 'modelled',
    unavailable: 'Pertumbuhan follower hanya terukur untuk 25 dari 7.720 creator (l2_gold.kol_profile_card.followers_growth).',
  },
  {
    id: 'audience',
    label: 'High Audience Quality',
    icon: 'verified_user',
    desc: 'Butuh skor kualitas audiens, yang baru terisi untuk segelintir creator.',
    filters: {},
    rank: () => 0,
    matchLabel: 'Audience quality',
    basis: 'modelled',
    unavailable: 'Skor kualitas audiens & authenticity baru ada untuk 23 dari 7.720 creator (feature.ig/tt_audience_analysis).',
  },
  {
    id: 'brandfit',
    label: 'Best Brand Fit',
    icon: 'handshake',
    desc: 'Butuh analisis kecocokan brand, yang tabelnya masih kosong.',
    filters: {},
    rank: () => 0,
    matchLabel: 'Brand fit',
    basis: 'modelled',
    unavailable: 'feature.brand_fit_analysis masih 0 baris — belum ada satu pun skor brand fit di database KOL.',
  },
  {
    id: 'emerging',
    label: 'Emerging Creators',
    icon: 'auto_awesome',
    desc: 'Di bawah 100rb follower, diurutkan dari engagement rate terukur tertinggi.',
    // The follower ceiling is a real server-side bound now (BE: `follMax`), so
    // this narrows all 7.720 creators instead of hiding the big ones on the
    // page that happened to load.
    filters: { follMax: 100_000 },
    rank: s => Math.min(100, (s.erPct / 8) * 100),
    matchLabel: 'Engagement rate',
    basis: 'measured',
  },
  {
    id: 'ready',
    label: 'Campaign Ready',
    icon: 'task_alt',
    desc: 'Butuh creator yang sudah menghubungkan akunnya, dan belum ada satu pun.',
    // This chip used to filter on Verified — a real column covering 932 of the
    // roster. Verified was replaced by Business Connected, which is a stronger
    // claim (the creator linked the account through OAuth) and is currently
    // true for nobody. Rather than keep `connectedOnly: true` and ship a chip
    // that empties the grid in silence, it joins the four presets that say what
    // they are waiting for. It becomes a one-line change the day connect ships.
    filters: {},
    rank: () => 0,
    matchLabel: 'Connected',
    basis: 'measured',
    unavailable: 'Belum ada creator yang menghubungkan akunnya lewat OAuth — social_account.platform_user_id + oauth_token masih kosong untuk seluruh roster.',
  },
  {
    id: 'value',
    label: 'Cost Efficient',
    icon: 'savings',
    desc: 'Butuh rate card, yang belum terisi untuk satu creator pun.',
    filters: {},
    rank: () => 0,
    matchLabel: 'Cost efficiency',
    basis: 'measured',
    unavailable: 'l1_silver.unified_rate_card masih 0 baris dan rate_card_min_fee null untuk semua — belum ada harga untuk dihitung.',
  },
]

/** The presets the KOL database can actually answer today. */
export const availablePresets = (): CreatorPreset[] =>
  CREATOR_PRESETS.filter(p => !p.unavailable)

const PRESET_BY_ID: Record<string, CreatorPreset> =
  Object.fromEntries(CREATOR_PRESETS.map(p => [p.id, p]))

export const presetById = (id: PresetId | null | undefined): CreatorPreset | null =>
  (id ? PRESET_BY_ID[id] ?? null : null)

/* ── empty states ─────────────────────────────────────────────────────────── */

/**
 * Why nothing came back, and what to loosen — in the order most likely to be
 * the culprit.
 *
 * "No data" tells the reader nothing they did not already know. The point of
 * this is that the criteria are *theirs*, so the way out is always a specific
 * one they can act on.
 */
export function relaxSuggestions(c: MatchCriteria): string[] {
  const out: string[] = []
  if (c.maxRate > 0) out.push('Naikkan batas rate card — harga di bawah plafon ini jarang ada.')
  if (c.erMin >= 4) out.push(`Turunkan syarat engagement dari ${c.erMin}% — di atas 4% sudah sangat sedikit.`)
  else if (c.erMin > 0) out.push(`Turunkan syarat engagement dari ${c.erMin}%.`)
  if (c.follMin >= 100_000) out.push('Perkecil batas minimum follower — creator besar jumlahnya sedikit.')
  else if (c.follMin > 0) out.push('Perkecil batas minimum follower.')
  if (c.connectedOnly) out.push('Matikan filter "connected saja" — belum ada creator yang menghubungkan akunnya, jadi filter ini mengosongkan hasil.')
  if (c.tiers.length) out.push('Lepas filter tier.')
  if (c.categories.length) out.push('Lepas filter kategori, atau coba kategori yang berdekatan.')
  if (c.platform) out.push('Coba platform lain.')
  return out.slice(0, 3)
}
