'use client'

import { createContext, useContext } from 'react'
import type { ReportTableMetrics, SectionMetrics } from './tableTypes'
import type { ReportChartMetrics } from './chartTypes'
import type { ReportKpiMetrics } from './kpiMetrics'
import type { ReportPostMetrics } from './posts'

/**
 * Real table-metric values for the current report (brand + period), provided by
 * ReportBuilder and consumed by TableBlock so the preview shows live DB numbers
 * without prop-drilling through the slide tree. Null while loading / unavailable
 * (TableBlock then renders "—" — never dummy).
 */
export const ReportMetricsContext = createContext<ReportTableMetrics | null>(null)

export function useReportMetrics(): ReportTableMetrics | null {
  return useContext(ReportMetricsContext)
}

/**
 * Real line-chart time series for the current report (brand + period), provided
 * by ReportBuilder and consumed by ChartBlock. Null while loading / unavailable
 * (the chart then shows an empty state, per metric — never dummy).
 */
export const ReportChartContext = createContext<ReportChartMetrics | null>(null)

export function useReportChart(): ReportChartMetrics | null {
  return useContext(ReportChartContext)
}

/**
 * Real KPI scorecard values for the current report (brand + period), provided by
 * ReportBuilder and consumed by KpiSlide / MetricPickerModal. Null while loading
 * (the scorecards then render "—" — never dummy).
 */
export const ReportKpiContext = createContext<ReportKpiMetrics | null>(null)

export function useReportKpi(): ReportKpiMetrics | null {
  return useContext(ReportKpiContext)
}

/**
 * Live post pool (per channel) for the current report (brand + month), provided by
 * ReportBuilder and consumed by the Visual Analysis slide. Null while loading /
 * unavailable (the slide then shows an empty state — never dummy).
 */
export const ReportPostContext = createContext<ReportPostMetrics | null>(null)

export function useReportPosts(): ReportPostMetrics | null {
  return useContext(ReportPostContext)
}

/** Resolve the metrics sub-map for a table (by type) on a given channel. */
export function sectionMetricsFor(
  metrics: ReportTableMetrics | null | undefined,
  tableType: string,
  channel: string,
): SectionMetrics | null {
  if (!metrics) return null
  const section = tableType === 'content_level' ? 'content'
    : tableType === 'channel_level' ? 'channel'
    : null
  if (!section) return null
  return metrics[section][channel as keyof typeof metrics.content] ?? null
}
