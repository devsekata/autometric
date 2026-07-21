import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getReportAvailablePeriods } from '@/lib/reports/data/periodsQuery'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/reports/periods?brand=<brandId>
// The (year, month) periods that have data for the brand (newest first), so the
// report setup can disable empty periods and default to the latest with data.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const brandId = req.nextUrl.searchParams.get('brand')
    if (!brandId) return NextResponse.json({ error: 'Missing brand.' }, { status: 400 })

    const periods = await getReportAvailablePeriods(orgId, brandId)
    return NextResponse.json({ periods })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/reports/periods]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
