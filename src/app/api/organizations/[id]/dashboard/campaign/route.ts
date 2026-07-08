import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getCampaignPosts, getCampaignAnalysis, type PlatformParam } from '@/lib/dashboard/campaign'

type Params = { params: Promise<{ id: string }> }

const PLATFORMS: PlatformParam[] = ['all', 'instagram', 'facebook', 'tiktok']

// GET /api/organizations/[id]/dashboard/campaign?platform=&brand=  → post selection grid
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const platformRaw = (sp.get('platform') ?? 'all').toLowerCase()
    const platform: PlatformParam = PLATFORMS.includes(platformRaw as PlatformParam) ? (platformRaw as PlatformParam) : 'all'
    const brandId = sp.get('brand') || null

    const posts = await getCampaignPosts(orgId, platform, brandId)
    return NextResponse.json({ posts })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/dashboard/campaign]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/organizations/[id]/dashboard/campaign  { postIds: string[] }  → analysis
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const postIds: string[] = Array.isArray(body?.postIds) ? body.postIds.filter((x: unknown) => typeof x === 'string') : []

    const analysis = await getCampaignAnalysis(postIds)
    return NextResponse.json(analysis)
  } catch (err) {
    console.error('[POST /api/organizations/[id]/dashboard/campaign]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
