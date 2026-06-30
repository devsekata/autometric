'use client'

import { Card, CardHead, SectionHeader, FlexKpiCard, Callout, Badge } from './ui'
import { HBars, ComboBarLine, MultiLineChart } from './charts'
import DashboardChrome from './DashboardChrome'
import {
  STORIES_KPIS, STORY_FUNNEL, STORY_FUNNEL_INSIGHT, STORY_TYPE_PERF, STORY_TYPE_INSIGHT,
  STORY_OVER_TIME, STORY_OVER_TIME_LABELS, PALETTE, fmtNum,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function FieldTag({ children }: { children: React.ReactNode }) {
  return <span style={PJ} className="text-[11px] font-semibold text-[#9a6fb5] bg-[#f3eefb] px-2.5 py-1 rounded-full">{children}</span>
}

export default function StoriesDashboard() {
  return (
    <DashboardChrome title="Stories" subtitle="Instagram & Facebook story performance">
      {() => (
        <>
          <SectionHeader icon="amp_stories" first>Performance</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {STORIES_KPIS.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
            <Card className="flex flex-col">
              <CardHead title="Story Retention Funnel" sub="How audiences navigate through your story sequences"
                action={<FieldTag>taps_forward · taps_back · exits</FieldTag>} />
              <div className="px-4 pb-4 pt-3">
                <HBars items={STORY_FUNNEL.map(f => ({
                  label: f.label, value: f.value, display: fmtNum(f.value), color: f.color,
                }))} />
              </div>
              <div className="mx-4 mb-4 mt-auto">
                <Callout tone="warning" title="Forward Tap Rate High">{STORY_FUNNEL_INSIGHT}</Callout>
              </div>
            </Card>

            <Card className="flex flex-col">
              <CardHead title="Story Type Performance" action={<FieldTag>story_type field</FieldTag>} />
              <div className="flex items-center justify-center gap-6 pb-1">
                <Badge text="Avg Reach" color="#e7a6bd" />
                <Badge text="Avg Replies" color="#6c4cd6" />
              </div>
              <div className="px-2 pb-3 pt-1">
                <ComboBarLine
                  labels={STORY_TYPE_PERF.map(s => s.type)}
                  bars={STORY_TYPE_PERF.map(s => s.reach)}
                  line={STORY_TYPE_PERF.map(s => s.replies)}
                  leftMax={40000} rightMax={2000} height={250}
                  fmtLeft={n => fmtNum(n)} />
              </div>
              <div className="mx-4 mb-4 mt-auto">
                <Callout tone="success" title="Interactive Stories Win">{STORY_TYPE_INSIGHT}</Callout>
              </div>
            </Card>
          </div>

          <SectionHeader icon="show_chart">Trend</SectionHeader>
          <Card>
            <CardHead title="Story Performance Over Time" sub="Views, exits & swipe-ups by week" />
            <div className="px-4 pb-3 pt-3">
              <MultiLineChart series={STORY_OVER_TIME} labels={STORY_OVER_TIME_LABELS} height={300} dots yAxis fmtY={fmtNum} />
            </div>
            <div className="flex items-center gap-4 px-4 pb-4 flex-wrap">
              {STORY_OVER_TIME.map(s => (
                <span key={s.name} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#6b7280]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}
                </span>
              ))}
            </div>
          </Card>
        </>
      )}
    </DashboardChrome>
  )
}
