'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, ConfigBlock } from '@/lib/reports/data/slideModel'
import { PJ, AiInsightBlock } from './parts'
import { ChartBlock } from './charts'
import { TableBlock } from './TableBlock'

function ChooserButton({ icon, label, editable, onClick }: { icon: string; label: string; editable: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={editable ? onClick : undefined}
      disabled={!editable}
      className={`flex flex-col items-center justify-center rounded-[1.4cqw] border-2 border-dashed transition-colors ${
        editable ? 'border-[#cbd5e1] text-[#94a3b8] hover:border-[#2C3079] hover:text-[#2C3079] hover:bg-[#F1F2FB] cursor-pointer' : 'border-[#dbe1e8] text-[#b6bcc4]'
      }`}
      style={{ width: '22cqw', height: '22cqh', gap: '1.4cqh' }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '4cqw' }}>{icon}</span>
      <span style={{ fontSize: '1.4cqw', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', ...PJ }}>{label}</span>
    </button>
  )
}

function SwitchButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Switch visualization type"
      className="absolute z-10 flex items-center justify-center rounded-[0.5cqw] bg-white border border-[#e2e8f0] text-[#94a3b8] hover:text-[#2C3079] hover:border-[#cbd5e1] shadow-sm transition-colors"
      style={{ top: '0.6cqh', right: '0.6cqw', width: '2.6cqw', height: '2.6cqw' }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '1.5cqw' }}>swap_horiz</span>
    </button>
  )
}

/**
 * Overview body — one big visualization (chart OR table) + a notes panel. Empty
 * state lets you pick Chart or Table. Header & footer come from the slide shell.
 */
export default function OverviewSlide({
  slide, colors, editable, onChange, onConfigure,
}: {
  slide: ContentSlide
  colors: CoverColors
  editable: boolean
  onChange?: (next: ContentSlide) => void
  onConfigure?: (block: ConfigBlock) => void
}) {
  const mode = slide.visualMode
  return (
    <>
      <div className="flex-1 min-h-0 relative">
        {mode === null ? (
          <div className="h-full flex items-center justify-center" style={{ gap: '4cqw' }}>
            <ChooserButton icon="bar_chart" label="Chart" editable={editable} onClick={() => { onChange?.({ ...slide, visualMode: 'chart' }); onConfigure?.('chart') }} />
            <ChooserButton icon="table_chart" label="Table" editable={editable} onClick={() => { onChange?.({ ...slide, visualMode: 'table' }); onConfigure?.('table') }} />
          </div>
        ) : mode === 'chart' ? (
          <div className="h-full relative">
            {editable && <SwitchButton onClick={() => onChange?.({ ...slide, visualMode: null, chart: null })} />}
            <ChartBlock config={slide.chart} colors={colors} channel={slide.channel} editable={editable} onConfigure={() => onConfigure?.('chart')} placeholderLabel="Select visualization" />
          </div>
        ) : (
          <div className="h-full relative">
            {editable && <SwitchButton onClick={() => onChange?.({ ...slide, visualMode: null, table: null })} />}
            <TableBlock config={slide.table} colors={colors} channel={slide.channel} editable={editable} onConfigure={() => onConfigure?.('table')} />
          </div>
        )}
      </div>

      <div style={{ height: '20cqh', flexShrink: 0 }}>
        <AiInsightBlock slide={slide} editable={editable} onChange={onChange} label="Comparative analysis & notes" />
      </div>
    </>
  )
}
