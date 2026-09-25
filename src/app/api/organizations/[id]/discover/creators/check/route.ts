import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/organizations/[id]/discover/creators/check — the old intake check,
 * which also looked the handle up among the warehouse's brand accounts.
 * Switched off: Add KOL checks through `/api/kol-directory/add/check`, which
 * reads the KOL server only.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orgId } = await params
  if (!(await requireOrgMemberById(orgId))) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
  }
  return featureUnavailable('Pengecekan creator lama')
}
