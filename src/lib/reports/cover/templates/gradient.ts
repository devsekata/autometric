import { shade } from '../colors'
import { CANVAS, CoverTemplate, svg } from './_shared'

export const gradient: CoverTemplate = {
  id: 'gradient',
  name: 'Gradient',
  description: 'Full diagonal gradient from primary to secondary',
  layout: {
    logo: { x: 0.06, y: 0.1, w: 0.2, h: 0.09, align: 'left' },
    title: { x: 0.06, y: 0.54, w: 0.74, size: 0.076, align: 'left', bold: true },
    subtitle: { x: 0.06, y: 0.8, w: 0.6, size: 0.03, align: 'left' },
    period: { x: 0.06, y: 0.88, w: 0.4, size: 0.025, align: 'left' },
  },
  background: (c, mode) => {
    const from = mode === 'dark' ? shade(c.primary, 0.35) : c.primary
    const to = mode === 'dark' ? shade(c.secondary, 0.35) : c.secondary
    return svg(`
      <defs>
        <linearGradient id="gGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${from}"/>
          <stop offset="1" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect width="${CANVAS.w}" height="${CANVAS.h}" fill="url(#gGrad)"/>
      <circle cx="1060" cy="170" r="240" fill="#ffffff" opacity="0.06"/>
      <circle cx="180" cy="640" r="160" fill="${c.accent}" opacity="0.18"/>
    `)
  },
  textColor: () => '#ffffff',
}
