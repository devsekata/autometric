// Types + pure helpers for the report line chart's REAL data (client-safe — no
// server imports, mirroring how tableTypes.ts pairs with the server metricsQuery).
//
// The payload carries, per channel + per metric, the values for all three line
// dimensions (Day Month / Last 3 Months / Daily-by-weekday) so the chart can
// switch dimension without refetching — exactly like the table's ReportTableMetrics.
import type { DashPlatform } from '@/components/dashboard/data'

/** Line metrics wired to the DB (sentiments excluded — no pipeline yet). */
export const CHART_METRIC_IDS = [
  'followers', 'profile_views', 'profile_reach', 'net_followers_growth',
  'engagements', 'likes', 'comments', 'shares',
] as const
export type ChartMetricId = (typeof CHART_METRIC_IDS)[number]

/** Values for one metric across the three dimensions (aligned to the labels below). */
export interface ChartDimSeries {
  daymonth: number[]      // one point per day of the report month (index 0 = day 1)
  last3months: number[]   // [month-2, month-1, month]
  days: number[]          // [Sun … Sat] — average per weekday within the report month
}
/** Present metrics for one channel, keyed by metric id (absent = no data → empty state). */
export type ChannelChartMetrics = Partial<Record<ChartMetricId, ChartDimSeries>>

/* ── sentiment (comment-based) ──────────────────────────────────────────────── */

export type SentimentKey = 'positive' | 'neutral' | 'negative'

/**
 * Sentiment line series for one channel: daily comment counts per sentiment,
 * carried across all three line dimensions (same shape as ChartDimSeries) so the
 * chart can switch dimension without refetching. Source: l2_gold.comment_sentiment_daily.
 */
export type ChannelSentiment = Record<SentimentKey, ChartDimSeries>

/* ── word cloud (comment-based) ─────────────────────────────────────────────── */

/** One cloud word: dominant sentiment (from its source posts) + total frequency. */
export interface CloudWordData { word: string; sentiment: SentimentKey; frequency: number }
/** Present word-cloud words for one channel (empty/absent = no data → empty state). */
export type ChannelWords = CloudWordData[]

export interface ChartMeta {
  year: number
  month: number             // 1-based
  daysInMonth: number
  dayLabels: string[]       // ['1' … 'N'] for Day Month
  monthLabels: string[]     // 3 short month names for Last 3 Months
}

/* ── bar chart ────────────────────────────────────────────────────────────── */

/** Bar categories wired to the DB (competitors excluded — only in l0_raw). */
export const BAR_CATEGORY_IDS = ['daily_performance', 'last3months_performance', 'content_pillars'] as const
export type BarCategoryId = (typeof BAR_CATEGORY_IDS)[number]

/** One bar category's grouped data: category labels + each metric's value per label. */
export interface BarCategoryData {
  labels: string[]                          // x-axis groups (weekdays / months / pillar names)
  metrics: Partial<Record<string, number[]>> // metricId → value aligned to labels (absent = no data)
}
/** Present bar categories for one channel, keyed by category id. */
export type ChannelBarMetrics = Partial<Record<BarCategoryId, BarCategoryData>>

/** Full report chart payload: line series + bar categories + sentiment + words + period meta. */
export interface ReportChartMetrics {
  meta: ChartMeta
  channels: Partial<Record<DashPlatform, ChannelChartMetrics>>   // line series
  bars: Partial<Record<DashPlatform, ChannelBarMetrics>>         // bar categories
  sentiment: Partial<Record<DashPlatform, ChannelSentiment>>     // sentiment line (3 series)
  words: Partial<Record<DashPlatform, ChannelWords>>             // word cloud
}

/** Sentiment series values for a channel + sentiment + dimension, or null when unavailable. */
export function sentimentSeriesFor(
  metrics: ReportChartMetrics | null | undefined,
  channel: string,
  sentiment: SentimentKey,
  dim: string | undefined,
): number[] | null {
  const entry = metrics?.sentiment?.[channel as DashPlatform]?.[sentiment]
  if (!entry) return null
  return dim === 'days' ? entry.days : dim === 'last3months' ? entry.last3months : entry.daymonth
}

/** Word-cloud words for a channel, optionally filtered by sentiment ('all'/undefined = every word). */
export function cloudWordsFrom(
  metrics: ReportChartMetrics | null | undefined,
  channel: string,
  sentiment?: string,
): CloudWordData[] {
  const words = metrics?.words?.[channel as DashPlatform] ?? []
  return !sentiment || sentiment === 'all' ? words : words.filter(w => w.sentiment === sentiment)
}

/** A bar category's real data for a channel, or null when unavailable (→ empty state). */
export function barCategoryFor(
  metrics: ReportChartMetrics | null | undefined, channel: string, categoryId: string | undefined,
): BarCategoryData | null {
  const entry = metrics?.bars?.[channel as DashPlatform]?.[categoryId as BarCategoryId]
  return entry && entry.labels.length ? entry : null
}

/** Value axis fitted to bars — always includes the zero baseline (bars grow from 0). */
export function barScale(values: number[]): AxisScale {
  return niceScale([0, ...values.filter(v => Number.isFinite(v))])
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** X-axis labels for a dimension, from the payload meta (falls back gracefully). */
export function dimensionLabelsFor(dim: string | undefined, meta: ChartMeta): string[] {
  if (dim === 'days') return WEEKDAY_LABELS
  if (dim === 'last3months') return meta.monthLabels
  return meta.dayLabels
}

/** The value array for a channel + metric + dimension, or null when unavailable. */
export function chartSeriesFor(
  metrics: ReportChartMetrics | null | undefined,
  channel: string,
  metricId: string,
  dim: string | undefined,
): number[] | null {
  const entry = metrics?.channels?.[channel as DashPlatform]?.[metricId as ChartMetricId]
  if (!entry) return null
  return dim === 'days' ? entry.days : dim === 'last3months' ? entry.last3months : entry.daymonth
}

/* ── axis scaling (shared by preview SVG + PPTX native axis) ─────────────────── */

export interface AxisScale { min: number; max: number; ticks: number[] }

// "Nice" number for axis rounding (1/2/5 × 10^n).
function niceNum(range: number, round: boolean): number {
  const r = range <= 0 ? 1 : range
  const exp = Math.floor(Math.log10(r))
  const f = r / Math.pow(10, exp)
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10)
  return nf * Math.pow(10, exp)
}

/**
 * A readable value axis fitted to the data (not forced to zero) so a "level"
 * metric like followers shows its variation, while flows still read naturally.
 * Ticks are returned top→bottom for direct rendering.
 */
export function niceScale(values: number[], tickCount = 4): AxisScale {
  const clean = values.filter(v => Number.isFinite(v))
  const lo = clean.length ? Math.min(...clean) : 0
  let hi = clean.length ? Math.max(...clean) : 1
  if (hi === lo) hi = lo + Math.abs(lo || 1) // pad a flat series so it has a range
  // Fit tightly to [lo, hi] (no forced zero baseline) so a "level" metric like
  // followers shows its variation on its own axis — the point of the dual axis.
  // Flows whose min is already near zero still start at ~0 via the nice floor.
  const step = niceNum(niceNum(hi - lo, false) / tickCount, true)
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = min; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return { min, max, ticks: ticks.reverse() }
}

/** Compact number for axis tick labels (1.2K / 3.4M). */
export function compactNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

