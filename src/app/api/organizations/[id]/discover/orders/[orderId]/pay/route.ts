import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; orderId: string }> }

/**
 * POST /api/organizations/[id]/discover/orders/[orderId]/pay
 *
 * Switched off: this endpoint discover_orders on the analytics warehouse (dropped). The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Pembayaran')
}

export async function POST(_req: NextRequest, { params }: Params) { return unavailable(params) }
