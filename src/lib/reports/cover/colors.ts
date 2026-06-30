// Color helpers shared by cover preview (HTML) and PPTX export.
// All functions are pure and SSR-safe.

export interface CoverColors {
  primary: string
  secondary: string
  accent: string
}

export type CoverMode = 'light' | 'dark'

/** Normalize "#rgb" / "rgb" / "#rrggbb" to "#rrggbb" lowercase. */
export function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#000000'
  return '#' + h.toLowerCase()
}

function toRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex).slice(1)
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Mix `hex` toward `target` by `amt` (0..1). */
export function mix(hex: string, target: string, amt: number): string {
  const a = toRgb(hex)
  const b = toRgb(target)
  return toHex({
    r: a.r + (b.r - a.r) * amt,
    g: a.g + (b.g - a.g) * amt,
    b: a.b + (b.b - a.b) * amt,
  })
}

export const shade = (hex: string, amt: number) => mix(hex, '#000000', amt)
export const tint = (hex: string, amt: number) => mix(hex, '#ffffff', amt)

/** Relative luminance 0..1 (perceptual). */
export function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Pick a readable text color (dark or light) for the given background. */
export function readableText(bgHex: string): string {
  return luminance(bgHex) > 0.55 ? '#111827' : '#ffffff'
}

/** pptxgenjs wants hex without the leading '#'. */
export const noHash = (hex: string) => normalizeHex(hex).slice(1)

/**
 * Extract a primary / secondary / accent palette from a logo image (data URL).
 * Browser-only: quantizes pixels on a small canvas and ranks by frequency.
 * Returns null if the image can't be decoded.
 */
export function extractPalette(dataUrl: string): Promise<CoverColors | null> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const size = 64
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, size, size)
      let data: Uint8ClampedArray
      try {
        data = ctx.getImageData(0, 0, size, size).data
      } catch {
        return resolve(null)
      }

      // Bucket colors into a coarse grid, weighting saturated colors higher so
      // the brand hue wins over near-white / near-black backgrounds.
      const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3]
        if (a < 128) continue
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        const sat = max === 0 ? 0 : (max - min) / max
        // skip near-white and near-black for the dominant pass
        if (max > 240 && min > 230) continue
        if (max < 24) continue
        const key = `${r >> 4}-${g >> 4}-${b >> 4}`
        const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
        const w = 1 + sat * 3
        cur.count += w
        cur.r += r * w
        cur.g += g * w
        cur.b += b * w
        buckets.set(key, cur)
      }

      const ranked = [...buckets.values()]
        .map(b => ({ count: b.count, hex: toHex({ r: b.r / b.count, g: b.g / b.count, b: b.b / b.count }) }))
        .sort((a, b) => b.count - a.count)

      if (ranked.length === 0) return resolve(null)

      const primary = ranked[0].hex
      // secondary: most distinct color from primary among the top buckets
      const distinct = (a: string, b: string) => {
        const x = toRgb(a), y = toRgb(b)
        return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b)
      }
      const secondary = ranked.slice(1).sort((a, b) => distinct(b.hex, primary) - distinct(a.hex, primary))[0]?.hex
        ?? shade(primary, 0.3)
      const accent = ranked[1]?.hex ?? tint(primary, 0.3)

      resolve({ primary, secondary, accent })
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}
