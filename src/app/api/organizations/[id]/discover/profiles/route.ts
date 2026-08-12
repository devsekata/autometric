import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolProfiles } from '@/lib/discover/profile'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/discover/profiles — enriched KOL roster
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    return NextResponse.json({ profiles: await listKolProfiles(orgId) })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/profiles]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
