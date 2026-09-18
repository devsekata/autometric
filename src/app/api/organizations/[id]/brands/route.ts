import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * GET, POST /api/organizations/[id]/brands
 *
 * Switched off: this endpoint reads and writes brands on the analytics warehouse; KOL public.brand has no rows and no link to social accounts. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Brands')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function POST(_req: NextRequest, { params }: Params) { return unavailable(params) }
