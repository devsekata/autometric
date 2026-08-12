import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getDiscoverSummary } from '@/lib/discover/summary'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/discover/summary?brand=
// Shared by the Campaigns, Audience, Reports and Settings pages.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const data = await getDiscoverSummary(orgId, req.nextUrl.searchParams.get('brand') || null)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/summary]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
