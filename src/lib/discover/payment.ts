import { createHash } from 'crypto'
import pool from '@/lib/db'
import type { OrderDetail, OrderStatus } from './orders'

/**
 * Payment for Discover orders.
 *
 * Deliberately a redirect integration. The source platform collected card
 * number, expiry and CVV into its own form; reproducing that would put this
 * application in PCI-DSS scope for no benefit. With Midtrans Snap the customer
 * is sent to Midtrans' own hosted page, so card data never reaches this server
 * — the only things stored here are an opaque token and a redirect URL.
 *
 * The provider is behind an interface so Xendit can be added without touching
 * callers; only `midtrans` is implemented today.
 *
 * Everything degrades cleanly when unconfigured: `isPaymentConfigured()` is
 * false, the pay endpoint answers 503 with a clear message, and orders simply
 * stay quotations. That is the expected state until the env vars below are set:
 *
 *   MIDTRANS_SERVER_KEY   (required)  server-side key from the Midtrans dashboard
 *   MIDTRANS_IS_PRODUCTION  optional  'true' to use the production endpoint
 *   NEXT_PUBLIC_APP_URL     optional  base for the post-payment return URL
 */

export type PaymentProvider = 'midtrans'

export interface PaymentSession {
  provider: PaymentProvider
  /** Provider-side reference; the webhook identifies the order by this. */
  reference: string
  redirectUrl: string
}

const SNAP_URL = {
  sandbox: 'https://app.sandbox.midtrans.com/snap/v1/transactions',
  production: 'https://app.midtrans.com/snap/v1/transactions',
}

export const isPaymentConfigured = () => !!process.env.MIDTRANS_SERVER_KEY

const isProduction = () => process.env.MIDTRANS_IS_PRODUCTION === 'true'

/**
 * Provider order id. Midtrans requires this to be unique forever — retrying a
 * failed payment with a reused id is rejected — so a timestamp is appended.
 * The order id stays the leading segment so the webhook can recover it.
 */
export const buildReference = (orderId: number, now: number) => `AMD-${orderId}-${now}`

export const orderIdFromReference = (reference: string): number | null => {
  const m = /^AMD-(\d+)-/.exec(reference)
  return m ? Number(m[1]) : null
}

/**
 * Accepts only a single-slash app-relative path under /organizations.
 *
 * Rejecting `//evil.com` and any scheme matters here: this value is handed to
 * the payment provider as the post-payment redirect, so an unvalidated one is
 * an open redirect stamped with our own checkout's authority.
 */
export function safeFinishPath(path: string | null | undefined): string | null {
  if (!path) return null
  if (!path.startsWith('/organizations/')) return null
  if (path.startsWith('//') || path.includes('://') || /[\r\n]/.test(path)) return null
  return path
}

export class PaymentNotConfiguredError extends Error {
  constructor() {
    super('Payment provider is not configured. Set MIDTRANS_SERVER_KEY to enable checkout.')
    this.name = 'PaymentNotConfiguredError'
  }
}

/**
 * Creates a Snap transaction and returns the hosted payment URL.
 *
 * `gross_amount` is sent as an integer: Midtrans rejects IDR amounts with
 * decimals, and our totals are integer rupiah by construction.
 */
export async function createPaymentSession(
  order: OrderDetail, customerEmail: string | null, now: number,
  /**
   * Where the provider sends the browser after payment. Must be an app-relative
   * path — it is concatenated onto our own origin, so anything absolute would
   * let a caller bounce users off-site from inside our checkout.
   */
  finishPath?: string | null,
): Promise<PaymentSession> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY
  if (!serverKey) throw new PaymentNotConfiguredError()

  const reference = buildReference(order.id, now)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

  // Item lines are sent so the Snap page itemises what is being paid for. Fee
  // and tax go as their own lines, because Midtrans validates that the item
  // sum equals gross_amount exactly.
  const items = [
    ...order.items.map(l => ({
      id: `${l.socialAccountId}:${l.deliverableId}`,
      price: l.unitPrice,
      quantity: l.qty,
      name: `${l.deliverableLabel} · ${l.accountUsername}`.slice(0, 50),
    })),
    ...(order.discountAmount > 0
      ? [{ id: 'discount', price: -order.discountAmount, quantity: 1, name: `Promo ${order.promoCode ?? ''}`.slice(0, 50) }]
      : []),
    ...(order.feeAmount > 0
      ? [{ id: 'fee', price: order.feeAmount, quantity: 1, name: `Platform fee ${order.feePct}%` }]
      : []),
    ...(order.taxAmount > 0
      ? [{ id: 'tax', price: order.taxAmount, quantity: 1, name: `PPN ${order.taxPct}%` }]
      : []),
  ]

  const res = await fetch(isProduction() ? SNAP_URL.production : SNAP_URL.sandbox, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Server key as HTTP Basic username with an empty password.
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
    },
    body: JSON.stringify({
      transaction_details: { order_id: reference, gross_amount: Math.round(order.total) },
      item_details: items,
      customer_details: customerEmail ? { email: customerEmail } : undefined,
      // Land the user back on the campaign they just paid for. Sending them to
      // the generic org list — the previous behaviour — discarded every bit of
      // context at the exact moment they most needed confirmation.
      callbacks: base
        ? { finish: `${base}${safeFinishPath(finishPath) ?? '/organizations'}` }
        : undefined,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Midtrans Snap ${res.status}: ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as { token?: string; redirect_url?: string }
  if (!json.redirect_url) throw new Error('Midtrans Snap returned no redirect_url')

  return { provider: 'midtrans', reference, redirectUrl: json.redirect_url }
}

export async function attachPaymentSession(
  orgId: string, orderId: number, session: PaymentSession,
): Promise<void> {
  await pool.query(
    `UPDATE public.discover_orders
        SET status = 'pending_payment', payment_provider = $3, payment_ref = $4,
            payment_redirect_url = $5, updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId, session.provider, session.reference, session.redirectUrl],
  )
}

/**
 * Verifies the Midtrans notification signature.
 *
 * sha512(order_id + status_code + gross_amount + server_key). Without this an
 * unauthenticated POST could mark any order paid, so a notification that fails
 * verification is discarded rather than trusted.
 */
export function verifyMidtransSignature(body: {
  order_id?: string; status_code?: string; gross_amount?: string; signature_key?: string
}): boolean {
  const serverKey = process.env.MIDTRANS_SERVER_KEY
  if (!serverKey || !body.signature_key) return false
  const expected = createHash('sha512')
    .update(`${body.order_id ?? ''}${body.status_code ?? ''}${body.gross_amount ?? ''}${serverKey}`)
    .digest('hex')
  // Both are hex digests of fixed length; compare directly.
  return expected === body.signature_key
}

/** Maps Midtrans transaction_status onto our order status vocabulary. */
export function mapMidtransStatus(
  transactionStatus: string, fraudStatus?: string,
): OrderStatus | null {
  switch (transactionStatus) {
    case 'capture':
      // Card captures land in 'challenge' until reviewed; only 'accept' is paid.
      return fraudStatus === 'accept' ? 'paid' : 'pending_payment'
    case 'settlement':
      return 'paid'
    case 'pending':
      return 'pending_payment'
    case 'deny':
    case 'failure':
      return 'failed'
    case 'cancel':
      return 'cancelled'
    case 'expire':
      return 'expired'
    default:
      return null
  }
}

/**
 * Applies a verified notification. Looks the order up by provider reference
 * only — the webhook is unauthenticated by nature, so it must never accept an
 * org id from the caller.
 */
export async function settleByReference(
  reference: string, status: OrderStatus,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    // $2 is cast explicitly: it appears both as the assigned value and inside a
    // CASE comparison, and without the cast Postgres cannot deduce one type for
    // the parameter ("inconsistent types deduced for parameter $2").
    `UPDATE public.discover_orders
        SET status = $2::varchar, updated_at = now(),
            paid_at = CASE WHEN $2::varchar = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END
      WHERE payment_ref = $1
        -- A settled order is terminal: a late or replayed notification must not
        -- move it back to pending or failed.
        AND status <> 'paid'`,
    [reference, status],
  )
  return (rowCount ?? 0) > 0
}
