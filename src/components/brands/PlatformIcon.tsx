import { Platform, PLATFORM_CONFIG } from '@/lib/brands/types'

const LOGOS: Partial<Record<Platform, string>> = {
  instagram: '/instagram.png',
  facebook:  '/facebook.png',
  tiktok:    '/tiktok.png',
}

interface Props {
  platform: Platform
  size?: number
}

export default function PlatformIcon({ platform, size = 22 }: Props) {
  const cfg  = PLATFORM_CONFIG[platform]
  const logo = LOGOS[platform]

  if (logo) {
    return (
      <img
        src={logo}
        alt={cfg.label}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
        className="rounded-md"
      />
    )
  }

  return (
    <div
      style={{
        width: size, height: size,
        borderRadius: Math.round(size * 0.27),
        background: cfg.bg,
        fontSize: Math.round(size * 0.38),
        fontWeight: 900,
        color: cfg.textColor,
        flexShrink: 0,
      }}
      className="flex items-center justify-center leading-none select-none"
    >
      {cfg.short}
    </div>
  )
}
