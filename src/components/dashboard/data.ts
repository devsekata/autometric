// Data layer for the analytics dashboard. Currently dummy — swap these exports for
// real queries later without touching the view components.
// Everything here is fabricated but internally consistent so the UI reads well.

export type DashPlatform = 'instagram' | 'facebook' | 'tiktok'

export const PLATFORM_META: Record<DashPlatform, { label: string; short: string; color: string; logo: string }> = {
  instagram: { label: 'Instagram', short: 'IG', color: '#c13584', logo: '/instagram.png' },
  facebook:  { label: 'Facebook',  short: 'FB', color: '#1877f2', logo: '/facebook.png' },
  tiktok:    { label: 'TikTok',    short: 'TT', color: '#111827', logo: '/tiktok.png' },
}

// Accent palette used across charts (kept in the project's teal-forward family).
export const PALETTE = ['#3d7e96', '#e0a458', '#5fa783', '#d97a7a', '#8b7fc7', '#5b94b8']

export interface DashBrand {
  id: string
  name: string
  handle: string
  initials: string
  color: string
  followers: number
  platforms: DashPlatform[]
  logo?: string | null   // brand logo URL (public.brands.profile_url); null → initials badge
}

export const BRANDS: DashBrand[] = [
  { id: 'b1', name: 'Aurora Coffee',  handle: '@auroracoffee',  initials: 'AC', color: '#1e4f49', followers: 128400, platforms: ['instagram', 'facebook', 'tiktok'] },
  { id: 'b2', name: 'Nimbus Apparel', handle: '@nimbus.co',     initials: 'NA', color: '#3d7e96', followers: 96200,  platforms: ['instagram', 'tiktok'] },
  { id: 'b3', name: 'Verde Goods',    handle: '@verdegoods',    initials: 'VG', color: '#5fa783', followers: 41200,  platforms: ['instagram', 'facebook'] },
  { id: 'b4', name: 'Pace Athletics', handle: '@paceathletics', initials: 'PA', color: '#d97a7a', followers: 64500,  platforms: ['instagram', 'facebook', 'tiktok'] },
]

export interface Kpi {
  key: string
  label: string
  icon: string
  value: string
  delta: number          // percent change vs previous period; sign matters
  positiveIsGood: boolean
  spark: number[]        // mini trend
  ownAccountOnly?: boolean
}

// Headline KPIs. Shared metrics (Posts/Reach/ER) are kept consistent with CONTENT_KPIS.
export const KPIS: Kpi[] = [
  { key: 'followers',  label: 'Followers',      icon: 'group',          value: '128.4K', delta: 3.2,  positiveIsGood: true,  spark: [118, 119, 121, 120, 123, 124, 126, 125, 127, 128.4] },
  { key: 'er',         label: 'Engagement Rate', icon: 'favorite',       value: '3.91%',  delta: 2.1,  positiveIsGood: true,  spark: [3.5, 3.6, 3.55, 3.7, 3.75, 3.8, 3.88, 3.91] },
  { key: 'reach',      label: 'Reach',           icon: 'ads_click',      value: '5.7M',   delta: 8.5,  positiveIsGood: true,  spark: [4.6, 4.9, 5.0, 5.2, 5.3, 5.5, 5.6, 5.7], ownAccountOnly: true },
  { key: 'impr',       label: 'Impressions',     icon: 'visibility',     value: '9.4M',   delta: -4.0, positiveIsGood: true,  spark: [9.9, 9.7, 9.6, 9.5, 9.4, 9.3, 9.35, 9.4], ownAccountOnly: true },
  { key: 'posts',      label: 'Posts',           icon: 'grid_view',      value: '142',    delta: 12,   positiveIsGood: true,  spark: [108, 115, 118, 124, 128, 134, 139, 142] },
  { key: 'freq',       label: 'Posting / wk',    icon: 'calendar_month', value: '5.2',    delta: 8.3,  positiveIsGood: true,  spark: [4.4, 4.6, 4.5, 4.8, 4.9, 5.0, 5.1, 5.0, 5.2, 5.2] },
]

// 30-day daily series.
function gen(start: number, drift: number, jitter: number, n = 30): number[] {
  const out: number[] = []
  let v = start
  for (let i = 0; i < n; i++) {
    v += drift + (Math.sin(i * 1.7) * jitter)
    out.push(Math.round(v * 10) / 10)
  }
  return out
}

export const FOLLOWER_GROWTH = gen(118400, 70, 220).map(v => Math.round(v))
export const ER_TREND = gen(4.1, 0.025, 0.18)

export const ENGAGEMENT_BREAKDOWN = [
  { label: 'Likes',    value: 62, color: PALETTE[0] },
  { label: 'Comments', value: 18, color: PALETTE[1] },
  { label: 'Saves',    value: 12, color: PALETTE[2] },
  { label: 'Shares',   value: 8,  color: PALETTE[3] },
]

export const PLATFORM_SPLIT: { platform: DashPlatform; value: number }[] = [
  { platform: 'instagram', value: 128400 },
  { platform: 'facebook',  value: 86200 },
  { platform: 'tiktok',    value: 54900 },
]

export interface CompetitorRow {
  name: string
  platform: DashPlatform
  isSelf?: boolean
  followers: number
  er: number
  growth: number
  posts: number
  share: number        // share of voice %
}

export const COMPETITORS: CompetitorRow[] = [
  { name: 'Your Brand',   platform: 'instagram', isSelf: true, followers: 128400, er: 4.8, growth: 3.2, posts: 47, share: 28 },
  { name: 'Northwind Co', platform: 'instagram', followers: 210300, er: 3.1, growth: 1.0, posts: 62, share: 38 },
  { name: 'Lumen Studio', platform: 'instagram', followers: 98100,  er: 5.5, growth: 5.1, posts: 38, share: 18 },
  { name: 'Pace & Co',    platform: 'instagram', followers: 64500,  er: 4.0, growth: 2.3, posts: 29, share: 10 },
  { name: 'Verde Goods',  platform: 'instagram', followers: 41200,  er: 6.2, growth: 7.8, posts: 24, share: 6 },
]

export const PERIODS = ['7 days', '30 days', '90 days', 'Custom'] as const
export type Period = typeof PERIODS[number]

export const PLATFORM_FILTERS = ['All', 'instagram', 'facebook', 'tiktok'] as const
export type PlatformFilter = typeof PLATFORM_FILTERS[number]

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

// Query fragment a tab appends to its data fetch. Custom ranges send explicit
// start/end dates; presets send the label the API maps to a day count.
export function buildPeriodQS(period: Period, start: string | null, end: string | null): string {
  if (period === 'Custom' && start && end) return `period=Custom&start=${start}&end=${end}`
  return `period=${encodeURIComponent(period)}`
}

// Human label for a custom range, e.g. "1 Jun – 30 Jun 2026". Shows the year on
// both sides only when the range straddles two years.
export function fmtRangeLabel(start: string, end: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const day = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${M[m - 1]}` }
  const ys = start.slice(0, 4), ye = end.slice(0, 4)
  return ys === ye ? `${day(start)} – ${day(end)} ${ye}` : `${day(start)} ${ys} – ${day(end)} ${ye}`
}

/* ─────────────────────────  CONTENT OVERVIEW  ───────────────────────── */

// Unified headline KPIs for the Content tab (consistent with the niche matrix totals).
export const CONTENT_KPIS: Kpi[] = [
  { key: 'c-posts',    label: 'Total Posts',     icon: 'grid_view',   value: '142',   delta: 12,   positiveIsGood: true, spark: [108, 115, 118, 124, 128, 134, 139, 142] },
  { key: 'c-reach',    label: 'Total Reach',     icon: 'ads_click',   value: '5.7M',  delta: 8.5,  positiveIsGood: true, spark: [4.6, 4.9, 5.0, 5.2, 5.3, 5.5, 5.6, 5.7] },
  { key: 'c-er',       label: 'Engagement Rate', icon: 'bolt',        value: '3.91%', delta: 2.1,  positiveIsGood: true, spark: [3.5, 3.6, 3.55, 3.7, 3.75, 3.8, 3.88, 3.91] },
  { key: 'c-likes',    label: 'Likes Rate',      icon: 'favorite',    value: '3.65%', delta: -1.2, positiveIsGood: true, spark: [3.9, 3.85, 3.8, 3.78, 3.72, 3.7, 3.68, 3.65] },
  { key: 'c-comments', label: 'Comments Rate',   icon: 'chat_bubble', value: '0.26%', delta: 0.5,  positiveIsGood: true, spark: [0.21, 0.22, 0.23, 0.23, 0.24, 0.25, 0.255, 0.26] },
  { key: 'c-eng',      label: 'Avg Eng / Post',  icon: 'trending_up', value: '6.4K',  delta: 4.1,  positiveIsGood: true, spark: [5.2, 5.5, 5.4, 5.9, 6.0, 6.1, 6.3, 6.4] },
]

export type ContentFormat = 'reels' | 'carousel' | 'image'

export const FORMAT_META: Record<ContentFormat, { label: string; icon: string }> = {
  reels:    { label: 'Reels',    icon: 'movie' },
  carousel: { label: 'Carousel', icon: 'collections' },
  image:    { label: 'Image',    icon: 'image' },
}

// count = number of posts of that format; er = avg engagement rate for it.
export const FORMAT_BREAKDOWN: { format: ContentFormat; count: number; er: number; color: string }[] = [
  { format: 'reels',    count: 68, er: 6.1, color: PALETTE[0] },
  { format: 'carousel', count: 44, er: 4.9, color: PALETTE[1] },
  { format: 'image',    count: 30, er: 3.2, color: PALETTE[2] },
]

// Posts published per week over the last 8 weeks.
export const POSTING_FREQUENCY: { label: string; value: number }[] = [
  { label: 'W1', value: 4 }, { label: 'W2', value: 6 }, { label: 'W3', value: 5 }, { label: 'W4', value: 7 },
  { label: 'W5', value: 5 }, { label: 'W6', value: 8 }, { label: 'W7', value: 6 }, { label: 'W8', value: 6 },
]

// Engagement intensity by day × time slot (0–1). Used for the best-time heatmap.
export const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const HEATMAP_SLOTS = ['6a', '9a', '12p', '3p', '6p', '9p']
export const POSTING_HEATMAP: number[][] = [
  [0.1, 0.3, 0.5, 0.4, 0.8, 0.6], // Mon
  [0.2, 0.4, 0.6, 0.5, 0.9, 0.7], // Tue
  [0.2, 0.5, 0.7, 0.6, 1.0, 0.8], // Wed
  [0.3, 0.4, 0.6, 0.5, 0.85, 0.7],// Thu
  [0.3, 0.5, 0.7, 0.7, 0.9, 0.95],// Fri
  [0.4, 0.6, 0.5, 0.4, 0.5, 0.6], // Sat
  [0.5, 0.6, 0.4, 0.3, 0.4, 0.5], // Sun
]

export interface TopPost {
  id: string
  format: ContentFormat
  caption: string
  date: string
  likes: number
  comments: number
  er: number
  color: string
}

export const TOP_POSTS: TopPost[] = [
  { id: 'p1', format: 'reels',    caption: 'Behind the beans — our roast process in 30s ☕️', date: 'Jun 4',  likes: 12400, comments: 540, er: 7.8, color: '#caa46a' },
  { id: 'p2', format: 'carousel', caption: '5 ways to brew the perfect cup at home',           date: 'May 28', likes: 9800,  comments: 410, er: 6.5, color: '#8aa0a8' },
  { id: 'p3', format: 'reels',    caption: 'Customer reactions to the new seasonal blend',      date: 'May 22', likes: 8600,  comments: 372, er: 6.1, color: '#9c8f7a' },
  { id: 'p4', format: 'image',    caption: 'Morning light at the flagship store',               date: 'May 19', likes: 5200,  comments: 188, er: 4.4, color: '#b0b8bd' },
  { id: 'p5', format: 'carousel', caption: 'Meet the team behind your daily cup',               date: 'May 12', likes: 4700,  comments: 210, er: 4.1, color: '#a9b4a0' },
]

/* ─────────────────────  CONTENT MIX STRATEGY  ───────────────────── */

export const AI_SYNTHESIS =
  'Volume postingan meningkat 12% dibandingkan periode lalu, didorong oleh intensitas liputan #BeritaViral. ' +
  'Meskipun Likes Rate sedikit menurun (-1.2%), Comments Rate tumbuh positif (+0.5%), menandakan pergeseran ' +
  'perilaku audiens dari interaksi pasif ke diskusi aktif, terutama pada konten drama yang memancing debat ' +
  'karakter. Strategi konten kedepan sebaiknya mengoptimalkan Calls-to-Action yang memicu komentar untuk ' +
  'menjaga momentum ini.'

export interface MatrixRow {
  niche: string
  hashtag: string
  reach: number
  likes: number
  comments: number
  er: number
  insight: string
}

export const PERFORMANCE_MATRIX: MatrixRow[] = [
  { niche: 'Cinta Sepenuh Jiwa',    hashtag: '#CintaSepenuhJiwa',     reach: 980000,  likes: 45000, comments: 5200, er: 5.12, insight: 'Plot emosional tinggi memicu komentar debat antar audiens. ER tertinggi di kategori Drama.' },
  { niche: 'Mencintai Ipar Sendiri', hashtag: '#MencintaiIparSendiri', reach: 500000,  likes: 28000, comments: 3400, er: 6.28, insight: 'Kontroversial; rasio komentar terhadap like sangat tinggi menunjukkan diskusi intens.' },
  { niche: 'Terbelenggu Rasa',      hashtag: '#TerbelengguRindu',      reach: 300000,  likes: 12000, comments: 600,  er: 4.20, insight: 'Performa stabil, namun membutuhkan hook yang lebih kuat di 3 detik pertama.' },
  { niche: 'Garis-garis Cinta',     hashtag: '#GarisGarisCinta',       reach: 150000,  likes: 5000,  comments: 250,  er: 3.50, insight: 'Niche baru berkembang, perlu kolaborasi talent untuk boost awareness.' },
  { niche: 'Generic Brand Updates', hashtag: '#BeritaViral / #RCTI',   reach: 1100135, likes: 23931, comments: 1031, er: 2.27, insight: 'Reach massive karena sifat informatif, namun interaksi personal (komen) rendah.' },
]

export interface RelevanceTier {
  tier: string
  range: string
  pct: number
  desc: string
  color: string
}

export const COMMENT_RELEVANCE: RelevanceTier[] = [
  { tier: 'High Relevance',   range: '>80',   pct: 45, desc: 'Contextual replies, answers to captions', color: '#5fa783' },
  { tier: 'Medium Relevance', range: '50–80', pct: 35, desc: 'Generic compliments, short reactions',    color: '#e0a458' },
  { tier: 'Low Relevance',    range: '<50',   pct: 20, desc: 'Spam, unrelated mentions, emojis only',    color: '#d97a7a' },
]

export const RELEVANCE_INSIGHT =
  '45% of comments are "High Relevance", indicating strong storyline investment (e.g., debating characters). ' +
  'Low relevance comments are mostly generic emojis.'

export interface Contributor {
  username: string
  initials: string
  tier: string
  comments: number
  relevancy: number
  quote: string
  color: string
}

export const TOP_CONTRIBUTORS: Contributor[] = [
  { username: 'nayya070805',     initials: 'NA', tier: 'Super Fan',         comments: 42, relevancy: 94, color: '#3d7e96', quote: 'Udah sama Manda aja, udah dicintai secara ugal ugalan…' },
  { username: 'astri.bachtera87', initials: 'AS', tier: 'Active Discussant', comments: 28, relevancy: 88, color: '#5fa783', quote: 'Kdu jadi lebih seruu nihh gara2 si panda n manda' },
  { username: 'ciwanbanderas',   initials: 'CI', tier: 'Casual Viewer',     comments: 15, relevancy: 72, color: '#e0a458', quote: 'Kdu jadi komedi' },
  { username: 'fitri80734',      initials: 'FI', tier: 'Casual Viewer',     comments: 12, relevancy: 65, color: '#e0a458', quote: 'Sama Manda aja cocok ko' },
  { username: 'vivie_aryanti97', initials: 'VI', tier: 'Observer',          comments: 8,  relevancy: 85, color: '#8b7fc7', quote: 'Marcel Chandrawinata sebagai Rafk, tambahkan bagian itu dong' },
]

/* ─────────────────────  OVERVIEW — INSIGHTS  ───────────────────── */

// Slim per-channel snapshot: health + positioning only (metrics live in the KPI row).
export interface ChannelSnapshot {
  health: number
  primaryType: string
  winningFormat: string
}

export const CHANNEL_SNAPSHOT: Record<DashPlatform, ChannelSnapshot> = {
  instagram: { health: 88, primaryType: 'Visual / Lifestyle', winningFormat: 'Reels' },
  tiktok:    { health: 94, primaryType: 'Viral / Shorts',     winningFormat: 'Short Video' },
  facebook:  { health: 74, primaryType: 'Community / News',   winningFormat: 'Image' },
}

export const OVERALL_AI =
  'Secara keseluruhan, performa terkuat ada di TikTok dengan pertumbuhan signifikan (+45%). ' +
  'Konten format Reels & Short Video jadi pendorong utama engagement. Instagram stabil namun ' +
  'membutuhkan inovasi format visual. Jam posting Prime Time (19:00–21:00) memberikan ROI tertinggi.'

/* ─────────────────────  OVERVIEW — PORTFOLIO ROLL-UP  ───────────────────── */

// Headline KPIs roll up every brand × platform. Deltas are free-form strings
// because they mix units (%, pts, and qualitative notes).
export interface OverviewKpi {
  key: string
  label: string
  icon: string
  value: string
  delta: string
  good: boolean
  flat?: boolean              // neutral "=" state; overrides the up/down arrow
  dir?: 'up' | 'down'         // force arrow direction independent of `good` (e.g. "improved" drop)
  spark: number[]
}

export const OVERVIEW_KPIS: OverviewKpi[] = [
  { key: 'reach',  label: 'Total Reach (30d)',   icon: 'ads_click',     value: '48.7M', delta: '+14%',        good: true, spark: [38, 40, 39, 42, 44, 43, 46, 47, 48.7] },
  { key: 'eng',    label: 'Total Engagement',    icon: 'favorite',      value: '2.1M',  delta: '+22%',        good: true, spark: [1.5, 1.6, 1.7, 1.7, 1.8, 1.9, 2.0, 2.1] },
  { key: 'er',     label: 'Blended Eng. Rate',   icon: 'bolt',          value: '4.3%',  delta: '+0.8pts',     good: true, spark: [3.4, 3.6, 3.7, 3.8, 4.0, 4.1, 4.2, 4.3] },
  { key: 'views',  label: 'TK Video Views',      icon: 'smart_display', value: '18.2M', delta: '+44%',        good: true, spark: [10, 11, 12, 13, 15, 16, 17, 18.2] },
  { key: 'growth', label: 'Net Follower Growth', icon: 'group_add',     value: '+104K', delta: 'TikTok excl.', good: true, spark: [60, 70, 78, 85, 90, 96, 100, 104] },
]

// Multi-brand trend, one series per brand, switchable by metric.
export type TrendMetric = 'Engagement' | 'Reach' | 'Followers'
export const TREND_METRICS: TrendMetric[] = ['Engagement', 'Reach', 'Followers']
export const TREND_LABELS = ['W1', '', '', 'W4', '', '', 'W7', '', '', 'W10', '', 'W12']

export interface TrendSeries { name: string; color: string; data: number[] }

export const ENGAGEMENT_OVER_TIME: Record<TrendMetric, TrendSeries[]> = {
  Engagement: [
    { name: 'RCTI Drama',   color: PALETTE[0], data: gen(98000, 3200, 9000, 12) },
    { name: 'Official RCTI', color: PALETTE[1], data: gen(210000, 4200, 14000, 12) },
    { name: 'MNC TV',       color: PALETTE[2], data: gen(150000, 3800, 11000, 12) },
  ],
  Reach: [
    { name: 'RCTI Drama',   color: PALETTE[0], data: gen(2_600_000, 90000, 220000, 12) },
    { name: 'Official RCTI', color: PALETTE[1], data: gen(5_400_000, 110000, 340000, 12) },
    { name: 'MNC TV',       color: PALETTE[2], data: gen(3_000_000, 70000, 260000, 12) },
  ],
  Followers: [
    { name: 'RCTI Drama',   color: PALETTE[0], data: gen(1_900_000, 18000, 16000, 12) },
    { name: 'Official RCTI', color: PALETTE[1], data: gen(13_400_000, 22000, 30000, 12) },
    { name: 'MNC TV',       color: PALETTE[2], data: gen(6_500_000, 12000, 22000, 12) },
  ],
}

// Share of total reach across platforms.
export const PLATFORM_REACH_SHARE: { platform: DashPlatform; value: number }[] = [
  { platform: 'instagram', value: 42 },
  { platform: 'tiktok',    value: 38 },
  { platform: 'facebook',  value: 20 },
]

// Cross-brand, cross-platform benchmarking matrix.
export interface BrandMatrixRow {
  brand: string
  platform: DashPlatform
  followers: number
  reach: number
  engagement: number
  er: number
  posts: number
  trend: 'up' | 'flat' | 'down'
  score: number
}

export const BRAND_MATRIX: BrandMatrixRow[] = [
  { brand: 'RCTI Drama',    platform: 'instagram', followers: 1_200_000, reach: 3_500_000, engagement: 134_000, er: 3.8,  posts: 87,  trend: 'up',   score: 88 },
  { brand: 'RCTI Drama',    platform: 'tiktok',    followers: 850_000,   reach: 8_200_000, engagement: 950_000, er: 11.5, posts: 64,  trend: 'up',   score: 94 },
  { brand: 'Official RCTI', platform: 'instagram', followers: 8_700_000, reach: 6_500_000, engagement: 248_000, er: 2.8,  posts: 112, trend: 'up',   score: 82 },
  { brand: 'Official RCTI', platform: 'facebook',  followers: 5_200_000, reach: 1_800_000, engagement: 52_000,  er: 1.0,  posts: 45,  trend: 'flat', score: 65 },
  { brand: 'MNC TV',        platform: 'instagram', followers: 4_000_000, reach: 2_400_000, engagement: 182_000, er: 4.5,  posts: 79,  trend: 'up',   score: 90 },
  { brand: 'MNC TV',        platform: 'tiktok',    followers: 620_000,   reach: 4_100_000, engagement: 380_000, er: 9.2,  posts: 58,  trend: 'up',   score: 88 },
  { brand: 'MNC TV',        platform: 'facebook',  followers: 2_800_000, reach: 980_000,   engagement: 28_000,  er: 1.0,  posts: 38,  trend: 'down', score: 55 },
]

// Engagement rate by content tag (extra_attribute schema). overallEr is the
// blended baseline each tag is compared against.
export interface ContentAttribute { label: string; count: number; er: number; color: string }

export const CONTENT_ATTR_OVERALL_ER = 4.3
export const CONTENT_ATTRIBUTES: ContentAttribute[] = [
  { label: 'Boosted Posts', count: 34,  er: 6.8, color: '#e0a458' },
  { label: 'Collabs',       count: 18,  er: 9.2, color: '#d97a7a' },
  { label: 'Campaign',      count: 52,  er: 5.1, color: '#8b7fc7' },
  { label: 'Organic',       count: 187, er: 3.9, color: '#5fa783' },
  { label: 'Event',         count: 11,  er: 7.4, color: '#3d7e96' },
  { label: 'AON Posts',     count: 23,  er: 4.7, color: '#5b94b8' },
]

// X-axis labels for the best-time heatmap (aligns 1:1 with HEATMAP_SLOTS).
export const HEATMAP_TIME_LABELS = ['08:00', '12:00', '15:00', '18:00', '20:00', '22:00']

/* ─────────────────────  CONTENT OVERVIEW — PORTFOLIO  ───────────────────── */

export const CONTENT_OVERVIEW_KPIS: OverviewKpi[] = [
  { key: 'posts',  label: 'Total Posts (Period)',      icon: 'grid_view',     value: '291',   delta: '18% vs prior', good: true,  spark: [210, 225, 234, 240, 255, 268, 280, 291] },
  { key: 'saves',  label: 'Avg. Saves Rate (IG)',      icon: 'bookmark',      value: '2.3%',  delta: '0.4pts',       good: true,  spark: [1.8, 1.9, 1.95, 2.0, 2.1, 2.2, 2.25, 2.3] },
  { key: 'compl',  label: 'Avg. Completion Rate (TK)', icon: 'smart_display', value: '41%',   delta: '3pts',         good: false, spark: [46, 45, 44, 44, 43, 42, 41.5, 41] },
  { key: 'clicks', label: 'Link Clicks (FB)',          icon: 'ads_click',     value: '14.2K', delta: '22%',          good: true,  spark: [9.5, 10, 11, 11.5, 12.5, 13, 13.8, 14.2] },
]

// Reach by Instagram post type (Reels dominate).
export const IG_POST_TYPE_PERF: { label: string; reach: number; color: string }[] = [
  { label: 'Reels',    reach: 420000, color: PALETTE[0] },
  { label: 'Carousel', reach: 100000, color: PALETTE[1] },
  { label: 'Image',    reach: 78000,  color: PALETTE[2] },
  { label: 'Story',    reach: 54000,  color: PALETTE[3] },
]

export const POST_TYPE_INSIGHT =
  'Reels average 4.2× more reach than carousels. Profile visits from Reels convert followers at a higher rate.'

// Posts published per week — week 3 dips ~40%.
export const CONTENT_VOLUME_WEEKS: { label: string; value: number }[] = [
  { label: 'W1', value: 44 }, { label: 'W2', value: 46 }, { label: 'W3', value: 27 },
  { label: 'W4', value: 41 }, { label: 'W5', value: 49 }, { label: 'W6', value: 51 },
]

export const CONTENT_VOLUME_INSIGHT =
  'Week 3 saw a 40% posting drop across platforms. Engagement recovered with a lag — audiences penalise inconsistency.'

// Top posts ranked by engagement rate, all platforms combined.
export interface TopPostRow {
  rank: number
  platform: DashPlatform
  caption: string
  format: string
  reach: number
  views: number
  likes: number
  comments: number
  shares: number | null
  er: number
  tag: 'Organic' | 'Boosted'
}

export const TOP_POSTS_TABLE: TopPostRow[] = [
  { rank: 1,  platform: 'instagram', caption: 'Hasbi Malah Membela Lala Dari Pada Meiysa…',      format: 'Reel',     reach: 420000,  views: 380000,  likes: 42000,  comments: 3200,  shares: 8800,  er: 13.2, tag: 'Organic' },
  { rank: 2,  platform: 'tiktok',    caption: 'Plot twist yang bikin penonton syok! #DramaRCTI',  format: 'Video',    reach: 1200000, views: 980000,  likes: 88000,  comments: 5400,  shares: 12000, er: 9.5,  tag: 'Organic' },
  { rank: 3,  platform: 'instagram', caption: 'Momen Red Carpet Indonesian Television Awards…',   format: 'Carousel', reach: 180000,  views: 160000,  likes: 18000,  comments: 1100,  shares: 4200,  er: 14.5, tag: 'Boosted' },
  { rank: 4,  platform: 'facebook',  caption: 'Full time: Indonesia 2-0 Vietnam! Garuda di dadaku!', format: 'Video', reach: 890000,  views: 720000,  likes: 65000,  comments: 8900,  shares: null,  er: 10.3, tag: 'Organic' },
  { rank: 5,  platform: 'instagram', caption: 'Yasmin akhirnya tau siapa dalang di balik semua…', format: 'Reel',     reach: 350000,  views: 310000,  likes: 28000,  comments: 4800,  shares: 6200,  er: 11.6, tag: 'Organic' },
  { rank: 6,  platform: 'tiktok',    caption: 'Chef Juna marah-marah lagi! 😂 #MasterChef',        format: 'Video',    reach: 2100000, views: 1800000, likes: 145000, comments: 9200,  shares: 18000, er: 8.6,  tag: 'Boosted' },
  { rank: 7,  platform: 'instagram', caption: 'Suara emas dari Salma bikin merinding! #IdolIndonesia', format: 'Reel', reach: 290000,  views: 265000,  likes: 24000,  comments: 2100,  shares: 5100,  er: 11.0, tag: 'Organic' },
  { rank: 8,  platform: 'tiktok',    caption: 'Gol Spektakuler Timnas! 🇮🇩 GARUDA BISA!',          format: 'Video',    reach: 3200000, views: 2800000, likes: 210000, comments: 14200, shares: 24000, er: 7.7,  tag: 'Organic' },
  { rank: 9,  platform: 'facebook',  caption: 'Selamat ulang tahun RCTI ke-37! Terima kasih…',     format: 'Image',    reach: 95000,   views: 88000,   likes: 12000,  comments: 880,   shares: 200,   er: 14.9, tag: 'Organic' },
  { rank: 10, platform: 'instagram', caption: 'Biru masih belum bisa melupakan masa lalunya…',     format: 'Reel',     reach: 180000,  views: 165000,  likes: 15000,  comments: 2200,  shares: 3800,  er: 10.8, tag: 'Organic' },
]

// TikTok completion-rate distribution — % of videos falling in each bucket.
export const TIKTOK_COMPLETION_DIST: { label: string; value: number }[] = [
  { label: '0–25%',  value: 12 },
  { label: '25–50%', value: 22 },
  { label: '50–75%', value: 34 },
  { label: '75–100%', value: 32 },
]

// Avg reel completion (%) by clip duration bucket.
export const REEL_WATCH_BY_DURATION: { label: string; value: number }[] = [
  { label: '0–15s',  value: 72 },
  { label: '15–30s', value: 68 },
  { label: '30–45s', value: 45 },
  { label: '45–60s', value: 28 },
  { label: '60s+',   value: 22 },
]

export const REEL_WATCH_INSIGHT =
  '15–30s reels retain 68% avg completion. Videos over 45s drop below 30%.'

export const TIKTOK_COMPLETION_INSIGHT =
  '66% of videos are watched past the halfway point — well above the 50% retention benchmark.'

/* ─────────────────────  AUDIENCE — DEEP DIVE  ───────────────────── */

export const AUDIENCE_KPIS: OverviewKpi[] = [
  { key: 'foll', label: 'Total Tracked Followers', icon: 'group',      value: '23.4M', delta: '8.2% MoM', good: true,  spark: [20.1, 20.8, 21.3, 21.9, 22.4, 22.8, 23.1, 23.4] },
  { key: 'ige',  label: 'IG Accounts Engaged',     icon: 'favorite',   value: '1.2M',  delta: '11%',      good: true,  spark: [0.9, 0.95, 1.0, 1.05, 1.08, 1.12, 1.16, 1.2] },
  { key: 'tkv',  label: 'TK Profile Views',        icon: 'visibility', value: '4.8M',  delta: '34%',      good: true,  spark: [3.0, 3.3, 3.6, 3.9, 4.1, 4.4, 4.6, 4.8] },
  { key: 'fbv',  label: 'FB Profile Visits',       icon: 'person',     value: '890K',  delta: '0.4%',     good: true,  flat: true, spark: [880, 885, 882, 888, 884, 889, 887, 890] },
]

// Age buckets (overall share of audience).
export const AGE_DISTRIBUTION: { bucket: string; value: number; color: string }[] = [
  { bucket: '13–17', value: 9,  color: PALETTE[5] },
  { bucket: '18–24', value: 34, color: PALETTE[0] },
  { bucket: '25–34', value: 31, color: PALETTE[2] },
  { bucket: '35–44', value: 17, color: PALETTE[1] },
  { bucket: '45+',   value: 9,  color: PALETTE[3] },
]
export const AGE_INSIGHT =
  '18–24 is the fastest growing segment (+31% MoM on TikTok). IG skews 25–34. Adapt tone per platform.'

// Female / male split per platform.
export const GENDER_SPLIT: { platform: DashPlatform; female: number; male: number }[] = [
  { platform: 'instagram', female: 58, male: 42 },
  { platform: 'tiktok',    female: 64, male: 36 },
  { platform: 'facebook',  female: 49, male: 51 },
]

// Comment relevance tiers — semantic scoring of comments vs. their caption.
export interface RelevanceTierRow {
  tier: string
  range: string
  count: number
  pct: number
  desc: string
  color: string
  samples: string[]
}
export const COMMENT_RELEVANCE_TIERS: RelevanceTierRow[] = [
  { tier: 'High Relevance', range: '>75',   count: 36200, pct: 43, color: '#5fa783', desc: 'Contextual, plot-related, character debates',
    samples: ['Yasmin nangis bikin aku nangis juga 😭 plotnya emang beda', 'Hasbi harusnya sama Lala, chemistry mereka lebih kuat!', 'Biru akhirnya dapet keadilan, keren banget alurnya'] },
  { tier: 'Mid Relevance',  range: '40–75', count: 29500, pct: 35, color: '#e0a458', desc: 'Generic positive reactions, short praise',
    samples: ['Keren banget!', 'Suka sama videonya 🔥', 'Mantap jiwa', 'Gokil abis broo'] },
  { tier: 'Low Relevance',  range: '<40',   count: 18500, pct: 22, color: '#d97a7a', desc: 'Spam, emojis only, off-topic drops',
    samples: ['First! 🙋', 'Nitip like ya guys', 'Info loker dong', 'Like back ya!!!'] },
]
export const RELEVANCE_SIGNAL =
  'High-relevance comments (score >75) indicate deep story investment — audiences debating characters and plot. ' +
  'Low-relevance clusters are mostly generic emoji reactions. Optimise captions with open-ended questions to push ' +
  'high-relevance rate above 50%.'

// Top community contributors ranked by frequency × relevance.
export interface ContributorRow {
  rank: number
  initials: string
  username: string
  platform: DashPlatform
  comments: number
  likes: number
  daily: number
  relevance: number
  score: number
  tier: 'Super Fan' | 'Active' | 'Casual'
  color: string
}
export const COMMUNITY_CONTRIBUTORS: ContributorRow[] = [
  { rank: 1, initials: 'NA', username: '@nayya070805',     platform: 'instagram', comments: 42, likes: 156, daily: 3.2, relevance: 94, score: 138, tier: 'Super Fan', color: PALETTE[0] },
  { rank: 2, initials: 'DR', username: '@dramaqueeen88',   platform: 'tiktok',    comments: 38, likes: 312, daily: 4.1, relevance: 88, score: 130, tier: 'Super Fan', color: PALETTE[4] },
  { rank: 3, initials: 'BA', username: '@baper_sejati',    platform: 'instagram', comments: 31, likes: 118, daily: 2.8, relevance: 90, score: 119, tier: 'Super Fan', color: PALETTE[2] },
  { rank: 4, initials: 'AS', username: '@astri.bachtera87', platform: 'instagram', comments: 28, likes: 89,  daily: 2.1, relevance: 85, score: 112, tier: 'Active',    color: PALETTE[1] },
  { rank: 5, initials: 'VI', username: '@viral_watcher99', platform: 'tiktok',    comments: 21, likes: 204, daily: 1.8, relevance: 76, score: 97,  tier: 'Active',    color: PALETTE[5] },
  { rank: 6, initials: 'RC', username: '@rcti_fans2026',   platform: 'tiktok',    comments: 19, likes: 88,  daily: 1.5, relevance: 70, score: 84,  tier: 'Active',    color: PALETTE[3] },
  { rank: 7, initials: 'CI', username: '@ciwanbanderas',   platform: 'instagram', comments: 15, likes: 45,  daily: 1.2, relevance: 72, score: 80,  tier: 'Casual',    color: PALETTE[0] },
  { rank: 8, initials: 'FI', username: '@fitri80734',      platform: 'facebook',  comments: 12, likes: 22,  daily: 0.9, relevance: 65, score: 71,  tier: 'Casual',    color: PALETTE[2] },
]
export const SUPER_FAN_NOTE =
  'Nayya070805 and dramaqueeen88 have both high frequency AND high relevance — they\'re authentic advocates, ' +
  'not just prolific commenters. These are candidates for a creator/fan ambassador programme.'

// Audience by city (share of followers).
export const AUDIENCE_CITIES: { city: string; value: number }[] = [
  { city: 'Jakarta',  value: 38 },
  { city: 'Surabaya', value: 16 },
  { city: 'Medan',    value: 10 },
  { city: 'Bandung',  value: 8 },
  { city: 'Makassar', value: 5 },
  { city: 'Others',   value: 23 },
]

// User-generated content — tagged posts.
export interface UgcPost {
  username: string
  format: string
  caption: string
  likes: number
  comments: number
  total: number
  date: string
}
export const UGC_POSTS: UgcPost[] = [
  { username: '@nayya070805',     format: 'Reel',  caption: 'Udah sama Manda aja, udah dicintai secara ugal ugalan…', likes: 342, comments: 28, total: 370, date: 'Jun 9' },
  { username: '@astri.bachtera87', format: 'Image', caption: 'Kdu jadi lebih seruu nihh gara2 si panda n manda',       likes: 218, comments: 14, total: 232, date: 'Jun 8' },
  { username: '@ciwanbanderas',   format: 'Image', caption: 'Kdu jadi komedi sekarang haha',                           likes: 189, comments: 9,  total: 198, date: 'Jun 7' },
  { username: '@fitri80734',      format: 'Image', caption: 'Sama Manda aja cocok ko menurut ku',                      likes: 156, comments: 6,  total: 162, date: 'Jun 6' },
  { username: '@vivie_aryanti97', format: 'Reel',  caption: 'Marcel Chandrawinata Sebagai Rafki… keren banget!',       likes: 411, comments: 32, total: 443, date: 'Jun 5' },
]
export const UGC_OPPORTUNITY =
  'Tagged posts from top fans average 340 likes — 60% of branded post performance, at zero cost. ' +
  'Reposting high-performing UGC is the easiest reach multiplier available.'

/* ─────────────────────  STORIES  ───────────────────── */

export const STORIES_KPIS: OverviewKpi[] = [
  { key: 's-pub',   label: 'Stories Published', icon: 'amp_stories', value: '842',   delta: '24%',            good: true,  spark: [620, 670, 700, 730, 760, 790, 820, 842] },
  { key: 's-reach', label: 'Avg. Story Reach',  icon: 'ads_click',   value: '28.4K', delta: '9%',             good: true,  spark: [24, 25, 26, 26.5, 27, 27.5, 28, 28.4] },
  { key: 's-swipe', label: 'Swipe-Up Rate',     icon: 'swipe_up',    value: '3.1%',  delta: '0.4pts',         good: false, dir: 'down', spark: [3.6, 3.5, 3.4, 3.4, 3.3, 3.2, 3.15, 3.1] },
  { key: 's-exit',  label: 'Exit Rate (avg)',   icon: 'logout',      value: '18%',   delta: '2pts (improved)', good: true,  dir: 'down', spark: [22, 21, 20.5, 20, 19.5, 19, 18.5, 18] },
]

// Story retention funnel — absolute counts per step.
export const STORY_FUNNEL: { label: string; value: number; color: string }[] = [
  { label: 'Views',     value: 842000, color: '#6c4cd6' },
  { label: 'Taps Back', value: 118000, color: '#3d7e96' },
  { label: 'Taps Fwd',  value: 438000, color: '#3d7eea' },
  { label: 'Exits',     value: 152000, color: '#d6556f' },
  { label: 'Replies',   value: 50000,  color: '#d23f6f' },
  { label: 'Swipe-Up',  value: 26000,  color: '#5fa783' },
]
export const STORY_FUNNEL_INSIGHT =
  '52% tap-forward signals stories are being skipped. Hook in frame 1, or reduce sequence length to under 5 stories.'

// Story type performance — avg reach (bars) + avg replies (line).
export const STORY_TYPE_PERF: { type: string; reach: number; replies: number }[] = [
  { type: 'Static Image', reach: 23500, replies: 400 },
  { type: 'Video',        reach: 37500, replies: 900 },
  { type: 'Poll',         reach: 21500, replies: 1850 },
  { type: 'Quiz',         reach: 18500, replies: 1600 },
  { type: 'Link Sticker', reach: 27500, replies: 650 },
  { type: 'Countdown',    reach: 17500, replies: 380 },
]
export const STORY_TYPE_INSIGHT =
  'Polls and quizzes generate 3.8× more replies than static images. Stories with link stickers have 1.9% higher swipe-up.'

export const STORY_OVER_TIME_LABELS = ['W1 May', 'W2 May', 'W3 May', 'W4 May', 'W1 Jun', 'W2 Jun']
export const STORY_OVER_TIME: TrendSeries[] = [
  { name: 'Views',     color: '#d23f6f', data: [126000, 142000, 108000, 150000, 158000, 148000] },
  { name: 'Exits',     color: '#e0a458', data: [21000, 23000, 28000, 24000, 22000, 23000] },
  { name: 'Swipe-Ups', color: '#5fa783', data: [3200, 3500, 3000, 4200, 4800, 4500] },
]

/* ─────────────────────  TIKTOK DEEP  ───────────────────── */

export const TIKTOK_KPIS: OverviewKpi[] = [
  { key: 'tk-views',  label: 'Total Video Views',   icon: 'play_circle',  value: '18.2M', delta: '44%',          good: true,  spark: [11, 12, 13, 14, 15, 16, 17, 18.2] },
  { key: 'tk-new',    label: 'New Followers',       icon: 'person_add',   value: '142K',  delta: '28%',          good: true,  spark: [98, 105, 112, 120, 128, 134, 138, 142] },
  { key: 'tk-lost',   label: 'Lost Followers',      icon: 'person_remove', value: '38K',  delta: 'churn up 4%',  good: false, dir: 'up', spark: [30, 31, 33, 32, 35, 36, 37, 38] },
  { key: 'tk-net',    label: 'Net Growth',          icon: 'trending_up',  value: '+104K', delta: 'net positive', good: true,  spark: [70, 78, 84, 88, 94, 98, 101, 104] },
  { key: 'tk-compl',  label: 'Avg. Completion Rate', icon: 'check_circle', value: '41%',  delta: '3pts',         good: false, dir: 'down', spark: [46, 45, 44, 44, 43, 42, 41.5, 41] },
]

export const CHURN_WEEKS: { label: string; gained: number; lost: number }[] = [
  { label: 'W1 May', gained: 22000, lost: 5000 },
  { label: 'W2 May', gained: 24000, lost: 6000 },
  { label: 'W3 May', gained: 28000, lost: 11000 },
  { label: 'W4 May', gained: 18000, lost: 5000 },
  { label: 'W1 Jun', gained: 24000, lost: 5000 },
  { label: 'W2 Jun', gained: 26000, lost: 6000 },
]
export const CHURN_INSIGHT =
  'Lost follower volume spiked +62% — coinciding with a 3-day posting gap. Maintain ≥1 post/day on TikTok.'

// Video duration (s) vs. completion rate (%).
export const DURATION_COMPLETION: { x: number; y: number }[] = [
  { x: 8, y: 78 }, { x: 12, y: 72 }, { x: 15, y: 68 }, { x: 18, y: 65 }, { x: 22, y: 62 },
  { x: 28, y: 58 }, { x: 35, y: 50 }, { x: 42, y: 41 }, { x: 50, y: 35 }, { x: 58, y: 28 },
  { x: 65, y: 24 }, { x: 75, y: 19 }, { x: 90, y: 14 },
]

export const WATCH_BY_PILLAR: { label: string; value: number; color: string }[] = [
  { label: 'Drama Clips',   value: 12.4, color: '#6c4cd6' },
  { label: 'Behind Scenes', value: 9.7,  color: '#d23f6f' },
  { label: 'Live Recap',    value: 8.2,  color: '#3d7eea' },
  { label: 'Promotional',   value: 6.1,  color: '#5fa783' },
  { label: 'News Shorts',   value: 7.3,  color: '#e0a458' },
  { label: 'Comedy Skit',   value: 10.8, color: '#3d7e96' },
]
export const WATCH_INSIGHT =
  'Drama clips average 12.4s watch time vs. 6.1s for promotional posts. Narrative beats hard-sell.'

/* ─────────────────────  COMMUNITY  ───────────────────── */

export const COMMUNITY_KPIS: OverviewKpi[] = [
  { key: 'c-total', label: 'Total Comments Tracked', icon: 'forum',         value: '84.2K', delta: '31%',  good: true,  spark: [58, 62, 66, 70, 74, 78, 81, 84.2] },
  { key: 'c-igr',   label: 'IG Avg. Replies/Comment', icon: 'reply',        value: '1.8',   delta: '0.3',  good: true,  spark: [1.4, 1.45, 1.5, 1.6, 1.65, 1.7, 1.75, 1.8] },
  { key: 'c-tkr',   label: 'TK Comment-Like Ratio',   icon: 'thumb_up',     value: '0.12',  delta: 'high', good: true,  spark: [0.08, 0.09, 0.095, 0.1, 0.105, 0.11, 0.115, 0.12] },
  { key: 'c-fbl',   label: 'FB Avg. Likes/Comment',   icon: 'favorite',     value: '4.2',   delta: 'stable', good: true, flat: true, spark: [4.1, 4.2, 4.15, 4.2, 4.18, 4.2, 4.19, 4.2] },
]

export const COMMENT_VOLUME_LABELS = ['W1 May', 'W2 May', 'W3 May', 'W4 May', 'W1 Jun', 'W2 Jun']
export const COMMENT_VOLUME: TrendSeries[] = [
  { name: 'Instagram', color: '#d23f6f', data: [11000, 13000, 8500, 14200, 15000, 15800] },
  { name: 'TikTok',    color: '#111827', data: [8200, 9800, 6000, 11000, 12500, 13600] },
  { name: 'Facebook',  color: '#3d7eea', data: [3000, 3400, 2200, 3800, 4000, 4300] },
]

// Comments per hour of day (0–23); peak window highlighted in the view.
export const COMMENT_BY_HOUR: number[] = [
  780, 560, 380, 250, 180, 160, 210, 470, 690, 820, 860, 850,
  760, 730, 760, 790, 890, 1080, 1780, 2380, 2560, 2200, 1780, 1150,
]
export const COMMENT_PRIME_WINDOW = '19:00–23:00'
export const COMMENT_PRIME_INSIGHT =
  'Comments cluster 19:00–23:00 WIB. Responding within this window increases reply thread depth by 2.1×.'

/* ─────────────────────  CAMPAIGN ANALYSIS  ───────────────────── */

export const PILLAR_META: Record<string, { label: string; color: string }> = {
  drama:         { label: 'drama',         color: '#d23f6f' },
  entertainment: { label: 'entertainment', color: '#8b5cf6' },
  sports:        { label: 'sports',        color: '#3d7eea' },
  brand:         { label: 'brand',         color: '#6c4cd6' },
}

// Palette offered in the pillar colour picker.
export const PILLAR_COLORS = ['#6c4cd6', '#d23f6f', '#3d7eea', '#5fa783', '#e0a458', '#8b5cf6', '#3d7e96', '#d97a7a']

export interface CampaignPost {
  id: string
  platform: DashPlatform
  pillar: keyof typeof PILLAR_META
  boosted?: boolean
  caption: string
  date: string
  likes: number
  comments: number
  er: number
  hashtags: string[]
}

export const CAMPAIGN_POSTS: CampaignPost[] = [
  { id: 'cp1', platform: 'instagram', pillar: 'drama',         caption: 'Hasbi Malah Membela Lala — Eps 48 #CintaSepenuhJiwa', date: 'Jun 9', likes: 42000,  comments: 3200,  er: 13.2, hashtags: ['#CintaSepenuhJiwa', '#LayarDrama'] },
  { id: 'cp2', platform: 'tiktok',    pillar: 'drama',         caption: 'Plot twist yang bikin penonton syok! #DramaRCTI',    date: 'Jun 8', likes: 88000,  comments: 5400,  er: 9.5,  hashtags: ['#DramaRCTI', '#CintaSepenuhJiwa'] },
  { id: 'cp3', platform: 'instagram', pillar: 'entertainment', boosted: true, caption: 'Red Carpet Indonesian Television Awards 2025!', date: 'Jun 7', likes: 18000, comments: 1100, er: 14.5, hashtags: ['#ITA2025', '#RedCarpet', '#RCTI'] },
  { id: 'cp4', platform: 'facebook',  pillar: 'sports',        caption: 'TIMNAS INDONESIA 2-0 VIETNAM! Garuda di Dadaku!',    date: 'Jun 6', likes: 65000,  comments: 8900,  er: 10.3, hashtags: ['#TimnasIndonesia', '#GarudaDiDadaku'] },
  { id: 'cp5', platform: 'tiktok',    pillar: 'entertainment', boosted: true, caption: 'Chef Juna marah-marah lagi! 😄 #MasterChefIndonesia', date: 'Jun 5', likes: 145000, comments: 9200, er: 8.6, hashtags: ['#MasterChefIndonesia', '#ChefJuna'] },
  { id: 'cp6', platform: 'instagram', pillar: 'drama',         caption: 'Biru masih belum bisa melupakan masa lalunya… #TerbelengguRindu', date: 'Jun 4', likes: 15000, comments: 2200, er: 10.8, hashtags: ['#TerbelengguRindu', '#RCTI'] },
  { id: 'cp7', platform: 'tiktok',    pillar: 'sports',        caption: 'Gol Spektakuler Timnas! GARUDA BISA! 🇮🇩',          date: 'Jun 3', likes: 210000, comments: 14200, er: 7.7,  hashtags: ['#TimnasDay', '#GarudaBisa'] },
  { id: 'cp8', platform: 'instagram', pillar: 'brand',         caption: 'Selamat ulang tahun RCTI ke-37! Terima kasih telah setia', date: 'Jun 2', likes: 12000, comments: 880, er: 14.9, hashtags: ['#RCTI37Tahun', '#LayarDrama'] },
]

// Cleaned word cloud produced after running an analysis.
export const CAMPAIGN_WORDCLOUD: { word: string; weight: number }[] = [
  { word: 'drama', weight: 1.0 }, { word: 'plot', weight: 0.95 }, { word: 'garuda', weight: 0.92 },
  { word: 'banget', weight: 0.85 }, { word: 'timnas', weight: 0.84 }, { word: 'baper', weight: 0.8 },
  { word: 'keren', weight: 0.78 }, { word: 'nangis', weight: 0.72 }, { word: 'karakter', weight: 0.7 },
  { word: 'gol', weight: 0.68 }, { word: 'chemistry', weight: 0.66 }, { word: 'cinta', weight: 0.64 },
  { word: 'seru', weight: 0.6 }, { word: 'rcti', weight: 0.58 }, { word: 'penonton', weight: 0.55 },
  { word: 'alur', weight: 0.52 }, { word: 'episode', weight: 0.5 }, { word: 'masterchef', weight: 0.48 },
  { word: 'redcarpet', weight: 0.45 }, { word: 'mantap', weight: 0.42 },
]

export const CONTENT_ATTR_FINDING =
  'Collab posts drive 2.4× higher ER than organic, yet make up only 6% of total volume. ' +
  'Increasing collab frequency is the lowest-effort lever available.'

export const POSTING_WINDOW_INSIGHT =
  'Peak: Tue–Thu 19:00–21:00 WIB. Weekend 09:00–11:00 has strong reach but low posting ' +
  'frequency — an untapped slot.'
