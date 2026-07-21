// Data-table types. Restructured (2026-07-02) around the ROBZ LAUNCH metrics
// mapping into two channel-scoped sections — Content Level Metric &
// Channel Level Metric — plus the retained Sentiments and Brand vs Competitor
// tables. Both metric tables compare Previous vs Current period (Gap %), and
// their columns are filtered by the slide's channel (metrics are per-platform).
// Values are REAL DB numbers (via metricsQuery); no data renders "—", never dummy.
import type { DashPlatform } from '@/components/dashboard/data'
import { groupInt } from './format'

export type TableFormat = 'compact' | 'number' | 'percent' | 'time'
export type TableRowType = 'comparison' | 'competitors' | 'sentiments' | 'generic'

// `channels` omitted = available on every channel; otherwise the metric only
// exists for the listed platforms (per the ROBZ LAUNCH mapping).
export interface TableColumn { id: string; label: string; format: TableFormat; channels?: DashPlatform[] }
export interface TableType {
  id: string
  label: string
  icon: string
  description: string
  rowType: TableRowType
  /** true = metric table whose columns are scoped to the slide channel (disabled on "all"). */
  channelScoped?: boolean
  columns: TableColumn[]
  /** core columns pre-checked when the type is picked (defaults to all when absent). */
  defaultColumns?: string[]
  /**
   * Columns used ONLY on the cross-channel "all" view. This layout follows the
   * Content/Channel Performance spec: each "SUM & AVERAGE" metric contributes a
   * SUM column plus an `Avg.` column, while "SUM Only" metrics contribute one.
   * When absent, "all" falls back to the channel-agnostic subset of `columns`.
   */
  allColumns?: TableColumn[]
  /** Pre-checked columns for the "all" view (defaults to allColumns when absent). */
  allDefaultColumns?: string[]
  /** true = not selectable (greyed out) — e.g. competitor data isn't wired into reports. */
  disabled?: boolean
}

/** A configured table on a slide. `competitorIds` applies to the competitors
 *  table only — the chosen competitor social_account_ids (undefined = all). */
export interface TableConfig { type: string; columns: string[]; competitorIds?: string[] }

/** Real metric value for a comparison table: previous vs current period. */
export interface MetricPair { prev: number | null; curr: number | null }
/** Real values for one section+channel, keyed by table column id. */
export type SectionMetrics = Record<string, MetricPair>
/** Sentiments table: posts per dominant sentiment + share (per channel). */
export interface SentimentTableCell { number_of_posts: number; percentage: number }
export type SentimentTable = Record<'positive' | 'neutral' | 'negative', SentimentTableCell>
/** Table channel key: a specific platform, or 'all' (cross-channel aggregate). */
export type TableChannel = DashPlatform | 'all'
/**
 * One row of the Brand vs Competitor table: the brand itself or a competitor.
 * `values` is keyed by the brand_vs_competitor column id (null → renders "—",
 * e.g. reach columns which public competitor scraping never provides).
 */
export interface CompetitorEntity {
  id: string      // 'brand' for the brand row, else the competitor's social_account_id
  label: string   // brand name, or '@username'
  values: Record<string, number | null>
}
/** Competitor comparison for one platform: the brand + every competitor with a row. */
export interface CompetitorSection {
  brand: CompetitorEntity
  competitors: CompetitorEntity[]  // all of the brand's competitors on this platform
}

/** One org custom-metric column: id + display label + value format. Its per-channel
 *  values live in the content/channel SectionMetrics (keyed by this id). */
export interface CustomMetricColumn { id: string; label: string; format: TableFormat }

/** Full report metrics payload: content + channel level + sentiment + competitor. */
export interface ReportTableMetrics {
  content: Partial<Record<TableChannel, SectionMetrics>>   // per channel + 'all'
  channel: Partial<Record<TableChannel, SectionMetrics>>   // per channel + 'all'
  sentiment?: Partial<Record<DashPlatform, SentimentTable>>   // per channel (comment_sentiment_post by dominant sentiment)
  competitors?: Partial<Record<DashPlatform, CompetitorSection>>  // per channel (l2_gold.competitor_*)
  customMetrics?: CustomMetricColumn[]   // org custom metrics (selectable columns)
}

/** Org custom metrics as TableColumns (for buildTable + the column picker). */
export function customColumnsFrom(metrics: ReportTableMetrics | null | undefined): TableColumn[] {
  return (metrics?.customMetrics ?? []).map(c => ({ id: c.id, label: c.label, format: c.format }))
}

export const TABLE_TYPES: Record<string, TableType> = {
  content_level: {
    id: 'content_level', label: 'Content Level Metric', icon: 'dynamic_feed',
    description: 'Per-post metrics — this period vs last.', rowType: 'comparison', channelScoped: true,
    defaultColumns: ['reach', 'likes', 'comments', 'shares', 'eng_owned', 'er_reach'],
    // Cross-channel "all" view (Content Performance spec). Count metrics carry a SUM
    // column (period total) + an Avg. column (per post); ER carries a pooled SUM
    // column (Σengagement ÷ Σdenominator) + a mean Avg. column (avg per-post ER).
    // "New Follow from Content" is SUM only.
    allColumns: [
      { id: 'new_follow_content', label: 'New Follow from Content', format: 'number' },
      { id: 'reach', label: 'Reach', format: 'compact' },
      { id: 'avg_reach', label: 'Avg. Reach', format: 'compact' },
      { id: 'impressions_views', label: 'Impressions/Views', format: 'compact' },
      { id: 'avg_impressions_views', label: 'Avg. Impressions/Views', format: 'compact' },
      { id: 'likes', label: 'Likes', format: 'number' },
      { id: 'avg_likes', label: 'Avg. Likes', format: 'number' },
      { id: 'comments', label: 'Comments', format: 'number' },
      { id: 'avg_comments', label: 'Avg. Comments', format: 'number' },
      { id: 'shares', label: 'Shares', format: 'number' },
      { id: 'avg_shares', label: 'Avg. Shares', format: 'number' },
      { id: 'saved', label: 'Saved', format: 'number' },
      { id: 'avg_saved', label: 'Avg. Saved', format: 'number' },
      { id: 'reposts', label: 'Reposts', format: 'number' },
      { id: 'avg_reposts', label: 'Avg. Reposts', format: 'number' },
      { id: 'eng_owned', label: 'Engagement', format: 'compact' },
      { id: 'avg_eng_owned', label: 'Avg. Engagement', format: 'compact' },
      { id: 'er_reach_pooled', label: 'ER Reach', format: 'percent' },
      { id: 'er_reach', label: 'Avg. ER Reach', format: 'percent' },
      { id: 'er_views_pooled', label: 'ER Views', format: 'percent' },
      { id: 'er_views', label: 'Avg. ER Views', format: 'percent' },
      { id: 'er_followers_pooled', label: 'ER Followers', format: 'percent' },
      { id: 'er_followers', label: 'Avg. ER Followers', format: 'percent' },
    ],
    // Default = the 12 spec metrics as their primary (SUM / pooled) column; the
    // Avg. columns stay available in the picker (kept off by default to keep the
    // all-channel table readable).
    allDefaultColumns: [
      'new_follow_content', 'reach', 'impressions_views', 'likes', 'comments', 'shares',
      'saved', 'reposts', 'eng_owned', 'er_reach_pooled', 'er_views_pooled', 'er_followers_pooled',
    ],
    columns: [
      { id: 'likes', label: 'Likes', format: 'number' },
      { id: 'comments', label: 'Comments', format: 'number' },
      { id: 'shares', label: 'Shares', format: 'number' },
      { id: 'saved', label: 'Saved', format: 'number', channels: ['instagram', 'tiktok'] },
      { id: 'reposts', label: 'Reposts', format: 'number', channels: ['instagram'] },
      { id: 'eng_owned', label: 'Engagement Owned', format: 'compact' },
      { id: 'eng_public', label: 'Engagement Public', format: 'compact' },
      { id: 'er_reach', label: 'ER Reach', format: 'percent' },
      { id: 'er_views', label: 'ER Views', format: 'percent', channels: ['instagram', 'tiktok'] },
      { id: 'er_impressions', label: 'ER Impressions', format: 'percent', channels: ['facebook'] },
      { id: 'er_followers', label: 'ER Followers', format: 'percent' },
      { id: 'reach', label: 'Reach', format: 'compact' },
      { id: 'views', label: 'Views', format: 'compact', channels: ['instagram'] },
      { id: 'impressions', label: 'Impressions', format: 'compact', channels: ['tiktok', 'facebook'] },
      { id: 'video_views', label: 'Video Views', format: 'compact', channels: ['facebook'] },
      { id: 'reels_skip_rate', label: 'Reels Skip Rate', format: 'percent', channels: ['instagram'] },
      { id: 'video_watch_time', label: 'Video Avg. Watch Time', format: 'time' },
      { id: 'post_view_time', label: 'Post Avg. View Time', format: 'time', channels: ['tiktok'] },
      { id: 'post_completion', label: 'Post Completion Rate', format: 'percent', channels: ['tiktok'] },
      { id: 'new_follow_content', label: 'New Follow from Content', format: 'number', channels: ['instagram', 'tiktok'] },
    ],
  },
  channel_level: {
    id: 'channel_level', label: 'Channel Level Metric', icon: 'insights',
    description: 'Profile-wide metrics — this period vs last.', rowType: 'comparison', channelScoped: true,
    defaultColumns: ['total_followers', 'followers_net_growth', 'profile_views', 'total_posts', 'avg_eng_owned', 'avg_er_reach'],
    // Cross-channel "all" view (Channel Performance spec). Daily profile aggregates:
    // SUM column (period total) + Avg. column (per day). Followers & Total Post are
    // SUM only. "Profile Views" has no distinct gold source → renders "—".
    allColumns: [
      { id: 'total_followers', label: 'Followers', format: 'compact' },
      { id: 'followers_net_growth', label: 'Followers Nett Growth', format: 'number' },
      { id: 'avg_followers_net_growth', label: 'Avg. Followers Nett Growth', format: 'number' },
      { id: 'new_follows', label: 'New Follow', format: 'number' },
      { id: 'avg_new_follows', label: 'Avg. New Follow', format: 'number' },
      { id: 'unfollows', label: 'Unfollows', format: 'number' },
      { id: 'avg_unfollows', label: 'Avg. Unfollows', format: 'number' },
      { id: 'profile_reach', label: 'Profile Reach', format: 'compact' },
      { id: 'avg_profile_reach', label: 'Avg. Profile Reach', format: 'compact' },
      { id: 'profile_views', label: 'Profile Views', format: 'number' },
      { id: 'avg_profile_views', label: 'Avg. Profile Views', format: 'number' },
      { id: 'profile_visit', label: 'Profile Visit', format: 'number' },
      { id: 'avg_profile_visit', label: 'Avg. Profile Visit', format: 'number' },
      { id: 'total_posts', label: 'Total Post', format: 'number' },
    ],
    allDefaultColumns: [
      'total_followers', 'followers_net_growth', 'new_follows', 'unfollows',
      'profile_reach', 'profile_views', 'profile_visit', 'total_posts',
    ],
    columns: [
      { id: 'total_followers', label: 'Total Followers', format: 'compact' },
      { id: 'followers_net_growth', label: 'Followers Net Growth', format: 'number' },
      { id: 'new_follows', label: 'New Follows', format: 'number' },
      { id: 'unfollows', label: 'Unfollows', format: 'number' },
      { id: 'profile_views', label: 'Profile Views', format: 'number' },
      { id: 'profile_reach', label: 'Profile Reach', format: 'compact' },
      { id: 'avg_er_reach', label: 'Avg. ER Reach', format: 'percent' },
      { id: 'avg_er_views', label: 'Avg. ER Views', format: 'percent', channels: ['instagram', 'tiktok'] },
      { id: 'avg_er_impressions', label: 'Avg. ER Impressions', format: 'percent', channels: ['facebook'] },
      { id: 'avg_er_followers', label: 'Avg. ER Followers', format: 'percent' },
      { id: 'total_posts', label: 'Total Posts', format: 'number' },
      { id: 'avg_likes', label: 'Avg. Likes', format: 'number' },
      { id: 'avg_comments', label: 'Avg. Comments', format: 'number' },
      { id: 'avg_shares', label: 'Avg. Shares', format: 'number' },
      { id: 'avg_saved', label: 'Avg. Saved', format: 'number', channels: ['instagram', 'tiktok'] },
      { id: 'avg_reposts', label: 'Avg. Reposts', format: 'number', channels: ['instagram'] },
      { id: 'avg_eng_owned', label: 'Avg. Engagement Owned', format: 'compact' },
      { id: 'avg_eng_public', label: 'Avg. Engagement Public', format: 'compact' },
      { id: 'avg_reach', label: 'Avg. Reach', format: 'compact' },
      { id: 'avg_views', label: 'Avg. Views', format: 'compact', channels: ['instagram'] },
      { id: 'avg_impressions', label: 'Avg. Impressions', format: 'compact', channels: ['tiktok', 'facebook'] },
      { id: 'avg_video_views', label: 'Avg. Video Views', format: 'compact', channels: ['facebook'] },
    ],
  },
  brand_vs_competitor: {
    id: 'brand_vs_competitor', label: 'Brand vs Competitor', icon: 'group',
    description: 'Compare brand performance against competitors.', rowType: 'competitors', channelScoped: true,
    columns: [
      { id: 'followers_growth', label: 'Followers Growth', format: 'compact' },
      { id: 'followers_growth_pct', label: 'Followers Growth %', format: 'percent' },
      { id: 'post_count', label: 'Post Count', format: 'number' },
      { id: 'engagement', label: 'Engagement', format: 'compact' },
      { id: 'er_followers', label: 'ER Followers (%)', format: 'percent' },
      { id: 'post_reach', label: 'Post Reach', format: 'compact' },
      { id: 'profile_reach', label: 'Profile Reach', format: 'compact' },
    ],
  },
  sentiments: {
    id: 'sentiments', label: 'Sentiments', icon: 'favorite',
    description: 'Sentiment analysis breakdown.', rowType: 'sentiments',
    columns: [
      { id: 'number_of_posts', label: 'Number of Posts', format: 'number' },
      { id: 'percentage', label: 'Percentage (%)', format: 'percent' },
    ],
  },
}

const ROW_DEFS: Record<TableRowType, { id: string; label: string; isGap?: boolean }[]> = {
  comparison: [
    { id: 'prev', label: 'Previous Month' },
    { id: 'curr', label: 'Current Month' },
    { id: 'gap', label: 'Gap (%)', isGap: true },
  ],
  competitors: [
    { id: 'brand', label: 'Brand' },
    { id: 'comp_a', label: 'Competitor A' },
    { id: 'comp_b', label: 'Competitor B' },
    { id: 'comp_c', label: 'Competitor C' },
  ],
  sentiments: [
    { id: 'positive', label: 'Positive' },
    { id: 'neutral', label: 'Neutral' },
    { id: 'negative', label: 'Negative' },
  ],
  generic: [
    { id: '1', label: 'Item 1' },
    { id: '2', label: 'Item 2' },
    { id: '3', label: 'Item 3' },
  ],
}

export function firstColHeader(rowType: TableRowType): string {
  return rowType === 'comparison' ? 'Period'
    : rowType === 'competitors' ? 'Brand'
    : rowType === 'sentiments' ? 'Sentiment'
    : 'Category'
}

/**
 * The Sentiments table breakdown for a slide's channel. A specific platform
 * returns that platform's posts-by-sentiment; "all" (or any non-platform) combines
 * every platform (percentages recomputed). Null when there's no data for the scope.
 */
export function sentimentTableFor(
  sentiment: Partial<Record<DashPlatform, SentimentTable>> | undefined,
  channel: string,
): SentimentTable | null {
  if (!sentiment) return null
  if (channel === 'instagram' || channel === 'facebook' || channel === 'tiktok') {
    return sentiment[channel] ?? null
  }
  const acc = { positive: 0, neutral: 0, negative: 0 }
  let any = false
  for (const t of Object.values(sentiment)) {
    if (!t) continue
    any = true
    acc.positive += t.positive.number_of_posts
    acc.neutral += t.neutral.number_of_posts
    acc.negative += t.negative.number_of_posts
  }
  const total = acc.positive + acc.neutral + acc.negative
  if (!any || total === 0) return null
  const pct = (n: number) => (n / total) * 100
  return {
    positive: { number_of_posts: acc.positive, percentage: pct(acc.positive) },
    neutral: { number_of_posts: acc.neutral, percentage: pct(acc.neutral) },
    negative: { number_of_posts: acc.negative, percentage: pct(acc.negative) },
  }
}

/** A column shows on a channel when it has no `channels` restriction or lists it. */
export function isColumnOnChannel(col: TableColumn, channel: string): boolean {
  return !col.channels || col.channels.includes(channel as DashPlatform)
}

/** Columns of a type available for the given slide channel. On "all", a
 *  channel-scoped type uses its `allColumns` layout when defined (Content/Channel
 *  Performance spec), else the channel-agnostic subset of `columns`. */
export function columnsForChannel(typeId: string, channel: string): TableColumn[] {
  const def = TABLE_TYPES[typeId]
  if (!def) return []
  if (!def.channelScoped) return def.columns
  if (channel === 'all') return def.allColumns ?? def.columns.filter(c => isColumnOnChannel(c, 'all'))
  return def.columns.filter(c => isColumnOnChannel(c, channel))
}

/** Pre-checked columns for a type on a channel (core set, kept to what's available). */
export function defaultColumnsFor(typeId: string, channel: string): string[] {
  const avail = columnsForChannel(typeId, channel)
  const def = TABLE_TYPES[typeId]
  const base = (channel === 'all' && def?.allColumns ? def.allDefaultColumns : def?.defaultColumns) ?? avail.map(c => c.id)
  const filtered = base.filter(id => avail.some(c => c.id === id))
  return filtered.length ? filtered : avail.map(c => c.id)
}

/**
 * Every table type is available on any channel, including "all" — content/channel
 * level now carry a cross-channel aggregate (summed counts, recomputed rates), and
 * on "all" only the channel-agnostic columns are shown (see columnsForChannel).
 */
export function isTypeEnabledForChannel(typeId: string, channel: string): boolean {
  if (!(typeId in TABLE_TYPES) || channel === '') return false
  // The Brand-vs-Competitor table is inherently per-platform (a competitor lives on
  // one channel), so it's only available on a specific platform — not on "all".
  if (typeId === 'brand_vs_competitor') {
    return channel === 'instagram' || channel === 'facebook' || channel === 'tiktok'
  }
  return true
}

// Real DB values: percent keeps up to 2 decimals; time is already in seconds
// (metricsQuery normalizes avg_watch_time to seconds), shown to 1 decimal.
function fmtReal(format: TableFormat, val: number): string {
  if (format === 'percent') return (Math.round(val * 100) / 100) + '%'
  if (format === 'time') return (Math.round(val * 10) / 10) + 's'
  return groupInt(val)
}

export interface TableCell { text: string; gap?: boolean; positive?: boolean }
export interface TableRow { id: string; label: string; isGap?: boolean; cells: Record<string, TableCell> }

// Real cell from DB metrics. Null values (missing/ambiguous data) render "—".
function realCell(rowId: string, col: TableColumn, mv: MetricPair | undefined): TableCell {
  const prev = mv?.prev ?? null
  const curr = mv?.curr ?? null
  if (rowId === 'gap') {
    if (prev != null && curr != null && prev !== 0) {
      const g = ((curr - prev) / prev) * 100
      return { text: Math.abs(g).toFixed(1) + '%', gap: true, positive: g >= 0 }
    }
    return { text: '—' } // no data → neutral dash (no gap coloring)
  }
  const v = rowId === 'prev' ? prev : curr
  return { text: v == null ? '—' : fmtReal(col.format, v) }
}

// Real cell for the Sentiments table (row = sentiment, col = posts / percentage).
function sentimentCell(rowId: string, col: TableColumn, s: SentimentTable): TableCell {
  const row = s[rowId as keyof SentimentTable]
  if (!row) return { text: '—' }
  if (col.id === 'number_of_posts') return { text: fmtReal('number', row.number_of_posts) }
  if (col.id === 'percentage') return { text: fmtReal('percent', row.percentage) }
  return { text: '—' }
}

// Real cell for a Brand-vs-Competitor row (value keyed by column id; null → "—").
function competitorCell(entity: CompetitorEntity, col: TableColumn): TableCell {
  const v = entity.values[col.id]
  return { text: v == null ? '—' : fmtReal(col.format, v) }
}

/**
 * Build table rows. Real DB values for a comparison table (content_level /
 * channel_level) when `metrics` is supplied, for the sentiments table when
 * `sentiment` is supplied, and for the Brand-vs-Competitor table when
 * `competitors` is supplied — null values render "—". Without a real source
 * (or while data loads) rows render "—" too: no seeded numbers.
 */
export function buildTable(
  config: TableConfig,
  availableColumns: TableColumn[],
  metrics?: SectionMetrics | null,
  sentiment?: SentimentTable | null,
  competitors?: CompetitorSection | null,
  customCols: TableColumn[] = [],
): { header: string; columns: TableColumn[]; rows: TableRow[] } {
  const def = TABLE_TYPES[config.type] ?? TABLE_TYPES.content_level
  // Custom metrics attach to the comparison metric tables only (content/channel level).
  const extra = def.rowType === 'comparison' ? customCols.filter(c => config.columns.includes(c.id)) : []
  // Universe = the columns available for this table on the slide's channel (per-channel
  // columns, or the all-channel Content/Channel Performance layout on "all"). Order
  // follows the universe so the all-channel SUM/AVG pairs stay in spec order.
  const columns = [...availableColumns.filter(c => config.columns.includes(c.id)), ...extra]

  // Competitor table: dynamic rows (Brand + chosen competitors by @username).
  // config.competitorIds picks which competitors show (undefined = all). While
  // data loads (competitors == null) fall back to placeholder rows of "—".
  if (def.rowType === 'competitors') {
    let rows: TableRow[]
    if (competitors) {
      const sel = config.competitorIds
      const chosen = sel
        ? competitors.competitors.filter(c => sel.includes(c.id))
        : competitors.competitors
      const entities = [competitors.brand, ...chosen]
      rows = entities.map(e => {
        const cells: Record<string, TableCell> = {}
        columns.forEach(col => { cells[col.id] = competitorCell(e, col) })
        return { id: e.id, label: e.label, cells }
      })
    } else {
      rows = ROW_DEFS.competitors.map(r => {
        const cells: Record<string, TableCell> = {}
        columns.forEach(col => { cells[col.id] = { text: '—' } })
        return { id: r.id, label: r.label, cells }
      })
    }
    return { header: firstColHeader('competitors'), columns, rows }
  }

  const useReal = def.rowType === 'comparison' && metrics != null
  const useSent = def.rowType === 'sentiments' && sentiment != null
  const rows: TableRow[] = ROW_DEFS[def.rowType].map(r => {
    const cells: Record<string, TableCell> = {}
    columns.forEach(col => {
      cells[col.id] = useReal ? realCell(r.id, col, metrics![col.id])
        : useSent ? sentimentCell(r.id, col, sentiment!)
        : { text: '—' }
    })
    return { id: r.id, label: r.label, isGap: r.isGap, cells }
  })
  return { header: firstColHeader(def.rowType), columns, rows }
}
