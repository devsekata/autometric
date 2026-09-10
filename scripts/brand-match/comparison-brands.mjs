/**
 * The five sample brands, and the two axes they are scored on.
 *
 * ── Every category here comes from the database ─────────────────────────────
 * `category` is one of the nine canonical values in
 * `public.kol_categories.taxonomy_key`:
 *
 *     Beauty · Entertainment · Fashion · Fitness · Food · Gen Z · Lifestyle · Moms · Tech
 *
 * Not a synonym, not a re-spelling, and not a name invented for a spreadsheet.
 * `taxonomy_key` is the column the project already uses to answer "which of
 * these 28 category names are the same thing" — Foodies, Food and Cooking all
 * carry `Food`; Sports, Gym Enthusiast, Cyclist and Fitness all carry `Fitness`.
 * The creator side resolves through exactly the same column, so both halves of
 * every comparison speak one vocabulary that neither half authored.
 *
 * The earlier draft of this file did author one, and got it wrong in two places
 * a reader would not have caught: it filed `Moms` under `Parenting` and dropped
 * `Gen Z` entirely, when the database assigns both a taxonomy_key of their own.
 * That is the failure this rule exists to prevent.
 *
 * ── The record shape follows public.brand ──────────────────────────────────
 * `name`, `category`, `brand_keywords`, `brand_hashtags` are the columns
 * `public.brand` actually has (the table holds 0 rows, but its schema is the
 * project's statement of what a brand record is). The targeting fields below it
 * exist only where a creator-side column exists to answer them.
 *
 * ── The five are far apart on purpose ──────────────────────────────────────
 * Tech, Beauty, Food, Fitness, Fashion — five different canonical categories,
 * different audience genders, different interest sets. Five brands wanting the
 * same creator profile would rank identically and demonstrate nothing.
 */

/**
 * The nine canonical categories, as `kol_categories.taxonomy_key` holds them.
 *
 * Asserted against the roster snapshot at build time: if the database ever
 * grows, loses or renames a key, the build fails rather than scoring against a
 * list that has quietly gone stale.
 */
export const CANONICAL_CATEGORIES = [
  'Beauty', 'Entertainment', 'Fashion', 'Fitness', 'Food', 'Gen Z', 'Lifestyle', 'Moms', 'Tech',
]

/**
 * Every interest key in `l2_gold.audience_interest_daily`, spelled exactly as
 * the database spells it — lower case, and `sports` kept distinct from
 * `fitness` because the database keeps them distinct.
 *
 * `unknown` is deliberately absent: it is not an interest but the share of the
 * sampled audience the pipeline could not classify. It is counted in the
 * denominator of every share and reported as Interest Known %, never targeted.
 */
export const INTEREST_KEYS = [
  'art', 'automotive', 'beauty', 'business', 'education', 'entertainment',
  'fashion', 'fitness', 'food', 'gaming', 'music', 'parenting', 'pets',
  'photography', 'religion', 'sports', 'technology', 'travel',
]

/**
 * Relatedness between two canonical categories, on the workbook's 100 / 80 / 60
 * / 40 / 20 ladder. Row = what the brand wants, column = what the creator is.
 *
 * The ladder and its meaning are the engine workbook's; what is new is that the
 * axes are the database's nine keys rather than a 14-label list written for a
 * spreadsheet. Two of the nine are not content categories at all — `Moms` and
 * `Gen Z` describe an audience, which is a known flaw in the master list and the
 * reason each gets a hand-set row rather than a derived one. They still have to
 * be scoreable: 542 creators carry Moms and 145 carry Gen Z, and a brand match
 * that returned an error for 687 creators would be worse than one that returns
 * a defensible middle.
 *
 * Nothing is 0. An unrelated creator with a large relevant audience is a worse
 * buy than a related one, not a disqualified one.
 */
const R = (o) => o
export const CATEGORY_RELATEDNESS = {
  //          Beauty Entertainment Fashion Fitness Food GenZ Lifestyle Moms Tech
  Beauty: R({ Beauty: 100, Fashion: 80, Lifestyle: 70, 'Gen Z': 60, Entertainment: 50, Moms: 50, Fitness: 40, Food: 30, Tech: 20 }),
  Entertainment: R({ Entertainment: 100, 'Gen Z': 70, Lifestyle: 60, Fashion: 50, Beauty: 40, Food: 40, Moms: 40, Fitness: 30, Tech: 30 }),
  Fashion: R({ Fashion: 100, Beauty: 80, Lifestyle: 70, 'Gen Z': 60, Entertainment: 50, Moms: 40, Fitness: 40, Food: 20, Tech: 20 }),
  Fitness: R({ Fitness: 100, Lifestyle: 60, Food: 60, Beauty: 40, 'Gen Z': 40, Fashion: 40, Moms: 40, Entertainment: 30, Tech: 20 }),
  Food: R({ Food: 100, Lifestyle: 70, Moms: 60, Entertainment: 50, Fitness: 50, 'Gen Z': 40, Beauty: 30, Fashion: 20, Tech: 20 }),
  'Gen Z': R({ 'Gen Z': 100, Entertainment: 70, Fashion: 60, Beauty: 60, Lifestyle: 60, Tech: 50, Food: 40, Fitness: 40, Moms: 20 }),
  Lifestyle: R({ Lifestyle: 100, Beauty: 70, Fashion: 70, Food: 70, Moms: 60, Entertainment: 60, Fitness: 60, 'Gen Z': 60, Tech: 40 }),
  Moms: R({ Moms: 100, Lifestyle: 60, Food: 60, Beauty: 50, Fashion: 40, Fitness: 40, Entertainment: 40, Tech: 20, 'Gen Z': 20 }),
  Tech: R({ Tech: 100, 'Gen Z': 50, Lifestyle: 40, Entertainment: 30, Fashion: 20, Beauty: 20, Fitness: 20, Food: 20, Moms: 20 }),
}

export const BRANDS = [
  {
    brand_id: 'BR-01',
    brand_name: 'NovaTech',
    // kol_categories: "Technology and gadgets" and "Gaming" both carry this key.
    category: 'Tech',
    product: 'Productivity & Business Software',
    brand_keywords: ['teknologi', 'software', 'aplikasi', 'produktivitas', 'bisnis', 'digital'],
    brand_hashtags: ['tech', 'gadget', 'startup', 'produktivitas', 'aplikasi'],

    primary_age_range: '25-34',
    secondary_age_range: '18-24',
    gender_majority: 'Balanced',
    target_country: 'Indonesia',
    target_city: 'Jakarta',
    interests: ['technology', 'business', 'education', 'gaming'],

    caption_terms: ['teknologi', 'aplikasi', 'digital', 'bisnis', 'edukasi', 'gadget'],
    personality_brief: 'Professional · Innovative · Modern · Educational',
    ideal_creator: 'Creators carrying the Tech category — kol_categories "Technology and gadgets" or "Gaming" — with a business or education audience.',
  },
  {
    brand_id: 'BR-02',
    brand_name: 'LumiSkin',
    // kol_categories: "Beauty" — 1.206 creators, the second-largest category.
    category: 'Beauty',
    product: 'Skincare / Beauty',
    brand_keywords: ['skincare', 'perawatan kulit', 'kecantikan', 'glowing', 'serum', 'sunscreen'],
    brand_hashtags: ['skincare', 'beauty', 'glowing', 'makeup', 'bpom'],

    primary_age_range: '18-24',
    secondary_age_range: '25-34',
    gender_majority: 'Female',
    target_country: 'Indonesia',
    target_city: 'Jakarta',
    interests: ['beauty', 'fashion', 'entertainment'],

    caption_terms: ['skincare', 'kecantikan', 'makeup', 'glowing', 'perawatan', 'cantik'],
    personality_brief: 'Elegant · Friendly · Modern · Trustworthy',
    ideal_creator: 'Creators carrying the Beauty category, with a majority-female audience.',
  },
  {
    brand_id: 'BR-03',
    brand_name: 'DailyBite',
    // kol_categories: "Foodies" (63), "Food" (55) and "Cooking" (9) all carry this key.
    category: 'Food',
    product: 'Food / Beverage',
    brand_keywords: ['makanan', 'minuman', 'kuliner', 'resto', 'cafe', 'jajan'],
    brand_hashtags: ['kuliner', 'food', 'makanan', 'foodie', 'jajan'],

    primary_age_range: '18-24',
    secondary_age_range: '25-34',
    gender_majority: 'Balanced',
    target_country: 'Indonesia',
    target_city: 'Jakarta',
    interests: ['food', 'entertainment', 'parenting', 'travel'],

    caption_terms: ['kuliner', 'makanan', 'minuman', 'resto', 'enak', 'keluarga'],
    personality_brief: 'Friendly · Fun · Casual · Relatable',
    ideal_creator: 'Creators carrying the Food category — kol_categories "Foodies", "Food" or "Cooking" — or an entertainment audience that indexes on food.',
  },
  {
    brand_id: 'BR-04',
    brand_name: 'MoveFit',
    // kol_categories: "Fitness", "Sports", "Gym Enthusiast" and "Cyclist" all carry this key.
    category: 'Fitness',
    product: 'Sportswear / Fitness Product',
    brand_keywords: ['fitness', 'olahraga', 'gym', 'lari', 'kebugaran', 'sehat'],
    brand_hashtags: ['fitness', 'workout', 'gym', 'olahraga', 'sport'],

    primary_age_range: '18-24',
    secondary_age_range: '25-34',
    gender_majority: 'Balanced',
    target_country: 'Indonesia',
    target_city: 'Jakarta',
    // 'sports' and 'fitness' are separate keys in audience_interest_daily, so a
    // fitness brand targets both rather than making the database pick one.
    interests: ['fitness', 'sports', 'food'],

    caption_terms: ['olahraga', 'fitness', 'lari', 'gym', 'sehat', 'latihan'],
    personality_brief: 'Energetic · Motivational · Active · Bold',
    ideal_creator: 'Creators carrying the Fitness category — kol_categories "Fitness", "Sports", "Gym Enthusiast" or "Cyclist".',
  },
  {
    brand_id: 'BR-05',
    brand_name: 'UrbanMuse',
    // kol_categories: "Fashion" — 73 creators.
    category: 'Fashion',
    product: 'Fashion / Apparel',
    brand_keywords: ['fashion', 'outfit', 'ootd', 'gaya', 'koleksi', 'style'],
    brand_hashtags: ['ootd', 'fashion', 'style', 'outfit', 'lookbook'],

    primary_age_range: '18-24',
    secondary_age_range: '25-34',
    gender_majority: 'Female',
    target_country: 'Indonesia',
    target_city: 'Jakarta',
    interests: ['fashion', 'beauty', 'travel', 'music', 'photography'],

    caption_terms: ['fashion', 'outfit', 'gaya', 'style', 'koleksi', 'travel'],
    personality_brief: 'Modern · Stylish · Creative · Premium',
    ideal_creator: 'Creators carrying the Fashion category, with a majority-female audience.',
  },
]

/**
 * Brand fields in Brand_Profile reading order.
 *
 * `key` is the join key: the engine addresses a brand value by the cell its key
 * lands on, so renaming one here moves every formula that reads it. `kind`
 * decides rendering — `tokens` is a comma-joined set that gets one row per term
 * in the slot table, `flags` is the interest axis that becomes one 0/1 row per
 * INTEREST_KEYS entry.
 *
 * `source` is printed beside every field and is the point of the sheet: it says
 * which database column the value speaks to, or states plainly that no column
 * answers it. Three of them say the latter, and those three score nothing.
 */
export const BRAND_FIELDS = [
  ['A. BRAND RECORD  ·  public.brand', 'Brand ID', 'brand_id', 'text', '— workbook key'],
  [null, 'Brand Name', 'brand_name', 'text', 'public.brand.name'],
  [null, 'Category (canonical)', 'category', 'list', 'public.kol_categories.taxonomy_key — one of the 9 canonical values'],
  [null, 'Product / Service', 'product', 'text', '— descriptive, scores nothing'],
  [null, 'Brand Keywords', 'brand_keywords', 'tokens', 'public.brand.brand_keywords'],
  [null, 'Brand Hashtags', 'brand_hashtags', 'tokens', 'public.brand.brand_hashtags'],

  ['B. TARGET AUDIENCE', 'Primary Age Range', 'primary_age_range', 'list', 'NO COLUMN — audience_demographics_daily holds gender only; scores nothing'],
  [null, 'Secondary Age Range', 'secondary_age_range', 'list', 'NO COLUMN — as above'],
  [null, 'Gender Majority', 'gender_majority', 'list', "audience_demographics_daily (audience_type='gender') + feature.*_audience_analysis.female_pct"],
  [null, 'Target Country', 'target_country', 'list', "audience_geo_daily (geo_level='country')"],
  [null, 'Target City', 'target_city', 'list', "audience_geo_daily (geo_level='city')"],
  [null, 'Audience Interests', 'interests', 'flags', 'l2_gold.audience_interest_daily.interest_key — exact keys only'],

  ['C. CONTENT EVIDENCE', 'Caption Search Terms', 'caption_terms', 'tokens', 'searched in l1_silver.unified_post.caption — NOT a taxonomy; post_analysis.content_category is NULL in all 212 rows'],

  ['D. BRIEFED, NOT SCORED', 'Brand Personality', 'personality_brief', 'text', 'NO CREATOR COLUMN — no personality, tone, values or content-style field exists anywhere; Brand Personality Fit is N/A on all 120 rows'],
  [null, 'Ideal Creator', 'ideal_creator', 'text', '— descriptive, states which kol_categories rows feed this brand\'s canonical key'],
]
