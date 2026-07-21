'use client'

import { useState } from 'react'
import type { DashBrand } from '@/components/dashboard/data'
import type { ReportTemplateConfig, ReportTemplateRecord } from '@/lib/reports/data/slideModel'
import { REPORT_FONTS, FONT_META, fontStack } from '@/lib/reports/data/fonts'
import { MONTHS, YEARS } from './constants'
import { PJ, Label, Field } from './ui'

export default function SetupStep(props: {
  brands: DashBrand[]
  templates: ReportTemplateRecord[]
  onUseTemplate: (config: ReportTemplateConfig) => boolean
  brandId: string; onBrand: (id: string) => void
  month: string; setMonth: (v: string) => void; year: number; setYear: (v: number) => void
  title: string; setTitle: (v: string) => void; subtitle: string; setSubtitle: (v: string) => void
  font: string; setFont: (v: string) => void
  availablePeriods?: { year: number; month: number }[] | null
  onContinue: () => void
}) {
  const noBrands = props.brands.length === 0
  const [pickedId, setPickedId] = useState('')
  const applied = props.templates.find(t => t.id === pickedId)

  // Periods with data (null = still loading → don't disable anything yet). Years
  // are the fixed recent list merged with any data years so no real period hides.
  const periods = props.availablePeriods
  const hasPeriodData = !!(periods && periods.length)
  const availSet = new Set((periods ?? []).map(p => `${p.year}-${p.month}`))
  const availYears = new Set((periods ?? []).map(p => p.year))
  const yearOptions = [...new Set<number>([...YEARS, ...availYears])].sort((a, b) => b - a)
  const yearHasData = (y: number) => !hasPeriodData || availYears.has(y)
  const monthHasData = (name: string) => !hasPeriodData || availSet.has(`${props.year}-${MONTHS.indexOf(name) + 1}`)

  function handlePickTemplate(id: string) {
    if (!id) { setPickedId(''); return }
    const t = props.templates.find(x => x.id === id)
    if (t && props.onUseTemplate(t.config)) setPickedId(id)
  }

  return (
    <div className="max-w-[600px] mx-auto">
      <div className="bg-white rounded-2xl border border-[#e5e7eb] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#f0f1f2]">
          <h2 style={PJ} className="text-[15px] font-bold text-[#111827]">Report details</h2>
          <p className="text-[12px] text-[#9ca3af] mt-0.5">Pick the brand and reporting period, then design the cover.</p>
        </div>
        <div className="p-6 space-y-5">
          {props.templates.length > 0 && (
            <div className="rounded-xl border border-[#e3ece9] bg-gradient-to-br from-[#f2f8f5] to-[#eef4f7] p-4">
              <Label>Start from a saved template</Label>
              <select
                value={pickedId}
                onChange={e => handlePickTemplate(e.target.value)}
                style={PJ}
                className="w-full border border-[#cfe0da] rounded-lg px-3 py-2.5 text-[13px] text-[#111827] bg-white focus:border-[#3d7e96] focus:outline-none"
              >
                <option value="">Blank — build from scratch</option>
                {props.templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name} · {t.slideCount} slide{t.slideCount !== 1 ? 's' : ''}</option>
                ))}
              </select>
              {applied ? (
                <p className="text-[11.5px] text-[#1e6b5e] mt-2 flex items-start gap-1">
                  <span className="material-symbols-outlined text-[14px] leading-none mt-px">check_circle</span>
                  Struktur “{applied.name}” dimuat ({applied.slideCount} slide). Warna &amp; logo mengikuti brand yang dipilih di bawah.
                </p>
              ) : (
                <p className="text-[11px] text-[#73858c] mt-1.5">Muat struktur report yang tersimpan — data & branding ikut brand + periode di bawah.</p>
              )}
            </div>
          )}

          <div>
            <Label>Brand</Label>
            <select
              value={props.brandId}
              onChange={e => props.onBrand(e.target.value)}
              disabled={noBrands}
              style={PJ}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] text-[#111827] bg-white focus:border-[#3d7e96] focus:outline-none disabled:bg-[#f9fafb] disabled:text-[#9ca3af]"
            >
              {noBrands
                ? <option value="">No brands connected</option>
                : props.brands.map(b => (
                    <option key={b.id} value={b.id}>{b.handle ? `${b.name} · ${b.handle}` : b.name}</option>
                  ))}
            </select>
            {noBrands && (
              <p className="text-[11px] text-[#dc2626] mt-1.5">
                Belum ada brand terhubung untuk organisasi ini — hubungkan akun sosial dulu sebelum membuat report.
              </p>
            )}
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
                {MONTHS.map(m => (
                  <option key={m} value={m} disabled={!monthHasData(m)}>
                    {m}{monthHasData(m) ? '' : ' — no data'}
                  </option>
                ))}
              </select>
              <select
                value={props.year}
                onChange={e => props.setYear(Number(e.target.value))}
                style={PJ}
                className="border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] bg-white focus:border-[#3d7e96] focus:outline-none"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y} disabled={!yearHasData(y)}>
                    {y}{yearHasData(y) ? '' : ' — no data'}
                  </option>
                ))}
              </select>
            </div>
            {hasPeriodData
              ? <p className="text-[11px] text-[#9ca3af] mt-1.5">Hanya periode yang punya data yang bisa dipilih.</p>
              : periods
                ? <p className="text-[11px] text-[#dc2626] mt-1.5">Brand ini belum punya data periode apa pun.</p>
                : null}
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
            disabled={noBrands}
            style={PJ}
            className="flex items-center gap-2 bg-[#1e4f49] hover:bg-[#163a35] text-white text-[13px] font-bold px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#1e4f49]"
          >
            Design cover
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  )
}
