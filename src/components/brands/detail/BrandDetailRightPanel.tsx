'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useBrandDetail } from './BrandDetailContext'
import { PLATFORM_CONFIG } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const PLATFORM_LOGO: Record<string, string> = {
  instagram: '/instagram.png',
  facebook:  '/facebook.png',
  tiktok:    '/tiktok.png',
}

function getProfileUrl(platform: string, username: string) {
  const u = username.replace(/^@/, '')
  switch (platform) {
    case 'instagram': return `https://instagram.com/${u}`
    case 'tiktok':    return `https://tiktok.com/@${u}`
    case 'facebook':  return `https://facebook.com/${u}`
    case 'youtube':   return `https://youtube.com/@${u}`
    case 'twitter':   return `https://x.com/${u}`
    default:          return '#'
  }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrandDetailRightPanel() {
  const { brand, orgName } = useBrandDetail()
  const params  = useParams()
  const orgSlug = params?.orgSlug as string

  return (
    <div className="flex flex-col">

      <div className="pb-5 border-b border-[#e5e7eb]">
        <p className="text-[12px] text-[#9ca3af] leading-[1.7] mb-3">
          Track and manage all your brand's social media performance in one place.
          Monitor growth, compare with competitors, and get insights across
          Facebook, Instagram, and TikTok — all from your organization dashboard.
        </p>
        <Link href={`/organizations/${orgSlug}`} style={PJB}
          className="text-[12px] font-semibold text-[#285D6E] hover:text-[#1E4A58] transition-colors">
          Go to Dashboard →
        </Link>
      </div>

      <div className="pt-5">
        <p style={PJB} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-3">
          Brand Info
        </p>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span style={PJB} className="text-[12px] text-[#9ca3af] flex-shrink-0">Organization</span>
            <span style={PJB} className="text-[12px] font-semibold text-[#374151] truncate text-right">{orgName}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span style={PJB} className="text-[12px] text-[#9ca3af] flex-shrink-0">Created</span>
            <span style={PJB} className="text-[12px] text-[#374151]">{formatDate(brand.created_at)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span style={PJB} className="text-[12px] text-[#9ca3af] flex-shrink-0">Competitors</span>
            <span style={PJB} className="text-[12px] font-semibold text-[#374151]">{brand.competitors.length}</span>
          </div>

          <div className="flex items-center gap-2">
            {brand.accounts.map(acc => {
              const logo = PLATFORM_LOGO[acc.platform]
              const cfg  = PLATFORM_CONFIG[acc.platform]
              if (!logo) return null
              return (
                <a key={acc.id} href={acc.profile_url ?? getProfileUrl(acc.platform, acc.username)}
                  target="_blank" rel="noopener noreferrer"
                  title={`${cfg.label} · ${acc.username}`}
                  className="hover:opacity-70 transition-opacity flex-shrink-0">
                  <img src={logo} alt={cfg.label} style={{ width: 24, height: 24, objectFit: 'contain' }} className="rounded-md" />
                </a>
              )
            })}
          </div>
        </div>
      </div>

    </div>
  )
}
