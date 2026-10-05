/**
 * Client-safe vocabulary and value types for the Discover module.
 *
 * These live apart from profile.ts / rates.ts on purpose: those modules import
 * the pg pool, and any client component importing a *value* from them drags the
 * Postgres driver into the browser bundle (which fails outright on `dns`).
 * Filter chips and pricing previews need these constants in the browser, so
 * anything pure belongs here and the DB-backed modules re-export it.
 */

/* ── confidence ───────────────────────────────────────────────────────────── */

export type Confidence = 'live' | 'calculated' | 'estimated'

export interface Metric<T = number> {
  value: T
  confidence: Confidence
  /** Short human explanation shown in the credibility tooltip. */
  basis: string
}

/* ── audience vocabulary ──────────────────────────────────────────────────── */

export const CATEGORIES = ['Fitness', 'Lifestyle', 'Beauty', 'Food', 'Tech', 'Fashion', 'Travel'] as const
export const LIFESTYLES = ['Urban Active', 'Family First', 'Health Conscious', 'Trend Seeker', 'Budget Savvy', 'Premium Buyer'] as const
export const LOCATIONS = ['Jakarta', 'Bandung', 'Surabaya', 'Medan', 'Yogyakarta', 'Bali', 'Makassar'] as const
export const AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'] as const
export const TIERS = ['Nano', 'Micro', 'Mid-tier', 'Macro', 'Mega'] as const

export type Category = (typeof CATEGORIES)[number]
export type Lifestyle = (typeof LIFESTYLES)[number]
export type AgeBand = (typeof AGE_BANDS)[number]
export type Tier = (typeof TIERS)[number]

export const GENERATION: Record<AgeBand, string> = {
  '13-17': 'Gen Z', '18-24': 'Gen Z', '25-34': 'Millennials',
  '35-44': 'Millennials', '45-54': 'Gen X', '55+': 'Boomer+',
}

/** Follower tiers, same thresholds the source platform used. */
export function tierOf(followers: number): Tier {
  if (followers >= 1_000_000) return 'Mega'
  if (followers >= 100_000) return 'Macro'
  if (followers >= 50_000) return 'Mid-tier'
  if (followers >= 10_000) return 'Micro'
  return 'Nano'
}

/* ── deliverable catalogue ────────────────────────────────────────────────── */

export type DeliverablePlatform = 'instagram' | 'facebook' | 'tiktok'

export interface Deliverable {
  id: string
  label: string
  icon: string
  /** Price factor applied to the account's base rate. */
  mult: number
  platform: DeliverablePlatform
}

export const DELIVERABLES: Deliverable[] = [
  { id: 'ig_reel', label: 'Reels', icon: 'movie', mult: 1, platform: 'instagram' },
  { id: 'ig_concept', label: 'Concept Content', icon: 'lightbulb', mult: 0.75, platform: 'instagram' },
  { id: 'ig_feed', label: 'Feed Post', icon: 'photo_camera', mult: 0.5, platform: 'instagram' },
  { id: 'ig_story', label: 'Story', icon: 'amp_stories', mult: 0.3, platform: 'instagram' },
  { id: 'tt_video', label: 'Video', icon: 'music_video', mult: 0.9, platform: 'tiktok' },
  { id: 'tt_photo', label: 'Photo', icon: 'image', mult: 0.45, platform: 'tiktok' },
  { id: 'fb_reel', label: 'Reels', icon: 'movie', mult: 0.9, platform: 'facebook' },
  { id: 'fb_video', label: 'Video', icon: 'smart_display', mult: 0.8, platform: 'facebook' },
  { id: 'fb_feed', label: 'Feed Post', icon: 'photo_camera', mult: 0.45, platform: 'facebook' },
]

export const deliverablesFor = (platform: DeliverablePlatform) =>
  DELIVERABLES.filter(d => d.platform === platform)

export const findDeliverable = (id: string) => DELIVERABLES.find(d => d.id === id) ?? null

/**
 * Unit price for one deliverable, rounded to the nearest 1.000 IDR.
 *
 * Rounding happens here, once, so the price shown in the picker is byte for
 * byte the price that reaches the order line. Rounding later — at render time,
 * or per line total — is how a quotation ends up not summing to itself.
 */
export function unitPrice(baseRate: number, mult: number): number {
  if (!Number.isFinite(baseRate) || baseRate <= 0) return 0
  return Math.round((baseRate * mult) / 1000) * 1000
}

/* ── rate card shape ──────────────────────────────────────────────────────── */

export interface RateCard {
  socialAccountId: string
  baseRate: number
  currency: string
  note: string | null
  updatedAt: string | null
}

/**
 * Where a cart line's creator comes from.
 *
 * `owned` and `competitor` are accounts this org tracks in the warehouse, and
 * are the two values `AccountRelation` allows — those drive per-account analysis
 * screens that only exist when there is post history behind them. `roster` is a
 * creator from the commercial KOL platform's directory, which has no history and
 * no price of its own until the org sets one.
 *
 * Deliberately a wider type than `AccountRelation` rather than a widening of it:
 * a cart can hold a roster creator, and `getAccountDetail` must never be asked
 * to look one up in the warehouse.
 */
export type CartRelation = 'owned' | 'competitor' | 'roster'

/**
 * A price the org stated for a roster creator.
 *
 * The roster carries followers, engagement rate and categories but no rate, so
 * this is the only place a price for one exists. Same base-rate × multiplier
 * model as `RateCard`, so a roster line and an account line are priced by the
 * same function.
 */
export interface RosterRateCard {
  rosterKolId: string
  baseRate: number
  currency: string
  note: string | null
  updatedAt: string | null
}
