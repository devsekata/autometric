'use client'

import { Card, CardHead, SectionHeader, FlexKpiCard, Callout, Badge } from './ui'
import { DivergingBars, ScatterPlot, HBars } from './charts'
import DashboardChrome from './DashboardChrome'
import {
  TIKTOK_KPIS, CHURN_WEEKS, CHURN_INSIGHT, DURATION_COMPLETION,
  WATCH_BY_PILLAR, WATCH_INSIGHT, PALETTE, fmtNum,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function FieldTag({ children }: { children: React.ReactNode }) {
  return <span style={PJ} className="text-[11px] font-semibold text-[#6b7280] bg-[#f3f4f6] px-2.5 py-1 rounded-full">{children}</span>
}

const NET = CHURN_WEEKS.reduce((s, w) => s + w.gained - w.lost, 0)
const GAINED = CHURN_WEEKS.reduce((s, w) => s + w.gained, 0)
const LOST = CHURN_WEEKS.reduce((s, w) => s + w.lost, 0)

export default function TikTokDeepDashboard() {
  return (
    <DashboardChrome title="TikTok Deep" subtitle="Growth, churn & retention from TikTok's API">
      {() => (
        <>
          <SectionHeader icon="music_note" first>Performance</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
            {TIKTOK_KPIS.map((k, i) => <FlexKpiCard key={k.key} kpi={k} color={PALETTE[i % PALETTE.length]} />)}
          </div>

          {/* Follower churn */}
          <SectionHeader icon="sync_alt">Follower Churn Analysis</SectionHeader>
          <Card className="mb-3">
            <CardHead title="Follower Churn Analysis" sub="Unique to TikTok's API — no other platform in this schema tracks churn at this granularity"
              action={<FieldTag>new_followers · lost_followers · net_growth</FieldTag>} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 px-4 pt-1">
              {[
                { label: 'New Followers', value: `+${fmtNum(GAINED)}`, bg: '#edf6ef', border: '#d7ebdb', color: '#3d8a5f' },
                { label: 'Followers Lost', value: `−${fmtNum(LOST)}`, bg: '#fcefec', border: '#f3d6d0', color: '#c2553f' },
                { label: 'Net Growth', value: `+${fmtNum(NET)}`, bg: '#f3f1fb', border: '#e7e3f7', color: '#6c4cd6' },
              ].map(t => (
                <div key={t.label} className="rounded-xl border px-4 py-4 text-center" style={{ background: t.bg, borderColor: t.border }}>
                  <div style={{ ...PJ, color: t.color }} className="text-[26px] font-bold leading-none tabular-nums">{t.value}</div>
                  <div className="text-[12px] font-medium text-[#6b7280] mt-1.5">{t.label}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-6 pt-4 pb-1">
              <Badge text="New Followers" color="#7cc499" />
              <Badge text="Lost Followers" color="#e89aa3" />
            </div>
            <div className="px-4 pb-4 pt-1">
              <DivergingBars data={CHURN_WEEKS} height={240} fmt={fmtNum} />
            </div>
            <div className="mx-4 mb-4">
              <Callout tone="danger" title="Churn Spike — Week 3">{CHURN_INSIGHT}</Callout>
            </div>
          </Card>

          {/* Duration vs completion + watch time */}
          <SectionHeader icon="insights">Retention Drivers</SectionHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="flex flex-col">
              <CardHead title="Duration vs. Completion Rate" action={<FieldTag>video_duration · completion_rate</FieldTag>} />
              <div className="px-4 pb-4 pt-3 flex-1">
                <ScatterPlot points={DURATION_COMPLETION} xMax={95} yMax={80}
                  xTicks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90]} yTicks={[10, 20, 30, 40, 50, 60, 70, 80]}
                  xLabel="Video Duration (seconds)" color="#8b7fc7" height={260} />
              </div>
            </Card>

            <Card className="flex flex-col">
              <CardHead title="Avg Watch Time by Content Pillar" action={<FieldTag>avg_watch_time · content_pillar</FieldTag>} />
              <div className="px-4 pb-4 pt-3">
                <HBars items={WATCH_BY_PILLAR.map(w => ({
                  label: w.label, value: w.value, display: `${w.value}s`, color: w.color,
                }))} />
              </div>
              <div className="mx-4 mb-4 mt-auto">
                <Callout tone="success" title="Drama Clips Win">{WATCH_INSIGHT}</Callout>
              </div>
            </Card>
          </div>
        </>
      )}
    </DashboardChrome>
  )
}
