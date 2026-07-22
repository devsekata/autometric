'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, SlideChrome, ConfigBlock } from '@/lib/reports/data/slideModel'
import SlidePreview from '../slides/SlidePreview'
import { PJ } from './ui'

export default function SlideEditor({
  slide, colors, chrome, index, total, nextIsAdd,
  onChange, onConfigure, onBack, onPrev, onNext,
}: {
  slide: ContentSlide
  colors: CoverColors
  chrome: SlideChrome
  index: number
  total: number
  nextIsAdd: boolean
  onChange: (next: ContentSlide) => void
  onConfigure: (block: ConfigBlock) => void
  onBack: () => void
  onPrev?: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-[1000px] flex items-end justify-between mb-3">
        <h2 style={PJ} className="flex items-center gap-2 text-[15px] font-bold text-[#334155]">
          <span className="material-symbols-outlined text-[18px] text-[#94a3b8]">slideshow</span>
          Editing: {slide.title || 'Untitled slide'}
        </h2>
        <div className="flex items-center gap-3">
          <span style={PJ} className="text-[12px] font-mono bg-[#f3f4f6] px-2.5 py-1 rounded text-[#64748b]">
            {index + 2} / {total + 1}
          </span>
          <button
            onClick={onBack}
            style={PJ}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-[#6b7280] hover:text-[#374151] px-3 py-1.5 rounded-lg border border-[#e5e7eb] hover:border-[#d1d5db] hover:bg-[#f9fafb] transition"
          >
            <span className="material-symbols-outlined text-[15px]">arrow_back</span> Back to slides
          </button>
        </div>
      </div>

      <div className="w-full max-w-[1380px] flex items-center gap-4 justify-center">
        <button
          onClick={onPrev}
          disabled={!onPrev}
          title="Previous slide"
          className="w-12 h-12 flex items-center justify-center bg-white border-2 border-[#e5e7eb] rounded-xl text-[#475569] shadow-sm hover:border-[#1B8A80] hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[26px]">chevron_left</span>
        </button>

        <div className="flex-1 max-w-[1120px] rounded-2xl shadow-[0_30px_60px_-22px_rgba(16,24,40,0.40)]">
          <SlidePreview slide={slide} colors={colors} chrome={chrome} editable onChange={onChange} onConfigure={onConfigure} />
        </div>

        <button
          onClick={onNext}
          title={nextIsAdd ? 'Add new slide' : 'Next slide'}
          className={`w-12 h-12 flex items-center justify-center rounded-xl shadow-sm hover:scale-105 transition-all flex-shrink-0 border-2 ${
            nextIsAdd
              ? 'bg-[#F1F2FB] border-[#cfe5dd] text-[#2C3079] hover:border-[#2C3079]'
              : 'bg-white border-[#e5e7eb] text-[#475569] hover:border-[#1B8A80]'
          }`}
        >
          <span className="material-symbols-outlined text-[26px]">{nextIsAdd ? 'add' : 'chevron_right'}</span>
        </button>
      </div>

      <p className="mt-4 text-[12px] text-[#94a3b8]">Type directly on the slide to edit the title and content.</p>
    </div>
  )
}
