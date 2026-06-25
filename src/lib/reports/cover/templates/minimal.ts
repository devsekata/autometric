import { readableText, shade, tint } from '../colors'
import { CANVAS, CoverTemplate, svg } from './_shared'

export const minimal: CoverTemplate = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Centered, elegant layout with generous negative space',
  layout: {
    logo: { x: 0.42, y: 0.24, w: 0.16, h: 0.11, align: 'center' },
    title: { x: 0.1, y: 0.44, w: 0.8, size: 0.066, align: 'center', bold: true },
    subtitle: { x: 0.2, y: 0.66, w: 0.6, size: 0.028, align: 'center' },
    period: { x: 0.3, y: 0.74, w: 0.4, size: 0.024, align: 'center' },
  },
  background: (c, mode) => {
    const base = mode === 'dark' ? shade(c.primary, 0.86) : '#ffffff'
    const line = mode === 'dark' ? tint(c.primary, 0.2) : c.primary
    return svg(`
      <rect width="${CANVAS.w}" height="${CANVAS.h}" fill="${base}"/>
      <rect x="560" y="498" width="160" height="4" fill="${line}"/>
      <circle cx="640" cy="${CANVAS.h * 0.32}" r="320" fill="${c.accent}" opacity="${mode === 'dark' ? 0.08 : 0.05}"/>
    `)
  },
  textColor: (c, mode) => (mode === 'dark' ? '#ffffff' : readableText('#ffffff')),
}
