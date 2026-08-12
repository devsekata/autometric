import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { setItemProgress } from '@/lib/discover/campaignStore'
import { getOrder } from '@/lib/discover/orders'

type Params = { params: Promise<{ id: string; orderId: string; itemId: string }> }

const PROGRESS = ['pending', 'briefed', 'in_progress', 'review', 'published']

/**
 * PATCH — moves one creator's deliverable along in production.
 *
 * Progress is recorded by the team running the campaign, not derived: nothing
 * in the warehouse reports back "this sponsored post went live against order
 * 41". Campaign Management is only truthful because a person put these values
 * there.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId, itemId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const oid = Number(orderId), iid = Number(itemId)
    if (!Number.isInteger(oid) || oid <= 0 || !Number.isInteger(iid) || iid <= 0) {
      return NextResponse.json({ error: 'Invalid order or item id.' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be an object.' }, { status: 400 })
    }
    if (!PROGRESS.includes(body.progressStatus)) {
      return NextResponse.json(
        { error: `progressStatus must be one of: ${PROGRESS.join(', ')}.` }, { status: 400 })
    }

    const url = typeof body.publishedUrl === 'string' ? body.publishedUrl.trim() : null
    if (url && !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'publishedUrl must be an http(s) URL.' }, { status: 400 })
    }

    // setItemProgress scopes the write by org in the UPDATE itself, so a
    // mismatch writes nothing; a false return is "not yours or not there".
    const ok = await setItemProgress(orgId, oid, iid, body.progressStatus, url || null)
    if (!ok) return NextResponse.json({ error: 'Order item not found.' }, { status: 404 })

    return NextResponse.json(await getOrder(orgId, oid))
  } catch (err) {
    console.error('[PATCH discover/orders/[orderId]/items/[itemId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
