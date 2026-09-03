import type { KolDirectoryRow } from './kolDirectory'
import { sampleIntel } from './kolSample'

/**
 * Creator intelligence for a directory *row* — the signals the list needs to
 * rank, badge and explain a result, rather than just print it.
 *
 * The directory turns a search into a page of creators. Deciding between them
 * meant opening each one, because the row carried five facts and none of them
 * answered "is this person right for me". This module derives the rest from
 * what a row already implies, so the list can lead with a reason.
 *
 * ── What is real, and what is not ────────────────────────────────────────────
 *
 * This matters more than anything else here, so it is stated once and enforced
 * by `SIGNAL_BASIS` below rather than left to each caller to remember.
 *
 *   **Measured** — follower count, engagement rate, tier, verification,
 *   categories, city, and the rate card. These come from the KOL platform's own
 *   tables. Filters and scores built on them are exact.
 *
 *   **Modelled** — reach, views, growth, audience quality, authenticity and
 *   brand fit. The commercial roster has no columns for any of it, so
 *   `@/lib/discover/kolSample` derives them deterministically from the creator's
 *   real followers and engagement rate. Same creator, same numbers, every time —
 *   but numbers, not measurements.
 *
 * So the intelligence here **ranks and explains**; it never filters silently.
 * A modelled figure used as a hard filter would quietly drop creators on the
 * strength of a guess, and — because the roster pages server-side — would filter
 * only the rows already fetched, giving a count that means nothing. Ranking and
 * badging the page you asked for is honest about both limits.
 *
 * Everything is pure and client-safe: no `pg`, no fetch. The list computes it
 * per row as it renders.
 */

/** Where a signal comes from — the UI prints an estimate marker on `modelled`. */
export type SignalBasis = 'measured' | 'modelled'

export interface CreatorSignals {
  /* measured */
  followers: number
  erPct: number
  verified: boolean
  rateFrom: number | null
  rateCount: number
  /* modelled — see the note above */
  avgViews: number
  avgReach: number
  audienceQuality: number
  authenticity: number
  /** Follower growth over the last month, in percent. */
  growthMonthly: number
  brandFit: number
  /** The composite the creator workspace leads with, 0–100. */
  quality: number
  topCategory: string
  /** The largest audience segment, e.g. "Wanita 18–24". */
  topAudience: string | null
}

export const SIGNAL_BASIS: Record<keyof CreatorSignals, SignalBasis> = {
  followers: 'measured', erPct: 'measured', verified: 'measured',
  rateFrom: 'measured', rateCount: 'measured',
  avgViews: 'modelled', avgReach: 'modelled', audienceQuality: 'modelled',
  authenticity: 'modelled', growthMonthly: 'modelled', brandFit: 'modelled',
  quality: 'modelled', topCategory: 'measured', topAudience: 'modelled',
}

/**
 * One row's signals.
 *
 * `sampleIntel` builds a whole workspace payload — trends, content grids,
 * campaign history — and this needs eight numbers out of it. That is still the
 * right call: it is pure arithmetic over a seeded generator, it runs once per
 * visible row, and deriving the same figures a second way here is how two
 * screens start disagreeing about the same creator.
 */
export function creatorSignals(row: KolDirectoryRow): CreatorSignals {
  const intel = sampleIntel(row)
  const topAge = [...intel.audience.age].sort((a, b) => b.pct - a.pct)[0]
  const topGender = [...intel.audience.gender].sort((a, b) => b.pct - a.pct)[0]

  return {
    followers: row.followers ?? 0,
    erPct: row.erPct ?? 0,
    verified: row.verified,
    rateFrom: row.rateFrom,
    rateCount: row.rateCount,

    avgViews: intel.kpi.avgViews,
    avgReach: intel.kpi.avgReach,
    audienceQuality: intel.audience.qualityScore,
    authenticity: intel.audience.authenticity,
    growthMonthly: intel.growth.monthly,
    brandFit: intel.brandFit.score,
    quality: intel.quality.score,
    topCategory: row.categories[0] ?? '—',
    topAudience: topGender && topAge ? `${topGender.label} ${topAge.label}` : null,
  }
}

/* ── badges ───────────────────────────────────────────────────────────────── */

export interface CreatorBadge {
  id: string
  label: string
  /** `strong` badges rest on measured data; `soft` ones on modelled data. */
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

  // Measured first.
  if (s.erPct >= 4) out.push({ id: 'er', label: 'High Engagement', weight: 'strong', icon: 'bolt' })
  if (s.rateCount > 0 && s.verified) {
    out.push({ id: 'ready', label: 'Campaign Ready', weight: 'strong', icon: 'task_alt' })
  }
  if (isCostEfficient(s)) {
    out.push({ id: 'value', label: 'Cost Efficient', weight: 'strong', icon: 'savings' })
  }

  // Then modelled.
  if (s.growthMonthly >= 5) {
    out.push({ id: 'growth', label: 'Fast Growing', weight: 'soft', icon: 'trending_up' })
  }
  if (s.audienceQuality >= 80) {
    out.push({ id: 'audience', label: 'High Audience Quality', weight: 'soft', icon: 'verified_user' })
  }
  if (s.brandFit >= 80) {
    out.push({ id: 'fit', label: 'Strong Brand Fit', weight: 'soft', icon: 'handshake' })
  }
  if (s.followers > 0 && s.followers < 50_000 && s.growthMonthly >= 4) {
    out.push({ id: 'emerging', label: 'Emerging', weight: 'soft', icon: 'auto_awesome' })
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
export interface MatchCriteria {
  category: string
  platform: string
  tier: string
  follMin: number
  erMin: number
  maxRate: number
  verifiedOnly: boolean
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
  return !!(c.category || c.platform || c.tier || c.follMin || c.erMin
    || c.maxRate || c.verifiedOnly || c.preset)
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

  if (c.category) {
    const hit = row.categories.some(x => x.toLowerCase() === c.category.toLowerCase())
    parts.push({ label: 'Category', pct: hit ? 100 : 0, basis: 'measured' })
  }
  if (c.platform) {
    parts.push({
      label: 'Platform',
      pct: row.platform === c.platform ? 100 : 0,
      basis: 'measured',
    })
  }
  if (c.tier) {
    parts.push({ label: 'Tier', pct: row.tier === c.tier ? 100 : 0, basis: 'measured' })
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
  if (c.verifiedOnly) {
    parts.push({ label: 'Verified', pct: row.verified ? 100 : 0, basis: 'measured' })
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
  filters: Partial<Pick<MatchCriteria, 'erMin' | 'follMin' | 'maxRate' | 'verifiedOnly'>>
  /** The dimension it ranks by, 0–100. */
  rank: (s: CreatorSignals) => number
  matchLabel: string
  basis: SignalBasis
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
    desc: 'Engagement di atas 3%, diurutkan dari skor kualitas tertinggi.',
    filters: { erMin: 3 },
    rank: s => s.quality,
    matchLabel: 'Overall quality',
    basis: 'modelled',
  },
  {
    id: 'engagement',
    label: 'High Engagement',
    icon: 'bolt',
    desc: 'Engagement rate terukur di atas 4% — angka nyata dari platform.',
    filters: { erMin: 4 },
    rank: s => Math.min(100, (s.erPct / 8) * 100),
    matchLabel: 'Engagement rate',
    basis: 'measured',
  },
  {
    id: 'growing',
    label: 'Fast Growing',
    icon: 'trending_up',
    desc: 'Diurutkan dari pertumbuhan follower bulanan tertinggi.',
    filters: {},
    rank: s => Math.min(100, (s.growthMonthly / 10) * 100),
    matchLabel: 'Growth',
    basis: 'modelled',
  },
  {
    id: 'audience',
    label: 'High Audience Quality',
    icon: 'verified_user',
    desc: 'Diurutkan dari skor kualitas audiens dan authenticity.',
    filters: {},
    rank: s => (s.audienceQuality + s.authenticity) / 2,
    matchLabel: 'Audience quality',
    basis: 'modelled',
  },
  {
    id: 'brandfit',
    label: 'Best Brand Fit',
    icon: 'handshake',
    desc: 'Diurutkan dari kecocokan konten dan audiens dengan brand.',
    filters: {},
    rank: s => s.brandFit,
    matchLabel: 'Brand fit',
    basis: 'modelled',
  },
  {
    id: 'emerging',
    label: 'Emerging Creators',
    icon: 'auto_awesome',
    desc: 'Di bawah 100rb follower, diurutkan dari pertumbuhan tercepat.',
    filters: {},
    rank: s => (s.followers > 0 && s.followers < 100_000
      ? Math.min(100, (s.growthMonthly / 8) * 100)
      : 0),
    matchLabel: 'Emerging',
    basis: 'modelled',
  },
  {
    id: 'ready',
    label: 'Campaign Ready',
    icon: 'task_alt',
    desc: 'Terverifikasi dan sudah punya rate card — bisa langsung ditawar.',
    filters: { verifiedOnly: true },
    rank: s => (s.rateCount > 0 ? 100 : 0),
    matchLabel: 'Campaign readiness',
    basis: 'measured',
  },
  {
    id: 'value',
    label: 'Cost Efficient',
    icon: 'savings',
    desc: 'Diurutkan dari biaya per 1.000 follower termurah — harga rate card nyata.',
    filters: {},
    rank: s => {
      const cpm = cpmOf(s)
      if (cpm === null) return 0
      // Full marks at or under a third of the median, tapering to nothing at 2×.
      return Math.max(0, Math.min(100, Math.round(100 - ((cpm - CPM_MEDIAN / 3) / (CPM_MEDIAN * 2)) * 100)))
    },
    matchLabel: 'Cost efficiency',
    basis: 'measured',
  },
]

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
  if (c.verifiedOnly) out.push('Matikan filter "verified saja" — banyak creator bagus belum terverifikasi.')
  if (c.tier) out.push('Lepas filter tier.')
  if (c.category) out.push('Lepas filter kategori, atau coba kategori yang berdekatan.')
  if (c.platform) out.push('Coba platform lain.')
  return out.slice(0, 3)
}
