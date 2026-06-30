'use client'

import { BRANDS } from '@/components/dashboard/data'
import { REPORT_FONTS, FONT_META, fontStack } from '@/lib/reports/data/fonts'
import { MONTHS, YEARS } from './constants'
import { PJ, Label, Field } from './ui'

export default function SetupStep(props: {
  brandId: string; onBrand: (id: string) => void
  month: string; setMonth: (v: string) => void; year: number; setYear: (v: number) => void
  title: string; setTitle: (v: string) => void; subtitle: string; setSubtitle: (v: string) => void
  font: string; setFont: (v: string) => void
  onContinue: () => void
}) {
  return (
    <div className="max-w-[600px] mx-auto">
      <div className="bg-white rounded-2xl border border-[#e5e7eb] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#f0f1f2]">
          <h2 style={PJ} className="text-[15px] font-bold text-[#111827]">Report details</h2>
          <p className="text-[12px] text-[#9ca3af] mt-0.5">Pick the brand and reporting period, then design the cover.</p>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <Label>Brand</Label>
            <select
              value={props.brandId}
              onChange={e => props.onBrand(e.target.value)}
              style={PJ}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] text-[#111827] bg-white focus:border-[#3d7e96] focus:outline-none"
            >
              {BRANDS.map(b => <option key={b.id} value={b.id}>{b.name} · {b.handle}</option>)}
            </select>
          </div>

          <div>
            <Label>Period</Label>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={props.month}
                onChange={e => props.setMonth(e.target.value)}
                style={PJ}
                className="border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] bg-white focus:border-[#3d7e96] focus:outline-none"
              >
                {MONTHS.map(m => <option key={m}>{m}</option>)}
              </select>
              <select
                value={props.year}
                onChange={e => props.setYear(Number(e.target.value))}
                style={PJ}
                className="border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] bg-white focus:border-[#3d7e96] focus:outline-none"
              >
                {YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <Field label="Report title" value={props.title} onChange={props.setTitle} />
          <Field label="Subtitle" value={props.subtitle} onChange={props.setSubtitle} />

          <div>
            <Label>Font</Label>
            <div className="grid grid-cols-3 gap-2.5">
              {REPORT_FONTS.map(f => {
                const active = props.font === f
                return (
                  <button
                    key={f}
                    onClick={() => props.setFont(f)}
                    className={`rounded-lg border px-3 py-3 text-center transition-all ${active ? 'border-[#1e4f49] bg-[#f2f8f5] ring-1 ring-[#1e4f49]' : 'border-[#e5e7eb] hover:border-[#cbd5e1] hover:bg-[#f9fafb]'}`}
                  >
                    <div style={{ fontFamily: fontStack(f), fontSize: 20, fontWeight: 700, color: active ? '#1e4f49' : '#111827', lineHeight: 1.1 }}>Ag</div>
                    <div style={{ fontFamily: fontStack(f), fontSize: 12.5, fontWeight: 600, color: active ? '#1e4f49' : '#374151', marginTop: 4 }}>{f}</div>
                    <div className="text-[10.5px] text-[#9ca3af] mt-0.5">{FONT_META[f].kind}</div>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-[#9ca3af] mt-1.5">Font bawaan Microsoft — PPTX tampil sama persis di PowerPoint.</p>
          </div>
        </div>
        <div className="px-6 py-4 bg-[#fafbfb] border-t border-[#f0f1f2] flex justify-end">
          <button
            onClick={props.onContinue}
            style={PJ}
            className="flex items-center gap-2 bg-[#1e4f49] hover:bg-[#163a35] text-white text-[13px] font-bold px-5 py-2.5 rounded-lg shadow-sm transition-colors"
          >
            Design cover
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  )
}
