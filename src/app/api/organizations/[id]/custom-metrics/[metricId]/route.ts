import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { updateOrgCustomMetric, deleteOrgCustomMetric, parseInput } from '@/lib/reports/data/customMetricsStore'

type Params = { params: Promise<{ id: string; metricId: string }> }

// PUT /api/organizations/[id]/custom-metrics/[metricId] — update. Body: { name, format, terms, multiply100 }.
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, metricId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const input = parseInput(await req.json().catch(() => null))
    if (!input) return NextResponse.json({ error: 'Invalid custom metric — needs a name and at least one field.' }, { status: 400 })

    const updated = await updateOrgCustomMetric(orgId, metricId, input)
    if (!updated) return NextResponse.json({ error: 'Custom metric not found.' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[PUT /api/organizations/[id]/custom-metrics/[metricId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/organizations/[id]/custom-metrics/[metricId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, metricId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const ok = await deleteOrgCustomMetric(orgId, metricId)
    if (!ok) return NextResponse.json({ error: 'Custom metric not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/custom-metrics/[metricId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
