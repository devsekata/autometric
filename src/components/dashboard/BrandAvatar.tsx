'use client'

import { useState } from 'react'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/**
 * Brand avatar for the dashboard. Shows the brand's profile image
 * (public.brands.profile_url, surfaced as DashBrand.logo) when it's a valid http(s)
 * URL; otherwise — or if the image fails to load — falls back to the coloured
 * initials badge. `className` controls sizing + shape (e.g. "w-14 h-14 rounded-2xl").
 */
export default function BrandAvatar({ logo, initials, color, name, className, textClass }: {
  logo?: string | null
  initials: string
  color: string
  name?: string
  className: string
  textClass?: string
}) {
  const [err, setErr] = useState(false)
  const showImg = !!logo && /^https?:\/\//.test(logo) && !err

  if (showImg) {
    return (
      <img src={logo!} alt={name ?? initials} onError={() => setErr(true)}
        className={`${className} object-cover bg-[#f3f4f6] flex-shrink-0`} />
    )
  }
  return (
    <span style={{ background: color, ...PJ }}
      className={`${className} flex items-center justify-center text-white font-bold flex-shrink-0 ${textClass ?? ''}`}>
      {initials}
    </span>
  )
}
