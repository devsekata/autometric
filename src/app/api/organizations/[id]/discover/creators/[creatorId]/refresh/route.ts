import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; creatorId: string }> }

/**
 * POST /api/organizations/[id]/discover/creators/[creatorId]/refresh — re-ran
 * profiling into the warehouse creator copy. Switched off; see `../../route.ts`.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Profiling ulang creator')
}
