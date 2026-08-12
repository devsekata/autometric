import { NextRequest, NextResponse } from 'next/server'
import {
  isPaymentConfigured, mapMidtransStatus, orderIdFromReference,
  settleByReference, verifyMidtransSignature,
} from '@/lib/discover/payment'

/**
 * Midtrans payment notification endpoint.
 *
 * Unauthenticated by necessity — Midtrans calls it, not a logged-in user — so
 * every safeguard is in the handler:
 *   * the SHA-512 signature is verified before anything is read as truth;
 *   * the order is located by the provider reference alone, never by an org id
 *     supplied in the payload;
 *   * an already-paid order is never moved backwards (see settleByReference),
 *     so duplicate or out-of-order retries are harmless.
 *
 * Always answers 200 once the signature checks out. Midtrans retries on any
 * non-2xx, and re-delivering a notification we have already applied is noise.
 *
 * Configure the URL in the Midtrans dashboard as:
 *   https://<your-domain>/api/webhooks/midtrans
 */
export async function POST(req: NextRequest) {
  try {
    if (!isPaymentConfigured()) {
      return NextResponse.json({ error: 'Payment not configured.' }, { status: 503 })
    }

    const body = await req.json().catch(() => null)
    if (!body?.order_id) {
      return NextResponse.json({ error: 'Malformed notification.' }, { status: 400 })
    }

    if (!verifyMidtransSignature(body)) {
      console.warn('[midtrans-webhook] signature rejected for', body.order_id)
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
    }

    const reference: string = body.order_id
    const status = mapMidtransStatus(body.transaction_status ?? '', body.fraud_status)
    if (!status) {
      // A status we do not model — acknowledge so Midtrans stops retrying.
      console.warn('[midtrans-webhook] unmapped transaction_status', body.transaction_status)
      return NextResponse.json({ ok: true, ignored: true })
    }

    const applied = await settleByReference(reference, status)
    console.log(
      `[midtrans-webhook] ${reference} -> ${status}` +
      `${applied ? '' : ' (no change: unknown reference or already paid)'}`,
    )

    return NextResponse.json({
      ok: true, applied, status, orderId: orderIdFromReference(reference),
    })
  } catch (err) {
    console.error('[POST /api/webhooks/midtrans]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
