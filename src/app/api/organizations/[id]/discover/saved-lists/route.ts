import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * GET, POST /api/organizations/[id]/discover/saved-lists
 *
 * Switched off: Saved Lists were stored in the warehouse
 * (`discover_saved_lists`, dropped). The KOL database has no table for a named
 * list of creators — `agency_kol_saved_filters` holds a saved FILTER and is
 * served by `/discover/saved-filters`. Until a KOL home for creator lists is
 * decided, this answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: agencyId } = await params
  if (!(await requireOrgMemberById(agencyId))) {
    return NextResponse.json({ error: 'Not authorized for this agency.' }, { status: 401 })
  }
  return featureUnavailable('Saved Lists')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function POST(_req: NextRequest, { params }: Params) { return unavailable(params) }
