'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, ConfigBlock } from '@/lib/reports/data/slideModel'
import { InsightsBlock } from './parts'
import { ChartBlock } from './charts'
import { TableBlock } from './TableBlock'

/**
 * Standard Dashboard body — main chart + AI key insights, then a data table.
 * Header & footer are provided by the slide shell (SlidePreview).
 */
export default function DashboardSlide({
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
      <div className="flex min-h-0" style={{ gap: '2cqw', height: '37cqh' }}>
        <div style={{ flex: 1.85, minWidth: 0 }}>
          <ChartBlock config={slide.chart} colors={colors} channel={slide.channel} editable={editable} onConfigure={() => onConfigure?.('chart')} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InsightsBlock value={slide.insights} editable={editable} onChange={v => onChange?.({ ...slide, insights: v })} />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TableBlock config={slide.table} colors={colors} channel={slide.channel} editable={editable} onConfigure={() => onConfigure?.('table')} />
      </div>
    </>
  )
}
