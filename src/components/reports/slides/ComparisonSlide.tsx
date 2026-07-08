'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, ConfigBlock } from '@/lib/reports/data/slideModel'
import { InsightsBlock } from './parts'
import { ChartBlock } from './charts'

/**
 * Comparison View body — two side-by-side charts (Period A / B) + a comparative
 * analysis note. Header & footer are provided by the slide shell (SlidePreview).
 */
export default function ComparisonSlide({
  slide, colors, editable, onChange, onConfigure,
}: {
  slide: ContentSlide
  colors: CoverColors
  editable: boolean
  onChange?: (next: ContentSlide) => void
  onConfigure?: (block: ConfigBlock) => void
}) {
  return (
    <>
      <div className="flex-1 flex min-h-0" style={{ gap: '2.2cqw' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChartBlock config={slide.chartA} colors={colors} channel={slide.channel} editable={editable} onConfigure={() => onConfigure?.('chartA')} placeholderLabel="Period A / Segment A" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChartBlock config={slide.chartB} colors={colors} channel={slide.channel} editable={editable} onConfigure={() => onConfigure?.('chartB')} placeholderLabel="Period B / Segment B" />
        </div>
      </div>
      <div style={{ height: '22cqh', flexShrink: 0 }}>
        <InsightsBlock value={slide.insights} editable={editable} onChange={v => onChange?.({ ...slide, insights: v })} label="Comparative analysis & notes" />
      </div>
    </>
  )
}
