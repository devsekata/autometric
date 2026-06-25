// Builds and downloads a one-slide PPTX cover. Browser-only.
//
// Strategy (Option B): the template background is rasterized to a full-bleed PNG,
// while the logo and text are added as native PPTX elements so the client can
// still edit them in PowerPoint.
import { CoverColors, CoverMode, noHash } from '../cover/colors'
import { CANVAS, CoverTemplate, TextBox, LogoBox } from '../cover/templates'

// 16:9 wide slide in inches.
const SLIDE = { w: 13.333, h: 7.5 } as const
const PT_PER_IN = 72

export interface CoverConfig {
  brandName: string
  title: string
  subtitle: string
  period: string
  logoDataUrl: string | null
  colors: CoverColors
  mode: CoverMode
  template: CoverTemplate
}

/** Rasterize an SVG string to a PNG data URL at the given pixel size. */
export function svgToPng(svgString: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        return reject(new Error('Canvas 2D context unavailable'))
      }
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to rasterize cover background'))
    }
    img.src = url
  })
}

const txtOpts = (box: TextBox, color: string) => ({
  x: box.x * SLIDE.w,
  y: box.y * SLIDE.h,
  w: box.w * SLIDE.w,
  // tall enough for up to ~3 wrapped lines, top-anchored to mirror the preview
  h: box.size * SLIDE.h * 3,
  fontSize: Math.round(box.size * SLIDE.h * PT_PER_IN),
  align: box.align,
  bold: box.bold ?? false,
  color: noHash(color),
  fontFace: 'Plus Jakarta Sans',
  lineSpacingMultiple: 1.15,
  margin: 0,
  valign: 'top' as const,
})

const logoBoxIn = (box: LogoBox) => ({
  x: box.x * SLIDE.w,
  y: box.y * SLIDE.h,
  w: box.w * SLIDE.w,
  h: box.h * SLIDE.h,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pptx = any

/** 16:9 slide dimensions in inches (exported for image slides). */
export const SLIDE_IN = SLIDE

/** Adds the editable cover slide to an existing pptx (Option B: raster bg + native text). */
export async function addCoverSlide(pptx: Pptx, cfg: CoverConfig): Promise<void> {
  const slide = pptx.addSlide()

  // Full-bleed background (rasterized at 2x for crisp output).
  const bgSvg = cfg.template.background(cfg.colors, cfg.mode)
  const bgPng = await svgToPng(bgSvg, CANVAS.w * 2, CANVAS.h * 2)
  slide.addImage({ data: bgPng, x: 0, y: 0, w: SLIDE.w, h: SLIDE.h })

  const { layout } = cfg.template
  const textColor = cfg.template.textColor(cfg.colors, cfg.mode)

  // Logo (or initials fallback drawn as a shape + letters).
  if (cfg.logoDataUrl) {
    const b = logoBoxIn(layout.logo)
    slide.addImage({ data: cfg.logoDataUrl, ...b, sizing: { type: 'contain', w: b.w, h: b.h } })
  } else {
    const b = logoBoxIn(layout.logo)
    const initials = cfg.brandName.slice(0, 2).toUpperCase()
    const d = Math.min(b.w, b.h)
    slide.addShape('ellipse', { x: b.x, y: b.y, w: d, h: d, fill: { color: noHash(cfg.colors.primary) } })
    slide.addText(initials, {
      x: b.x, y: b.y, w: d, h: d, align: 'center', valign: 'middle',
      fontSize: Math.round(d * PT_PER_IN * 0.4), bold: true, color: 'FFFFFF', fontFace: 'Plus Jakarta Sans',
    })
  }

  if (cfg.title) slide.addText(cfg.title, txtOpts(layout.title, textColor))
  if (cfg.subtitle) slide.addText(cfg.subtitle, { ...txtOpts(layout.subtitle, textColor), bold: false })
  if (cfg.period) slide.addText(cfg.period, { ...txtOpts(layout.period, textColor), bold: false })
}

export async function exportCoverPptx(cfg: CoverConfig): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'AUTOMETRIC_16x9', width: SLIDE.w, height: SLIDE.h })
  pptx.layout = 'AUTOMETRIC_16x9'

  await addCoverSlide(pptx, cfg)

  const safe = (cfg.brandName || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  await pptx.writeFile({ fileName: `${safe}-cover.pptx` })
}
