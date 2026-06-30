import { CANVAS, CoverTemplate, svg } from './_shared'

export const blocks: CoverTemplate = {
  id: 'blocks',
  name: 'Color Blocks',
  description: 'Bold geometric blocks, logo top-left, title over a clean field',
  layout: {
    logo: { x: 0.06, y: 0.08, w: 0.18, h: 0.09, align: 'left' },
    title: { x: 0.06, y: 0.34, w: 0.74, size: 0.082, align: 'left', bold: true },
    subtitle: { x: 0.06, y: 0.62, w: 0.6, size: 0.03, align: 'left' },
    period: { x: 0.06, y: 0.7, w: 0.4, size: 0.025, align: 'left' },
  },
  background: (c, mode) => {
    const base = mode === 'dark' ? '#0f172a' : '#f8fafc'
    return svg(`
      <rect width="${CANVAS.w}" height="${CANVAS.h}" fill="${base}"/>
      <rect x="0" y="0" width="1280" height="14" fill="${c.primary}"/>
      <rect x="980" y="0" width="300" height="720" fill="${c.primary}" opacity="${mode === 'dark' ? 0.25 : 0.12}"/>
      <rect x="1100" y="120" width="120" height="120" fill="${c.secondary}"/>
      <rect x="1040" y="300" width="120" height="120" fill="${c.accent}"/>
      <rect x="1160" y="300" width="60" height="120" fill="${c.primary}"/>
    `)
  },
  textColor: (_c, mode) => (mode === 'dark' ? '#ffffff' : '#111827'),
}
