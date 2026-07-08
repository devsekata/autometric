import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getReportPostMetrics } from '@/lib/reports/data/postsQuery'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/reports/post-metrics?brand=<brandId>&year=&month=
// Live post pool (report month) per channel for the Visual Analysis slide, scoped
// to one brand. Sibling of the chart-metrics / kpi-metrics routes.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const brandId = sp.get('brand')
    if (!brandId) return NextResponse.json({ error: 'Missing brand.' }, { status: 400 })

    const year = Number(sp.get('year'))
    const month = Number(sp.get('month'))
    if (!Number.isInteger(year) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid year/month.' }, { status: 400 })
    }

    const data = await getReportPostMetrics(orgId, brandId, year, month)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/reports/post-metrics]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
