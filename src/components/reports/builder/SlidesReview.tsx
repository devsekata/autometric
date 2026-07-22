'use client'

import { useState } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, SlideChrome } from '@/lib/reports/data/slideModel'
import SlidePreview from '../slides/SlidePreview'
import { PJ } from './ui'

export default function SlidesReview({
  slides, colors, isExporting, cover, chromeFor,
  onAdd, onOpen, onRename, onDelete, onExport, onSaveTemplate, onEditCover,
}: {
  slides: ContentSlide[]
  colors: CoverColors
  isExporting: boolean
  cover: React.ReactNode
  chromeFor: (index: number) => SlideChrome
  onAdd: () => void
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onExport: (mode: 'export' | 'export-save') => void
  onSaveTemplate: () => void
  onEditCover: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2.5 mb-6">
        <button
          onClick={onSaveTemplate}
          disabled={isExporting}
          style={PJ}
          className="flex items-center gap-2 bg-white hover:bg-[#F1F2FB] disabled:opacity-60 text-[#2C3079] text-[13px] font-bold px-5 py-2.5 rounded-xl border border-[#2C3079]/30 hover:border-[#2C3079] transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">bookmark_add</span>
          Save Template
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={isExporting}
            style={PJ}
            className="flex items-center gap-2 bg-[#2C3079] hover:bg-[#20224F] disabled:opacity-60 text-white text-[13px] font-bold pl-5 pr-4 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(30,79,73,0.30)] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            {isExporting ? 'Exporting…' : 'Export PPTX'}
            <span className={`material-symbols-outlined text-[18px] transition-transform ${menuOpen ? 'rotate-180' : ''}`}>expand_more</span>
          </button>

          {menuOpen && !isExporting && (
            <>
              {/* click-outside catcher */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl border border-[#e5e7eb] shadow-[0_12px_34px_rgba(15,23,42,0.14)] overflow-hidden z-20 py-1">
                <button
                  onClick={() => { setMenuOpen(false); onExport('export') }}
                  style={PJ}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#F1F2FB] transition-colors text-left"
                >
                  <span className="material-symbols-outlined text-[20px] text-[#2C3079] mt-0.5">download</span>
                  <span>
                    <span className="block text-[13px] font-bold text-[#0f172a]">Export only</span>
                    <span className="block text-[11.5px] text-[#94a3b8]">Download the .pptx to this device</span>
                  </span>
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onExport('export-save') }}
                  style={PJ}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#F1F2FB] transition-colors text-left"
                >
                  <span className="material-symbols-outlined text-[20px] text-[#2C3079] mt-0.5">cloud_upload</span>
                  <span>
                    <span className="block text-[13px] font-bold text-[#0f172a]">Export &amp; save</span>
                    <span className="block text-[11.5px] text-[#94a3b8]">Download and store in your reports library</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 style={PJ} className="text-[22px] font-bold text-[#0f172a] tracking-[-0.02em]">Slides</h2>
          <p className="text-[13px] text-[#94a3b8] mt-0.5">Click a slide to edit. Add as many as you need.</p>
        </div>
        <span style={PJ} className="text-[12px] font-semibold text-[#64748b] bg-[#f3f4f6] px-3 py-1.5 rounded-full">
          {slides.length + 1} slide{slides.length + 1 !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Cover slide (edits via the cover step) */}
        <div
          onClick={onEditCover}
          className="group cursor-pointer bg-white rounded-2xl border border-[#e5e7eb] overflow-hidden hover:shadow-[0_8px_26px_rgba(15,23,42,0.10)] hover:border-[#2C3079] hover:-translate-y-0.5 transition-all"
        >
          <div className="aspect-video relative border-b border-[#f1f3f5] overflow-hidden">
            {cover}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
              <span style={PJ} className="flex items-center gap-1.5 bg-white px-3.5 py-2 rounded-lg text-[12px] font-bold text-[#2C3079] shadow-sm">
                <span className="material-symbols-outlined text-[16px]">edit</span> Edit cover
              </span>
            </div>
          </div>
          <div className="px-4 h-14 flex items-center justify-between">
            <h3 style={PJ} className="text-[13.5px] font-bold text-[#0f172a]">Cover</h3>
            <span style={PJ} className="text-[10px] font-bold uppercase tracking-wide text-[#2C3079] bg-[#E6E7F3] px-2 py-0.5 rounded-full">Cover</span>
          </div>
        </div>

        {/* Content slides */}
        {slides.map((s, i) => (
          <div
            key={s.id}
            onClick={() => onOpen(s.id)}
            className="group cursor-pointer bg-white rounded-2xl border border-[#e5e7eb] overflow-hidden hover:shadow-[0_8px_26px_rgba(15,23,42,0.10)] hover:border-[#1B8A80] hover:-translate-y-0.5 transition-all"
          >
            <div className="aspect-video relative border-b border-[#f1f3f5] overflow-hidden">
              <SlidePreview slide={s} colors={colors} chrome={chromeFor(i)} />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <span style={PJ} className="flex items-center gap-1.5 bg-white px-3.5 py-2 rounded-lg text-[12px] font-bold text-[#1B8A80] shadow-sm">
                  <span className="material-symbols-outlined text-[16px]">edit</span> Edit slide
                </span>
              </div>
              <span style={PJ} className="absolute top-2.5 left-2.5 text-[10px] font-bold bg-white/90 text-[#64748b] w-6 h-6 flex items-center justify-center rounded-md">
                {i + 2}
              </span>
            </div>
            <div className="px-4 h-14 flex items-center justify-between gap-2">
              {editingId === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.title}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { onRename(s.id, e.target.value); setEditingId(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onRename(s.id, e.currentTarget.value); setEditingId(null) }
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  style={PJ}
                  className="flex-1 text-[13.5px] font-bold text-[#0f172a] border-b-2 border-[#1B8A80] outline-none bg-transparent"
                />
              ) : (
                <>
                  <h3 style={PJ} className="flex-1 text-[13.5px] font-bold text-[#0f172a] truncate">
                    {s.title || 'Untitled slide'}
                  </h3>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setEditingId(s.id) }}
                      title="Rename"
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md text-[#9ca3af] hover:text-[#1B8A80] hover:bg-[#f0f7fa] transition"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                      title="Delete"
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md text-[#9ca3af] hover:text-[#dc2626] hover:bg-[#fef2f2] transition"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {/* Add slide */}
        <button
          onClick={onAdd}
          className="aspect-[16/10] rounded-2xl border-2 border-dashed border-[#d1d5db] hover:border-[#2C3079] hover:bg-[#F1F2FB] transition-all flex flex-col items-center justify-center gap-3 group"
        >
          <span className="w-12 h-12 rounded-full bg-[#f3f4f6] group-hover:bg-[#dcebe6] flex items-center justify-center text-[#9ca3af] group-hover:text-[#2C3079] transition-colors">
            <span className="material-symbols-outlined text-[26px]">add</span>
          </span>
          <span style={PJ} className="text-[13px] font-semibold text-[#6b7280] group-hover:text-[#2C3079]">Add slide</span>
        </button>
      </div>
    </div>
  )
}
