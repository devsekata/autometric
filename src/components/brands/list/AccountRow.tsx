import Link from 'next/link'
import { Brand, SocialAccount, PLATFORM_CONFIG, getColorFromId } from '@/lib/brands/types'
import CompetitorAvatars from './CompetitorAvatars'
import PlatformIcon from '../PlatformIcon'

interface Props {
  brand: Brand
  account: SocialAccount
  orgSlug: string
}

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function BrandAvatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ width: 22, height: 22, background: color, borderRadius: 6, fontSize: 8.5 }}
      className="flex items-center justify-center font-bold text-white leading-none select-none flex-shrink-0">
      {initials}
    </div>
  )
}

export default function AccountRow({ brand, account, orgSlug }: Props) {
  const cfg   = PLATFORM_CONFIG[account.platform]
  const color = getColorFromId(brand.id)

  return (
    <div className="grid grid-cols-[1.6fr_1.2fr_1.4fr_1.2fr_1.3fr_1.3fr] items-center px-6 py-2.5 border-b border-[#e5e7eb] hover:bg-[#fafafa] transition-colors">

      <div className="flex items-center gap-2 pr-4 min-w-0">
        <BrandAvatar name={brand.name} color={color} />
        <Link href={`/organizations/${orgSlug}/brands/${brand.id}/overview`}
          style={PJB} className="text-[13px] font-semibold text-[#111827] truncate hover:text-[#3d7e96] transition-colors">
          {brand.name}
        </Link>
      </div>

      <div className="flex items-center gap-2 pr-4">
        <PlatformIcon platform={account.platform} size={22} />
        <span style={PJB} className="text-[12.5px] text-[#374151]">{cfg.label}</span>
      </div>

      <span style={PJB} className="text-[13px] font-medium text-[#111827] truncate pr-4">{account.username}</span>

      <div className="pr-4"><CompetitorAvatars competitors={brand.competitors} /></div>

      <span style={PJB} className="text-[12px] text-[#9ca3af] tabular-nums">{fmt(account.connected_at)}</span>
      <span style={PJB} className="text-[12px] text-[#9ca3af] tabular-nums">{fmt(brand.created_at)}</span>

    </div>
  )
}
