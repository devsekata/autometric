/**
 * Vocabulary and relevance matrices for the Brand Match workbook.
 *
 * Every list here is the prototype's own where the prototype has one, so the
 * spreadsheet and the running product cannot drift apart on a word:
 *
 *   TIERS, CATEGORIES, AGE_BANDS, CITIES  → `@/lib/discover/vocab`
 *   PLATFORMS                              → `public.platforms.key`
 *   DATA_STATUS                            → `KolDataStatus` in `@/lib/discover/kolDirectory`
 *   MATCH level wording                    → `brandFit.verdict` in `@/lib/discover/kolSample`
 *
 * CATEGORIES, SUBCATS, INDUSTRIES and NICHES are not defined here at all: they
 * are derived from `taxonomy.mjs`, which is the tree they are levels of. A list
 * kept in two files is a list that will disagree with itself — which is exactly
 * the state the product is in today, with 28 rows in `kol_categories`, 7 names
 * in `@/lib/discover/vocab` and 14 here.
 *
 * The four matrices are the part the prototype does *not* have: today
 * `feature.brand_fit_analysis` is empty and the four "Brand Fit" presets in
 * `@/lib/discover/creatorMatch` are disabled because of it. They are the
 * editable inputs that make the score explainable — a reviewer can point at one
 * cell and say the number is wrong, which is not true of a model.
 */

import {
  CATEGORIES, SUBCATS, INDUSTRIES, NICHES, BRAND_TAXONOMY, subOf,
  CROSSWALK_PRIMARY, CROSSWALK_SECONDARY, CROSSWALK_SIBLING,
  nicheClaims, subsOfCategory,
} from './taxonomy.mjs'

export { CATEGORIES, SUBCATS, INDUSTRIES, NICHES }

export const PLATFORMS = ['Instagram', 'TikTok']

/** `TIERS` and the `tierOf()` thresholds from `@/lib/discover/vocab`. */
export const TIERS = [
  { name: 'Nano', min: 0, max: 9999 },
  { name: 'Micro', min: 10000, max: 49999 },
  { name: 'Mid-tier', min: 50000, max: 99999 },
  { name: 'Macro', min: 100000, max: 999999 },
  { name: 'Mega', min: 1000000, max: null },
]

/** `AGE_BANDS` collapsed to the five bands an audience split is stored in. */
export const AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45+']
export const GENDER_MAJORITY = ['Female', 'Male', 'Balanced', 'Any']
export const COUNTRIES = ['Indonesia', 'Malaysia', 'Singapore', 'Philippines', 'Thailand', 'Vietnam']
export const REGIONS = [
  'Nasional', 'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah', 'Jawa Timur',
  'Banten', 'Bali', 'DI Yogyakarta', 'Sumatera Utara', 'Sulawesi Selatan',
]
/** `LOCATIONS` from `@/lib/discover/vocab`, plus the roster's other frequent cities. */
export const CITIES = [
  'Nasional', 'Jakarta', 'Bandung', 'Surabaya', 'Medan', 'Yogyakarta',
  'Bali', 'Makassar', 'Tangerang', 'Semarang', 'Bekasi', 'Depok',
]

/**
 * One vocabulary for both Audience Interests and Content Topics.
 *
 * They are scored against each other, so they have to be able to hit the same
 * token. Two lists that merely look alike would score every pair zero.
 */
export const INTERESTS = [
  'Technology', 'Business', 'Education', 'Finance', 'Productivity', 'Beauty', 'Skincare',
  'Makeup', 'Fashion', 'Shopping', 'Food', 'Cooking', 'Coffee', 'Travel', 'Fitness',
  'Health', 'Parenting', 'Music', 'Entertainment', 'Gaming', 'Automotive', 'Home Decor',
]

export const CONTENT_STYLES = [
  'Educational', 'Tutorial', 'Review', 'Storytelling', 'Aesthetic',
  'Entertaining', 'Vlog', 'Demo', 'Talking Head', 'Comedy',
]
export const CREATOR_PERSONALITIES = [
  'Professional', 'Educational', 'Creative', 'Tech-savvy', 'Reviewer', 'Relatable',
  'Casual', 'Premium', 'Luxury', 'Entertaining', 'Humorous', 'Inspirational',
]
export const BRAND_PERSONALITIES = [
  'Professional', 'Innovative', 'Friendly', 'Premium', 'Playful',
  'Educational', 'Authentic', 'Bold', 'Caring', 'Modern',
]
export const BRAND_TONES = [
  'Formal', 'Informative', 'Warm', 'Aspirational', 'Playful',
  'Inspiring', 'Straightforward', 'Conversational',
]
export const COMM_STYLES = [
  'Educational', 'Storytelling', 'Demonstrative', 'Conversational',
  'Data-driven', 'Visual-first', 'Humorous', 'Testimonial',
]
export const VALUES = [
  'Trust', 'Innovation', 'Quality', 'Transparency', 'Sustainability', 'Affordability',
  'Community', 'Empowerment', 'Authenticity', 'Craftsmanship', 'Health', 'Family',
  'Fun', 'Performance',
]
export const POSITIONING = ['Value', 'Mass', 'Mid-market', 'Premium', 'Luxury']
export const PURCHASE_INTENT = ['Low', 'Medium', 'High']
export const RISK_FLAGS = ['None', 'Low', 'Medium', 'High']
export const YES_NO = ['Yes', 'No']
export const AUDIENCE_PRIORITY = ['Balanced', 'Age', 'Gender', 'Location', 'Interest']
export const MATCH_LEVELS = [
  'Excellent Match', 'Strong Match', 'Good Match', 'Moderate Match', 'Low Match',
]
export const RECOMMENDATIONS = [
  'Highly Recommended', 'Recommended', 'Consider', 'Low Priority', 'Excluded',
]
export const CONFIDENCE = ['High', 'Medium', 'Limited Data']
/** `KolDataStatus` from `@/lib/discover/kolDirectory`. */
export const DATA_STATUS = ['Live', 'Calculated', 'Estimated']

/* ── relevance matrices ───────────────────────────────────────────────────── */

/**
 * Industry x creator Category, on the 100 / 80 / 60 / 40 / 20 ladder.
 * Anything unlisted is 20 — unrelated, not zero, because an unrelated creator
 * with a huge relevant audience is still a worse buy than a related one rather
 * than a disqualified one.
 */
export const INDUSTRY_CATEGORY = {
  'Technology / SaaS': { Tech: 100, Education: 80, Finance: 80, Gaming: 60, Lifestyle: 60, Entertainment: 40, Automotive: 40, 'Home & Living': 40, Fitness: 40, Travel: 40 },
  'Beauty & Skincare': { Beauty: 100, Fashion: 80, Lifestyle: 80, Fitness: 60, Parenting: 40, Entertainment: 40, Food: 40, Travel: 40, 'Home & Living': 40 },
  'Food & Beverage': { Food: 100, Lifestyle: 80, Travel: 80, Entertainment: 60, Parenting: 60, Fitness: 60, 'Home & Living': 60, Beauty: 40, Fashion: 40, Education: 40 },
  'Fashion & Apparel': { Fashion: 100, Beauty: 80, Lifestyle: 80, Entertainment: 60, Travel: 60, Fitness: 40, Parenting: 40, 'Home & Living': 40, Food: 40 },
  'Health & Fitness': { Fitness: 100, Lifestyle: 80, Food: 80, Beauty: 60, Parenting: 60, Education: 40, Fashion: 40, Travel: 40, Tech: 40, 'Home & Living': 40 },
  'Financial Services': { Finance: 100, Education: 80, Tech: 80, Lifestyle: 60, Parenting: 40, Automotive: 40, 'Home & Living': 40, Travel: 40 },
  Education: { Education: 100, Tech: 80, Finance: 80, Parenting: 60, Lifestyle: 60, Entertainment: 40, Fitness: 40, Travel: 40, Gaming: 40 },
  'Travel & Hospitality': { Travel: 100, Lifestyle: 80, Food: 80, Fashion: 60, Entertainment: 60, Parenting: 60, Beauty: 40, Fitness: 40, 'Home & Living': 40, Automotive: 40 },
  'Home & Living': { 'Home & Living': 100, Lifestyle: 80, Parenting: 80, Food: 60, Fashion: 40, Beauty: 40, Travel: 40, Finance: 40, Tech: 40 },
  Automotive: { Automotive: 100, Tech: 80, Lifestyle: 60, Travel: 60, Gaming: 40, Finance: 40, Entertainment: 40 },
  'Gaming & Entertainment': { Gaming: 100, Entertainment: 100, Tech: 80, Lifestyle: 60, Education: 40, Food: 40, Fashion: 40, Automotive: 40 },
  'Parenting & Baby': { Parenting: 100, 'Home & Living': 80, Lifestyle: 80, Food: 60, Fitness: 60, Beauty: 60, Education: 60, Fashion: 40, Travel: 40, Finance: 40 },
}

const CAT_CLUSTER = {
  Beauty: 'consumer', Fashion: 'consumer', Food: 'consumer', Fitness: 'consumer',
  Lifestyle: 'consumer', Travel: 'consumer', Parenting: 'consumer', 'Home & Living': 'consumer',
  Tech: 'knowledge', Finance: 'knowledge', Education: 'knowledge',
  Entertainment: 'media', Gaming: 'media', Automotive: 'mobility',
}
const CAT_NEIGHBOURS = [
  ['Beauty', 'Fashion'], ['Beauty', 'Lifestyle'], ['Fashion', 'Lifestyle'],
  ['Food', 'Lifestyle'], ['Food', 'Travel'], ['Fitness', 'Lifestyle'], ['Fitness', 'Food'],
  ['Tech', 'Finance'], ['Tech', 'Education'], ['Tech', 'Gaming'], ['Finance', 'Education'],
  ['Finance', 'Lifestyle'], ['Education', 'Parenting'], ['Lifestyle', 'Travel'],
  ['Lifestyle', 'Parenting'], ['Lifestyle', 'Home & Living'], ['Parenting', 'Home & Living'],
  ['Entertainment', 'Gaming'], ['Entertainment', 'Lifestyle'], ['Automotive', 'Tech'],
  ['Travel', 'Entertainment'], ['Beauty', 'Parenting'], ['Fashion', 'Entertainment'],
]
/**
 * Categories that reach across clusters. A lifestyle creator can carry a SaaS
 * brief in a way an automotive creator cannot, so the two do not deserve the
 * same "unrelated" floor.
 */
const CAT_BRIDGE = new Set(['Lifestyle', 'Entertainment'])

/** Category x Category relatedness, same ladder. */
export function catRel(a, b) {
  if (a === b) return 100
  if (CAT_NEIGHBOURS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 80
  if (CAT_CLUSTER[a] === CAT_CLUSTER[b]) return 60
  return (CAT_BRIDGE.has(a) || CAT_BRIDGE.has(b)) ? 40 : 20
}

/**
 * Brand Personality x Creator Personality.
 *
 * Deliberately not an identity matrix: "Innovative" is answered better by a
 * Tech-savvy or Creative creator than by a creator who calls themselves
 * Innovative, and a brand that only ever matched its own adjective would rank
 * out every creator worth booking.
 */
export const PERSONALITY_FIT = {
  Professional: { Professional: 100, Educational: 90, Reviewer: 70, 'Tech-savvy': 70, Premium: 70, Luxury: 60, Inspirational: 60, Creative: 50, Relatable: 50, Casual: 30, Entertaining: 30, Humorous: 20 },
  Innovative: { 'Tech-savvy': 100, Creative: 95, Reviewer: 85, Educational: 75, Professional: 70, Inspirational: 70, Premium: 60, Luxury: 50, Relatable: 50, Entertaining: 45, Casual: 40, Humorous: 30 },
  Friendly: { Relatable: 100, Casual: 95, Entertaining: 75, Humorous: 70, Inspirational: 65, Educational: 60, Creative: 60, Reviewer: 60, Professional: 45, 'Tech-savvy': 45, Premium: 35, Luxury: 25 },
  Premium: { Premium: 100, Luxury: 95, Professional: 85, Creative: 65, Inspirational: 65, Reviewer: 60, Educational: 55, 'Tech-savvy': 50, Relatable: 35, Entertaining: 30, Casual: 25, Humorous: 20 },
  Playful: { Entertaining: 100, Humorous: 95, Casual: 85, Relatable: 80, Creative: 75, Reviewer: 50, Inspirational: 50, Educational: 40, 'Tech-savvy': 40, Professional: 25, Premium: 25, Luxury: 20 },
  Educational: { Educational: 100, Professional: 85, 'Tech-savvy': 80, Reviewer: 75, Inspirational: 65, Creative: 60, Relatable: 55, Casual: 45, Premium: 45, Entertaining: 40, Luxury: 30, Humorous: 30 },
  Authentic: { Relatable: 100, Inspirational: 85, Casual: 80, Educational: 70, Creative: 70, Reviewer: 70, Entertaining: 60, Humorous: 55, Professional: 55, 'Tech-savvy': 50, Premium: 45, Luxury: 35 },
  Bold: { Creative: 90, Entertaining: 85, Inspirational: 80, Humorous: 75, 'Tech-savvy': 70, Reviewer: 65, Premium: 65, Luxury: 60, Relatable: 60, Casual: 55, Professional: 50, Educational: 45 },
  Caring: { Relatable: 95, Inspirational: 85, Educational: 75, Casual: 75, Creative: 60, Reviewer: 60, Professional: 55, Entertaining: 55, Humorous: 45, Premium: 40, 'Tech-savvy': 40, Luxury: 30 },
  Modern: { Creative: 90, 'Tech-savvy': 90, Premium: 80, Inspirational: 75, Reviewer: 75, Educational: 70, Professional: 70, Luxury: 70, Entertaining: 60, Relatable: 60, Casual: 55, Humorous: 40 },
}

/** Brand Tone x Content Style. */
export const TONE_STYLE = {
  Formal: { Educational: 90, Tutorial: 85, Demo: 80, 'Talking Head': 75, Review: 70, Storytelling: 55, Aesthetic: 50, Vlog: 40, Entertaining: 30, Comedy: 20 },
  Informative: { Educational: 100, Tutorial: 95, Review: 90, Demo: 85, 'Talking Head': 80, Storytelling: 65, Vlog: 55, Aesthetic: 50, Entertaining: 40, Comedy: 30 },
  Warm: { Storytelling: 95, Vlog: 90, 'Talking Head': 75, Tutorial: 70, Entertaining: 70, Review: 65, Aesthetic: 65, Educational: 60, Comedy: 60, Demo: 55 },
  Aspirational: { Aesthetic: 95, Storytelling: 85, Vlog: 75, Review: 70, Educational: 65, Tutorial: 65, 'Talking Head': 60, Demo: 60, Entertaining: 60, Comedy: 35 },
  Playful: { Entertaining: 100, Comedy: 95, Vlog: 80, Storytelling: 70, Aesthetic: 60, Review: 60, Tutorial: 55, 'Talking Head': 55, Demo: 45, Educational: 40 },
  Inspiring: { Storytelling: 95, Aesthetic: 80, Vlog: 75, Educational: 75, 'Talking Head': 70, Review: 60, Tutorial: 60, Entertaining: 60, Demo: 50, Comedy: 40 },
  Straightforward: { Review: 95, Demo: 95, Tutorial: 90, Educational: 85, 'Talking Head': 80, Vlog: 55, Storytelling: 55, Aesthetic: 45, Entertaining: 40, Comedy: 30 },
  Conversational: { 'Talking Head': 95, Vlog: 90, Storytelling: 85, Review: 75, Entertaining: 75, Comedy: 70, Tutorial: 65, Educational: 65, Aesthetic: 55, Demo: 55 },
}

/** Communication Style x Content Style. */
export const COMM_STYLE_FIT = {
  Educational: { Educational: 100, Tutorial: 95, Demo: 80, 'Talking Head': 75, Review: 70, Storytelling: 60, Vlog: 50, Aesthetic: 45, Entertaining: 40, Comedy: 30 },
  Storytelling: { Storytelling: 100, Vlog: 90, 'Talking Head': 75, Aesthetic: 70, Entertaining: 70, Educational: 60, Review: 60, Comedy: 60, Tutorial: 55, Demo: 45 },
  Demonstrative: { Demo: 100, Tutorial: 95, Review: 90, Educational: 80, 'Talking Head': 65, Vlog: 60, Aesthetic: 55, Storytelling: 50, Entertaining: 45, Comedy: 30 },
  Conversational: { 'Talking Head': 100, Vlog: 90, Storytelling: 80, Entertaining: 75, Review: 70, Comedy: 70, Tutorial: 60, Educational: 60, Aesthetic: 50, Demo: 50 },
  'Data-driven': { Educational: 95, Review: 90, Demo: 85, Tutorial: 80, 'Talking Head': 70, Storytelling: 50, Vlog: 45, Aesthetic: 40, Entertaining: 35, Comedy: 20 },
  'Visual-first': { Aesthetic: 100, Vlog: 85, Demo: 75, Entertaining: 70, Tutorial: 70, Storytelling: 70, Review: 65, Educational: 55, Comedy: 55, 'Talking Head': 50 },
  Humorous: { Comedy: 100, Entertaining: 95, Vlog: 80, Storytelling: 70, 'Talking Head': 70, Review: 60, Aesthetic: 50, Tutorial: 45, Educational: 40, Demo: 35 },
  Testimonial: { Review: 100, Storytelling: 85, 'Talking Head': 80, Vlog: 75, Demo: 70, Tutorial: 65, Educational: 60, Aesthetic: 55, Entertaining: 55, Comedy: 40 },
}

const STYLE_GROUP = {
  Educational: 'info', Tutorial: 'info', Demo: 'info', Review: 'info', 'Talking Head': 'info',
  Storytelling: 'narrative', Vlog: 'narrative', Aesthetic: 'visual',
  Entertaining: 'fun', Comedy: 'fun',
}
/** Content Style x Content Style, for Preferred Content Style against the creator's. */
export const styleRel = (a, b) => (a === b ? 100 : STYLE_GROUP[a] === STYLE_GROUP[b] ? 80 : 45)

/* ── the crosswalk: brand niche x creator sub category ────────────────────── */

/** The bottom of the 100/80/60/40/20 ladder, the same floor UNRELATED holds. */
const UNRELATED = 20

const NICHE_INDEX = new Map()
for (const i of BRAND_TAXONOMY) {
  for (const n of i.niches) NICHE_INDEX.set(n.label, { industry: i.industry, ...nicheClaims(n) })
}

/**
 * What a brand niche should score a creator sub category, and why.
 *
 * The default is not invented: it is the Industry x Category value from matrix 5
 * read at the sub category's parent, so a niche can never disagree with its own
 * industry by accident. The taxonomy sharpens it in two directions — up, where a
 * human named the sub category, and down, where the human named a *sibling* of
 * it and thereby said this one is not what the brief means.
 *
 * The four rungs, and the reason the third exists:
 *
 *   PRIMARY    100  the niche named it
 *   SECONDARY   85  the niche named it as a reach
 *   SIBLING    ≤70  the niche named something else in the same category
 *   DERIVED     —   the niche said nothing about this category; matrix 5 rules
 *
 * Without SIBLING the crosswalk contradicts itself: matrix 5 gives Derma
 * Skincare the whole Beauty category at 100, so Makeup — which the brief never
 * mentioned — would outscore Haircare, which it named as a secondary.
 *
 * Returns `{ score, rule, derived }`; `derived` is what the matrix alone would
 * have said, which is the number a reviewer wants printed beside the override.
 */
export function crosswalk(nicheLabel, subCode) {
  const n = NICHE_INDEX.get(nicheLabel)
  const sub = subOf(subCode)
  if (!n || !sub) return { score: UNRELATED, rule: 'UNKNOWN', derived: UNRELATED }
  const derived = INDUSTRY_CATEGORY[n.industry]?.[sub.catLabel] ?? UNRELATED
  if (n.primary.has(subCode)) return { score: CROSSWALK_PRIMARY, rule: 'PRIMARY', derived }
  if (n.secondary.has(subCode)) return { score: CROSSWALK_SECONDARY, rule: 'SECONDARY', derived }
  if (n.cats.has(sub.catLabel)) {
    return { score: Math.min(derived, CROSSWALK_SIBLING), rule: 'SIBLING', derived }
  }
  return { score: derived, rule: 'DERIVED', derived }
}

/**
 * The crosswalk as a table: every sub category of every category any niche
 * spoke about, scored.
 *
 * Deliberately not just the two override lists. A table that shows only what a
 * niche named cannot be checked for the failure it is most likely to have —
 * something unnamed quietly outranking something named — because the offending
 * row is the one that was left out. Listing the whole of each claimed category
 * makes the ladder visible and the omissions meaningful: a category absent from
 * this table is one no niche has an opinion about, and matrix 5 governs it.
 */
export function crosswalkRows() {
  const out = []
  for (const i of BRAND_TAXONOMY) {
    for (const n of i.niches) {
      const { cats } = NICHE_INDEX.get(n.label)
      for (const catLabel of CATEGORIES) {
        if (!cats.has(catLabel)) continue
        // Highest first inside each category, so the ladder reads top to bottom
        // and a sibling that has climbed above a named sub category shows up as
        // a row in the wrong place rather than as a number to be compared.
        const rung = subsOfCategory(catLabel)
          .map(({ code, label }) => ({
            industry: i.industry, niche: n.label, subCode: code,
            subLabel: label, catLabel, ...crosswalk(n.label, code),
          }))
          .sort((a, b) => b.score - a.score)
        out.push(...rung)
      }
    }
  }
  return out
}
