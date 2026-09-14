import { getBrandProfile, isScoreable, toScoringBrand, type BrandProfile } from './profile'
import { scoringRecordsFor } from './records'
import { score } from './score'
import { explain, type MatchExplanation } from './explain'
import { measuredSignals, type MeasuredSignals } from './measured'

export type { BrandProfile, BrandProfileInput, EligibilityRules } from './profile'
export {
  getBrandProfile, saveBrandProfile, emptyProfile, isScoreable, toEligibility,
  toScoringBrand, BrandProfileError, GENDER_MAJORITIES,
} from './profile'
export type { GenderMajority } from './profile'
export { CANONICAL_CATEGORIES, INTEREST_KEYS, TIERS, tierOf } from './model'
export type { CanonicalCategory, InterestKey } from './model'
export { NA, normalise, score } from './score'
export type {
  MatchConfidence, MatchLevel, ScoreResult, ScoringBrand, ScoringRecord, Scored,
} from './score'
export { explain, LEVEL_TONE, SIGNAL_LABELS } from './explain'
export type { MatchExplanation, MatchSignal, SignalId } from './explain'
export { scoringRecordsFor } from './records'
export { measuredSignals } from './measured'
export type { MeasuredSignals } from './measured'

/**
 * The Brand Match Engine, as one call.
 *
 *     Brand Profile → Brand Match Engine → public.kol_directory → Match Score
 *
 * Hand it an organization and a page of creator ids; get back the real score for
 * each, with the reason. Every screen that shows a match — Creator Database,
 * Compare, the creator report — goes through this, so a creator cannot be a
 * Strong Match on one screen and a Good Match on the next.
 *
 * ── Returns a map, and it can be empty ─────────────────────────────────────
 * An organization with no saved Brand Profile gets an empty map, not a map of
 * zeros and not a map of 100s. The UI shows a prompt to set the profile up.
 * Inventing a score for a brand that has said nothing about itself is exactly
 * the fake precision this replaces.
 */
export interface CreatorMatch {
  creatorId: string
  explanation: MatchExplanation
}

export async function matchCreators(
  organizationId: string,
  creatorIds: string[],
  profileOverride?: BrandProfile,
): Promise<{
  profile: BrandProfile
  scoreable: boolean
  matches: Map<string, MatchExplanation>
  /**
   * The measured half of each creator — authenticity, audience quality, growth,
   * views — read from the same records the score was computed from.
   *
   * Returned even when the profile is not scoreable, because these are facts
   * about the creator and do not depend on any brand. It is what replaced the
   * generated figures `kolSample` used to put on the same cards.
   */
  measured: Map<string, MeasuredSignals>
}> {
  const profile = profileOverride ?? await getBrandProfile(organizationId)
  const matches = new Map<string, MatchExplanation>()
  const measured = new Map<string, MeasuredSignals>()

  if (!creatorIds.length) return { profile, scoreable: isScoreable(profile), matches, measured }

  const records = await scoringRecordsFor(creatorIds)
  for (const [id, record] of records) measured.set(id, measuredSignals(record))

  if (!isScoreable(profile)) return { profile, scoreable: false, matches, measured }

  const brand = toScoringBrand(profile)
  for (const [id, record] of records) matches.set(id, explain(score(record, brand)))

  return { profile, scoreable: true, matches, measured }
}
