'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import { TABLE_TYPES, TableColumn, TableConfig, SectionMetrics, SentimentTable, CompetitorSection, buildTable, sentimentTableFor, customColumnsFrom } from '@/lib/reports/data/tableTypes'
import { useReportMetrics, sectionMetricsFor, competitorSectionFor } from '@/lib/reports/data/metricsContext'
import { PJ, Card, CardLabel, Placeholder } from './parts'

// Renders a configured table, matching report_2's SmartTableBlock layout: sticky
// first column (Period/Channel/…), metric columns, mono values, green/red Gap row.
function TableView({ config, accent, metrics, sentiment, competitors, customCols }: { config: TableConfig; accent: string; metrics: SectionMetrics | null; sentiment: SentimentTable | null; competitors: CompetitorSection | null; customCols: TableColumn[] }) {
  const { header, columns, rows } = buildTable(config, metrics, sentiment, competitors, customCols)
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col rounded-[0.8cqw] border" style={{ borderColor: '#eef0f2', ...PJ }}>
      {/* Header */}
      <div className="flex" style={{ background: '#f8fafb', borderBottom: `0.25cqh solid ${accent}` }}>
        <div style={{ flex: '0 0 14cqw', fontSize: '1.0cqw', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.02em', padding: '0.55cqh 0.6cqw' }}>{header}</div>
        {columns.map(c => (
          <div key={c.id} className="truncate" style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: '0.92cqw', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.01em', padding: '0.55cqh 0.45cqw' }} title={c.label}>{c.label}</div>
        ))}
      </div>
      {/* Rows */}
      {rows.map(r => (
        <div key={r.id} className="flex flex-1 min-h-0 items-center" style={{ borderBottom: '1px solid #f1f3f5', background: r.isGap ? '#fafbfc' : 'transparent' }}>
          <div className="truncate" style={{ flex: '0 0 14cqw', fontSize: '1.05cqw', fontWeight: 700, color: '#0f172a', padding: '0 0.6cqw' }}>{r.label}</div>
          {columns.map(c => {
            const cell = r.cells[c.id]
            const color = cell.gap ? (cell.positive ? '#16a34a' : '#dc2626') : '#475569'
            return (
              <div key={c.id} className="truncate" style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: '1.0cqw', fontWeight: cell.gap ? 700 : 500, color, fontFamily: mono, padding: '0 0.45cqw' }}>
                {cell.gap && cell.positive ? '+' : ''}{cell.text}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function TableBlock({ config, colors, channel, editable, onConfigure }: { config: TableConfig | null; colors: CoverColors; channel: string; editable: boolean; onConfigure?: () => void }) {
  const metrics = useReportMetrics()
  if (!config) return <Placeholder icon="table_chart" label="Configure data table" editable={editable} onClick={onConfigure} />
  const def = TABLE_TYPES[config.type]
  const sm = sectionMetricsFor(metrics, config.type, channel)
  const sentiment = sentimentTableFor(metrics?.sentiment, channel)
  const competitors = competitorSectionFor(metrics, channel)
  return (
    <Card style={{ padding: '1.8cqh 1.8cqw', display: 'flex', flexDirection: 'column', gap: '1cqh' }}>
      <CardLabel icon={def?.icon ?? 'table_chart'} accent={colors.primary} onEdit={editable ? onConfigure : undefined}>{def?.label ?? 'Data table'}</CardLabel>
      <TableView config={config} accent={colors.primary} metrics={sm} sentiment={sentiment} competitors={competitors} customCols={customColumnsFrom(metrics)} />
    </Card>
  )
}
