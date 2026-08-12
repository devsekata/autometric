import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getCampaignDashboard } from '@/lib/discover/campaignStore'

type Params = { params: Promise<{ id: string; orderId: string }> }

// GET /api/organizations/[id]/discover/orders/[orderId]/dashboard
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const data = await getCampaignDashboard(orgId, Number(orderId), Date.now())
    if (!data) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET discover/orders/[orderId]/dashboard]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
