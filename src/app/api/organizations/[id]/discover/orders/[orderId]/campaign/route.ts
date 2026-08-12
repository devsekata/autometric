import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  CAMPAIGN_STAGES, getCampaignFields, saveCampaignFields, setCampaignStage,
  type CampaignPatch, type InspirationPick,
} from '@/lib/discover/campaignStore'
import { getOrder } from '@/lib/discover/orders'

type Params = { params: Promise<{ id: string; orderId: string }> }

const GENDERS = ['all', 'female', 'male']
const OBJECTIVES = ['Awareness', 'Consideration', 'Conversion', 'Engagement', 'Loyalty']
const PAYMENT_METHODS = ['card', 'bank_transfer', 'invoice']

/** Brief references, stored frozen — anything malformed is dropped, not stored. */
function parseInspirations(raw: unknown): InspirationPick[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((v): InspirationPick[] => {
    const source = typeof v?.source === 'string' ? v.source : ''
    const postRowId = Number(v?.postRowId)
    const platform = typeof v?.platform === 'string' ? v.platform : ''
    if (!source || !platform || !Number.isInteger(postRowId)) return []
    return [{ source, postRowId, platform }]
  }).slice(0, 24)
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const fields = await getCampaignFields(orgId, Number(orderId))
    if (!fields) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    return NextResponse.json(fields)
  } catch (err) {
    console.error('[GET discover/orders/[orderId]/campaign]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// PATCH — partial update of the campaign half of an order.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, orderId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const order = await getOrder(orgId, Number(orderId))
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be an object.' }, { status: 400 })
    }

    // The lifecycle is the one field that is *supposed* to move after payment —
    // that is the whole point of Campaign Management — so it is handled before
    // the paid-order lock and by its own writer.
    if (body.campaignStatus !== undefined) {
      if (!CAMPAIGN_STAGES.includes(body.campaignStatus)) {
        return NextResponse.json(
          { error: `campaignStatus must be one of: ${CAMPAIGN_STAGES.join(', ')}.` }, { status: 400 })
      }
      await setCampaignStage(orgId, Number(orderId), body.campaignStatus)
      // A status-only PATCH is complete here; anything else falls through.
      if (Object.keys(body).length === 1) {
        return NextResponse.json(await getCampaignFields(orgId, Number(orderId)))
      }
    }

    // A paid campaign is a record of what was agreed; its brief and goals are
    // no longer editable.
    if (order.status === 'paid') {
      return NextResponse.json({ error: 'Campaign sudah dibayar dan tidak bisa diubah.' }, { status: 409 })
    }
    if (body.targetGender !== undefined && !GENDERS.includes(body.targetGender)) {
      return NextResponse.json({ error: 'targetGender must be all, female or male.' }, { status: 400 })
    }
    if (body.objective !== undefined && body.objective !== null && !OBJECTIVES.includes(body.objective)) {
      return NextResponse.json({ error: `objective must be one of: ${OBJECTIVES.join(', ')}.` }, { status: 400 })
    }
    if (body.startDate && body.endDate && body.endDate < body.startDate) {
      return NextResponse.json({ error: 'endDate cannot be before startDate.' }, { status: 400 })
    }
    if (body.paymentMethod !== undefined && body.paymentMethod !== null
        && !PAYMENT_METHODS.includes(body.paymentMethod)) {
      return NextResponse.json(
        { error: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}.` }, { status: 400 })
    }

    const patch: CampaignPatch = {}
    for (const k of ['objective', 'brief', 'keyMessage', 'deadline', 'paymentMethod',
                     'hashtags', 'mentions', 'startDate', 'endDate',
                     'budget', 'goalReach', 'goalEngagement', 'targetAges', 'targetGender',
                     'estReach', 'estEngagement', 'estEmv', 'successRate', 'successFactors'] as const) {
      if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k]
    }
    if (body.inspirations !== undefined) patch.inspirations = parseInspirations(body.inspirations)

    await saveCampaignFields(orgId, Number(orderId), patch)
    return NextResponse.json(await getCampaignFields(orgId, Number(orderId)))
  } catch (err) {
    console.error('[PATCH discover/orders/[orderId]/campaign]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
