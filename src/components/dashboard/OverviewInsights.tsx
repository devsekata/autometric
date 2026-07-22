'use client'

import { Card, CardHead } from './ui'
import {
  OVERALL_AI, CHANNEL_SNAPSHOT, PLATFORM_META,
  type DashBrand, type DashPlatform, type PlatformFilter,
} from './data'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function healthColor(h: number) {
  if (h >= 85) return '#3d8a5f'
  if (h >= 70) return '#c79235'
  return '#c2553f'
}

const FORMAT_ICON: Record<string, string> = {
  Reels: 'movie', Image: 'image', 'Short Video': 'smart_display', Carousel: 'collections', 'Live Stream': 'sensors',
}

/* ---------- Channel Health (driven by the platform switcher) ---------- */

const SNAP_COLS = 'grid-cols-[1.3fr_1.2fr_1.2fr_1fr]'

export function ChannelHealth({ brand, platform }: { brand: DashBrand; platform: PlatformFilter }) {
  const platforms: DashPlatform[] = platform === 'All' ? brand.platforms : [platform]
  return (
    <Card className="overflow-hidden">
      <CardHead title="Channel Health" sub={platform === 'All' ? 'Health, content type & winning format per channel' : `${PLATFORM_META[platform].label} channel`} />
      <div className={`grid ${SNAP_COLS} gap-2 px-4 py-2.5 border-y border-[#eef0f2] bg-[#fafbfb]`}>
        {['Channel', 'Health', 'Primary Type', 'Winning Format'].map(h => (
          <span key={h} style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">{h}</span>
        ))}
      </div>
      {platforms.map((p, i) => {
        const s = CHANNEL_SNAPSHOT[p]
        const meta = PLATFORM_META[p]
        return (
          <div key={p}
            className={`grid ${SNAP_COLS} gap-2 px-4 py-3 items-center text-[13px] hover:bg-[#fafbfb] ${
              i < platforms.length - 1 ? 'border-b border-[#f1f3f4]' : ''
            }`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <img src={meta.logo} alt={meta.label} className="w-6 h-6 object-contain flex-shrink-0" />
              <span className="font-semibold text-[#374151] truncate">{meta.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ ...PJ, color: healthColor(s.health) }} className="text-[15px] font-bold tabular-nums leading-none">{s.health}</span>
              <span className="text-[10px] text-[#9ca3af]">/100</span>
              <div className="flex-1 h-1.5 rounded-full bg-[#f3f4f6] overflow-hidden max-w-[64px]">
                <div className="h-full rounded-full" style={{ width: `${s.health}%`, background: healthColor(s.health) }} />
              </div>
            </div>
            <span className="text-[#6b7280] truncate">{s.primaryType}</span>
            <span className="inline-flex items-center gap-1.5 text-[#374151] font-medium truncate">
              <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">{FORMAT_ICON[s.winningFormat] ?? 'play_circle'}</span>
              {s.winningFormat}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

/* ---------- AI Analysis: Overall ---------- */

export function OverallAI() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <span className="w-6 h-6 rounded-md bg-gradient-to-br from-[#1B8A80] to-[#2C3079] flex items-center justify-center">
          <span className="material-symbols-outlined text-[15px] text-white">auto_awesome</span>
        </span>
        <h3 style={PJ} className="text-[12.5px] font-bold text-[#111827]">AI Analysis: Overall</h3>
        <span className="text-[9px] font-bold uppercase tracking-wide text-[#1B8A80] bg-[#eef5f8] px-1.5 py-0.5 rounded">AI</span>
      </div>
      <p className="px-4 pb-4 text-[13px] leading-relaxed text-[#4b5563]">{OVERALL_AI}</p>
    </Card>
  )
}
