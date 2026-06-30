import { CANVAS, CoverTemplate, svg } from './_shared'

export const editorial: CoverTemplate = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Clean magazine layout with a top accent bar and rule',
  layout: {
    logo: { x: 0.06, y: 0.1, w: 0.18, h: 0.08, align: 'left' },
    title: { x: 0.06, y: 0.36, w: 0.82, size: 0.08, align: 'left', bold: true },
    subtitle: { x: 0.06, y: 0.66, w: 0.6, size: 0.03, align: 'left' },
    period: { x: 0.06, y: 0.74, w: 0.4, size: 0.025, align: 'left' },
  },
  background: (c, mode) => {
    const base = mode === 'dark' ? '#0f172a' : '#ffffff'
    return svg(`
      <rect width="${CANVAS.w}" height="${CANVAS.h}" fill="${base}"/>
      <rect x="0" y="0" width="${CANVAS.w}" height="12" fill="${c.primary}"/>
      <rect x="${0.06 * CANVAS.w}" y="${0.31 * CANVAS.h}" width="72" height="6" fill="${c.accent}"/>
      <rect x="1180" y="0" width="100" height="720" fill="${c.primary}" opacity="${mode === 'dark' ? 0.22 : 0.08}"/>
    `)
  },
  textColor: (_c, mode) => (mode === 'dark' ? '#ffffff' : '#111827'),
}
