import { SocialAccount, CompetitorAccount, PLATFORM_CONFIG } from '@/lib/brands/types'
import CompetitorAvatars from './CompetitorAvatars'
import PlatformIcon from '../PlatformIcon'

interface Props {
  account: SocialAccount
  competitors: CompetitorAccount[]
  brandCreatedAt: string
}

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ChannelRow({ account, competitors, brandCreatedAt }: Props) {
  const cfg = PLATFORM_CONFIG[account.platform]

  return (
    <div className="grid grid-cols-[1.6fr_1.4fr_1.2fr_1fr_1.3fr_1.3fr] items-center px-6 py-2.5 border-b border-[#e5e7eb] hover:bg-[#fafafa] transition-colors">

      <div className="flex items-center gap-2 pr-4">
        <PlatformIcon platform={account.platform} size={22} />
        <span style={PJB} className="text-[13px] font-medium text-[#374151]">{cfg.label}</span>
      </div>

      <div className="flex items-center gap-2 pr-4 min-w-0">
        {account.avatar_url
          ? <img src={account.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
          : <PlatformIcon platform={account.platform} size={18} />
        }
        <span style={PJB} className="text-[13px] font-medium text-[#111827] truncate">{account.username}</span>
      </div>

      <div className="pr-4"><CompetitorAvatars competitors={competitors} /></div>

      <div>
        {account.connected ? (
          <span style={PJB} className="inline-flex items-center gap-1.5 h-[20px] px-2 rounded-full text-[10.5px] font-semibold bg-[#ecfdf5] text-[#059669]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0" />
            Connected
          </span>
        ) : (
          <span style={PJB} className="inline-flex items-center gap-1.5 h-[20px] px-2 rounded-full text-[10.5px] font-semibold bg-[#fef2f2] text-[#dc2626]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444] flex-shrink-0" />
            Disconnected
          </span>
        )}
      </div>

      <span style={PJB} className="text-[12px] text-[#9ca3af] tabular-nums">{fmt(account.connected_at)}</span>
      <span style={PJB} className="text-[12px] text-[#9ca3af] tabular-nums">{fmt(brandCreatedAt)}</span>

    </div>
  )
}
