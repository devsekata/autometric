// KPI scorecard metrics — the FULL list from report_2's MetricSelectionModal.
// Values/deltas are deterministic (hash-seeded) instead of Math.random so the
// preview is stable and matches export.
import { groupInt } from './format'

export interface KpiMetric {
  key: string
  label: string
  icon: string
  value: string
  delta: number
  positiveIsGood: boolean
}

type Fmt = 'pct' | 'k500' | 'kfollow' | 'count' | 'time' | 'default'

// [key, label, material-icon, value-format] — mirrors report_2 exactly.
const RAW: [string, string, string, Fmt][] = [
  ['reach', 'Reach', 'ads_click', 'k500'],
  ['impressions', 'Impressions', 'visibility', 'k500'],
  ['followers', 'Total Followers', 'group', 'kfollow'],
  ['growth', 'Followers Growth', 'trending_up', 'pct'],
  ['engagement', 'Engagement', 'touch_app', 'default'],
  ['er', 'Engagement Rate', 'bar_chart', 'pct'],
  ['likes', 'Likes', 'favorite', 'count'],
  ['comments', 'Comments', 'chat_bubble', 'count'],
  ['saves', 'Saves', 'bookmark', 'count'],
  ['shares', 'Shares', 'send', 'count'],
  ['reposts', 'Reposts', 'repeat', 'count'],
  ['views', 'Video Views', 'play_circle', 'k500'],
  ['story_views', 'Story Views', 'play_circle', 'k500'],
  ['story_reach', 'Story Reach', 'amp_stories', 'k500'],
  ['visits', 'Profile Visits', 'person', 'default'],
  ['clicks', 'Website Clicks', 'mouse', 'default'],
  ['watch_time', 'Avg. Watch Time', 'schedule', 'time'],
  ['total_interactions', 'Total Interactions', 'thumb_up', 'count'],
  ['new_followers', 'New Followers', 'person_add', 'kfollow'],
]

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}

function valueFor(key: string, fmt: Fmt): string {
  const r = hash01(key)
  switch (fmt) {
    case 'pct': return (r * 5 + 1).toFixed(2) + '%'
    case 'k500': return groupInt((Math.floor(r * 500) + 100) * 1000)   // hundreds of thousands
    case 'kfollow': return groupInt((Math.floor(r * 100) + 10) * 1000) // tens of thousands
    case 'count': return groupInt(Math.floor(r * 10000) + 500)
    case 'time': return (r * 50 + 5).toFixed(1) + 's'
    default: return groupInt(Math.floor(r * 5000) + 500)
  }
}

function deltaFor(key: string): number {
  const mag = Number((hash01(key + '_d') * 20 + 1).toFixed(1))
  return hash01(key + '_s') > 0.4 ? mag : -mag
}

export const KPI_METRICS: KpiMetric[] = RAW.map(([key, label, icon, fmt]) => ({
  key, label, icon, value: valueFor(key, fmt), delta: deltaFor(key), positiveIsGood: true,
}))

export const getKpiMetric = (key: string | null): KpiMetric | undefined =>
  key ? KPI_METRICS.find(m => m.key === key) : undefined

/** True when the delta should read as "good" (green) given the metric's polarity. */
export const deltaIsGood = (m: KpiMetric) => (m.delta >= 0) === m.positiveIsGood
