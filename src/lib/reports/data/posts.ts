// Post data for the Visual Analysis slide. Live-only: values come from
// l1_silver.unified_post (via ReportPostContext / postsQuery). No sample/dummy
// fallback — when there is no live pool the slide shows a loading / empty state.
import { groupInt } from './format'

// Ordered by the Content Performance categories (Acquisition → Awareness →
// Engagement → Efficiency). "Impressions/Views" is one combined metric (Facebook
// = impressions, Instagram/TikTok = views). ER is split into Reach/Views/Followers.
// All of them are always offered as options; ones with no data render as 0.
export const POST_METRICS: { id: string; label: string }[] = [
  { id: 'new_follow', label: 'New Follow' },
  { id: 'reach', label: 'Reach' },
  { id: 'impressions_views', label: 'Impressions/Views' },
  { id: 'likes', label: 'Likes' },
  { id: 'comments', label: 'Comments' },
  { id: 'shares', label: 'Shares' },
  { id: 'saves', label: 'Saved' },
  { id: 'reposts', label: 'Reposts' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'er_reach', label: 'ER Reach' },
  { id: 'er_views', label: 'ER Views' },
  { id: 'er_followers', label: 'ER Followers' },
]

// ER metrics render as percentages (and get the ER highlight color in the card).
const ER_METRIC_IDS = new Set(['er_reach', 'er_views', 'er_followers'])
export const isErMetric = (id: string) => ER_METRIC_IDS.has(id)

export const POST_FILTERS: { id: string; label: string }[] = [
  { id: 'top', label: 'Top performing' },
  { id: 'low', label: 'Low performing' },
  { id: 'mixed', label: 'Top & low (mixed)' },
]

export const POST_COUNTS = [4, 6, 8]

export interface PostRow {
  id: number
  tag?: 'TOP' | 'LOW'
  image: string
  format: string   // display label, e.g. 'Reel'
  pillar: string   // display label, e.g. 'Awareness'
  metrics: Record<string, string>   // display-formatted per POST_METRICS id
}

// A candidate post carrying numeric metric values, fetched from
// l1_silver.unified_post. buildPosts filters/ranks/slices these into PostRow.
export interface PostCandidate {
  id: number
  image: string | null
  formatId: string; format: string
  pillarId: string; pillar: string
  values: Record<string, number>   // numeric per POST_METRICS id (er_* are percent numbers)
}

// Live candidate pool for a report (brand + month), keyed by channel. Built by
// postsQuery.ts, provided through ReportPostContext, consumed by the Visual slide
// and the PPTX exporter.
export type ReportPostMetrics = Record<string, PostCandidate[]>

// Normalize the messy source `format` (photo/Motion/Static/reels/Reels-Tiktok/…)
// into the slide's filter buckets.
export function normFormat(raw?: string | null): { id: string; label: string } {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return { id: 'other', label: 'Other' }
  if (s.includes('reel')) return { id: 'reel', label: 'Reel' }
  if (s.includes('carousel')) return { id: 'carousel', label: 'Carousel' }
  if (s.includes('video') || s.includes('motion')) return { id: 'video', label: 'Video' }
  if (s.includes('photo') || s.includes('feed') || s.includes('static') || s.includes('image')) return { id: 'image', label: 'Image' }
  if (s.includes('link')) return { id: 'link', label: 'Link' }
  if (s.includes('story')) return { id: 'story', label: 'Story' }
  return { id: s, label: (raw ?? '').trim() }
}

// Content pillars are brand-specific free text → slug id + verbatim label.
export function normPillar(raw?: string | null): { id: string; label: string } {
  const t = (raw ?? '').trim()
  if (!t) return { id: 'none', label: 'No pillar' }
  return { id: t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), label: t }
}

const fmtValue = (id: string, v: number) => (isErMetric(id) ? v.toFixed(2) + '%' : groupInt(v))

export interface PostOptions {
  format?: string
  pillar?: string
  sortMetric?: string
  source?: PostCandidate[]   // live pool; empty/absent ⇒ no posts (no sample fallback)
}

// Filter (format + pillar) → rank by the chosen metric → apply top/low/mixed → slice.
// Returns [] when there is no live pool — the slide never shows fabricated posts.
export function buildPosts(count: number, filter: string, opts: PostOptions = {}): PostRow[] {
  const cands = opts.source ?? []
  if (!cands.length) return []
  const format = opts.format ?? 'all'
  const pillar = opts.pillar ?? 'all'
  const sortMetric = opts.sortMetric ?? 'engagement'

  let pool = cands
  if (format !== 'all') pool = pool.filter(p => p.formatId === format)
  if (pillar !== 'all') pool = pool.filter(p => p.pillarId === pillar)
  const key = (p: PostCandidate) => p.values[sortMetric] ?? 0
  const sorted = [...pool].sort((a, b) => key(b) - key(a))   // best → worst by chosen metric

  let picked: { cand: PostCandidate; tag?: 'TOP' | 'LOW' }[]
  if (filter === 'low') picked = [...sorted].reverse().slice(0, count).map(cand => ({ cand }))
  else if (filter === 'mixed') {
    const half = Math.ceil(count / 2)
    const top = sorted.slice(0, half)
    const bottom = sorted.slice(half).reverse().slice(0, count - half)   // worst first, no overlap with top
    picked = [
      ...top.map(cand => ({ cand, tag: 'TOP' as const })),
      ...bottom.map(cand => ({ cand, tag: 'LOW' as const })),
    ]
  } else picked = sorted.slice(0, count).map(cand => ({ cand }))

  return picked.map(({ cand, tag }, i) => {
    const metrics: Record<string, string> = {}
    POST_METRICS.forEach(m => { metrics[m.id] = fmtValue(m.id, cand.values[m.id] ?? 0) })
    return { id: i + 1, tag, image: cand.image ?? '', format: cand.format, pillar: cand.pillar, metrics }
  })
}

export const metricLabel = (id: string) => POST_METRICS.find(m => m.id === id)?.label ?? id

// ── metric availability ───────────────────────────────────────────────────────
// Every metric in POST_METRICS is always offered in the Visual slide pickers — a
// metric with no data on the channel still shows and renders as 0 / 0.00%, so the
// user can put it on the card deliberately. `populatedMetricsFor` reports which
// metrics actually carry data; it only drives defaults, never restricts choices.
export function populatedMetricsFor(source: PostCandidate[] | undefined): string[] {
  if (!source || !source.length) return []
  return POST_METRICS.filter(m => source.some(p => (p.values[m.id] ?? 0) > 0)).map(m => m.id)
}

const isKnownMetric = (id: string) => POST_METRICS.some(m => m.id === id)

// Ranking metric: an explicit pick is honoured as-is, even when it has no data on
// this channel. Only an unset (or retired) pick falls back to a populated metric.
export function effectiveSortMetric(metric: string | undefined, populated: string[]): string {
  if (metric && isKnownMetric(metric)) return metric
  if (populated.includes('engagement')) return 'engagement'
  return populated[0] ?? 'engagement'
}

// Which metrics show on the card — every pick is honoured, empty ones included.
// With nothing picked, default to the first few metrics that do carry data. Order
// ALWAYS follows the canonical POST_METRICS sequence (Acquisition → Awareness →
// Engagement → Efficiency), NOT the order the user clicked them.
export function effectiveShownMetrics(selected: string[], populated: string[]): string[] {
  const sel = new Set(selected)
  const shown = POST_METRICS.filter(m => sel.has(m.id)).map(m => m.id)
  return shown.length ? shown : populated.slice(0, 3)
}

// Distinct format/pillar ids present in a pool — the valid filter values.
export function availableFilterIds(source: PostCandidate[] | undefined, key: 'formatId' | 'pillarId'): string[] {
  if (!source || !source.length) return []
  return [...new Set(source.map(p => p[key]))]
}

// Resolve a saved format/pillar filter against a brand's actual data: keep it if
// the brand has that value, else fall back to 'all'. Lets a template's brand-
// specific filter apply cleanly to a different brand.
export function effectiveFilterId(selected: string | undefined, availableIds: string[]): string {
  const v = selected ?? 'all'
  return v === 'all' || availableIds.includes(v) ? v : 'all'
}
