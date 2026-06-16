import { CompetitorAccount } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'

interface Props {
  competitors: CompetitorAccount[]
}

export default function CompetitorAvatars({ competitors }: Props) {
  if (competitors.length === 0) {
    return <span className="text-[13px] text-[#c4c9d4]">—</span>
  }

  const shown = competitors.slice(0, 4)
  const rest  = competitors.length - shown.length

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {shown.map((c, i) => (
          <div key={c.social_account_id}
            title={c.username}
            style={{ zIndex: shown.length - i, width: 22, height: 22 }}
            className="rounded-full border-2 border-white bg-[#f3f4f6] flex items-center justify-center flex-shrink-0 overflow-hidden">
            {c.avatar_url
              ? <img src={c.avatar_url} alt={c.username} className="w-full h-full object-cover" />
              : <PlatformIcon platform={c.platform} size={14} />
            }
          </div>
        ))}
      </div>
      {rest > 0 && (
        <span className="text-[11px] font-semibold text-[#6b7280]">+{rest}</span>
      )}
    </div>
  )
}
