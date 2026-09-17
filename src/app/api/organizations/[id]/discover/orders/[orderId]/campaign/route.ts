import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; orderId: string }> }

/**
 * GET, PATCH /api/organizations/[id]/discover/orders/[orderId]/campaign
 *
 * Switched off: this endpoint discover_orders on the analytics warehouse (dropped). The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Campaign')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function PATCH(_req: NextRequest, { params }: Params) { return unavailable(params) }
