/**
 * Brand personality (what a brand picks in Brand Profile) -> the creator
 * personality label it is compared against in Brand Fit's Values component.
 *
 * The two sides do not share a vocabulary. Creators are tagged from
 * `public.kol_attribute` (kind `personality`, group `creator_personality`:
 * Professional, Educational, Relatable, Casual, Entertaining, Humorous,
 * Inspirational, Creative, Tech-savvy, Reviewer, Premium, Luxury, Expert), while
 * a brand describes itself with brand adjectives. Compared word for word, only
 * a brand word that happens to also be a creator label could ever match.
 *
 * The one source in the codebase that relates the two vocabularies is
 * `PERSONALITY_FIT` in `scripts/brand-match/vocabulary.mjs` (Brand Personality x
 * Creator Personality affinity). Each entry below is that matrix's single
 * highest-affinity creator label for the brand word — nothing else was used,
 * and `scripts/verify-brand-fit-input.ts` fails if the two drift apart.
 *
 * A brand word with no entry is UNMAPPED: it is kept on the brand profile, it
 * is reported in the Brand Fit notes, and it is left out of the Values
 * denominator — it is not measured, which is different from a creator failing
 * to match it. Unmapped today, for want of evidence:
 *   * `Modern` — PERSONALITY_FIT ties Creative and Tech-savvy at 90.
 *   * `Warm` — a Brand TONE in vocabulary.mjs; it relates to content styles
 *     (TONE_STYLE), not to creator personality.
 *   * `Minimal`, `Energetic`, `Trustworthy`, `Youthful`, `Confident`,
 *     `Down-to-earth` — the Brand Profile form offers them, but no source file
 *     or table relates them to a creator label.
 *
 * Client-safe on purpose: no imports, so the form can read it.
 */
export const BRAND_TO_CREATOR_PERSONALITY: Readonly<Record<string, string>> = {
  Professional: 'Professional',
  Innovative: 'Tech-savvy',
  Friendly: 'Relatable',
  Premium: 'Premium',
  Playful: 'Entertaining',
  Educational: 'Educational',
  Authentic: 'Relatable',
  Bold: 'Creative',
  Caring: 'Relatable',
}

const BY_KEY = new Map(
  Object.entries(BRAND_TO_CREATOR_PERSONALITY).map(([k, v]) => [k.toLowerCase(), v]),
)

/** The creator label a brand word is compared against, or null when unmapped. */
export function creatorPersonalityFor(brandWord: string): string | null {
  return BY_KEY.get(brandWord.trim().toLowerCase()) ?? null
}

export interface MappedPersonality {
  /** Creator labels to compare with `kol_attribute` labels, de-duplicated. */
  labels: string[]
  /** Brand words with no creator equivalent, as the brand wrote them. */
  unmapped: string[]
}

export function mapBrandPersonality(brandWords: readonly string[]): MappedPersonality {
  const labels: string[] = []
  const unmapped: string[] = []
  for (const raw of brandWords) {
    const word = raw.trim()
    if (!word) continue
    const label = creatorPersonalityFor(word)
    if (label === null) {
      if (!unmapped.some(u => u.toLowerCase() === word.toLowerCase())) unmapped.push(word)
    } else if (!labels.includes(label)) {
      labels.push(label)
    }
  }
  return { labels, unmapped }
}
