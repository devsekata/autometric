import { readableText, shade, tint } from '../colors'
import { CANVAS, CoverTemplate, svg } from './_shared'

export const diagonal: CoverTemplate = {
  id: 'diagonal',
  name: 'Diagonal',
  description: 'Diagonal color split with the title resting on a deep brand panel',
  layout: {
    logo: { x: 0.06, y: 0.08, w: 0.2, h: 0.1, align: 'left' },
    title: { x: 0.06, y: 0.48, w: 0.66, size: 0.078, align: 'left', bold: true },
    subtitle: { x: 0.06, y: 0.76, w: 0.55, size: 0.03, align: 'left' },
    period: { x: 0.06, y: 0.84, w: 0.4, size: 0.025, align: 'left' },
  },
  background: (c, mode) => {
    const base = mode === 'dark' ? shade(c.primary, 0.82) : tint(c.primary, 0.9)
    const panel = mode === 'dark' ? shade(c.primary, 0.55) : c.primary
    return svg(`
      <rect width="${CANVAS.w}" height="${CANVAS.h}" fill="${base}"/>
      <polygon points="0,720 0,330 1280,90 1280,720" fill="${panel}"/>
      <polygon points="0,720 0,520 560,720" fill="${c.accent}" opacity="0.35"/>
      <polygon points="1280,90 1280,300 760,90" fill="${c.secondary}" opacity="0.4"/>
    `)
  },
  textColor: (c, mode) => (mode === 'dark' ? '#ffffff' : readableText(c.primary)),
}
