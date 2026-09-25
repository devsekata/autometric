import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string; accountId: string }> }

/**
 * GET /api/organizations/[id]/discover/account/[accountId]
 *
 * Switched off: this endpoint reads tracked brand/competitor accounts from the analytics warehouse. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Analisis akun tracked')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
