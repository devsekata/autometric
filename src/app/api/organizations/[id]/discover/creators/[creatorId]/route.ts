import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; creatorId: string }> }

/**
 * /api/organizations/[id]/discover/creators/[creatorId] — detail, monitoring
 * toggle and delete for the old warehouse creator copy. Switched off; see
 * `../route.ts`.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Detail creator lama')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function PATCH(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function DELETE(_req: NextRequest, { params }: Params) { return unavailable(params) }
