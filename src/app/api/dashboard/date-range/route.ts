import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { getDataDateRange } from '@/lib/dashboard/dateRange'
import type { PlatformParam } from '@/lib/dashboard/overview'

const PLATFORMS: PlatformParam[] = ['all', 'instagram', 'facebook', 'tiktok']

// GET /api/dashboard/date-range?org=<orgSlug>&brand=<brandId>&platform=<all|instagram|facebook|tiktok>
// Bounds (min/max metric_date) for the dashboard custom date picker. Kept outside
// /api/organizations/[id] to reuse the slug-based access check (mirrors
// /api/dashboard/brands, which the chrome also calls with the org slug).
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const slug = sp.get('org')
    if (!slug) return NextResponse.json({ error: 'Missing org.' }, { status: 400 })

    const org = await getOrgBySlugForUser(slug, userId) // enforces active membership
    if (!org) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const platformRaw = (sp.get('platform') ?? 'all').toLowerCase()
    const platform: PlatformParam = PLATFORMS.includes(platformRaw as PlatformParam)
      ? (platformRaw as PlatformParam) : 'all'
    const brandId = sp.get('brand') || null

    const range = await getDataDateRange(org.id, platform, brandId)
    return NextResponse.json(range)
  } catch (err) {
    console.error('[GET /api/dashboard/date-range]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
