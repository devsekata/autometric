// Dummy post data for the Visual Analysis slide (mirrors report_2's LayoutContent).
// Deterministic so preview == export.

export const POST_METRICS: { id: string; label: string }[] = [
  { id: 'reach', label: 'Reach' },
  { id: 'impressions', label: 'Impressions' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'likes', label: 'Likes' },
  { id: 'comments', label: 'Comments' },
  { id: 'saves', label: 'Saves' },
  { id: 'shares', label: 'Shares' },
  { id: 'views', label: 'Views' },
  { id: 'er', label: 'ER' },
]

export const POST_FILTERS: { id: string; label: string }[] = [
  { id: 'top', label: 'Top performing' },
  { id: 'low', label: 'Low performing' },
  { id: 'mixed', label: 'Top & low (mixed)' },
]

export const POST_COUNTS = [4, 6, 8]

export interface PostRow {
  id: number
  tag?: 'TOP' | 'LOW'
  metrics: Record<string, string>
}

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}

const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n))

function makePost(i: number): { id: number; engagement: number; raw: Record<string, number | string> } {
  const reach = Math.floor(hash01(`r${i}`) * 50000) + 1000
  const engagement = Math.floor(hash01(`e${i}`) * 5000) + 100
  const raw: Record<string, number | string> = {
    reach, impressions: Math.floor(reach * (1 + hash01(`i${i}`) * 0.5)),
    engagement, likes: Math.floor(engagement * 0.75), comments: Math.floor(engagement * 0.1),
    saves: Math.floor(engagement * 0.08), shares: Math.floor(engagement * 0.07),
    views: Math.floor(reach * 0.6), er: ((engagement / reach) * 100).toFixed(2) + '%',
  }
  return { id: i, engagement, raw }
}

export function buildPosts(count: number, filter: string): PostRow[] {
  const all = Array.from({ length: 24 }, (_, i) => makePost(i)).sort((a, b) => b.engagement - a.engagement)
  let picked: { id: number; raw: Record<string, number | string>; tag?: 'TOP' | 'LOW' }[]
  if (filter === 'low') picked = [...all].reverse().slice(0, count)
  else if (filter === 'mixed') {
    const half = Math.ceil(count / 2)
    picked = [
      ...all.slice(0, half).map(p => ({ ...p, tag: 'TOP' as const })),
      ...[...all].reverse().slice(0, count - half).map(p => ({ ...p, tag: 'LOW' as const })),
    ]
  } else picked = all.slice(0, count)

  return picked.map(p => {
    const metrics: Record<string, string> = {}
    POST_METRICS.forEach(m => {
      const v = p.raw[m.id]
      metrics[m.id] = typeof v === 'string' ? v : fmtK(v)
    })
    return { id: p.id + 204, tag: p.tag, metrics }
  })
}

export const metricLabel = (id: string) => POST_METRICS.find(m => m.id === id)?.label ?? id
