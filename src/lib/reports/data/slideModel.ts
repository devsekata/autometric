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

// ── AI analyst insight (Gemini) ──────────────────────────────────────────────
export type RecommendationType = 'SCALE' | 'REFINE' | 'EXPLORE' | 'STOP'
export interface AiRecommendation { type: RecommendationType; text: string }
export interface AiInsight { analysis: string; recommendations: AiRecommendation[] }

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
  postFormat: string         // visual — format filter: 'all' | 'reel' | 'video' | 'carousel' | 'image'
  postPillar: string         // visual — content-pillar filter: 'all' | '<pillar id>'
  postSortMetric: string     // visual — metric the top/low ranking is based on
  postMetrics: string[]      // visual — which post metrics to show
  visualMode: VisualMode     // overview — chart | table | null
  aiInsight: AiInsight | null // AI analyst insight (analysis + typed recommendations)
}

/** Block keys that open a configuration modal. (`kpi-<index>` = a KPI scorecard) */
export type ConfigBlock = 'chart' | 'table' | 'chartA' | 'chartB' | `kpi-${number}`

/**
 * A saved report template = reusable structure only (cover style + slides), with
 * NO brand/period/data. Applied to any brand + period; branding (colors/logo) and
 * live data come from the newly selected brand. Persisted as the `config` JSONB.
 */
export interface ReportTemplateCover {
  templateId: string
  mode: CoverMode
  font: string
  title: string
  subtitle: string
}
export interface ReportTemplateConfig {
  cover: ReportTemplateCover
  slides: ContentSlide[]
}
export interface ReportTemplateRecord {
  id: string
  name: string
  sourceBrandName: string | null
  slideCount: number
  slideTypes: SlideType[]
  config: ReportTemplateConfig
  createdAt: number
}

export interface SlideChrome {
  brandName: string
  period: string
  preparedBy: string
  logoDataUrl: string | null
  pageNumber: number
  totalPages: number
  template: CoverTemplate  // selected cover template (used by Section Heading)
  mode: CoverMode
  font: string             // report font name (e.g. 'Calibri')
}

const SLIDE_DEFAULTS: Record<SlideType, Partial<ContentSlide>> = {
  section: { title: 'Section Title', body: 'A short description of what follows' },
  dashboard: { title: 'Performance Dashboard' },
  comparison: { title: 'Period Comparison' },
  kpi: { title: 'KPI Overview' },
  visual: { title: 'Visual Analysis' },
  overview: { title: 'Overview Slide' },
}

export function makeSlide(type: SlideType, seq: number, channel = 'instagram'): ContentSlide {
  const d = SLIDE_DEFAULTS[type]
  return {
    id: `s${seq}-${Date.now()}`,
    type,
    title: d.title ?? '',
    body: d.body ?? '',
    insights: '',
    channel,
    chart: null,
    table: null,
    chartA: null,
    chartB: null,
    metricCount: 4,
    kpiMetrics: [null, null, null, null, null, null],
    postCount: 4,
    postFilter: 'top',
    postFormat: 'all',
    postPillar: 'all',
    postSortMetric: 'engagement',
    postMetrics: ['reach', 'engagement', 'er'],
    visualMode: null,
    aiInsight: null,
  }
}
