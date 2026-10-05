/**
 * The Brand Match vocabularies: the closed lists both sides of a comparison
 * speak, and the follower tiers.
 *
 * -- What used to be here, and why it is gone --------------------------------
 * This file used to open with `V`: the weighted Brand Match scorer's component
 * and sub-weights, its normalisation targets, its confidence cut-offs and its
 * five score bands (`W_BRAND_BUSINESS`, `W_TARGET_AUDIENCE`, `W_BS_*`,
 * `BAND_MODERATE`, ...). That scorer is gone, along with `score.ts` and
 * `explain.ts`, and Brand Match is now the plain mean of the criteria a Brand
 * Profile chose (`@/lib/discover/whatMatters/brandMatch`): equal weight each,
 * no bands, and an unmeasured criterion left out of the denominator.
 *
 * The constants went with it rather than being left in place. A table of forty
 * weights that nothing reads is not documentation, it is a second model sitting
 * where someone can wire it back in — which is exactly what "one Brand Match
 * engine" rules out. `scripts/verify-brand-profile-kol.ts` fails if `W_BS_*`
 * reappears anywhere under this directory.
 *
 * -- What is left, and why it stays -----------------------------------------
 * Vocabularies, not weights. None of these scores anything; they are the closed
 * lists the brand side and the creator side have to share in order to be
 * comparable at all:
 *
 *   `CANONICAL_CATEGORIES`  `public.kol_categories.taxonomy_key`, the nine keys
 *   `INTEREST_KEYS`         the audience pipeline's own interest keys, read by
 *                           `whatMatters/audienceMatch.ts` for Audience Interest
 *   `CATEGORY_RELATEDNESS`  read by `@/lib/discover/brandFit`
 *   `TIERS` / `tierOf`      the KOL platform's follower bands, read by
 *                           `./records.ts`
 *
 * Nothing here is tunable by a user, and none of it is exposed in any UI as a
 * number to adjust. A brand states what it wants; the system decides what that
 * is worth.
 */

/**
 * The nine canonical categories, as `public.kol_categories.taxonomy_key` holds
 * them. A brand's category is one of these and nothing else — not a synonym,
 * not a re-spelling, not a name invented for this app.
 */
export const CANONICAL_CATEGORIES = [
  'Beauty', 'Entertainment', 'Fashion', 'Fitness', 'Food', 'Gen Z', 'Lifestyle', 'Moms', 'Tech',
] as const
export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number]

/**
 * Every interest key in `l2_gold.audience_interest_daily`, spelled as the
 * database spells it — lower case, and `sports` kept distinct from `fitness`
 * because the database keeps them distinct.
 *
 * `unknown` is deliberately absent: it is not an interest but the share of the
 * sampled audience the pipeline could not classify. It is counted in the
 * denominator of every share and reported as Interest Known %, never targeted.
 */
export const INTEREST_KEYS = [
  'art', 'automotive', 'beauty', 'business', 'education', 'entertainment',
  'fashion', 'fitness', 'food', 'gaming', 'music', 'parenting', 'pets',
  'photography', 'religion', 'sports', 'technology', 'travel',
] as const
export type InterestKey = (typeof INTEREST_KEYS)[number]

/**
 * Relatedness between two canonical categories, on the 100/80/60/40/20 ladder.
 * Row = what the brand wants, column = what the creator is.
 *
 * Two of the nine are not content categories at all — `Moms` and `Gen Z`
 * describe an audience — which is why each gets a hand-set row. They still have
 * to be scoreable: 542 creators carry Moms and 145 carry Gen Z, and a brand
 * match that errored for 687 creators would be worse than one that returns a
 * defensible middle.
 *
 * Nothing is 0. An unrelated creator with a large relevant audience is a worse
 * buy than a related one, not a disqualified one.
 */
export const CATEGORY_RELATEDNESS: Record<string, Record<string, number>> = {
  Beauty: { Beauty: 100, Fashion: 80, Lifestyle: 70, 'Gen Z': 60, Entertainment: 50, Moms: 50, Fitness: 40, Food: 30, Tech: 20 },
  Entertainment: { Entertainment: 100, 'Gen Z': 70, Lifestyle: 60, Fashion: 50, Beauty: 40, Food: 40, Moms: 40, Fitness: 30, Tech: 30 },
  Fashion: { Fashion: 100, Beauty: 80, Lifestyle: 70, 'Gen Z': 60, Entertainment: 50, Moms: 40, Fitness: 40, Food: 20, Tech: 20 },
  Fitness: { Fitness: 100, Lifestyle: 60, Food: 60, Beauty: 40, 'Gen Z': 40, Fashion: 40, Moms: 40, Entertainment: 30, Tech: 20 },
  Food: { Food: 100, Lifestyle: 70, Moms: 60, Entertainment: 50, Fitness: 50, 'Gen Z': 40, Beauty: 30, Fashion: 20, Tech: 20 },
  'Gen Z': { 'Gen Z': 100, Entertainment: 70, Fashion: 60, Beauty: 60, Lifestyle: 60, Tech: 50, Food: 40, Fitness: 40, Moms: 20 },
  Lifestyle: { Lifestyle: 100, Beauty: 70, Fashion: 70, Food: 70, Moms: 60, Entertainment: 60, Fitness: 60, 'Gen Z': 60, Tech: 40 },
  Moms: { Moms: 100, Lifestyle: 60, Food: 60, Beauty: 50, Fashion: 40, Fitness: 40, Entertainment: 40, Tech: 20, 'Gen Z': 20 },
  Tech: { Tech: 100, 'Gen Z': 50, Lifestyle: 40, Entertainment: 30, Fashion: 20, Beauty: 20, Fitness: 20, Food: 20, Moms: 20 },
}

/**
 * The tier bands and their engagement-rate targets, mirroring Lookup_Lists
 * sections 3 and 11b.
 *
 * These are the KOL platform's own follower bands. A Nano creator is held to 8%
 * ER and a Mega to 2% because that is what each population actually achieves —
 * scoring both against one target would rank every small account above every
 * large one and call it a match.
 */
export const TIERS = [
  { name: 'Nano', min: 0, erTarget: 8 },
  { name: 'Micro', min: 10_000, erTarget: 6 },
  { name: 'Mid-tier', min: 50_000, erTarget: 4.5 },
  { name: 'Macro', min: 100_000, erTarget: 3 },
  { name: 'Mega', min: 1_000_000, erTarget: 2 },
] as const

export function tierOf(followers: number | null | undefined): string | null {
  if (typeof followers !== 'number' || !Number.isFinite(followers)) return null
  for (let i = TIERS.length - 1; i >= 0; i--) if (followers >= TIERS[i].min) return TIERS[i].name
  return 'Nano'
}
