import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * /api/organizations/[id]/discover/creators — the old per-org creator copy
 * (`discover_creators` on the analytics warehouse). Switched off: My Creators
 * is `agency_kol_accounts` on the KOL server now — list it through
 * `/discover/kol-directory?scope=mine`, change it through `/discover/my-creators`.
 */
async function unavailable(params: Params['params']) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Daftar creator lama')
}

export async function GET(_req: NextRequest, { params }: Params) { return unavailable(params) }
export async function POST(_req: NextRequest, { params }: Params) { return unavailable(params) }
