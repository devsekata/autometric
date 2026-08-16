/**
 * Sample intelligence for a roster creator.
 *
 * ⚠ EVERYTHING THIS MODULE RETURNS IS DEMO DATA. ⚠
 *
 * The commercial KOL database holds identity only — username, platform,
 * follower count, engagement rate, category, tier, verified flag. It has no
 * posts, no reach/impressions/views, no audience demographics, no campaign
 * history and no time series of any kind (the campaign tables exist but are
 * empty). The Creator Intelligence Workspace was specified around all of that,
 * so the missing numbers are generated here to give the screens their real
 * shape ahead of the data.
 *
 * Three rules keep this safe to ship:
 *
 * 1. Every value is marked in the UI. The workspace paints a banner and each
 *    sampled figure carries a "contoh" marker, so nothing here can be mistaken
 *    for a measurement.
 * 2. It is deterministic. The generator is seeded from the creator's id, so a
 *    creator shows the same numbers on every render, every reload and for every
 *    user — sample data that reshuffles itself is obviously fake in a demo, and
 *    worse, makes screenshots irreproducible.
 * 3. It is anchored to what IS real. Reach, views and EMV are derived from the
 *    creator's actual follower count and engagement rate, and the trend series
 *    lands on their real rate in the final month. A 12M-follower creator and a
 *    3K-follower creator therefore get plausibly different numbers rather than
 *    the same invented ones.
 *
 * Replacing this module is the whole migration: once real tables land, delete
 * the call sites' `sample` prefix and the marker components fall away with it.
 */

import type { KolDirectoryRow } from './kolDirectory'

/* ── deterministic randomness ─────────────────────────────────────────────── */

/** FNV-1a over the creator id — a stable 32-bit seed, no dependency needed. */
function seedOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and good enough for placeholder figures. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ── shapes ───────────────────────────────────────────────────────────────── */

export interface SampleTrendPoint {
  month: string
  erPct: number
  reach: number
  views: number
  followers: number
}

export interface SampleShare { label: string; pct: number }

export interface SampleContentItem {
  title: string
  views: number
  erPct: number
  format: string
}

export interface SampleCampaign {
  name: string
  brand: string
  period: string
  deliverables: number
  budgetUsd: number
  status: 'Completed' | 'Running'
  erPct: number
  roas: number
  reach: number
  engagement: number
  paid: boolean
  /** Index of the stage reached, into CAMPAIGN_STAGES. */
  stage: number
}

export const CAMPAIGN_STAGES = [
  'Brief', 'Content Draft', 'Revision', 'Approval', 'Scheduled', 'Published', 'Completed',
] as const

export interface SampleHighlight {
  icon: string
  tone: 'good' | 'warning' | 'neutral'
  headline: string
  detail: string
}

export interface SampleIntel {
  /** The composite the Overview leads with, and its four contributing scores. */
  quality: { score: number; verdict: string; bars: SampleShare[] }
  /** Interpretations that sit beside the trend chart rather than under it. */
  highlights: SampleHighlight[]
  collaboration: {
    completed: number
    avgCampaignErPct: number
    onTimePct: number
    repeat: number
    reliability: number
  }
  suggestedBrands: string[]
  /** How sure the summary claims to be — sampled like the summary itself. */
  aiConfidence: number
  kpi: {
    avgReach: number
    avgViews: number
    emvUsd: number
    /** Percentage-point / percent deltas "vs previous period". */
    delta: { followers: number; er: number; reach: number; views: number; emv: number }
  }
  trend: SampleTrendPoint[]
  performance: {
    impressions: number
    likes: number
    comments: number
    shares: number
    saves: number
  }
  growth: { monthly: number; threeMonth: number; sixMonth: number }
  audience: {
    authenticity: number
    qualityScore: number
    potentialReach: number
    gender: SampleShare[]
    age: SampleShare[]
    location: SampleShare[]
    generation: SampleShare[]
    interests: string[]
    quality: SampleShare[]
  }
  content: {
    recent: SampleContentItem[]
    top: SampleContentItem[]
    formats: SampleShare[]
    topics: SampleShare[]
    sentiment: SampleShare[]
  }
  campaigns: SampleCampaign[]
  brandFit: {
    score: number
    verdict: string
    bars: SampleShare[]
    strengths: string[]
    watchouts: string[]
  }
  ai: {
    summary: string
    strengths: string[]
    watchouts: string[]
    predicted: { d30: number; d90: number; m6: number }
    suggestion: { campaignType: string; content: string; objective: string; postingTime: string }
  }
}

/* ── vocabularies ─────────────────────────────────────────────────────────── */

const MONTHS = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']

const CITIES = ['Jakarta', 'Bandung', 'Surabaya', 'Tangerang', 'Medan', 'Yogyakarta']

const INTERESTS: Record<string, string[]> = {
  default: ['Lifestyle', 'Entertainment', 'Travel', 'Food', 'Music', 'Shopping'],
  Beauty: ['Skincare', 'Makeup', 'GRWM', 'Haircare', 'Fragrance', 'Clean beauty'],
  Fashion: ['Streetwear', 'OOTD', 'Thrifting', 'Sneakers', 'Local brands', 'Runway'],
  Food: ['Street food', 'Home cooking', 'Cafe hopping', 'Baking', 'Halal food', 'Recipes'],
  Fitness: ['Running', 'Gym', 'Wellness', 'Marathon', 'Sportswear', 'Nutrition'],
  Travel: ['Backpacking', 'Staycation', 'Hidden gems', 'Culinary trips', 'Diving', 'Hiking'],
  Gaming: ['Mobile Legends', 'Valorant', 'Streaming', 'Esports', 'PC build', 'Game review'],
  Technology: ['Gadgets', 'Smartphone', 'Reviews', 'AI tools', 'Photography gear', 'Apps'],
}

const IG_FORMATS = ['Reels', 'Carousel', 'Story', 'Feed']
const TT_FORMATS = ['Video', 'Photo', 'Live', 'Duet']

const CONTENT_TITLES: Record<string, string[]> = {
  default: [
    'Daily routine', 'Q&A bareng followers', 'A day in my life',
    'Rekomendasi mingguan', 'Behind the scenes', 'Kolaborasi terbaru',
  ],
  Beauty: [
    'Morning skincare routine', 'GRWM: acara malam', 'Review serum baru',
    'Makeup 5 menit', 'Skincare budget di bawah 100rb', 'Hasil pakai 30 hari',
  ],
  Fitness: [
    'Morning run routine', 'Persiapan maraton', 'Review sepatu lari',
    'Latihan 20 menit di rumah', 'Menu makan sehari', 'Recovery day',
  ],
  Food: [
    'Kuliner kaki lima', 'Resep 15 menit', 'Cafe hopping Jakarta',
    'Masak untuk keluarga', 'Review resto viral', 'Bekal harian',
  ],
}

const BRANDS = ['Nike', 'Adidas', 'Somethinc', 'Tokopedia', 'Wardah', 'Erigo', 'Scarlett']
const CAMPAIGN_NAMES = [
  'Product Relaunch', 'Seasonal Series', 'Brand Ambassador', 'Ramadan Campaign',
  'Store Opening', 'Anniversary Sale',
]

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** A share list that always totals 100, with the remainder given to the largest. */
function normalise(parts: SampleShare[]): SampleShare[] {
  const total = parts.reduce((s, p) => s + p.pct, 0)
  const scaled = parts.map(p => ({ ...p, pct: Math.round((p.pct / total) * 1000) / 10 }))
  const drift = Math.round((100 - scaled.reduce((s, p) => s + p.pct, 0)) * 10) / 10
  if (drift !== 0 && scaled.length) {
    const i = scaled.reduce((best, p, idx) => (p.pct > scaled[best].pct ? idx : best), 0)
    scaled[i] = { ...scaled[i], pct: Math.round((scaled[i].pct + drift) * 10) / 10 }
  }
  return scaled
}

const round = (n: number, dp = 0) => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/* ── the generator ────────────────────────────────────────────────────────── */

export function sampleIntel(creator: KolDirectoryRow): SampleIntel {
  const rand = rng(seedOf(creator.id))
  /** Uniform in [lo, hi). */
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]

  const followers = creator.followers ?? Math.round(between(5_000, 80_000))
  // A creator with no measured rate still needs a number for the sampled
  // screens; it is drawn from the band the roster's measured rates sit in.
  const erPct = creator.erPct ?? round(between(0.6, 4.2), 2)
  const category = creator.categories[0] ?? 'default'
  const isTikTok = creator.platform === 'tiktok'

  /* Reach and views scale off the real follower count, not off nothing. */
  const reachRate = between(0.22, 0.46)
  const avgReach = Math.round(followers * reachRate)
  const avgViews = Math.round(avgReach * between(1.05, 1.45))
  // CPM-style: a thousand impressions valued somewhere in the local range.
  const emvUsd = Math.round(avgViews * between(0.010, 0.019))

  /**
   * Six months landing on the creator's real engagement rate: the series is
   * built backwards from today's value so the last point agrees with the number
   * shown in the KPI bar and on the directory card.
   */
  const trend: SampleTrendPoint[] = []
  let er = erPct
  let reach = avgReach
  let views = avgViews
  let foll = followers
  for (let i = MONTHS.length - 1; i >= 0; i--) {
    trend[i] = {
      month: MONTHS[i],
      erPct: round(er, 2),
      reach: Math.round(reach),
      views: Math.round(views),
      followers: Math.round(foll),
    }
    er = Math.max(0.1, er / between(1.005, 1.06))
    reach /= between(1.01, 1.09)
    views /= between(1.02, 1.11)
    foll /= between(1.01, 1.05)
  }

  const growthMonthly = round(((followers / trend[trend.length - 2].followers) - 1) * 100, 1)
  const growth = {
    monthly: growthMonthly,
    threeMonth: round(((followers / trend[MONTHS.length - 4].followers) - 1) * 100, 1),
    sixMonth: round(((followers / trend[0].followers) - 1) * 100, 1),
  }

  const interests = INTERESTS[category] ?? INTERESTS.default
  const titles = CONTENT_TITLES[category] ?? CONTENT_TITLES.default
  const formats = isTikTok ? TT_FORMATS : IG_FORMATS

  const femaleShare = round(between(38, 78), 1)
  const authenticity = Math.round(between(72, 95))

  const contentItem = (i: number, boost: number): SampleContentItem => ({
    title: titles[i % titles.length],
    views: Math.round(avgViews * boost * between(0.75, 1.35)),
    erPct: round(erPct * between(0.8, 1.6), 2),
    format: formats[i % formats.length],
  })

  const campaignCount = Math.floor(between(2, 5))
  const campaigns: SampleCampaign[] = Array.from({ length: campaignCount }, (_, i) => {
    const running = i === 0 && rand() > 0.6
    return {
      name: `${pick(CAMPAIGN_NAMES)}`,
      brand: pick(BRANDS),
      period: `${MONTHS[MONTHS.length - 1 - i] ?? 'Jan'} 2026`,
      deliverables: Math.floor(between(2, 7)),
      budgetUsd: Math.round(between(1.2, 8) * 1000),
      status: running ? 'Running' : 'Completed',
      erPct: round(erPct * between(1.05, 1.9), 1),
      roas: round(between(2.4, 6.1), 1),
      reach: Math.round(avgReach * between(3, 12)),
      engagement: Math.round(avgReach * between(0.05, 0.14)),
      paid: !running,
      stage: running ? Math.floor(between(1, 5)) : CAMPAIGN_STAGES.length - 1,
    }
  })

  const fitBars = normaliseScores([
    { label: 'Audience Fit', pct: Math.round(between(72, 96)) },
    { label: 'Category Fit', pct: Math.round(between(70, 97)) },
    { label: 'Engagement Fit', pct: Math.round(between(68, 96)) },
    { label: 'Brand Safety', pct: Math.round(between(78, 98)) },
    { label: 'Content Fit', pct: Math.round(between(70, 97)) },
  ])
  const fitScore = Math.round(fitBars.reduce((s, b) => s + b.pct, 0) / fitBars.length)

  const tier = creator.tier ?? 'Micro'
  const platformLabel = isTikTok ? 'TikTok' : 'Instagram'

  const qualityBars = normaliseScores([
    { label: 'Engagement', pct: Math.round(between(74, 96)) },
    { label: 'Audience', pct: Math.round(between(72, 95)) },
    { label: 'Growth', pct: Math.round(between(68, 94)) },
    { label: 'Authenticity', pct: authenticity },
  ])
  const qualityScore = Math.round(qualityBars.reduce((s, b) => s + b.pct, 0) / qualityBars.length)

  const deltaViews = round(between(6, 24), 1)
  const deltaReach = round(between(4, 19), 1)

  return {
    quality: {
      score: qualityScore,
      verdict: qualityScore >= 90 ? 'Excellent' : qualityScore >= 80 ? 'Strong' : qualityScore >= 70 ? 'Fair' : 'Weak',
      bars: qualityBars,
    },
    highlights: [
      {
        icon: 'visibility', tone: 'good',
        headline: `↑ ${deltaViews}% Views`,
        detail: 'Views naik dibanding periode sebelumnya',
      },
      {
        icon: 'podcasts', tone: 'good',
        headline: `↑ ${deltaReach}% Reach`,
        detail: 'Jangkauan konten terakhir menguat',
      },
      {
        icon: 'check_circle', tone: 'good',
        headline: 'Di atas rata-rata kategori',
        detail: `ER ${erPct.toFixed(2)}% melampaui rata-rata ${category === 'default' ? 'roster' : category}`,
      },
    ],
    collaboration: {
      completed: Math.floor(between(4, 16)),
      avgCampaignErPct: round(erPct * between(1.1, 1.7), 1),
      onTimePct: Math.round(between(88, 99)),
      repeat: Math.floor(between(1, 8)),
      reliability: Math.round(between(82, 98)),
    },
    suggestedBrands: [
      pick(BRANDS), pick(BRANDS), pick(BRANDS),
    ].filter((b, i, xs) => xs.indexOf(b) === i),
    aiConfidence: Math.round(between(76, 94)),
    kpi: {
      avgReach,
      avgViews,
      emvUsd,
      delta: {
        followers: growthMonthly,
        er: round(erPct - trend[trend.length - 2].erPct, 2),
        // Shared with the highlight cards so the two never disagree on screen.
        reach: deltaReach,
        views: deltaViews,
        emv: round(between(3, 16), 1),
      },
    },
    trend,
    performance: {
      impressions: Math.round(avgReach * between(1.3, 1.8)),
      likes: Math.round(avgReach * (erPct / 100) * between(6, 11)),
      comments: Math.round(avgReach * (erPct / 100) * between(0.3, 0.8)),
      shares: Math.round(avgReach * (erPct / 100) * between(0.5, 1.4)),
      saves: Math.round(avgReach * (erPct / 100) * between(0.8, 2.2)),
    },
    growth,
    audience: {
      authenticity,
      qualityScore: Math.round(between(70, 94)),
      potentialReach: Math.round(followers * between(0.55, 0.92)),
      gender: normalise([
        { label: 'Perempuan', pct: femaleShare },
        { label: 'Laki-laki', pct: round(98 - femaleShare, 1) },
        { label: 'Lainnya', pct: 2 },
      ]),
      age: normalise([
        { label: '18–24', pct: between(14, 30) },
        { label: '25–34', pct: between(28, 44) },
        { label: '35–44', pct: between(14, 26) },
        { label: '45–54', pct: between(6, 14) },
        { label: '55+', pct: between(2, 8) },
      ]),
      location: normalise(
        CITIES.slice(0, 4).map((city, i) => ({ label: city, pct: between(26 - i * 6, 40 - i * 8) }))
          .concat([{ label: 'Lainnya', pct: between(18, 34) }]),
      ),
      generation: normalise([
        { label: 'Gen Z', pct: between(24, 44) },
        { label: 'Millennials', pct: between(40, 58) },
        { label: 'Gen X', pct: between(8, 20) },
      ]),
      interests,
      quality: normalise([
        { label: 'Authentic', pct: authenticity },
        { label: 'Suspicious', pct: between(2, 8) },
        { label: 'Inactive', pct: between(1, 6) },
      ]),
    },
    content: {
      recent: Array.from({ length: 6 }, (_, i) => contentItem(i, between(0.7, 1.2))),
      top: Array.from({ length: 3 }, (_, i) => contentItem(i + 1, between(1.8, 3.4)))
        .sort((a, b) => b.views - a.views),
      formats: normalise(formats.map((f, i) => ({ label: f, pct: between(50 - i * 12, 64 - i * 14) }))),
      topics: normalise(interests.slice(0, 5).map((t, i) => ({ label: t, pct: between(38 - i * 7, 46 - i * 8) }))),
      sentiment: normalise([
        { label: 'Positif', pct: between(64, 86) },
        { label: 'Netral', pct: between(10, 24) },
        { label: 'Negatif', pct: between(2, 9) },
      ]),
    },
    campaigns,
    brandFit: {
      score: fitScore,
      verdict: fitScore >= 90 ? 'EXCELLENT' : fitScore >= 80 ? 'STRONG' : fitScore >= 70 ? 'MODERATE' : 'WEAK',
      bars: fitBars,
      strengths: [
        `Niche ${category === 'default' ? 'umum' : category} sejalan dengan kategori brand`,
        `Audiens dominan ${femaleShare >= 50 ? 'perempuan' : 'laki-laki'} usia 25–34`,
        `Engagement rate ${erPct.toFixed(2)}% di ${platformLabel}`,
      ],
      watchouts: [
        'Pengalaman untuk positioning premium/luxury masih terbatas',
        `Tier ${tier} biasanya punya antrean kolaborasi yang padat`,
      ],
    },
    ai: {
      summary:
        `@${creator.username} adalah creator ${tier} di ${platformLabel} dengan ${
          followers.toLocaleString('id-ID')} followers dan engagement rate ${erPct.toFixed(2)}%. ` +
        `Audiensnya didominasi ${femaleShare >= 50 ? 'perempuan' : 'laki-laki'} Millennials, ` +
        `dan format terkuatnya adalah ${formats[0].toLowerCase()}.`,
      strengths: [
        'Engagement di atas rata-rata kategorinya',
        `Audiens autentik ${authenticity}%`,
        'Pertumbuhan follower konsisten enam bulan terakhir',
        `Performa ${formats[0].toLowerCase()} kuat`,
      ],
      watchouts: [
        'Permintaan kolaborasi tinggi — jadwal perlu dikunci lebih awal',
        'Harga di atas median tier-nya',
        'Riwayat campaign kategori premium masih tipis',
      ],
      predicted: {
        d30: Math.round(followers * between(1.02, 1.07)),
        d90: Math.round(followers * between(1.08, 1.2)),
        m6: Math.round(followers * between(1.18, 1.42)),
      },
      suggestion: {
        campaignType: pick(['Product Launch', 'Brand Ambassador', 'Awareness Push', 'Seasonal Campaign']),
        content: isTikTok ? 'TikTok Video / Live' : 'Reels / Carousel',
        objective: pick(['Awareness + Engagement', 'Consideration', 'Traffic + Engagement']),
        postingTime: pick([
          'Kam & Sab · 18:00–20:00 WIB',
          'Sel & Jum · 19:00–21:00 WIB',
          'Rab & Min · 11:00–13:00 WIB',
        ]),
      },
    },
  }
}

/** Scores are independent 0–100 bars, so they are clamped rather than summed to 100. */
function normaliseScores(bars: SampleShare[]): SampleShare[] {
  return bars.map(b => ({ ...b, pct: Math.max(0, Math.min(100, Math.round(b.pct))) }))
}
