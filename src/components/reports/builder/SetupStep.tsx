'use client'

import { BRANDS } from '@/components/dashboard/data'
import { MONTHS, YEARS } from './constants'
import { PJ, Label, Field } from './ui'

export default function SetupStep(props: {
  brandId: string; onBrand: (id: string) => void
  month: string; setMonth: (v: string) => void; year: number; setYear: (v: number) => void
  title: string; setTitle: (v: string) => void; subtitle: string; setSubtitle: (v: string) => void
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
