// Multi-slide PPTX export — fully EDITABLE (native PowerPoint elements) while
// mirroring the on-screen preview. Cover + content slides (Section Heading,
// Standard Dashboard, Comparison) are built with pptxgenjs shapes / text /
// native charts (addChart) / native tables (addTable) — no rasterized images,
// so everything stays editable in PowerPoint.
import { CoverColors, noHash, tint } from '../cover/colors'
import { CoverConfig, SLIDE_IN, addCoverSlide, addContainImage, svgToPng } from './exportCover'
import { ChartConfig, resolveBarData, resolveLineData, chartSummary, SENTIMENT_PALETTES } from '../data/chartData'
import { TableColumn, TableConfig, TABLE_TYPES, SectionMetrics, SentimentTable, CompetitorSection, ReportTableMetrics, buildTable, sentimentTableFor, customColumnsFrom } from '../data/tableTypes'
import { cloudWordsFrom, type ReportChartMetrics, type CloudWordData } from '../data/chartTypes'
import { computeWordCloud, WC_W, WC_H, WC_FONT } from '../data/wordcloudLayout'
import { KpiMetric, ReportKpiMetrics, deltaIsGood, kpiMetricFor } from '../data/kpiMetrics'
import { buildPosts, metricLabel as postMetricLabel, availableMetricsFor, effectiveSortMetric, effectiveShownMetrics, availableFilterIds, effectiveFilterId, type ReportPostMetrics } from '../data/posts'
import { PLATFORM_META, type DashPlatform } from '@/components/dashboard/data'
import type { ContentSlide, SlideChrome, AiInsight } from '../data/slideModel'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Slide = any

const S = SLIDE_IN
let PJ = 'Calibri'          // report font (set per export); MONO stays for table numbers
const MONO = 'Consolas'

// cq → inches / points (slide is 13.333in × 7.5in = 960pt × 540pt)
const W = (cqw: number) => (cqw / 100) * S.w
const H = (cqh: number) => (cqh / 100) * S.h
const FS = (cqw: number) => Math.max(6, Math.round((cqw / 100) * 960 * 10) / 10)

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null // not an image (e.g. an HTML page) → caller falls back
    return await new Promise(resolve => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function card(slide: Slide, x: number, y: number, w: number, h: number) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.07, fill: { color: 'FFFFFF' }, line: { color: 'E8EBEE', width: 0.75 } })
}

function placeholder(slide: Slide, x: number, y: number, w: number, h: number, label: string) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.06, fill: { color: 'FFFFFF', transparency: 55 }, line: { color: 'CBD5E1', width: 1, dashType: 'dash' } })
  slide.addText(label, { x, y, w, h, align: 'center', valign: 'middle', fontSize: FS(1.5), bold: true, color: '94A3B8', charSpacing: 1, fontFace: PJ })
}

// Empty state inside a card — for real blocks with no data in the brand+period (never dummy).
function noDataText(slide: Slide, x: number, y: number, w: number, h: number, label = 'No data for this period') {
  slide.addText(label, { x, y, w, h, align: 'center', valign: 'middle', fontSize: FS(1.3), bold: true, color: 'B6BCC4', fontFace: PJ })
}

/* ── Cards ───────────────────────────────────────────────────────────────── */

const whashStr = (str: string) => { let v = 0; for (let i = 0; i < str.length; i++) v = (v * 31 + str.charCodeAt(i)) >>> 0; return (v % 1000) / 1000 }
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Build the word cloud as an SVG (rasterized to PNG for export) — packed by the
// same d3-cloud layout as the on-screen preview, scaled from the fixed layout box
// into the target pixels, so preview and export match.
function wordCloudSvg(cloud: CloudWordData[], cw: number, ch: number): string {
  const placed = computeWordCloud(cloud)
  let body = ''
  for (const p of placed) {
    const pal = SENTIMENT_PALETTES[p.sentiment]
    const color = pal[Math.floor(whashStr(p.word + 'c') * pal.length)]
    const transform = `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})${p.rotate ? ` rotate(${p.rotate})` : ''}`
    body += `<text transform="${transform}" font-family="${WC_FONT}" font-weight="${p.weight}" font-size="${p.fontSize.toFixed(1)}" fill="${color}" text-anchor="middle">${xmlEsc(p.word)}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${WC_W} ${WC_H}">${body}</svg>`
}

async function chartCard(
  pptx: any, slide: Slide, config: ChartConfig | null, colors: CoverColors,
  x: number, y: number, w: number, h: number, placeholderLabel = 'MAIN CHART AREA',
  chartMetrics?: ReportChartMetrics | null, channel = 'instagram',
) {
  if (!config) { placeholder(slide, x, y, w, h, placeholderLabel); return }
  card(slide, x, y, w, h)
  const pad = W(1.6)
  slide.addText(chartSummary(config).toUpperCase(), { x: x + pad, y: y + H(1.6), w: w - 2 * pad, h: H(3), fontSize: FS(1.2), bold: true, color: '94A3B8', fontFace: PJ })

  const cy = y + H(5), ch = h - H(6.6)
  if (config.chartType === 'wordcloud') {
    // Real words scoped to brand+period, colored by post sentiment; empty → No data.
    const cloud = cloudWordsFrom(chartMetrics ?? null, channel, config.sentiment)
    if (!cloud.length) { noDataText(slide, x + pad, cy, w - 2 * pad, ch); return }
    const bw = w - 2 * pad
    const pxW = 900, pxH = Math.max(1, Math.round(pxW * (ch / bw)))
    const png = await svgToPng(wordCloudSvg(cloud, pxW, pxH), pxW, pxH)
    slide.addImage({ data: png, x: x + pad, y: cy, w: bw, h: ch })
    return
  }

  const box = { x: x + pad, y: cy, w: w - 2 * pad, h: ch }
  const legend = { showLegend: true, legendPos: 't', legendFontSize: FS(1.1), legendColor: '64748B', legendFontFace: PJ, showTitle: false }
  const catAxis = { catAxisLabelColor: '94A3B8', catAxisLabelFontSize: FS(1.0), catAxisLabelFontFace: PJ }

  // Bars — SMALL MULTIPLES: one mini bar chart per metric, each with its own real
  // value axis (true units; matches the preview).
  if (config.chartType === 'bar') {
    const { labels, series } = resolveBarData(config, chartMetrics ?? null, channel, colors)
    if (!series.length) { noDataText(slide, box.x, box.y, box.w, box.h); return }
    const gap = W(1.2), titleH = H(3.2)
    const subW = (box.w - gap * (series.length - 1)) / series.length
    series.forEach((s, i) => {
      const sx = box.x + i * (subW + gap)
      slide.addText(s.name.toUpperCase(), { x: sx, y: box.y, w: subW, h: titleH, align: 'center', fontSize: FS(1.05), bold: true, color: '64748B', fontFace: PJ })
      slide.addChart('bar', [{ name: s.name, labels, values: s.data }], {
        x: sx, y: box.y + titleH, w: subW, h: box.h - titleH,
        showLegend: false, showTitle: false, ...catAxis, chartColors: [noHash(s.color)],
        valAxisMinVal: s.scale.min, valAxisMaxVal: s.scale.max,
        valGridLine: { style: 'solid', size: 1, color: 'F1F3F5' }, catGridLine: { style: 'none' },
        valAxisLabelColor: 'B6BCC4', valAxisLabelFontSize: FS(1.0), valAxisLabelFontFace: PJ,
        barDir: config.barOrientation === 'horizontal' ? 'bar' : 'col',
        barGrouping: 'clustered', barGapWidthPct: 20,
      })
    })
    return
  }

  // Line — real data (dual-axis for 2 metrics so each keeps a readable scale).
  const { labels, series } = resolveLineData(config, chartMetrics ?? null, channel, colors)
  if (!series.length) { noDataText(slide, box.x, box.y, box.w, box.h); return }
  const sentiment = !!config.metrics?.includes('sentiments')
  const lineStyle = { lineSize: 2.25, lineDataSymbol: 'none' as const, lineSmooth: false }

  if (series.length === 2 && !sentiment) {
    const [a, b] = series
    slide.addChart(
      [
        { type: 'line', data: [{ name: a.name, labels, values: a.data }], options: { chartColors: [noHash(a.color)], ...lineStyle } },
        { type: 'line', data: [{ name: b.name, labels, values: b.data }], options: { chartColors: [noHash(b.color)], ...lineStyle, secondaryValAxis: true, secondaryCatAxis: true } },
      ],
      {
        ...box, ...legend,
        valAxes: [
          { valAxisMinVal: a.scale.min, valAxisMaxVal: a.scale.max, valAxisLabelColor: noHash(a.color), valAxisLabelFontSize: FS(1.0), valAxisLabelFontFace: PJ, valGridLine: { style: 'solid', size: 1, color: 'F1F3F5' } },
          { valAxisMinVal: b.scale.min, valAxisMaxVal: b.scale.max, valAxisLabelColor: noHash(b.color), valAxisLabelFontSize: FS(1.0), valAxisLabelFontFace: PJ, valGridLine: { style: 'none' } },
        ],
        catAxes: [
          { ...catAxis, catGridLine: { style: 'none' } },
          { catAxisHidden: true },
        ],
      },
    )
    return
  }

  // Single metric (or sentiments' 3 shared-scale series).
  const scale = series[0]?.scale ?? { min: 0, max: 100 }
  slide.addChart('line', series.map(s => ({ name: s.name, labels, values: s.data })), {
    ...box, ...legend, ...catAxis, ...lineStyle, chartColors: series.map(s => noHash(s.color)),
    valAxisMinVal: scale.min, valAxisMaxVal: scale.max,
    valGridLine: { style: 'solid', size: 1, color: 'F1F3F5' }, catGridLine: { style: 'none' },
    valAxisLabelColor: 'B6BCC4', valAxisLabelFontSize: FS(1.0), valAxisLabelFontFace: PJ,
  })
}

/** Split "**bold**" markers into pptx text runs. */
function boldRuns(text: string): { text: string; options: { bold: boolean } }[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(s => s !== '').map(p =>
    p.startsWith('**') && p.endsWith('**') ? { text: p.slice(2, -2), options: { bold: true } } : { text: p, options: { bold: false } })
}

/** Largest font (pt, ≤ basePt) that fits `len` chars into a wIn×hIn inch box. Conservative → never clips. */
function fitFontPt(len: number, wIn: number, hIn: number, basePt: number): number {
  for (let pt = basePt; pt > basePt * 0.5; pt -= 0.5) {
    const cpl = Math.max(6, Math.floor(wIn / ((pt * 0.55) / 72)))  // ~0.55em average char width
    const lines = Math.ceil(len / cpl)
    if (lines * ((pt * 1.34) / 72) <= hIn) return pt                // 1.34 line-height
  }
  return Math.max(6, basePt * 0.5)
}

function insightsCard(slide: Slide, content: { text: string; ai: AiInsight | null }, x: number, y: number, w: number, h: number, label: string) {
  const ai = content.ai
  const hasAi = !!ai && !!ai.analysis
  if (!hasAi && !content.text) { placeholder(slide, x, y, w, h, label === 'KEY INSIGHTS' ? 'AI KEY INSIGHTS' : label); return }
  card(slide, x, y, w, h)
  const pad = W(1.6)
  slide.addText(label, { x: x + pad, y: y + H(1.6), w: w - 2 * pad, h: H(3), fontSize: FS(1.2), bold: true, color: '1E4F49', fontFace: PJ })

  const bodyW = w - 2 * pad
  const bodyH = h - H(6)
  const bodyOpts = { x: x + pad, y: y + H(5), w: bodyW, h: bodyH, align: 'left' as const, valign: 'top' as const, fit: 'shrink' as const, fontFace: PJ }
  if (hasAi) {
    // Deterministically size the paragraph to fit the box so it never clips in the PPTX.
    const pt = fitFontPt(ai!.analysis.length, bodyW, bodyH, FS(1.5))
    const runs = boldRuns(ai!.analysis).map(r => ({ text: r.text, options: { bold: r.options.bold, color: r.options.bold ? '0F172A' : '475569', fontSize: pt } }))
    slide.addText(runs, { ...bodyOpts, lineSpacingMultiple: 1.15 })
  } else {
    slide.addText(content.text, { ...bodyOpts, fontSize: FS(1.45), color: '475569', lineSpacingMultiple: 1.3 })
  }
}

// Resolve the real metric sub-map for a table (content/channel level) on a channel.
function sectionFor(metrics: ReportTableMetrics | undefined, config: TableConfig | null, channel: string): SectionMetrics | null {
  if (!metrics || !config) return null
  const section = config.type === 'content_level' ? 'content' : config.type === 'channel_level' ? 'channel' : null
  if (!section) return null
  return metrics[section][channel as DashPlatform] ?? null
}

// The Brand-vs-Competitor section for a table on a channel (export side).
function competitorFor(metrics: ReportTableMetrics | undefined, config: TableConfig | null, channel: string): CompetitorSection | null {
  if (!metrics?.competitors || !config) return null
  return metrics.competitors[channel as DashPlatform] ?? null
}

function tableCard(slide: Slide, config: TableConfig | null, colors: CoverColors, x: number, y: number, w: number, h: number, sm: SectionMetrics | null = null, sent: SentimentTable | null = null, comp: CompetitorSection | null = null, customCols: TableColumn[] = []) {
  if (!config) { placeholder(slide, x, y, w, h, 'CONFIGURE DATA TABLE'); return }
  card(slide, x, y, w, h)
  const pad = W(1.6)
  const def = TABLE_TYPES[config.type]
  slide.addText((def?.label ?? 'Data table').toUpperCase(), { x: x + pad, y: y + H(1.4), w: w - 2 * pad, h: H(3), fontSize: FS(1.2), bold: true, color: '94A3B8', fontFace: PJ })

  const { header, columns, rows } = buildTable(config, sm, sent, comp, customCols)
  const headOpt = { bold: true, color: '94A3B8', fontSize: FS(1.0), fill: { color: 'F8FAFB' }, valign: 'middle' as const }
  const headRow = [
    { text: header, options: { ...headOpt, align: 'left' as const } },
    ...columns.map(c => ({ text: c.label, options: { ...headOpt, align: 'right' as const } })),
  ]
  const bodyRows = rows.map(r => [
    { text: r.label, options: { bold: true, color: '0F172A', align: 'left' as const, fontSize: FS(1.05), valign: 'middle' as const, fill: r.isGap ? { color: 'FAFBFC' } : undefined } },
    ...columns.map(c => {
      const cell = r.cells[c.id]
      const color = cell.gap ? (cell.positive ? '16A34A' : 'DC2626') : '475569'
      return { text: (cell.gap && cell.positive ? '+' : '') + cell.text, options: { align: 'right' as const, color, bold: !!cell.gap, fontSize: FS(1.0), fontFace: MONO, valign: 'middle' as const, fill: r.isGap ? { color: 'FAFBFC' } : undefined } }
    }),
  ])

  const tw = w - 2 * pad
  const firstW = tw * 0.18
  const colW = [firstW, ...columns.map(() => (tw - firstW) / columns.length)]
  slide.addTable([headRow, ...bodyRows], {
    x: x + pad, y: y + H(4.8), w: tw, h: h - H(6),
    colW, fontFace: PJ, autoPage: false,
    border: { type: 'solid', color: 'F1F3F5', pt: 0.5 },
  })
}

async function channelBadge(slide: Slide, channel: string, headerRight: number, headerY: number) {
  // "All channels" — a compact right-aligned row of every platform logo.
  if (channel === 'all') {
    const size = H(5), gap = W(0.6)
    const ids: DashPlatform[] = ['instagram', 'facebook', 'tiktok']
    const y = headerY + (H(12) - size) / 2
    let x = headerRight - (size * ids.length + gap * (ids.length - 1))
    for (const p of ids) {
      const logo = await toDataUrl(PLATFORM_META[p].logo)
      if (logo) await addContainImage(slide, logo, x, y, size, size, 'center')
      x += size + gap
    }
    return
  }
  const meta = PLATFORM_META[channel as keyof typeof PLATFORM_META]
  if (!meta) return
  const logo = await toDataUrl(meta.logo)
  if (!logo) return
  // Logo only — no background, no label.
  const size = H(7)
  await addContainImage(slide, logo, headerRight - size, headerY + (H(12) - size) / 2, size, size, 'right')
}

function dashboardHeader(slide: Slide, title: string, colors: CoverColors) {
  const hx = W(4), hy = H(4), hw = W(92), hh = H(12)
  card(slide, hx, hy, hw, hh)
  slide.addShape('rect', { x: hx, y: hy, w: W(0.7), h: hh, fill: { color: noHash(colors.primary) } })
  slide.addText(title || 'Untitled slide', { x: hx + W(2), y: hy, w: hw - W(22), h: hh, valign: 'middle', fontSize: FS(2.8), bold: true, color: '0F172A', fontFace: PJ })
  return { hx, hy, hw, hh }
}

async function footer(slide: Slide, chrome: SlideChrome, colors: CoverColors, x: number, y: number, w: number) {
  const fy = y + H(0.8), fh = H(6)
  // Left — logo (no box) · period
  let lx = x
  if (chrome.logoDataUrl) {
    const lw = await addContainImage(slide, chrome.logoDataUrl, lx, fy, W(14), fh, 'left')
    lx += lw + W(1.4)
  } else {
    slide.addText(chrome.brandName.slice(0, 2).toUpperCase(), { x: lx, y: fy, w: W(6), h: fh, valign: 'middle', fontSize: FS(1.9), bold: true, color: noHash(colors.primary), fontFace: PJ })
    lx += W(6)
  }
  slide.addShape('ellipse', { x: lx, y: fy + fh / 2 - W(0.45), w: W(0.9), h: W(0.9), fill: { color: noHash(colors.primary) }, line: { width: 0 } })
  slide.addText(chrome.period, { x: lx + W(1.6), y: fy, w: W(30), h: fh, valign: 'middle', fontSize: FS(1.5), color: '475569', fontFace: PJ })

  // Center — prepared by
  if (chrome.preparedBy) {
    slide.addText(
      [
        { text: 'Prepared by\n', options: { fontSize: FS(1.05), color: '94A3B8' } },
        { text: chrome.preparedBy, options: { fontSize: FS(1.3), bold: true, color: '475569' } },
      ],
      { x: x + w / 2 - W(20), y: fy, w: W(40), h: fh, align: 'center', valign: 'middle', fontFace: PJ, lineSpacingMultiple: 1.05 },
    )
  }

  // Right — page (no pill)
  slide.addText(
    [
      { text: String(chrome.pageNumber), options: { color: noHash(colors.primary), bold: true } },
      { text: '  /  ', options: { color: 'CBD5E1' } },
      { text: String(chrome.totalPages), options: { color: '94A3B8' } },
    ],
    { x: x + w - W(16), y: fy, w: W(16), h: fh, align: 'right', valign: 'middle', fontSize: FS(1.5), fontFace: PJ },
  )
}

/* ── Slide builders ──────────────────────────────────────────────────────── */

async function addSectionSlide(pptx: any, slide: ContentSlide, chrome: SlideChrome, colors: CoverColors) {
  const s = pptx.addSlide()
  const bgPng = await svgToPng(chrome.template.background(colors, chrome.mode), 1280 * 2, 720 * 2)
  s.addImage({ data: bgPng, x: 0, y: 0, w: S.w, h: S.h })
  s.addShape('rect', { x: 0, y: 0, w: S.w, h: S.h, fill: { color: chrome.mode === 'dark' ? '000000' : 'FFFFFF', transparency: chrome.mode === 'dark' ? 82 : 78 }, line: { width: 0 } })
  const text = noHash(chrome.template.textColor(colors, chrome.mode))
  s.addText('SECTION', { x: 0, y: H(35), w: S.w, h: H(5), align: 'center', fontSize: FS(1.5), bold: true, color: text, charSpacing: 6, fontFace: PJ })
  s.addShape('rect', { x: S.w / 2 - W(3.5), y: H(43.5), w: W(7), h: H(0.6), fill: { color: text }, line: { width: 0 } })
  s.addText(slide.title || 'Section Title', { x: W(8), y: H(45), w: S.w - W(16), h: H(16), align: 'center', valign: 'middle', fontSize: FS(7), bold: true, color: text, fontFace: PJ })
  if (slide.body) s.addText(slide.body, { x: W(15), y: H(64), w: S.w - W(30), h: H(8), align: 'center', fontSize: FS(2.4), color: text, fontFace: PJ })
}

async function addDashboardSlide(pptx: any, slide: ContentSlide, chrome: SlideChrome, colors: CoverColors, metrics?: ReportTableMetrics, chartMetrics?: ReportChartMetrics) {
  const s = pptx.addSlide()
  s.background = { color: noHash(tint(colors.primary, 0.965)) }
  s.addShape('rect', { x: 0, y: 0, w: S.w, h: H(0.5), fill: { color: noHash(colors.primary) }, line: { width: 0 } })
  const { hx, hy, hw } = dashboardHeader(s, slide.title, colors)
  await channelBadge(s, slide.channel, hx + hw - W(1.5), hy)

  const ry = H(18), rh = H(37)
  const chartW = W(58.4), insW = W(31.6)
  await chartCard(pptx, s, slide.chart, colors, hx, ry, chartW, rh, 'MAIN CHART AREA', chartMetrics, slide.channel)
  insightsCard(s, { text: slide.insights, ai: slide.aiInsight }, hx + chartW + W(2), ry, insW, rh, 'KEY INSIGHTS')
  tableCard(s, slide.table, colors, hx, H(57), hw, H(30), sectionFor(metrics, slide.table, slide.channel), sentimentTableFor(metrics?.sentiment, slide.channel), competitorFor(metrics, slide.table, slide.channel), customColumnsFrom(metrics))
  await footer(s, chrome, colors, hx, H(89), hw)
}

async function addComparisonSlide(pptx: any, slide: ContentSlide, chrome: SlideChrome, colors: CoverColors, chartMetrics?: ReportChartMetrics) {
  const s = pptx.addSlide()
  s.background = { color: noHash(tint(colors.primary, 0.965)) }
  s.addShape('rect', { x: 0, y: 0, w: S.w, h: H(0.5), fill: { color: noHash(colors.primary) }, line: { width: 0 } })
  const { hx, hy, hw } = dashboardHeader(s, slide.title, colors)
  await channelBadge(s, slide.channel, hx + hw - W(1.5), hy)

  const cy = H(18), chH = H(45), cw = W(45)
  await chartCard(pptx, s, slide.chartA, colors, hx, cy, cw, chH, 'PERIOD A / SEGMENT A', chartMetrics, slide.channel)
  await chartCard(pptx, s, slide.chartB, colors, hx + cw + W(2), cy, cw, chH, 'PERIOD B / SEGMENT B', chartMetrics, slide.channel)
  insightsCard(s, { text: slide.insights, ai: slide.aiInsight }, hx, H(65), hw, H(22), 'COMPARATIVE ANALYSIS & NOTES')
  await footer(s, chrome, colors, hx, H(89), hw)
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

function scorecard(slide: Slide, metric: KpiMetric | undefined, accent: string, count: number, x: number, y: number, w: number, h: number) {
  if (!metric) { placeholder(slide, x, y, w, h, 'ADD METRIC'); return }
  card(slide, x, y, w, h)
  slide.addShape('rect', { x, y, w, h: H(0.5), fill: { color: noHash(accent) }, line: { width: 0 } })
  const pad = W(1.2)
  const valueCqw = count <= 4 ? 2.5 : count === 5 ? 2.1 : 1.8
  slide.addText(metric.label.toUpperCase(), { x: x + pad, y: y + H(1.8), w: w - 2 * pad, h: H(2.4), fontSize: FS(0.95), bold: true, color: '94A3B8', fontFace: PJ })
  slide.addText(metric.value, { x: x + pad, y: y + H(5), w: w - 2 * pad, h: H(5), fontSize: FS(valueCqw), bold: true, color: '0F172A', fontFace: PJ })
  const good = deltaIsGood(metric)
  const arrow = metric.delta >= 0 ? '▲' : '▼'
  const trend = metric.hasDelta === false
    ? [{ text: 'no prior-period data', options: { color: '94A3B8' } }]
    : [
        { text: `${arrow} ${Math.abs(metric.delta)}%  `, options: { color: good ? '16A34A' : 'DC2626', bold: true } },
        { text: 'vs last period', options: { color: '94A3B8' } },
      ]
  slide.addText(trend, { x: x + pad, y: y + H(11.8), w: w - 2 * pad, h: H(3), fontSize: FS(0.95), fontFace: PJ })
}

async function addKpiSlide(pptx: any, slide: ContentSlide, chrome: SlideChrome, colors: CoverColors, chartMetrics?: ReportChartMetrics, kpiMetrics?: ReportKpiMetrics) {
  const s = pptx.addSlide()
  s.background = { color: noHash(tint(colors.primary, 0.965)) }
  s.addShape('rect', { x: 0, y: 0, w: S.w, h: H(0.5), fill: { color: noHash(colors.primary) }, line: { width: 0 } })
  const { hx, hy, hw } = dashboardHeader(s, slide.title, colors)
  await channelBadge(s, slide.channel, hx + hw - W(1.5), hy)

  const n = Math.max(1, slide.metricCount)
  const gap = n >= 6 ? W(1) : W(1.6)
  const cardW = (hw - gap * (n - 1)) / n
  const ry = H(18), rh = H(17)
  for (let i = 0; i < n; i++) {
    const key = slide.kpiMetrics[i] ?? null
    const metric = kpiMetricFor(kpiMetrics ?? null, slide.channel, key)   // "—" when no data; never dummy
    scorecard(s, metric, colors.primary, n, hx + i * (cardW + gap), ry, cardW, rh)
  }

  const cy = H(37), ch = H(50)
  const chartW = W(60)
  await chartCard(pptx, s, slide.chart, colors, hx, cy, chartW, ch, 'DEEP DIVE ANALYSIS', chartMetrics, slide.channel)
  insightsCard(s, { text: slide.insights, ai: slide.aiInsight }, hx + chartW + W(2), cy, hw - chartW - W(2), ch, 'SUMMARY & ACTIONS')
  await footer(s, chrome, colors, hx, H(89), hw)
}

function hslToHex(h: number, sat: number, lig: number): string {
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lig - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c } else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c } else if (h < 300) { r = x; b = c } else { r = c; b = x }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase()
  return to(r) + to(g) + to(b)
}

async function postCard(slide: Slide, post: { id: number; tag?: string; image?: string; format?: string; pillar?: string; metrics: Record<string, string> }, postMetrics: string[], n: number, x: number, y: number, w: number, h: number) {
  card(slide, x, y, w, h)
  const imgH = h * 0.55
  slide.addShape('rect', { x, y, w, h: imgH, fill: { color: hslToHex((post.id * 47) % 360, 0.42, 0.85) }, line: { width: 0 } })
  const imgData = post.image ? await toDataUrl(post.image) : null
  if (imgData) await addContainImage(slide, imgData, x, y, w, imgH, 'center')
  if (post.tag) slide.addText(post.tag, { x: x + W(0.4), y: y + H(0.6), w: W(5), h: H(2.2), fontSize: FS(0.8), bold: true, color: 'FFFFFF', fill: { color: post.tag === 'TOP' ? '16A34A' : 'E11D48' }, align: 'center', valign: 'middle', fontFace: PJ })
  const pad = W(0.6)
  const fs = n === 4 ? FS(1.05) : n === 6 ? FS(0.9) : FS(0.78)
  const capFs = Math.max(6, Math.round(fs * 0.82 * 10) / 10)
  slide.addText(`#${post.id}`, { x: x + pad, y: y + imgH + H(0.4), w: w - 2 * pad, h: H(2.0), fontSize: fs, bold: true, color: '334155', fontFace: PJ })
  const caption = [post.format, post.pillar].filter(Boolean).join('  ·  ')
  if (caption) slide.addText(caption, { x: x + pad, y: y + imgH + H(2.5), w: w - 2 * pad, h: H(1.8), fontSize: capFs, color: '94A3B8', valign: 'top', fontFace: PJ })
  const colY = y + imgH + H(4.4), colH = h - imgH - H(4.8)
  slide.addText(postMetrics.map(m => postMetricLabel(m)).join('\n'), { x: x + pad, y: colY, w: (w - 2 * pad) * 0.6, h: colH, fontSize: fs, color: '94A3B8', align: 'left', valign: 'top', lineSpacingMultiple: 1.25, fontFace: PJ })
  slide.addText(postMetrics.map(m => post.metrics[m] ?? '—').join('\n'), { x: x + pad + (w - 2 * pad) * 0.55, y: colY, w: (w - 2 * pad) * 0.45, h: colH, fontSize: fs, color: '334155', align: 'right', valign: 'top', lineSpacingMultiple: 1.25, fontFace: MONO })
}

async function addVisualSlide(pptx: any, slide: ContentSlide, chrome: SlideChrome, colors: CoverColors, postMetrics?: ReportPostMetrics | null) {
  const s = pptx.addSlide()
  s.background = { color: noHash(tint(colors.primary, 0.965)) }
  s.addShape('rect', { x: 0, y: 0, w: S.w, h: H(0.5), fill: { color: noHash(colors.primary) }, line: { width: 0 } })
  const { hx, hy, hw } = dashboardHeader(s, slide.title, colors)
  await channelBadge(s, slide.channel, hx + hw - W(1.5), hy)

  const n = slide.postCount
  const source = postMetrics?.[slide.channel]
  // Channel-aware availability + brand-aware filters — must match VisualSlide exactly so export == preview.
  const available = availableMetricsFor(source, slide.channel)
  const sortMetric = effectiveSortMetric(slide.postSortMetric, available)
  const shownMetrics = effectiveShownMetrics(slide.postMetrics, available)
  const format = effectiveFilterId(slide.postFormat, availableFilterIds(source, 'formatId'))
  const pillar = effectiveFilterId(slide.postPillar, availableFilterIds(source, 'pillarId'))
  const posts = buildPosts(n, slide.postFilter, { format, pillar, sortMetric, source })
  const gap = n === 4 ? W(1.2) : n === 6 ? W(0.9) : W(0.7)
  const cw = (hw - gap * (n - 1)) / n
  const gy = H(18), gh = H(49)
  for (let i = 0; i < posts.length; i++) await postCard(s, posts[i], shownMetrics, n, hx + i * (cw + gap), gy, cw, gh)

  insightsCard(s, { text: slide.insights, ai: slide.aiInsight }, hx, H(69), hw, H(18), 'VISUAL STRATEGY NOTES & INSIGHTS')
  await footer(s, chrome, colors, hx, H(89), hw)
}

async function addOverviewSlide(pptx: any, slide: ContentSlide, chrome: SlideChrome, colors: CoverColors, metrics?: ReportTableMetrics, chartMetrics?: ReportChartMetrics) {
  const s = pptx.addSlide()
  s.background = { color: noHash(tint(colors.primary, 0.965)) }
  s.addShape('rect', { x: 0, y: 0, w: S.w, h: H(0.5), fill: { color: noHash(colors.primary) }, line: { width: 0 } })
  const { hx, hy, hw } = dashboardHeader(s, slide.title, colors)
  await channelBadge(s, slide.channel, hx + hw - W(1.5), hy)

  const vy = H(18), vh = H(47)
  if (slide.visualMode === 'chart') await chartCard(pptx, s, slide.chart, colors, hx, vy, hw, vh, 'SELECT VISUALIZATION', chartMetrics, slide.channel)
  else if (slide.visualMode === 'table') tableCard(s, slide.table, colors, hx, vy, hw, vh, sectionFor(metrics, slide.table, slide.channel), sentimentTableFor(metrics?.sentiment, slide.channel), competitorFor(metrics, slide.table, slide.channel), customColumnsFrom(metrics))
  else placeholder(s, hx, vy, hw, vh, 'SELECT A CHART OR TABLE')

  insightsCard(s, { text: slide.insights, ai: slide.aiInsight }, hx, H(67), hw, H(20), 'COMPARATIVE ANALYSIS & NOTES')
  await footer(s, chrome, colors, hx, H(89), hw)
}

export interface ReportExportOptions {
  cover: CoverConfig
  slides: ContentSlide[]
  chromes: SlideChrome[]
  colors: CoverColors
  brandName: string
  font: string
  metrics?: ReportTableMetrics | null
  chartMetrics?: ReportChartMetrics | null
  kpiMetrics?: ReportKpiMetrics | null
  postMetrics?: ReportPostMetrics | null
}

export async function exportReportPptx({ cover, slides, chromes, colors, brandName, font, metrics, chartMetrics, kpiMetrics, postMetrics }: ReportExportOptions): Promise<{ blob: Blob; fileName: string }> {
  PJ = font
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'AUTOMETRIC_16x9', width: S.w, height: S.h })
  pptx.layout = 'AUTOMETRIC_16x9'

  await addCoverSlide(pptx, cover)

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]
    const chrome = chromes[i]
    if (slide.type === 'section') await addSectionSlide(pptx, slide, chrome, colors)
    else if (slide.type === 'comparison') await addComparisonSlide(pptx, slide, chrome, colors, chartMetrics ?? undefined)
    else if (slide.type === 'kpi') await addKpiSlide(pptx, slide, chrome, colors, chartMetrics ?? undefined, kpiMetrics ?? undefined)
    else if (slide.type === 'visual') await addVisualSlide(pptx, slide, chrome, colors, postMetrics)
    else if (slide.type === 'overview') await addOverviewSlide(pptx, slide, chrome, colors, metrics ?? undefined, chartMetrics ?? undefined)
    else await addDashboardSlide(pptx, slide, chrome, colors, metrics ?? undefined, chartMetrics ?? undefined)
  }

  const safe = (brandName || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const fileName = `${safe}-report.pptx`
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  return { blob, fileName }
}
