import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; metricId: string }> }

/**
 * PUT, DELETE /api/organizations/[id]/custom-metrics/[metricId]
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

export async function PUT(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function DELETE(_req: NextRequest, { params }: Params) { return unavailable(params) }
