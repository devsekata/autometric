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
  font?: string
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

/** Natural pixel dimensions of an image (data URL or URL). */
export function imgDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
    img.onerror = () => resolve({ w: 1, h: 1 })
    img.src = src
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySlide = any

/**
 * Places an image *contained* inside a box (preserves aspect — no stretch),
 * aligned horizontally (left/center/right) and centered vertically. Avoids
 * pptxgenjs `sizing` which is unreliable for base64 data URLs.
 */
export async function addContainImage(slide: AnySlide, data: string, bx: number, by: number, bw: number, bh: number, alignX: 'left' | 'center' | 'right' = 'left'): Promise<number> {
  const { w: iw, h: ih } = await imgDims(data)
  const ar = iw / ih
  let dw = bw, dh = bw / ar
  if (dh > bh) { dh = bh; dw = bh * ar }
  const dx = alignX === 'center' ? bx + (bw - dw) / 2 : alignX === 'right' ? bx + (bw - dw) : bx
  const dy = by + (bh - dh) / 2
  slide.addImage({ data, x: dx, y: dy, w: dw, h: dh })
  return dw
}

/** Centre-crop a data URL to an aspect ratio. Null if it can't be decoded. */
function cropToAspect(src: string, targetAr: number): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1
        // Keep the largest centred region that already has the target ratio.
        let sw = iw, sh = ih
        if (iw / ih > targetAr) sw = ih * targetAr   // too wide → trim the sides
        else sh = iw / targetAr                      // too tall → trim top & bottom
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(sw))
        canvas.height = Math.max(1, Math.round(sh))
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)
        // JPEG unless the source carries transparency — re-encoding photos as PNG
        // bloats the .pptx badly.
        resolve(src.startsWith('data:image/png') ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88))
      } catch { resolve(null) }   // tainted canvas → caller falls back to contain
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Places an image *covering* a box — fills it edge to edge, centre-cropped, no
 * letterboxing and no stretch. Crops on a canvas instead of using pptxgenjs
 * `sizing`, which is unreliable for base64 data URLs.
 */
export async function addCoverImage(slide: AnySlide, data: string, bx: number, by: number, bw: number, bh: number): Promise<void> {
  const cropped = await cropToAspect(data, bw / bh)
  if (cropped) slide.addImage({ data: cropped, x: bx, y: by, w: bw, h: bh })
  else await addContainImage(slide, data, bx, by, bw, bh, 'center')
}

const txtOpts = (box: TextBox, color: string, font: string) => ({
  x: box.x * SLIDE.w,
  y: box.y * SLIDE.h,
  w: box.w * SLIDE.w,
  // tall enough for up to ~3 wrapped lines, top-anchored to mirror the preview
  h: box.size * SLIDE.h * 3,
  fontSize: Math.round(box.size * SLIDE.h * PT_PER_IN),
  align: box.align,
  bold: box.bold ?? false,
  color: noHash(color),
  fontFace: font,
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
  const font = cfg.font ?? 'Calibri'

  // Logo (or initials fallback drawn as a shape + letters).
  if (cfg.logoDataUrl) {
    const b = logoBoxIn(layout.logo)
    await addContainImage(slide, cfg.logoDataUrl, b.x, b.y, b.w, b.h, layout.logo.align)
  } else {
    const b = logoBoxIn(layout.logo)
    const initials = cfg.brandName.slice(0, 2).toUpperCase()
    const d = Math.min(b.w, b.h)
    slide.addShape('ellipse', { x: b.x, y: b.y, w: d, h: d, fill: { color: noHash(cfg.colors.primary) } })
    slide.addText(initials, {
      x: b.x, y: b.y, w: d, h: d, align: 'center', valign: 'middle',
      fontSize: Math.round(d * PT_PER_IN * 0.4), bold: true, color: 'FFFFFF', fontFace: font,
    })
  }

  if (cfg.title) slide.addText(cfg.title, txtOpts(layout.title, textColor, font))
  if (cfg.subtitle) slide.addText(cfg.subtitle, { ...txtOpts(layout.subtitle, textColor, font), bold: false })
  if (cfg.period) slide.addText(cfg.period, { ...txtOpts(layout.period, textColor, font), bold: false })
}

export async function exportCoverPptx(cfg: CoverConfig): Promise<{ blob: Blob; fileName: string }> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'AUTOMETRIC_16x9', width: SLIDE.w, height: SLIDE.h })
  pptx.layout = 'AUTOMETRIC_16x9'

  await addCoverSlide(pptx, cfg)

  const safe = (cfg.brandName || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const fileName = `${safe}-cover.pptx`
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  return { blob, fileName }
}
