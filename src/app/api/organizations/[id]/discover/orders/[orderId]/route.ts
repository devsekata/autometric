import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getOrder, updateOrderStatus, type OrderStatus } from '@/lib/discover/orders'

type Params = { params: Promise<{ id: string; orderId: string }> }

// Statuses a user may set by hand. 'paid' is absent on purpose: only a verified
// payment notification may mark an order paid.
const MANUAL: OrderStatus[] = ['draft', 'cancelled']

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const order = await getOrder(orgId, Number(orderId))
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

    return NextResponse.json(order)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/orders/[orderId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// PATCH — body: { status: 'draft' | 'cancelled' }
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const status = body?.status
    if (!MANUAL.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${MANUAL.join(', ')}.` }, { status: 400 })
    }

    const existing = await getOrder(orgId, Number(orderId))
    if (!existing) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    if (existing.status === 'paid') {
      return NextResponse.json({ error: 'A paid order cannot be changed.' }, { status: 409 })
    }

    await updateOrderStatus(orgId, Number(orderId), status)
    return NextResponse.json({ ok: true, status })
  } catch (err) {
    console.error('[PATCH /api/organizations/[id]/discover/orders/[orderId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
