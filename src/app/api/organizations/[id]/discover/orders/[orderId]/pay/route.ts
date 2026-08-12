import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getOrder } from '@/lib/discover/orders'
import {
  attachPaymentSession, createPaymentSession, isPaymentConfigured, PaymentNotConfiguredError,
} from '@/lib/discover/payment'

type Params = { params: Promise<{ id: string; orderId: string }> }

/**
 * POST — starts checkout for an order and returns the hosted payment URL.
 *
 * The client redirects the browser to `redirectUrl`; card details are entered
 * on the provider's page, never here. The order is only marked paid later, by
 * the signature-verified webhook.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    if (!isPaymentConfigured()) {
      return NextResponse.json(
        { error: 'Pembayaran belum dikonfigurasi. Set MIDTRANS_SERVER_KEY untuk mengaktifkan checkout.' },
        { status: 503 },
      )
    }

    const order = await getOrder(orgId, Number(orderId))
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    if (order.status === 'paid') {
      return NextResponse.json({ error: 'Order sudah dibayar.' }, { status: 409 })
    }
    if (order.total <= 0) {
      return NextResponse.json({ error: 'Order total must be greater than zero.' }, { status: 400 })
    }

    // The client supplies where to land after payment; safeFinishPath rejects
    // anything that is not an app-relative /organizations path.
    const body = await req.json().catch(() => null)
    const returnPath = typeof body?.returnPath === 'string' ? body.returnPath : null

    const session = await auth()
    const paymentSession = await createPaymentSession(
      order, session?.user?.email ?? null, Date.now(), returnPath)
    await attachPaymentSession(orgId, order.id, paymentSession)

    return NextResponse.json({
      provider: paymentSession.provider,
      reference: paymentSession.reference,
      redirectUrl: paymentSession.redirectUrl,
    })
  } catch (err) {
    if (err instanceof PaymentNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[POST /api/organizations/[id]/discover/orders/[orderId]/pay]', err)
    return NextResponse.json({ error: 'Gagal memulai pembayaran.' }, { status: 502 })
  }
}
