'use client'

import { CoverColors, tint } from '@/lib/reports/cover/colors'
import { ContentSlide, SlideChrome, ConfigBlock } from '@/lib/reports/data/slideModel'
import { fontStack } from '@/lib/reports/data/fonts'
import { PJ, Card, Title, ChannelBadge, Footer } from './parts'
import SectionSlide from './SectionSlide'
import DashboardSlide from './DashboardSlide'
import ComparisonSlide from './ComparisonSlide'
import KpiSlide from './KpiSlide'
import VisualSlide from './VisualSlide'
import OverviewSlide from './OverviewSlide'

// Re-exported for convenience so existing imports `from '.../SlidePreview'` keep working.
export type { ContentSlide, SlideType, SlideChrome, ConfigBlock, ChartConfig, TableConfig } from '@/lib/reports/data/slideModel'
export { makeSlide } from '@/lib/reports/data/slideModel'

/**
 * Slide dispatcher. Section Heading is full-bleed; Dashboard/Comparison share a
 * shell (page bg + decorative elements + header + footer) with their body swapped.
 */
export default function SlidePreview({
  slide, colors, chrome, editable = false, flat = false, onChange, onConfigure,
}: {
  slide: ContentSlide
  colors: CoverColors
  chrome: SlideChrome
  editable?: boolean
  flat?: boolean   // square corners + no ring (used when rasterizing for export)
  onChange?: (next: ContentSlide) => void
  onConfigure?: (block: ConfigBlock) => void
}) {
  const setField = (k: keyof ContentSlide, v: string) => onChange?.({ ...slide, [k]: v })
  const pageBg = tint(colors.primary, 0.965)
  const frame = flat ? 'relative w-full bg-white overflow-hidden' : 'relative w-full bg-white rounded-xl overflow-hidden ring-1 ring-black/5'
  const rootStyle = { aspectRatio: '16 / 9', containerType: 'size', ['--report-font']: fontStack(chrome.font) } as React.CSSProperties

  if (slide.type === 'section') {
    return (
      <div className={frame} style={rootStyle}>
        <SectionSlide slide={slide} colors={colors} chrome={chrome} editable={editable} onChange={onChange} />
      </div>
    )
  }

  return (
    <div className={frame} style={rootStyle}>
      <div className="absolute inset-0 flex flex-col" style={{ padding: '4cqh 4cqw', gap: '2cqh', background: pageBg, fontFamily: PJ.fontFamily }}>
        {/* Decorative elements (report_2-style) */}
        <div className="absolute rounded-full pointer-events-none" style={{ top: '-10cqh', right: '-6cqw', width: '26cqw', height: '26cqw', background: `radial-gradient(circle, ${tint(colors.primary, 0.7)} 0%, transparent 70%)`, opacity: 0.5 }} />
        <div className="absolute rounded-full pointer-events-none" style={{ bottom: '-12cqh', left: '-8cqw', width: '30cqw', height: '30cqw', background: `radial-gradient(circle, ${tint(colors.accent, 0.7)} 0%, transparent 70%)`, opacity: 0.4 }} />
        <div className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '0.5cqh', background: `linear-gradient(90deg, ${colors.primary}, ${colors.accent}, transparent)` }} />

        {/* Header */}
        <Card style={{ height: '12cqh', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 2.6cqw' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '0.7cqw', height: '100%', background: colors.primary }} />
          <div style={{ flex: 1, paddingLeft: '1.4cqw' }}>
            <Title value={slide.title} editable={editable} onChange={v => setField('title', v)} />
          </div>
          <ChannelBadge channel={slide.channel} />
        </Card>

        {slide.type === 'dashboard' ? (
          <DashboardSlide slide={slide} colors={colors} editable={editable} onChange={onChange} onConfigure={onConfigure} />
        ) : slide.type === 'kpi' ? (
          <KpiSlide slide={slide} colors={colors} editable={editable} onChange={onChange} onConfigure={onConfigure} />
        ) : slide.type === 'visual' ? (
          <VisualSlide slide={slide} colors={colors} editable={editable} onChange={onChange} />
        ) : slide.type === 'overview' ? (
          <OverviewSlide slide={slide} colors={colors} editable={editable} onChange={onChange} onConfigure={onConfigure} />
        ) : (
          <ComparisonSlide slide={slide} colors={colors} editable={editable} onChange={onChange} onConfigure={onConfigure} />
        )}

        <Footer chrome={chrome} colors={colors} />
      </div>
    </div>
  )
}
