import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getOrgCustomMetrics, createOrgCustomMetric, parseInput } from '@/lib/reports/data/customMetricsStore'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/custom-metrics — the org's custom metric library.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    return NextResponse.json(await getOrgCustomMetrics(orgId))
  } catch (err) {
    console.error('[GET /api/organizations/[id]/custom-metrics]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/organizations/[id]/custom-metrics — create one. Body: { name, format, terms, multiply100 }.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const input = parseInput(await req.json().catch(() => null))
    if (!input) return NextResponse.json({ error: 'Invalid custom metric — needs a name and at least one field.' }, { status: 400 })

    const created = await createOrgCustomMetric(orgId, access.userId, input)
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/custom-metrics]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
