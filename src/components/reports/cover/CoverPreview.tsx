'use client'

import { useMemo } from 'react'
import { CoverColors, CoverMode } from '@/lib/reports/cover/colors'
import { CoverTemplate, TextBox } from '@/lib/reports/cover/templates'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export interface CoverPreviewProps {
  brandName: string
  title: string
  subtitle: string
  period: string
  logoDataUrl: string | null
  colors: CoverColors
  mode: CoverMode
  template: CoverTemplate
}

/**
 * Live, pixel-faithful preview of the report cover. The background is the same
 * SVG used by the PPTX export; logo + text are HTML overlays positioned with the
 * template's fractional layout. Font sizes use container-query height units so
 * the cover scales cleanly with its container.
 */
export default function CoverPreview(props: CoverPreviewProps) {
  const { brandName, title, subtitle, period, logoDataUrl, colors, mode, template } = props

  const bgUrl = useMemo(() => {
    const svg = template.background(colors, mode)
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  }, [template, colors, mode])

  const textColor = template.textColor(colors, mode)
  const { layout } = template

  const textStyle = (box: TextBox): React.CSSProperties => ({
    position: 'absolute',
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    fontSize: `${box.size * 100}cqh`,
    fontWeight: box.bold ? 800 : 500,
    textAlign: box.align,
    color: textColor,
    lineHeight: 1.15,
    letterSpacing: box.bold ? '-0.02em' : 0,
    ...PJ,
  })

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl shadow-lg shadow-black/10 ring-1 ring-black/5"
      style={{
        aspectRatio: '16 / 9',
        containerType: 'size',
        backgroundImage: bgUrl,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Logo or initials fallback */}
      {logoDataUrl ? (
        <img
          src={logoDataUrl}
          alt="logo"
          style={{
            position: 'absolute',
            left: `${layout.logo.x * 100}%`,
            top: `${layout.logo.y * 100}%`,
            width: `${layout.logo.w * 100}%`,
            height: `${layout.logo.h * 100}%`,
            objectFit: 'contain',
            objectPosition:
              layout.logo.align === 'center' ? 'center' : layout.logo.align === 'right' ? 'right' : 'left',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            left: `${layout.logo.x * 100}%`,
            top: `${layout.logo.y * 100}%`,
            height: `${layout.logo.h * 100}%`,
            aspectRatio: '1 / 1',
            borderRadius: '9999px',
            background: colors.primary,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: `${layout.logo.h * 45}cqh`,
            ...PJ,
          }}
        >
          {brandName.slice(0, 2).toUpperCase()}
        </div>
      )}

      {title && <div style={textStyle(layout.title)}>{title}</div>}
      {subtitle && <div style={textStyle(layout.subtitle)}>{subtitle}</div>}
      {period && <div style={{ ...textStyle(layout.period), opacity: 0.9 }}>{period}</div>}
    </div>
  )
}
