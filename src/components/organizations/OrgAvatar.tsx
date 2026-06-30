const COLORS = [
  '#3d7e96',
  '#5b7a6e',
  '#64748b',
  '#7b6b8b',
  '#8b6b5e',
  '#6b7a5e',
]

function getColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return COLORS[hash % COLORS.length]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

interface Props {
  name: string
  size?: number
}

export default function OrgAvatar({ name, size = 32 }: Props) {
  return (
    <div
      style={{ width: size, height: size, backgroundColor: getColor(name) }}
      className="rounded-md flex items-center justify-center flex-shrink-0"
    >
      <span
        style={{ fontSize: Math.round(size * 0.38) }}
        className="font-semibold text-white leading-none select-none"
      >
        {getInitials(name)}
      </span>
    </div>
  )
}
