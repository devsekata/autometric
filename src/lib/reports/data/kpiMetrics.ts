// KPI scorecard metrics. Definitions (key/label/icon/format + per-platform
// availability + aggregation kind) drive the real DB values via kpiQuery.ts.
// No dummy fallback — a metric with no data for the brand+period renders "—".
import type { DashPlatform } from '@/components/dashboard/data'
import { groupInt } from './format'

export type KpiFmt = 'pct' | 'k500' | 'kfollow' | 'count' | 'time' | 'default'
export type KpiKind = 'sum' | 'last' | 'ratio' | 'avg'

export interface KpiMetric {
  key: string
  label: string
  icon: string
  value: string
  delta: number
  positiveIsGood: boolean
  hasDelta?: boolean // false → no comparable previous period (hide the trend badge)
}

export interface KpiDef {
  key: string
  label: string
  icon: string
  format: KpiFmt
  kind: KpiKind
  channels?: DashPlatform[] // omitted = available on every channel
}

// [key, label, material-icon, format, kind, channels?] — channels reflect where
// the metric actually carries data in the medallion (see docs / kpiQuery).
const RAW: [string, string, string, KpiFmt, KpiKind, DashPlatform[]?][] = [
  ['reach', 'Reach', 'ads_click', 'k500', 'sum'],
  ['impressions', 'Impressions', 'visibility', 'k500', 'sum', ['facebook']],
  ['followers', 'Total Followers', 'group', 'kfollow', 'last'],
  ['growth', 'Followers Growth', 'trending_up', 'default', 'sum'],
  ['engagement', 'Engagement', 'touch_app', 'default', 'sum'],
  ['er', 'Engagement Rate', 'bar_chart', 'pct', 'ratio'],
  ['likes', 'Likes', 'favorite', 'count', 'sum'],
  ['comments', 'Comments', 'chat_bubble', 'count', 'sum'],
  ['saves', 'Saves', 'bookmark', 'count', 'sum', ['instagram']],
  ['shares', 'Shares', 'send', 'count', 'sum'],
  ['reposts', 'Reposts', 'repeat', 'count', 'sum', ['instagram']],
  ['views', 'Video Views', 'play_circle', 'k500', 'sum'],
  ['story_views', 'Story Views', 'play_circle', 'k500', 'sum', ['instagram']],
  ['story_reach', 'Story Reach', 'amp_stories', 'k500', 'sum', ['instagram']],
  ['visits', 'Profile Visits', 'person', 'default', 'sum'],
  ['clicks', 'Website Clicks', 'mouse', 'default', 'sum', ['instagram', 'facebook']],
  ['watch_time', 'Avg. Watch Time', 'schedule', 'time', 'avg', ['instagram', 'tiktok']],
  ['total_interactions', 'Total Interactions', 'thumb_up', 'count', 'sum'],
  ['new_followers', 'New Followers', 'person_add', 'kfollow', 'sum', ['facebook', 'tiktok']],
]

export const KPI_DEFS: KpiDef[] = RAW.map(([key, label, icon, format, kind, channels]) => ({ key, label, icon, format, kind, channels }))
export const KPI_DEF_BY_KEY: Record<string, KpiDef> = Object.fromEntries(KPI_DEFS.map(d => [d.key, d]))

/** Metric value for one period pair: current vs previous. */
export interface KpiPair { curr: number | null; prev: number | null }
/** Real KPI values per platform, keyed by metric key. */
export type ReportKpiMetrics = Partial<Record<DashPlatform, Record<string, KpiPair>>>

/** KPI defs available on a channel (per-platform metric mapping). */
export function kpiDefsForChannel(channel: string): KpiDef[] {
  return KPI_DEFS.filter(d => !d.channels || d.channels.includes(channel as DashPlatform))
}

export const kpiPairFor = (m: ReportKpiMetrics | null | undefined, channel: string, key: string): KpiPair | null =>
  m?.[channel as DashPlatform]?.[key] ?? null

function fmtVal(format: KpiFmt, v: number): string {
  if (format === 'pct') return (Math.round(v * 100) / 100) + '%'
  if (format === 'time') return (Math.round(v * 10) / 10) + 's'
  return groupInt(v) // counts / followers / reach → full numbers with dot separators
}
const round1 = (n: number) => Math.round(n * 10) / 10

/** Build a scorecard metric from a real DB pair (null current → "—", no delta). */
export function buildKpiMetric(def: KpiDef, pair: KpiPair | null): KpiMetric {
  const curr = pair?.curr ?? null
  const prev = pair?.prev ?? null
  const value = curr == null ? '—' : fmtVal(def.format, curr)
  const hasDelta = curr != null && prev != null && prev !== 0
  const delta = hasDelta ? round1(((curr - prev) / prev) * 100) : 0
  return { key: def.key, label: def.label, icon: def.icon, value, delta, positiveIsGood: true, hasDelta }
}

/** Real scorecard metric for a channel + key (undefined when the def is unknown). */
export function kpiMetricFor(metrics: ReportKpiMetrics | null | undefined, channel: string, key: string | null): KpiMetric | undefined {
  if (!key) return undefined
  const def = KPI_DEF_BY_KEY[key]
  return def ? buildKpiMetric(def, kpiPairFor(metrics, channel, key)) : undefined
}

/** True when the delta should read as "good" (green) given the metric's polarity. */
export const deltaIsGood = (m: KpiMetric) => (m.delta >= 0) === m.positiveIsGood
