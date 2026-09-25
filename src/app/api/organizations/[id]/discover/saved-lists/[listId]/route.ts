import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; listId: string }> }

/**
 * GET, PATCH, DELETE /api/organizations/[id]/discover/saved-lists/[listId]
 *
 * Switched off with the collection route — see `../route.ts`.
 */
async function unavailable(params: Params['params']) {
  const { id: agencyId } = await params
  if (!(await requireOrgMemberById(agencyId))) {
    return NextResponse.json({ error: 'Not authorized for this agency.' }, { status: 401 })
  }
  return featureUnavailable('Saved Lists')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function PATCH(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function DELETE(_req: NextRequest, { params }: Params) { return unavailable(params) }
