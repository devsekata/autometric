import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * GET, PUT /api/organizations/[id]/discover/rates
 *
 * Switched off: this endpoint discover_rate_cards on the analytics warehouse (dropped); the KOL rate card stays empty. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Rate Card')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function PUT(_req: NextRequest, { params }: Params) { return unavailable(params) }
