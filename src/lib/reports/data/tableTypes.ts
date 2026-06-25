// Data-table types — replicated 1:1 from report_2's data/tableTypes.ts + the
// row/value logic in SmartTableBlock, so the table metrics match the example
// exactly. Values are DETERMINISTIC (seeded) instead of Math.random so the
// preview is stable and matches export.

export type TableFormat = 'compact' | 'number' | 'percent' | 'time'
export type TableRowType = 'comparison' | 'channels' | 'types' | 'competitors' | 'sentiments' | 'generic'

export interface TableColumn { id: string; label: string; format: TableFormat }
export interface TableType {
  id: string
  label: string
  icon: string
  description: string
  rowType: TableRowType
  columns: TableColumn[]
}

/** A configured table on a slide. */
export interface TableConfig { type: string; columns: string[] }

export const TABLE_TYPES: Record<string, TableType> = {
  performance: {
    id: 'performance', label: 'Performance Overview', icon: 'monitoring',
    description: 'Month-over-month comparison of key profile metrics.', rowType: 'comparison',
    columns: [
      { id: 'profile_reach', label: 'Profile Reach', format: 'compact' },
      { id: 'profile_visit', label: 'Profile Visit', format: 'number' },
      { id: 'growth', label: 'Followers Growth', format: 'number' },
      { id: 'reach', label: 'Reach', format: 'compact' },
      { id: 'engagement', label: 'Engagement', format: 'number' },
      { id: 'likes', label: 'Likes', format: 'number' },
      { id: 'comments', label: 'Comments', format: 'number' },
      { id: 'shares', label: 'Shares', format: 'number' },
      { id: 'saves', label: 'Saves', format: 'number' },
      { id: 'er_reach', label: 'ER Reach', format: 'percent' },
      { id: 'er_followers', label: 'ER Followers', format: 'percent' },
    ],
  },
  kpi: {
    id: 'kpi', label: 'Channel Overview', icon: 'task_alt',
    description: 'Cross-channel performance against goals.', rowType: 'channels',
    columns: [
      { id: 'followers', label: 'Followers', format: 'compact' },
      { id: 'ytd_growth', label: 'YTD Growth', format: 'percent' },
      { id: 'monthly_growth', label: 'MoM Growth', format: 'percent' },
      { id: 'channel_reach', label: 'Reach', format: 'compact' },
      { id: 'profile_visit', label: 'Profile Visit', format: 'number' },
      { id: 'total_eng', label: 'Total Eng.', format: 'compact' },
    ],
  },
  post_performance: {
    id: 'post_performance', label: 'Post Performance', icon: 'bar_chart',
    description: 'Content output and viewership trends.', rowType: 'comparison',
    columns: [
      { id: 'post_count', label: 'Post Count', format: 'number' },
      { id: 'reach', label: 'Reach', format: 'compact' },
      { id: 'engagement', label: 'Engagement', format: 'compact' },
      { id: 'views', label: 'Views', format: 'compact' },
      { id: 'watch_time', label: 'Avg Watch Time', format: 'time' },
    ],
  },
  post_type: {
    id: 'post_type', label: 'Post Type Performance', icon: 'image',
    description: 'Breakdown by format (Image, Reels, Carousel).', rowType: 'types',
    columns: [
      { id: 'post_count', label: 'Post Count', format: 'number' },
      { id: 'reach', label: 'Reach', format: 'compact' },
      { id: 'engagement', label: 'Engagement', format: 'compact' },
      { id: 'likes', label: 'Likes', format: 'number' },
      { id: 'comments', label: 'Comments', format: 'number' },
      { id: 'shares', label: 'Shares', format: 'number' },
      { id: 'saves', label: 'Saves', format: 'number' },
    ],
  },
  brand_vs_competitor: {
    id: 'brand_vs_competitor', label: 'Brand vs Competitor', icon: 'group',
    description: 'Compare brand performance against competitors.', rowType: 'competitors',
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
  custom: {
    id: 'custom', label: 'Custom Table', icon: 'tune',
    description: 'Build your own table.', rowType: 'generic',
    columns: [
      { id: 'metric_1', label: 'Metric 1', format: 'number' },
      { id: 'metric_2', label: 'Metric 2', format: 'percent' },
      { id: 'metric_3', label: 'Metric 3', format: 'compact' },
    ],
  },
}

const ROW_DEFS: Record<TableRowType, { id: string; label: string; isGap?: boolean }[]> = {
  comparison: [
    { id: 'prev', label: 'Previous Month' },
    { id: 'curr', label: 'Current Month' },
    { id: 'gap', label: 'Gap (%)', isGap: true },
  ],
  channels: [
    { id: 'ig', label: 'Instagram' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'fb', label: 'Facebook' },
  ],
  types: [
    { id: 'img', label: 'Image' },
    { id: 'reel', label: 'Reels' },
    { id: 'car', label: 'Carousel' },
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
    : rowType === 'channels' ? 'Channel'
    : rowType === 'competitors' ? 'Brand'
    : rowType === 'sentiments' ? 'Sentiment'
    : 'Category'
}

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}

function fmt(format: TableFormat, val: number): string {
  if (format === 'percent') return val + '%'
  if (format === 'compact') return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(val)
  if (format === 'time') return val + 's'
  return val.toLocaleString()
}

export interface TableCell { text: string; gap?: boolean; positive?: boolean }
export interface TableRow { id: string; label: string; isGap?: boolean; cells: Record<string, TableCell> }

export function buildTable(config: TableConfig): { header: string; columns: TableColumn[]; rows: TableRow[] } {
  const def = TABLE_TYPES[config.type] ?? TABLE_TYPES.performance
  const columns = def.columns.filter(c => config.columns.includes(c.id))
  const rows: TableRow[] = ROW_DEFS[def.rowType].map(r => {
    const cells: Record<string, TableCell> = {}
    columns.forEach(col => {
      const seed = `${def.id}|${r.id}|${col.id}`
      if (r.isGap) {
        cells[col.id] = { text: (hash01(seed) * 20 + 1).toFixed(1) + '%', gap: true, positive: hash01(seed + 'p') > 0.4 }
      } else {
        let raw: number
        if (col.format === 'percent') raw = parseFloat((hash01(seed) * 5).toFixed(2))
        else if (col.format === 'time') raw = Math.floor(hash01(seed) * 60 + 10)
        else raw = Math.floor(hash01(seed) * 50000 + 1000)
        cells[col.id] = { text: fmt(col.format, raw) }
      }
    })
    return { id: r.id, label: r.label, isGap: r.isGap, cells }
  })
  return { header: firstColHeader(def.rowType), columns, rows }
}
