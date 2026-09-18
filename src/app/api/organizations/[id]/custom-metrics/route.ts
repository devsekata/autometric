import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * GET, POST /api/organizations/[id]/custom-metrics
 *
 * Switched off: this endpoint stores org_custom_metrics on the analytics warehouse; the KOL database has no such table. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Custom metrics')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function POST(_req: NextRequest, { params }: Params) { return unavailable(params) }
