import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { buildQuotation, createOrder, listOrders, type CartLineInput } from '@/lib/discover/orders'

type Params = { params: Promise<{ id: string }> }

/** Accepts only well-shaped lines; the quotation layer does the real validation. */
function parseLines(raw: unknown): CartLineInput[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((l): CartLineInput[] => {
    const socialAccountId = typeof l?.socialAccountId === 'string' ? l.socialAccountId : ''
    const deliverableId = typeof l?.deliverableId === 'string' ? l.deliverableId : ''
    const relation = l?.relation === 'competitor' ? 'competitor' as const : 'owned' as const
    const qty = Math.floor(Number(l?.qty))
    if (!socialAccountId || !deliverableId || !Number.isFinite(qty) || qty <= 0) return []

    // A negotiated price. Passed through as a candidate only — buildQuotation
    // still requires the account to have a rate card, so this can adjust a
    // price but never conjure a priceable line out of nothing.
    const rawPrice = Number(l?.unitPriceOverride)
    const unitPriceOverride =
      l?.unitPriceOverride === null || l?.unitPriceOverride === undefined
        || !Number.isFinite(rawPrice) || rawPrice < 0
        ? null
        : Math.round(rawPrice)

    const t = l?.target
    const target = t && typeof t === 'object'
      ? {
          objective: typeof t.objective === 'string' ? t.objective : null,
          reach: Number.isFinite(Number(t.reach)) ? Number(t.reach) : null,
          engagement: Number.isFinite(Number(t.engagement)) ? Number(t.engagement) : null,
        }
      : null

    return [{
      socialAccountId, deliverableId, relation,
      qty: Math.min(qty, 999), unitPriceOverride, target,
    }]
  })
}

// GET /api/organizations/[id]/discover/orders — order history
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    return NextResponse.json({ orders: await listOrders(orgId) })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/orders]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * POST — price a cart, and optionally persist it.
 *
 * `preview: true` returns the quotation without writing anything, which is what
 * the cart page calls on every change. Only an explicit non-preview POST
 * creates an order.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const lines = parseLines(body?.lines)
    const promoCode = typeof body?.promoCode === 'string' ? body.promoCode : null

    if (lines.length === 0) {
      return NextResponse.json({ error: 'At least one valid line is required.' }, { status: 400 })
    }

    if (body?.preview) {
      return NextResponse.json({ quotation: await buildQuotation(orgId, lines, promoCode) })
    }

    const name = typeof body?.name === 'string' ? body.name : ''
    const created = await createOrder(orgId, access.userId, name, lines, promoCode, body?.notes ?? null)
    if (!created) {
      // Everything was rejected — hand back why, rather than a bare 400.
      const q = await buildQuotation(orgId, lines, promoCode)
      return NextResponse.json(
        { error: 'No priceable lines. Set a rate card for the selected accounts first.', rejected: q.rejected },
        { status: 400 },
      )
    }

    return NextResponse.json({ id: created.id, quotation: created.quotation }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/orders]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
