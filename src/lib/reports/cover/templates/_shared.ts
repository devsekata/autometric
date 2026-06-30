// Shared types + helpers for cover templates.
//
// Each template owns a tintable background (rendered as SVG) plus a layout map.
// Layout positions are FRACTIONS of the 16:9 canvas (0..1) so the exact same
// numbers drive both the on-screen HTML preview and the PPTX export.
import { CoverColors, CoverMode } from '../colors'

export const CANVAS = { w: 1280, h: 720 } as const

export type TextAlign = 'left' | 'center' | 'right'

export interface TextBox {
  x: number
  y: number
  w: number
  /** font size as a fraction of canvas height */
  size: number
  align: TextAlign
  bold?: boolean
}

export interface LogoBox {
  x: number
  y: number
  w: number
  h: number
  align: TextAlign
}

export interface CoverLayout {
  logo: LogoBox
  title: TextBox
  subtitle: TextBox
  period: TextBox
}

export interface CoverTemplate {
  id: string
  name: string
  description: string
  layout: CoverLayout
  /** Background only — text & logo are overlaid separately so they stay editable in PPT. */
  background: (c: CoverColors, mode: CoverMode) => string
  /** Text color over this template's text region. */
  textColor: (c: CoverColors, mode: CoverMode) => string
}

export function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.w}" height="${CANVAS.h}" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}">${inner}</svg>`
}
