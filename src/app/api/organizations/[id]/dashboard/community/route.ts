import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/dashboard/community
 *
 * Switched off: this endpoint reads brand analytics (l2_gold/l1_silver) from the analytics warehouse; the KOL database has no brand-level source for it. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Dashboard')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
