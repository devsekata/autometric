// Domain model for content slides (shared by the slide components and the
// PPTX exporter). Kept in lib so nothing imports types up from components.
import { CoverMode } from '../cover/colors'
import { CoverTemplate } from '../cover/templates'
import { ChartConfig } from './chartData'
import { TableConfig } from './tableTypes'

export type { ChartConfig } from './chartData'
export type { TableConfig } from './tableTypes'

export type SlideType = 'section' | 'dashboard' | 'comparison' | 'kpi' | 'visual' | 'overview'
export type VisualMode = 'chart' | 'table' | null

export interface ContentSlide {
  id: string
  type: SlideType
  title: string
  body: string       // section subtitle
  insights: string   // dashboard key-insights / comparison notes / kpi summary
  channel: string    // 'instagram' | 'facebook' | 'tiktok'
  chart: ChartConfig | null   // dashboard main chart / kpi deep-dive / overview chart
  table: TableConfig | null   // dashboard data table / overview table
  chartA: ChartConfig | null  // comparison left
  chartB: ChartConfig | null  // comparison right
  metricCount: number             // kpi — number of scorecards (3..6)
  kpiMetrics: (string | null)[]   // kpi — selected metric key per scorecard slot
  postCount: number          // visual — number of post cards (4/6/8)
  postFilter: string         // visual — 'top' | 'low' | 'mixed'
  postMetrics: string[]      // visual — which post metrics to show
  visualMode: VisualMode     // overview — chart | table | null
}

/** Block keys that open a configuration modal. (`kpi-<index>` = a KPI scorecard) */
export type ConfigBlock = 'chart' | 'table' | 'chartA' | 'chartB' | `kpi-${number}`

export interface SlideChrome {
  brandName: string
  period: string
  preparedBy: string
  logoDataUrl: string | null
  pageNumber: number
  totalPages: number
  template: CoverTemplate  // selected cover template (used by Section Heading)
  mode: CoverMode
}

const SLIDE_DEFAULTS: Record<SlideType, Partial<ContentSlide>> = {
  section: { title: 'Section Title', body: 'A short description of what follows' },
  dashboard: { title: 'Performance Dashboard' },
  comparison: { title: 'Period Comparison' },
  kpi: { title: 'KPI Overview' },
  visual: { title: 'Visual Analysis' },
  overview: { title: 'Overview Slide' },
}

export function makeSlide(type: SlideType, seq: number): ContentSlide {
  const d = SLIDE_DEFAULTS[type]
  return {
    id: `s${seq}-${Date.now()}`,
    type,
    title: d.title ?? '',
    body: d.body ?? '',
    insights: '',
    channel: 'instagram',
    chart: null,
    table: null,
    chartA: null,
    chartB: null,
    metricCount: 4,
    kpiMetrics: [null, null, null, null, null, null],
    postCount: 4,
    postFilter: 'top',
    postMetrics: ['reach', 'engagement', 'er'],
    visualMode: null,
  }
}
