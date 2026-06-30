'use client'

import { CoverColors } from '@/lib/reports/cover/colors'
import { ContentSlide, SlideChrome } from '@/lib/reports/data/slideModel'
import { PJ } from './parts'

/**
 * Section Heading — a full-bleed, centered section divider. Background follows the
 * selected cover template (softened with a veil), centered "SECTION" eyebrow +
 * editable title + subtitle.
 */
export default function SectionSlide({
  slide, colors, chrome, editable, onChange,
}: {
  slide: ContentSlide
  colors: CoverColors
  chrome: SlideChrome
  editable: boolean
  onChange?: (next: ContentSlide) => void
}) {
  const setField = (k: keyof ContentSlide, v: string) => onChange?.({ ...slide, [k]: v })
  const svg = chrome.template.background(colors, chrome.mode)
  const bg = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  const text = chrome.template.textColor(colors, chrome.mode)
  const center: React.CSSProperties = { textAlign: 'center' }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundImage: bg, backgroundSize: 'cover', backgroundPosition: 'center', fontFamily: PJ.fontFamily }}>
      {/* Soft veil — tones down the gradient / color intensity */}
      <div className="absolute inset-0" style={{ background: chrome.mode === 'dark' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.24)' }} />

      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: '0 12cqw' }}>
        <div style={{ fontSize: '1.5cqw', fontWeight: 800, letterSpacing: '0.5em', textTransform: 'uppercase', color: text, opacity: 0.6, marginBottom: '2.4cqh' }}>
          Section
        </div>
        <div className="rounded-full" style={{ width: '7cqw', height: '0.6cqh', background: text, opacity: 0.8, marginBottom: '3.4cqh' }} />

        {editable ? (
          <input
            value={slide.title}
            onChange={e => setField('title', e.target.value)}
            placeholder="Section title"
            style={{ ...center, fontSize: '7cqw', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, color: text, background: 'transparent', outline: 'none', width: '100%' }}
          />
        ) : (
          <div className="truncate" style={{ ...center, fontSize: '7cqw', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, color: text, maxWidth: '100%' }}>
            {slide.title || 'Section Title'}
          </div>
        )}

        {editable ? (
          <input
            value={slide.body}
            onChange={e => setField('body', e.target.value)}
            placeholder="Add a subtitle (optional)"
            style={{ ...center, fontSize: '2.4cqw', fontWeight: 500, color: text, opacity: 0.85, background: 'transparent', outline: 'none', width: '100%', marginTop: '2.6cqh' }}
          />
        ) : (
          slide.body && (
            <div style={{ ...center, fontSize: '2.4cqw', fontWeight: 500, color: text, opacity: 0.85, marginTop: '2.6cqh' }}>{slide.body}</div>
          )
        )}

        <div className="flex items-center" style={{ gap: '1.2cqw', marginTop: '3.6cqh' }}>
          <span className="rounded-full" style={{ width: '1.4cqw', height: '1.4cqw', background: text, opacity: 0.55 }} />
          <span className="rounded-full" style={{ width: '1.4cqw', height: '1.4cqw', background: text, opacity: 0.55 }} />
          <span className="rounded-full" style={{ width: '1.4cqw', height: '1.4cqw', background: text, opacity: 0.55 }} />
        </div>
      </div>
    </div>
  )
}
