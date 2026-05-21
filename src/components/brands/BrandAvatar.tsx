import { getColorFromId } from '@/lib/brands/types'

interface Props {
  brand: { id: string; name: string; profile_url: string | null }
  size: number
}

export default function BrandAvatar({ brand, size }: Props) {
  const radius   = Math.round(size * 0.26)
  const fontSize = Math.round(size * 0.35)

  if (brand.profile_url) {
    return (
      <img
        src={brand.profile_url}
        alt={brand.name}
        style={{ width: size, height: size, borderRadius: radius }}
        className="object-cover flex-shrink-0 select-none"
      />
    )
  }

  const color    = getColorFromId(brand.id)
  const initials = brand.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div
      style={{ width: size, height: size, background: color, borderRadius: radius, fontSize }}
      className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none"
    >
      {initials}
    </div>
  )
}
