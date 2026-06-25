// Chart configuration data + dummy-series builders, mirrored 1:1 from report_2's
// ChartSelectionModal / SmartChartBlock so the metric-selection flow matches exactly.
import { CoverColors } from '../cover/colors'

export type ChartCategory = 'line' | 'bar' | 'wordcloud'
export type LineDimension = 'daymonth' | 'last3months' | 'days'
export type BarOrientation = 'vertical' | 'horizontal'

export interface ChartConfig {
  chartType: ChartCategory
  // line
  dimension?: LineDimension
  metrics?: string[]
  // bar
  barOrientation?: BarOrientation
  barCategory?: string
  barMetrics?: string[]
  // wordcloud
  sentiment?: string
}

export const MAX_LINE_METRICS = 2

export const LINE_DIMENSIONS = [
  { id: 'daymonth', label: 'Day Month', icon: 'calendar_month', desc: 'Daily trends (1 Jun, 2 Jun, etc.)' },
  { id: 'last3months', label: 'Last 3 Months', icon: 'schedule', desc: 'Recent 3-month comparison' },
  { id: 'days', label: 'Daily', icon: 'show_chart', desc: 'Day of week analysis (Sun, Mon, etc.)' },
] as const

export const LINE_METRICS = [
  { id: 'followers', label: 'Followers', icon: 'group' },
  { id: 'profile_views', label: 'Profile Views', icon: 'visibility' },
  { id: 'profile_reach', label: 'Profile Reach', icon: 'trending_up' },
  { id: 'net_followers_growth', label: 'Net Followers Growth', icon: 'trending_up' },
  { id: 'engagements', label: 'Engagements', icon: 'favorite' },
  { id: 'likes', label: 'Likes', icon: 'favorite' },
  { id: 'comments', label: 'Comments', icon: 'chat_bubble' },
  { id: 'shares', label: 'Shares', icon: 'share' },
  { id: 'sentiments', label: 'Sentiments (Neg, Neu, Pos)', icon: 'bubble_chart' },
] as const

export const BAR_CATEGORIES = [
  {
    id: 'daily_performance', label: 'Daily Performance', desc: 'Daily metrics breakdown',
    metrics: [
      { id: 'profile_views', label: 'Profile Views' },
      { id: 'engagement', label: 'Engagement' },
      { id: 'followers', label: 'Followers' },
      { id: 'net_followers_growth', label: 'Net Followers Growth' },
    ],
  },
  {
    id: 'last3months_performance', label: 'Last 3 Months Performance', desc: 'Quarterly comparison',
    metrics: [
      { id: 'followers', label: 'Followers' },
      { id: 'followers_growth_pct', label: 'Followers Growth (%)' },
      { id: 'er_reach', label: 'ER Reach' },
      { id: 'engagements', label: 'Engagements' },
      { id: 'avg_engagements', label: 'Avg Engagements' },
      { id: 'total_reach', label: 'Total Reach' },
    ],
  },
  {
    id: 'content_pillars', label: 'Content Pillars Comparison', desc: 'Compare content categories',
    metrics: [
      { id: 'number_of_posts', label: 'Number of Posts' },
      { id: 'avg_er_pct', label: 'Avg ER%' },
      { id: 'avg_reach', label: 'Avg Reach' },
      { id: 'engagement', label: 'Engagement' },
      { id: 'avg_engagements', label: 'Avg Engagements' },
    ],
  },
  {
    id: 'competitors', label: 'Competitors Comparison', desc: 'Compare with competitors',
    metrics: [
      { id: 'avg_engagements', label: 'Avg Engagements' },
      { id: 'engagements', label: 'Engagements' },
      { id: 'avg_er_reach', label: 'Avg ER Reach' },
      { id: 'avg_reach', label: 'Avg Reach' },
      { id: 'followers_growth', label: 'Followers Growth' },
      { id: 'followers_growth_pct', label: 'Followers Growth (%)' },
    ],
  },
] as const

export const WORDCLOUD_SENTIMENTS = [
  { id: 'all', label: 'All', desc: 'All sentiments combined' },
  { id: 'positive', label: 'Positive', desc: 'Positive sentiment words' },
  { id: 'negative', label: 'Negative', desc: 'Negative sentiment words' },
  { id: 'neutral', label: 'Neutral', desc: 'Neutral sentiment words' },
] as const

// id → display label across every metric source
export const METRIC_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = { sentiments: 'Sentiments' }
  LINE_METRICS.forEach(x => (m[x.id] = x.label))
  BAR_CATEGORIES.forEach(c => c.metrics.forEach(x => (m[x.id] = x.label)))
  return m
})()

/* ── dummy data ──────────────────────────────────────────────────────────── */

// stable pseudo-random in [0,1) from a string (so charts don't flicker on render)
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}
const seedVal = (seed: string, min = 35, max = 95) => min + Math.round(hash01(seed) * (max - min))

const monthShort = (offset: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return d.toLocaleString('en', { month: 'short' })
}

export function dimensionLabels(dim?: LineDimension): string[] {
  switch (dim) {
    case 'days': return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    case 'last3months': return [monthShort(-2), monthShort(-1), monthShort(0)]
    case 'daymonth':
    default: {
      const mo = monthShort(0)
      return [1, 6, 11, 16, 21, 26].map(d => `${d} ${mo}`)
    }
  }
}

export function barCategoryLabels(cat?: string): string[] {
  switch (cat) {
    case 'daily_performance': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    case 'last3months_performance': return [monthShort(-2), monthShort(-1), monthShort(0)]
    case 'content_pillars': return ['Educational', 'Promotional', 'Entertainment', 'UGC']
    case 'competitors': return ['Brand', 'Comp A', 'Comp B', 'Comp C']
    default: return ['A', 'B', 'C', 'D']
  }
}

export interface Series { name: string; color: string; data: number[] }

const SENTIMENT_COLORS: Record<string, string> = { Negative: '#ef4444', Neutral: '#94a3b8', Positive: '#22c55e' }

export function buildLineData(config: ChartConfig, colors: CoverColors): { labels: string[]; series: Series[] } {
  const labels = dimensionLabels(config.dimension)
  if (config.metrics?.includes('sentiments')) {
    return {
      labels,
      series: ['Negative', 'Neutral', 'Positive'].map(name => ({
        name, color: SENTIMENT_COLORS[name],
        data: labels.map((_, i) => seedVal(`${name}${i}`, name === 'Positive' ? 45 : 10, name === 'Positive' ? 75 : name === 'Neutral' ? 45 : 30)),
      })),
    }
  }
  const palette = [colors.primary, colors.accent, colors.secondary]
  return {
    labels,
    series: (config.metrics ?? []).map((id, idx) => ({
      name: METRIC_LABELS[id] ?? id, color: palette[idx % palette.length],
      data: labels.map((_, i) => seedVal(`${id}_${config.dimension}_${i}`)),
    })),
  }
}

export function buildBarData(config: ChartConfig, colors: CoverColors): { labels: string[]; series: Series[] } {
  const labels = barCategoryLabels(config.barCategory)
  const palette = [colors.primary, colors.accent, colors.secondary, '#d96d6d']
  return {
    labels,
    series: (config.barMetrics ?? []).map((id, idx) => ({
      name: METRIC_LABELS[id] ?? id, color: palette[idx % palette.length],
      data: labels.map(lbl => seedVal(`${id}_${lbl}`)),
    })),
  }
}

export type Sentiment = 'positive' | 'neutral' | 'negative'
export interface CloudWord { word: string; sentiment: Sentiment }

// Sentiment-tagged keywords for the word cloud.
export const WORDCLOUD_DATA: CloudWord[] = [
  // positive
  { word: 'amazing', sentiment: 'positive' }, { word: 'love', sentiment: 'positive' }, { word: 'quality', sentiment: 'positive' },
  { word: 'recommend', sentiment: 'positive' }, { word: 'premium', sentiment: 'positive' }, { word: 'fast', sentiment: 'positive' },
  { word: 'fresh', sentiment: 'positive' }, { word: 'great', sentiment: 'positive' }, { word: 'beautiful', sentiment: 'positive' },
  { word: 'helpful', sentiment: 'positive' }, { word: 'reliable', sentiment: 'positive' }, { word: 'favorite', sentiment: 'positive' },
  // neutral
  { word: 'launch', sentiment: 'neutral' }, { word: 'new', sentiment: 'neutral' }, { word: 'design', sentiment: 'neutral' },
  { word: 'drop', sentiment: 'neutral' }, { word: 'reels', sentiment: 'neutral' }, { word: 'update', sentiment: 'neutral' },
  { word: 'price', sentiment: 'neutral' }, { word: 'size', sentiment: 'neutral' }, { word: 'shipping', sentiment: 'neutral' },
  { word: 'order', sentiment: 'neutral' }, { word: 'color', sentiment: 'neutral' }, { word: 'stock', sentiment: 'neutral' },
  // negative
  { word: 'slow', sentiment: 'negative' }, { word: 'expensive', sentiment: 'negative' }, { word: 'delay', sentiment: 'negative' },
  { word: 'issue', sentiment: 'negative' }, { word: 'confusing', sentiment: 'negative' }, { word: 'broken', sentiment: 'negative' },
  { word: 'late', sentiment: 'negative' }, { word: 'missing', sentiment: 'negative' },
]

// Sentiment → shade options (vary within a sentiment for variety).
export const SENTIMENT_PALETTES: Record<Sentiment, string[]> = {
  positive: ['#15803d', '#16a34a', '#22c55e'],
  neutral: ['#475569', '#64748b', '#94a3b8'],
  negative: ['#b91c1c', '#dc2626', '#ef4444'],
}

export function cloudWordsFor(sentiment?: string): CloudWord[] {
  return !sentiment || sentiment === 'all' ? WORDCLOUD_DATA : WORDCLOUD_DATA.filter(d => d.sentiment === sentiment)
}

export function chartSummary(c: ChartConfig): string {
  if (c.chartType === 'line') return (c.metrics ?? []).map(m => METRIC_LABELS[m] ?? m).join(' · ')
  if (c.chartType === 'bar') return (c.barMetrics ?? []).map(m => METRIC_LABELS[m] ?? m).join(' · ')
  return `Word cloud${c.sentiment && c.sentiment !== 'all' ? ` · ${c.sentiment}` : ''}`
}

export function chartIcon(c: ChartConfig): string {
  return c.chartType === 'bar' ? 'bar_chart' : c.chartType === 'wordcloud' ? 'bubble_chart' : 'show_chart'
}
