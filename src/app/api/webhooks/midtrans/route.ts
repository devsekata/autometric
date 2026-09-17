import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * POST /api/webhooks/midtrans
 *
 * Switched off with Ordering: the orders it settled lived in `discover_orders`
 * on the analytics warehouse, which the KOL product no longer reads or writes.
 */
export async function POST() {
  return featureUnavailable('Pembayaran')
}
