import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { parseCustomRange } from '@/lib/dashboard/range'
import { getContentOverviewData, type PlatformParam } from '@/lib/dashboard/content'

type Params = { params: Promise<{ id: string }> }

const PLATFORMS: PlatformParam[] = ['all', 'instagram', 'facebook', 'tiktok']
const PERIOD_DAYS: Record<string, number> = { '7 days': 7, '30 days': 30, '90 days': 90, Custom: 30 }

// GET /api/organizations/[id]/dashboard/content?platform=&period=&brand=
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const platformRaw = (sp.get('platform') ?? 'all').toLowerCase()
    const platform: PlatformParam = PLATFORMS.includes(platformRaw as PlatformParam)
      ? (platformRaw as PlatformParam) : 'all'
    const days = PERIOD_DAYS[sp.get('period') ?? '30 days'] ?? 30
    const brandId = sp.get('brand') || null
    const custom = parseCustomRange(sp)

    const data = await getContentOverviewData(orgId, platform, days, brandId, custom)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/dashboard/content]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
