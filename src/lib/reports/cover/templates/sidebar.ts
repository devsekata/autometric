import { shade } from '../colors'
import { CANVAS, CoverTemplate, svg } from './_shared'

export const sidebar: CoverTemplate = {
  id: 'sidebar',
  name: 'Sidebar',
  description: 'Solid brand panel on the left holding the logo and title',
  layout: {
    logo: { x: 0.06, y: 0.1, w: 0.2, h: 0.09, align: 'left' },
    title: { x: 0.06, y: 0.4, w: 0.3, size: 0.058, align: 'left', bold: true },
    subtitle: { x: 0.06, y: 0.68, w: 0.28, size: 0.026, align: 'left' },
    period: { x: 0.06, y: 0.75, w: 0.28, size: 0.022, align: 'left' },
  },
  background: (c, mode) => {
    const base = mode === 'dark' ? shade(c.primary, 0.85) : '#f4f6f8'
    const panel = mode === 'dark' ? shade(c.primary, 0.45) : c.primary
    return svg(`
      <rect width="${CANVAS.w}" height="${CANVAS.h}" fill="${base}"/>
      <rect x="0" y="0" width="486" height="720" fill="${panel}"/>
      <rect x="486" y="0" width="14" height="720" fill="${c.accent}"/>
      <circle cx="930" cy="560" r="190" fill="${c.secondary}" opacity="0.12"/>
    `)
  },
  textColor: () => '#ffffff',
}
