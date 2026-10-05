/**
 * The workbook's two datasets: 30 creators and 3 brands.
 *
 * The creators are dummy, but they are not arbitrary. Each one is hand-set on
 * the fields the Brand Match actually reads — platform, category, sub category,
 * audience shape, content style, personality, values — and the mechanical rest
 * (views, growth, consistency, prices) is derived from the handle by the same
 * FNV-1a hash `@/lib/discover/profile.ts` uses, so the numbers are stable across
 * regenerations and nobody has to diff a spreadsheet full of fresh randomness.
 *
 * The spread is deliberate. Three brands run against one roster, and the point
 * of the exercise is that the ranking changes; a roster of thirty
 * interchangeable mid-tier lifestyle creators would score the same for all
 * three and prove nothing.
 *
 * Several creators are missing a field on purpose — a blank Median Views, a
 * blank rate card, a blank audience city. That is not sloppiness: the real
 * roster is full of holes (`l1_silver.unified_rate_card` holds 0 rows,
 * `creator_city` is 0% filled), the Confidence column exists to report them,
 * and every formula in the workbook has to survive them without printing
 * #DIV/0!.
 */

import { TIERS } from './vocabulary.mjs'

/* ── deterministic pseudo-randomness ──────────────────────────────────────── */

/** FNV-1a over the handle plus a salt, exactly as `@/lib/discover/profile.ts`. */
function hash(seed, salt) {
  let h = 0x811c9dc5
  const s = `${seed}::${salt}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
const rnd = (seed, salt) => hash(seed, salt) / 0x100000000
const between = (seed, salt, lo, hi) => lo + rnd(seed, salt) * (hi - lo)
const r1 = (n) => Math.round(n * 10) / 10
const r2 = (n) => Math.round(n * 100) / 100

/** `tierOf()` from `@/lib/discover/vocab`, mirrored so the seed data agrees
 *  with the Tier formula the workbook writes into KOL_Database. */
export function tierOf(followers) {
  for (let i = TIERS.length - 1; i >= 0; i--) if (followers >= TIERS[i].min) return TIERS[i].name
  return 'Nano'
}

/* ── audience shapes ──────────────────────────────────────────────────────── */

/** Age skews per creator archetype, before jitter. Order follows AGE_BANDS. */
const AGE_SHAPES = {
  genz: [12, 44, 30, 10, 4],
  young: [8, 38, 34, 14, 6],
  mid: [3, 24, 45, 20, 8],
  older: [2, 14, 38, 30, 16],
}
/** Female share bands per archetype. */
const GENDER_SHAPES = { f: [72, 86], fmid: [60, 70], bal: [45, 55], m: [20, 34] }

function ageSplit(seed, shape) {
  const base = AGE_SHAPES[shape]
  const jit = base.map((v, i) => Math.max(1, v + between(seed, `age${i}`, -4, 4)))
  const sum = jit.reduce((a, b) => a + b, 0)
  const out = jit.map(v => Math.round((v / sum) * 100))
  // Fold the rounding remainder into the largest band, so the five cells add up
  // to exactly 100 — a demographic split that shows 99% reads as a bug.
  const drift = 100 - out.reduce((a, b) => a + b, 0)
  out[out.indexOf(Math.max(...out))] += drift
  return out
}

/* ── the roster ───────────────────────────────────────────────────────────── */

/**
 * Hand-set fields only. Everything else is derived below.
 * `over` pins a derived field where the case matters — a creator meant to be
 * the hidden gem, or the one that has to trip the brand-safety hard filter.
 */
const SEED = [
  { id: 'KOL-01', name: 'Ardi Nugraha', handle: 'ardidigital', platform: 'Instagram', cat: 'Tech', sub: 'Gadget Review', verified: 'Yes', city: 'Jakarta', followers: 128000, er: 3.8, age: 'mid', gender: 'm', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Technology, Productivity, Business, Gaming, Shopping', topics: 'Technology, Productivity, Business', style: 'Review', personality: 'Reviewer', values: 'Quality, Trust, Innovation, Transparency', intent: 'High' },
  { id: 'KOL-02', name: 'Rifqi Pratama', handle: 'rifqi.codes', platform: 'TikTok', cat: 'Tech', sub: 'Software & SaaS', verified: 'No', city: 'Bandung', followers: 86000, er: 6.2, age: 'young', gender: 'm', region: 'Jawa Barat', audCity: 'Bandung', interests: 'Technology, Productivity, Education, Business, Finance', topics: 'Technology, Productivity, Education, Business', style: 'Educational', personality: 'Educational', values: 'Innovation, Empowerment, Transparency, Quality', intent: 'Medium' },
  { id: 'KOL-03', name: 'Salsa Aulia', handle: 'salsabeautydiary', platform: 'Instagram', cat: 'Beauty', sub: 'Skincare', verified: 'Yes', city: 'Jakarta', followers: 240000, er: 4.4, age: 'young', gender: 'f', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Skincare, Beauty, Makeup, Shopping, Health', topics: 'Skincare, Beauty, Health', style: 'Review', personality: 'Reviewer', values: 'Authenticity, Quality, Trust, Health', intent: 'High', over: { selected: 'Yes' } },
  { id: 'KOL-04', name: 'Nadia Puspa', handle: 'nadiaglowup', platform: 'TikTok', cat: 'Beauty', sub: 'Makeup', verified: 'Yes', city: 'Surabaya', followers: 512000, er: 7.1, age: 'genz', gender: 'f', region: 'Jawa Timur', audCity: 'Surabaya', interests: 'Makeup, Beauty, Fashion, Shopping, Entertainment', topics: 'Makeup, Beauty, Fashion', style: 'Tutorial', personality: 'Creative', values: 'Fun, Authenticity, Quality, Empowerment', intent: 'High', over: { compSat: 78, partner: 'Yes' } },
  { id: 'KOL-05', name: 'Bimo Saputra', handle: 'bimomakan', platform: 'TikTok', cat: 'Food', sub: 'Culinary Review', verified: 'Yes', city: 'Jakarta', followers: 375000, er: 8.4, age: 'young', gender: 'bal', region: 'Nasional', audCity: 'Jakarta', interests: 'Food, Cooking, Travel, Shopping, Entertainment', topics: 'Food, Cooking, Travel', style: 'Review', personality: 'Relatable', values: 'Fun, Authenticity, Community, Affordability', intent: 'High' },
  { id: 'KOL-06', name: 'Ayu Lestari', handle: 'dapurayu', platform: 'Instagram', cat: 'Food', sub: 'Home Cooking', verified: 'No', city: 'Yogyakarta', followers: 64000, er: 5.2, age: 'mid', gender: 'f', region: null, audCity: 'Yogyakarta', interests: 'Cooking, Food, Parenting, Home Decor, Health', topics: 'Cooking, Food, Parenting', style: 'Tutorial', personality: 'Relatable', values: 'Family, Community, Quality, Affordability', intent: 'Medium' },
  { id: 'KOL-07', name: 'Fajar Ramadhan', handle: 'fajarfinance', platform: 'Instagram', cat: 'Finance', sub: 'Personal Finance', verified: 'Yes', city: 'Jakarta', followers: 152000, er: 3.2, age: 'mid', gender: 'm', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Finance, Business, Education, Technology, Productivity', topics: 'Finance, Business, Education', style: 'Educational', personality: 'Professional', values: 'Trust, Transparency, Empowerment, Quality', intent: 'Medium' },
  { id: 'KOL-08', name: 'Tania Wijaya', handle: 'taniainvest', platform: 'TikTok', cat: 'Finance', sub: 'Investing', verified: 'No', city: 'Jakarta', followers: 98000, er: 5.6, age: 'young', gender: 'fmid', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Finance, Business, Education, Productivity, Shopping', topics: 'Finance, Business, Productivity', style: 'Educational', personality: 'Educational', values: 'Empowerment, Transparency, Trust, Innovation', intent: 'Medium' },
  { id: 'KOL-09', name: 'Gilang Prakoso', handle: 'gilangbelajar', platform: 'TikTok', cat: 'Education', sub: 'Study Tips', verified: 'Yes', city: 'Semarang', followers: 210000, er: 6.8, age: 'genz', gender: 'bal', region: 'Jawa Tengah', audCity: 'Semarang', interests: 'Education, Productivity, Technology, Entertainment, Business', topics: 'Education, Productivity, Technology', style: 'Educational', personality: 'Educational', values: 'Empowerment, Community, Trust, Innovation', intent: 'Low' },
  { id: 'KOL-10', name: 'Mira Handayani', handle: 'mirabahasa', platform: 'Instagram', cat: 'Education', sub: 'Language', verified: 'No', city: 'Bandung', followers: 42000, er: 4.9, age: 'young', gender: 'fmid', region: 'Jawa Barat', audCity: 'Bandung', interests: 'Education, Travel, Productivity, Entertainment, Technology', topics: 'Education, Travel, Productivity', style: 'Tutorial', personality: 'Educational', values: 'Empowerment, Quality, Community, Trust', intent: 'Low', over: { medianViews: null } },
  { id: 'KOL-11', name: 'Dimas Anggara', handle: 'dimasfit', platform: 'Instagram', cat: 'Fitness', sub: 'Gym & Strength', verified: 'Yes', city: 'Jakarta', followers: 178000, er: 3.9, age: 'mid', gender: 'm', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Fitness, Health, Food, Fashion, Shopping', topics: 'Fitness, Health, Food', style: 'Demo', personality: 'Professional', values: 'Performance, Health, Quality, Trust', intent: 'Medium' },
  { id: 'KOL-12', name: 'Rani Kusuma', handle: 'ranihomeworkout', platform: 'TikTok', cat: 'Fitness', sub: 'Home Workout', verified: 'No', city: 'Tangerang', followers: 305000, er: 6.5, age: 'young', gender: 'f', region: 'Banten', audCity: 'Tangerang', interests: 'Fitness, Health, Food, Beauty, Parenting', topics: 'Fitness, Health, Food', style: 'Tutorial', personality: 'Inspirational', values: 'Health, Empowerment, Community, Performance', intent: 'Medium' },
  { id: 'KOL-13', name: 'Kevin Halim', handle: 'kevinstyleid', platform: 'Instagram', cat: 'Fashion', sub: 'Streetwear', verified: 'No', city: 'Jakarta', followers: 96000, er: 3.4, age: 'genz', gender: 'm', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Fashion, Shopping, Music, Entertainment, Beauty', topics: 'Fashion, Shopping, Music', style: 'Aesthetic', personality: 'Creative', values: 'Craftsmanship, Quality, Authenticity, Fun', intent: 'High' },
  { id: 'KOL-14', name: 'Zahra Amelia', handle: 'zahrahijabstyle', platform: 'Instagram', cat: 'Fashion', sub: 'Hijab Fashion', verified: 'Yes', city: 'Bandung', followers: 268000, er: 4.7, age: 'young', gender: 'f', region: 'Jawa Barat', audCity: 'Bandung', interests: 'Fashion, Beauty, Shopping, Skincare, Travel', topics: 'Fashion, Beauty, Shopping', style: 'Aesthetic', personality: 'Premium', values: 'Quality, Authenticity, Craftsmanship, Trust', intent: 'High' },
  { id: 'KOL-15', name: 'Andini Rahma', handle: 'andinidaily', platform: 'Instagram', cat: 'Lifestyle', sub: 'Daily Vlog', verified: 'No', city: 'Jakarta', followers: 58000, er: 5.8, age: 'young', gender: 'f', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Shopping, Food, Beauty, Travel, Fashion', topics: 'Shopping, Food, Beauty', style: 'Vlog', personality: 'Relatable', values: 'Authenticity, Fun, Community, Affordability', intent: 'High', over: { medianViews: null, rate: null } },
  { id: 'KOL-16', name: 'Yoga Pratama', handle: 'yogaminimal', platform: 'TikTok', cat: 'Lifestyle', sub: 'Self Improvement', verified: 'No', city: 'Yogyakarta', followers: 143000, er: 7.3, age: 'young', gender: 'bal', region: 'DI Yogyakarta', audCity: 'Yogyakarta', interests: 'Productivity, Education, Finance, Technology, Health', topics: 'Productivity, Education, Finance', style: 'Storytelling', personality: 'Inspirational', values: 'Empowerment, Authenticity, Trust, Health', intent: 'Medium' },
  { id: 'KOL-17', name: 'Sinta Maharani', handle: 'sintajalanjalan', platform: 'Instagram', cat: 'Travel', sub: 'Domestic Travel', verified: 'Yes', city: 'Bali', followers: 187000, er: 4.1, age: 'mid', gender: 'fmid', region: 'Bali', audCity: 'Bali', interests: 'Travel, Food, Shopping, Fashion, Entertainment', topics: 'Travel, Food, Shopping', style: 'Aesthetic', personality: 'Premium', values: 'Quality, Authenticity, Fun, Community', intent: 'Medium' },
  { id: 'KOL-18', name: 'Reza Fadillah', handle: 'rezabudgettrip', platform: 'TikTok', cat: 'Travel', sub: 'Budget Travel', verified: 'No', city: 'Surabaya', followers: 72000, er: 6.9, age: 'young', gender: 'bal', region: 'Jawa Timur', audCity: 'Surabaya', interests: 'Travel, Food, Productivity, Entertainment, Shopping', topics: 'Travel, Food, Entertainment', style: 'Vlog', personality: 'Casual', values: 'Affordability, Fun, Authenticity, Community', intent: 'Medium', over: { g90: null } },
  { id: 'KOL-19', name: 'Putri Amanda', handle: 'putrimomlife', platform: 'Instagram', cat: 'Parenting', sub: 'Momlife', verified: 'Yes', city: 'Depok', followers: 134000, er: 4.6, age: 'mid', gender: 'f', region: 'Jawa Barat', audCity: 'Depok', interests: 'Parenting, Health, Cooking, Home Decor, Shopping', topics: 'Parenting, Health, Cooking', style: 'Storytelling', personality: 'Relatable', values: 'Family, Health, Community, Trust', intent: 'High' },
  { id: 'KOL-20', name: 'Hendra Wijoyo', handle: 'hendrakeluarga', platform: 'TikTok', cat: 'Parenting', sub: 'Kids & Family', verified: 'No', city: 'Bekasi', followers: 89000, er: 5.4, age: 'older', gender: 'bal', region: 'Jawa Barat', audCity: 'Bekasi', interests: 'Parenting, Food, Entertainment, Home Decor, Education', topics: 'Parenting, Food, Entertainment', style: 'Entertaining', personality: 'Humorous', values: 'Family, Fun, Community, Affordability', intent: 'Medium' },
  { id: 'KOL-21', name: 'Bagas Setiawan', handle: 'bagaskomedi', platform: 'TikTok', cat: 'Entertainment', sub: 'Comedy', verified: 'Yes', city: 'Jakarta', followers: 1240000, er: 9.2, age: 'genz', gender: 'bal', region: 'Nasional', audCity: 'Nasional', interests: 'Entertainment, Music, Food, Gaming, Shopping', topics: 'Entertainment, Music, Food', style: 'Comedy', personality: 'Humorous', values: 'Fun, Community, Authenticity, Affordability', intent: 'Low', over: { compSat: 88, brandSafety: 62, risk: 'Medium' } },
  { id: 'KOL-22', name: 'Nabila Kirana', handle: 'nabilamusic', platform: 'Instagram', cat: 'Entertainment', sub: 'Music', verified: 'Yes', city: 'Jakarta', followers: 420000, er: 3.6, age: 'genz', gender: 'fmid', region: 'Nasional', audCity: 'Jakarta', interests: 'Music, Entertainment, Fashion, Beauty, Shopping', topics: 'Music, Entertainment, Fashion', style: 'Aesthetic', personality: 'Creative', values: 'Fun, Craftsmanship, Authenticity, Community', intent: 'Low', over: { brandSafety: 55, risk: 'High', excluded: 'Yes' } },
  { id: 'KOL-23', name: 'Arya Mahendra', handle: 'aryagaming', platform: 'TikTok', cat: 'Gaming', sub: 'Mobile Gaming', verified: 'Yes', city: 'Surabaya', followers: 640000, er: 7.8, age: 'genz', gender: 'm', region: 'Nasional', audCity: 'Surabaya', interests: 'Gaming, Technology, Entertainment, Music, Shopping', topics: 'Gaming, Technology, Entertainment', style: 'Entertaining', personality: 'Entertaining', values: 'Fun, Performance, Community, Innovation', intent: 'Medium', over: { cart: 'Yes' } },
  { id: 'KOL-24', name: 'Rio Saputra', handle: 'riopcbuild', platform: 'Instagram', cat: 'Gaming', sub: 'PC & Console', verified: 'No', city: 'Medan', followers: 51000, er: 4.2, age: 'young', gender: 'm', region: 'Sumatera Utara', audCity: null, interests: 'Gaming, Technology, Productivity, Entertainment, Shopping', topics: 'Gaming, Technology, Productivity', style: 'Demo', personality: 'Tech-savvy', values: 'Performance, Quality, Innovation, Craftsmanship', intent: 'High' },
  { id: 'KOL-25', name: 'Denny Kurniawan', handle: 'dennymotovlog', platform: 'TikTok', cat: 'Automotive', sub: 'Motorcycle', verified: 'No', city: 'Bekasi', followers: 228000, er: 5.1, age: 'young', gender: 'm', region: 'Jawa Barat', audCity: 'Bekasi', interests: 'Automotive, Travel, Entertainment, Technology, Shopping', topics: 'Automotive, Travel, Entertainment', style: 'Vlog', personality: 'Casual', values: 'Performance, Fun, Community, Affordability', intent: 'Medium' },
  { id: 'KOL-26', name: 'Wisnu Adi', handle: 'wisnucarreview', platform: 'Instagram', cat: 'Automotive', sub: 'Car Review', verified: 'Yes', city: 'Jakarta', followers: 76000, er: 2.9, age: 'older', gender: 'm', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Automotive, Technology, Finance, Travel, Business', topics: 'Automotive, Technology, Finance', style: 'Review', personality: 'Professional', values: 'Quality, Trust, Performance, Transparency', intent: 'High', over: { consistency: 48, community: 51 } },
  { id: 'KOL-27', name: 'Laras Ayu', handle: 'larasinterior', platform: 'Instagram', cat: 'Home & Living', sub: 'Interior', verified: 'No', city: 'Bandung', followers: 46000, er: 4.4, age: 'mid', gender: 'f', region: 'Jawa Barat', audCity: 'Bandung', interests: 'Home Decor, Shopping, Parenting, Food, Fashion', topics: 'Home Decor, Shopping, Parenting', style: 'Aesthetic', personality: 'Premium', values: 'Craftsmanship, Quality, Family, Sustainability', intent: 'High', over: { rate: null } },
  { id: 'KOL-28', name: 'Tiara Nisrina', handle: 'tiararapihin', platform: 'TikTok', cat: 'Home & Living', sub: 'Home Organization', verified: 'No', city: 'Jakarta', followers: 118000, er: 6.1, age: 'young', gender: 'f', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Home Decor, Shopping, Productivity, Parenting, Cooking', topics: 'Home Decor, Productivity, Shopping', style: 'Tutorial', personality: 'Relatable', values: 'Quality, Affordability, Family, Community', intent: 'High' },
  { id: 'KOL-29', name: 'Sekar Ayu', handle: 'sekarskincarejujur', platform: 'TikTok', cat: 'Beauty', sub: 'Skincare', verified: 'No', city: 'Yogyakarta', followers: 27000, er: 8.9, age: 'young', gender: 'f', region: 'DI Yogyakarta', audCity: 'Yogyakarta', interests: 'Skincare, Beauty, Health, Shopping, Makeup', topics: 'Skincare, Beauty, Health', style: 'Review', personality: 'Relatable', values: 'Authenticity, Trust, Health, Transparency', intent: 'High', over: { audQual: 91, audAuth: 95, brandSafety: 94, compSat: 12, consistency: 88 } },
  { id: 'KOL-30', name: 'Ibnu Faisal', handle: 'ibnubisnis', platform: 'Instagram', cat: 'Finance', sub: 'Business', verified: 'Yes', city: 'Jakarta', followers: 355000, er: 2.6, age: 'older', gender: 'm', region: 'DKI Jakarta', audCity: 'Jakarta', interests: 'Business, Finance, Education, Technology, Productivity', topics: 'Business, Finance, Education', style: 'Talking Head', personality: 'Professional', values: 'Trust, Quality, Empowerment, Transparency', intent: 'Medium', over: { medianViews: null, audQual: 66, audAuth: 71 } },
]

/** Turns one seed row into the full KOL_Database record. */
function expand(s) {
  const h = s.handle
  const isTikTok = s.platform === 'TikTok'
  // TikTok distributes to non-followers; Instagram largely does not. The two
  // therefore sit on different view-to-follower bands, which is what makes the
  // "View-to-Follower Ratio" preset a real question rather than a platform sort.
  const viewFactor = isTikTok ? between(h, 'vf', 0.55, 1.6) : between(h, 'vf', 0.18, 0.42)
  const avgViews = Math.round(s.followers * viewFactor)
  const medianViews = Math.round(avgViews * between(h, 'mv', 0.62, 0.88))
  const g30 = r1(between(h, 'g30', 0.4, 7.5))
  const ages = ageSplit(h, s.age)
  const [gLo, gHi] = GENDER_SHAPES[s.gender]
  const female = Math.round(between(h, 'gen', gLo, gHi))
  const brandSafety = Math.round(between(h, 'bs', 68, 97))
  const compSat = Math.round(between(h, 'cs', 5, 72))

  const o = s.over ?? {}
  const rec = {
    id: s.id,
    name: s.name,
    handle: `@${s.handle}`,
    platform: s.platform,
    category: s.cat,
    subCategory: s.sub,
    verified: s.verified,
    creatorCity: s.city,
    followers: s.followers,
    er: s.er,
    avgViews,
    medianViews: 'medianViews' in o ? o.medianViews : medianViews,
    g30,
    g90: 'g90' in o ? o.g90 : r1(g30 * between(h, 'g90', 2.0, 3.4)),
    consistency: o.consistency ?? Math.round(between(h, 'cons', 52, 95)),
    community: o.community ?? Math.round(between(h, 'comm', 45, 92)),
    audQual: o.audQual ?? Math.round(between(h, 'aq', 58, 94)),
    audAuth: o.audAuth ?? Math.round(between(h, 'auth', 64, 96)),
    shareRate: r2(between(h, 'sh', 0.2, 2.4)),
    saveRate: r2(between(h, 'sv', 0.4, 4.5)),
    recentPerf: Math.round(between(h, 'rp', 42, 96)),
    age1317: ages[0], age1824: ages[1], age2534: ages[2], age3544: ages[3], age45: ages[4],
    female,
    male: 100 - female,
    audienceCountry: 'Indonesia',
    audienceRegion: s.region,
    audienceCity: 'audCity' in o ? o.audCity : s.audCity,
    audienceInterests: s.interests,
    purchaseIntent: s.intent,
    contentTopics: s.topics,
    contentStyle: s.style,
    creatorPersonality: s.personality,
    creatorValues: s.values,
    contentQuality: Math.round(between(h, 'cq', 58, 95)),
    // Rate card in IDR, priced per 1.000 followers. `l1_silver.unified_rate_card`
    // holds 0 rows today, so this is the workbook's own input, not a reading.
    rate: 'rate' in o ? o.rate : Math.round((s.followers / 1000) * between(h, 'rate', 20000, 62000) / 1000) * 1000,
    brandSafety: o.brandSafety ?? brandSafety,
    compSat: o.compSat ?? compSat,
    alreadySelected: o.selected ?? 'No',
    inCart: o.cart ?? 'No',
    existingPartner: o.partner ?? 'No',
    excluded: o.excluded ?? 'No',
    addedDate: new Date(2026, 0, 1 + Math.floor(rnd(h, 'add') * 230)),
    updatedDate: new Date(2026, 7, 1 + Math.floor(rnd(h, 'upd') * 39)),
  }
  // Risk is derived from the two safety inputs unless the case pins it, so a
  // reviewer can retrace why a creator is flagged instead of taking it on faith.
  rec.risk = o.risk ?? (rec.brandSafety < 60 || rec.compSat > 85 ? 'High'
    : rec.brandSafety < 70 || rec.compSat > 75 ? 'Medium'
      : rec.brandSafety < 82 ? 'Low' : 'None')
  rec.tier = tierOf(rec.followers)
  return rec
}

export const KOLS = SEED.map(expand)

/* ── the brands ───────────────────────────────────────────────────────────── */

/**
 * Field keys are the workbook's join key: `Brand_Profile` column C carries them,
 * every engine formula addresses a brand value by the cell that key lands on,
 * and the README hands the same keys to the backend as the payload shape.
 */
export const BRAND_FIELDS = [
  ['A. COMPANY PROFILE', 'Brand ID', 'brand_id', 'text'],
  [null, 'Brand Name', 'brand_name', 'text'],
  [null, 'Industry', 'industry', 'list:Industry'],
  [null, 'Company Description', 'company_description', 'text'],
  [null, 'Product / Service Category', 'product_category', 'list:SubCategory'],
  [null, 'Main Business Keywords', 'business_keywords', 'tokens'],
  [null, 'Brand Niche', 'brand_niche', 'list:Niche'],

  ['B. TARGET AUDIENCE', 'Primary Age Range', 'primary_age_range', 'list:AgeBand'],
  [null, 'Secondary Age Range', 'secondary_age_range', 'list:AgeBand'],
  [null, 'Gender Majority', 'gender_majority', 'list:GenderMajority'],
  [null, 'Target Country', 'target_country', 'list:Country'],
  [null, 'Target Region / Province', 'target_region', 'list:Region'],
  [null, 'Target City', 'target_city', 'list:City'],
  [null, 'Audience Interests', 'audience_interests', 'tokens'],
  [null, 'Audience Demographics Priority', 'audience_priority', 'list:AudiencePriority'],

  ['C. BRAND IDENTIFICATION', 'Brand Personality', 'brand_personality', 'list:BrandPersonality'],
  [null, 'Brand Values', 'brand_values', 'tokens'],
  [null, 'Brand Tone', 'brand_tone', 'list:BrandTone'],
  [null, 'Brand Positioning', 'brand_positioning', 'list:Positioning'],
  [null, 'Brand Keywords', 'brand_keywords', 'tokens'],
  [null, 'Communication Style', 'communication_style', 'list:CommStyle'],

  ['D. IDEAL CREATOR PROFILE', 'Preferred Platform', 'preferred_platform', 'multi:Platform'],
  [null, 'Preferred Category', 'preferred_category', 'list:Category'],
  [null, 'Preferred Sub Category', 'preferred_subcategory', 'list:SubCategory'],
  [null, 'Preferred Tier', 'preferred_tier', 'multi:Tier'],
  [null, 'Preferred Follower Range — Min', 'preferred_followers_min', 'int'],
  [null, 'Preferred Follower Range — Max', 'preferred_followers_max', 'int'],
  [null, 'Minimum Engagement Rate (%)', 'min_engagement_rate', 'pct'],
  [null, 'Preferred Content Style', 'preferred_content_style', 'list:ContentStyle'],
  [null, 'Preferred Content Topics', 'preferred_content_topics', 'tokens'],
  [null, 'Preferred Creator Personality', 'preferred_creator_personality', 'list:CreatorPersonality'],
  [null, 'Preferred Creator Values', 'preferred_creator_values', 'tokens'],
  [null, 'Minimum Audience Quality', 'min_audience_quality', 'score'],
  [null, 'Minimum Brand Safety', 'min_brand_safety', 'score'],

  ['E. MATCHING CONFIGURATION', 'Category is a Hard Filter', 'category_hard_filter', 'list:YesNo'],
  [null, 'Audience Country is a Hard Filter', 'country_hard_filter', 'list:YesNo'],
  [null, 'Max Competitor Saturation (0 = off)', 'max_competitor_saturation', 'score'],
  [null, 'Minimum Brand Match (0 = off)', 'min_brand_match', 'score'],
  [null, 'Exclude Already Selected', 'exclude_already_selected', 'list:YesNo'],
  [null, 'Exclude Already in Cart', 'exclude_in_cart', 'list:YesNo'],
  [null, 'Exclude Existing Partner', 'exclude_existing_partner', 'list:YesNo'],
  [null, 'Exclude Excluded Creator', 'exclude_excluded_creator', 'list:YesNo'],
]

/** The list fields whose overlap is scored token by token. */
export const TOKEN_FIELDS = [
  ['business_keywords', 'Main Business Keywords'],
  ['audience_interests', 'Audience Interests'],
  ['brand_keywords', 'Brand Keywords'],
  ['brand_values', 'Brand Values'],
  ['preferred_content_topics', 'Preferred Content Topics'],
  ['preferred_creator_values', 'Preferred Creator Values'],
]

export const BRANDS = [
  {
    brand_id: 'BRAND-A',
    brand_name: 'Nusatech Cloud',
    industry: 'Technology / SaaS',
    company_description: 'Workflow automation and team collaboration for Indonesian SMEs.',
    product_category: 'Software & SaaS',
    business_keywords: 'Technology, Productivity, Business, Education, Finance',
    brand_niche: 'B2B SaaS',
    primary_age_range: '25-34',
    secondary_age_range: '18-24',
    gender_majority: 'Any',
    target_country: 'Indonesia',
    target_region: 'DKI Jakarta',
    target_city: 'Jakarta',
    audience_interests: 'Technology, Business, Productivity, Education, Finance',
    audience_priority: 'Interest',
    brand_personality: 'Innovative',
    brand_values: 'Innovation, Trust, Transparency, Quality, Empowerment',
    brand_tone: 'Informative',
    brand_positioning: 'Mid-market',
    brand_keywords: 'Technology, Productivity, Business, Education, Finance',
    communication_style: 'Educational',
    preferred_platform: 'Instagram, TikTok',
    preferred_category: 'Tech',
    preferred_subcategory: 'Software & SaaS',
    preferred_tier: 'Micro, Mid-tier, Macro',
    preferred_followers_min: 10000,
    preferred_followers_max: 1000000,
    min_engagement_rate: 2.5,
    preferred_content_style: 'Educational',
    preferred_content_topics: 'Technology, Business, Education, Productivity, Finance',
    preferred_creator_personality: 'Educational',
    preferred_creator_values: 'Innovation, Trust, Quality, Transparency, Empowerment',
    min_audience_quality: 65,
    min_brand_safety: 70,
    category_hard_filter: 'No',
    country_hard_filter: 'Yes',
    max_competitor_saturation: 0,
    min_brand_match: 0,
    exclude_already_selected: 'No',
    exclude_in_cart: 'No',
    exclude_existing_partner: 'No',
    exclude_excluded_creator: 'Yes',
  },
  {
    brand_id: 'BRAND-B',
    brand_name: 'Lumaya Skin',
    industry: 'Beauty & Skincare',
    company_description: 'Dermatologist-tested skincare for humid-climate skin barriers.',
    product_category: 'Skincare',
    business_keywords: 'Skincare, Beauty, Makeup, Health, Shopping',
    brand_niche: 'Derma Skincare',
    primary_age_range: '18-24',
    secondary_age_range: '25-34',
    gender_majority: 'Female',
    target_country: 'Indonesia',
    target_region: 'Nasional',
    target_city: 'Jakarta',
    audience_interests: 'Skincare, Beauty, Makeup, Fashion, Shopping',
    audience_priority: 'Gender',
    brand_personality: 'Premium',
    brand_values: 'Quality, Authenticity, Trust, Craftsmanship, Health',
    brand_tone: 'Aspirational',
    brand_positioning: 'Premium',
    brand_keywords: 'Skincare, Beauty, Health, Makeup, Shopping',
    communication_style: 'Visual-first',
    preferred_platform: 'Instagram, TikTok',
    preferred_category: 'Beauty',
    preferred_subcategory: 'Skincare',
    preferred_tier: 'Micro, Mid-tier',
    preferred_followers_min: 10000,
    preferred_followers_max: 500000,
    min_engagement_rate: 3,
    preferred_content_style: 'Review',
    preferred_content_topics: 'Skincare, Beauty, Makeup, Health, Shopping',
    preferred_creator_personality: 'Reviewer',
    preferred_creator_values: 'Authenticity, Quality, Trust, Health, Craftsmanship',
    min_audience_quality: 70,
    min_brand_safety: 75,
    category_hard_filter: 'No',
    country_hard_filter: 'Yes',
    max_competitor_saturation: 0,
    min_brand_match: 0,
    exclude_already_selected: 'No',
    exclude_in_cart: 'No',
    exclude_existing_partner: 'Yes',
    exclude_excluded_creator: 'Yes',
  },
  {
    brand_id: 'BRAND-C',
    brand_name: 'Rasa Nusantara',
    industry: 'Food & Beverage',
    company_description: 'Ready-to-drink archipelago flavours for everyday family tables.',
    product_category: 'Coffee & Beverage',
    business_keywords: 'Food, Cooking, Coffee, Shopping, Entertainment',
    brand_niche: 'Ready-to-Drink',
    primary_age_range: '25-34',
    secondary_age_range: '35-44',
    gender_majority: 'Balanced',
    target_country: 'Indonesia',
    target_region: 'Nasional',
    target_city: 'Nasional',
    audience_interests: 'Food, Cooking, Coffee, Travel, Entertainment',
    audience_priority: 'Age',
    brand_personality: 'Friendly',
    brand_values: 'Fun, Community, Affordability, Authenticity, Family',
    brand_tone: 'Warm',
    brand_positioning: 'Mass',
    brand_keywords: 'Food, Cooking, Coffee, Entertainment, Shopping',
    communication_style: 'Storytelling',
    preferred_platform: 'Instagram, TikTok',
    preferred_category: 'Food',
    preferred_subcategory: 'Culinary Review',
    preferred_tier: 'Nano, Micro, Mid-tier',
    preferred_followers_min: 5000,
    preferred_followers_max: 400000,
    min_engagement_rate: 3.5,
    preferred_content_style: 'Storytelling',
    preferred_content_topics: 'Food, Cooking, Coffee, Entertainment, Travel',
    preferred_creator_personality: 'Relatable',
    preferred_creator_values: 'Fun, Community, Authenticity, Family, Affordability',
    min_audience_quality: 60,
    min_brand_safety: 65,
    category_hard_filter: 'No',
    country_hard_filter: 'Yes',
    max_competitor_saturation: 0,
    min_brand_match: 0,
    exclude_already_selected: 'No',
    exclude_in_cart: 'No',
    exclude_existing_partner: 'No',
    exclude_excluded_creator: 'Yes',
  },
]
