import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listDiscoverContent } from '@/lib/discover/content'
import {
  DEFAULT_DISCOVER_FILTERS, DISCOVER_FORMATS,
  type DiscoverFilters, type DiscoverFormat, type DiscoverPlatform, type DiscoverSort,
} from '@/lib/discover/types'

type Params = { params: Promise<{ id: string }> }

const PLATFORMS: DiscoverPlatform[] = ['instagram', 'facebook', 'tiktok']
const SORTS: DiscoverSort[] = ['new', 'old', 'views', 'likes', 'er', 'best', 'worst']
const TYPES = ['all', 'organic', 'sponsored', 'campaign', 'boosted'] as const
const SOURCES = ['all', 'brand', 'competitor'] as const

/** Clamp a numeric query param; anything unparseable falls back to `dflt`. */
function num(v: string | null, dflt: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : dflt
}

// GET /api/organizations/[id]/discover/content?q=&format=&platform=&pillar=&type=&source=&erMin=&likesMin=&viewsMin=&days=&sort=&page=&pageSize=&brand=
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const formatRaw = sp.get('format') ?? 'All'
    const platformRaw = (sp.get('platform') ?? 'all').toLowerCase()
    const typeRaw = (sp.get('type') ?? 'all').toLowerCase()
    const sourceRaw = (sp.get('source') ?? 'all').toLowerCase()
    const sortRaw = (sp.get('sort') ?? 'views').toLowerCase()
    const daysRaw = sp.get('days')

    const filters: DiscoverFilters = {
      q: sp.get('q') ?? '',
      format: DISCOVER_FORMATS.includes(formatRaw as DiscoverFormat)
        ? (formatRaw as DiscoverFormat) : 'All',
      platform: PLATFORMS.includes(platformRaw as DiscoverPlatform)
        ? (platformRaw as DiscoverPlatform) : 'all',
      pillar: sp.get('pillar') || 'all',
      type: (TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as DiscoverFilters['type']) : 'all',
      source: (SOURCES as readonly string[]).includes(sourceRaw) ? (sourceRaw as DiscoverFilters['source']) : 'all',
      erMin: num(sp.get('erMin'), 0, 100),
      likesMin: num(sp.get('likesMin'), 0),
      viewsMin: num(sp.get('viewsMin'), 0),
      days: !daysRaw || daysRaw === 'all' ? 'all' : num(daysRaw, 0, 3650),
      sort: SORTS.includes(sortRaw as DiscoverSort) ? (sortRaw as DiscoverSort) : 'views',
      page: Math.max(1, num(sp.get('page'), 1)),
      pageSize: num(sp.get('pageSize'), DEFAULT_DISCOVER_FILTERS.pageSize, 96),
      savedOnly: sp.get('saved') === '1',
    }

    const data = await listDiscoverContent(orgId, filters, sp.get('brand') || null)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/content]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
