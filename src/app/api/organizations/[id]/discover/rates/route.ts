import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  DELIVERABLES, listRateCards, listRosterRateCards, setRateCard, setRosterRateCard,
} from '@/lib/discover/rates'
import { listDirectory } from '@/lib/discover/directory'
import { getRosterIdentities } from '@/lib/discover/kolDirectory'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/discover/rates — rate cards + deliverable catalogue
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    // Roster prices ride along: the Directory grid needs to know, for every row
    // on the page, whether that creator has a price yet — and asking per row
    // would be a query per card.
    const [rates, dir, rosterRates] = await Promise.all([
      listRateCards(orgId),
      listDirectory(orgId),
      listRosterRateCards(orgId),
    ])

    // Who those priced roster creators are, so the cart can name them and list
    // the deliverables for their platform without a second round trip. Only the
    // priced ones: a creator with no price cannot be in a cart. Failure here is
    // not fatal — the rest of the payload is what most callers came for.
    let rosterCreators: { id: string; username: string; platform: string | null }[] = []
    const pricedIds = Object.keys(rosterRates)
    if (pricedIds.length) {
      try {
        rosterCreators = [...(await getRosterIdentities(pricedIds)).values()]
      } catch (e) {
        console.error('[GET discover/rates] roster lookup failed:', e)
      }
    }

    return NextResponse.json({
      rates, rosterRates, rosterCreators, deliverables: DELIVERABLES, accounts: dir.accounts,
    })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/rates]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * PUT /api/organizations/[id]/discover/rates
 *
 * Body is either `{ socialAccountId, baseRate, note? }` for a tracked account or
 * `{ rosterKolId, baseRate, note? }` for a creator from the commercial roster.
 * Two id fields rather than one plus a flag, because the two are checked against
 * different sources and mixing them behind one name is how a roster id ends up
 * written into an account's rate card.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const accountId = typeof body?.socialAccountId === 'string' ? body.socialAccountId : ''
    const rosterKolId = typeof body?.rosterKolId === 'string' ? body.rosterKolId : ''
    const baseRate = Number(body?.baseRate)

    if ((!accountId && !rosterKolId) || !Number.isFinite(baseRate) || baseRate < 0) {
      return NextResponse.json(
        { error: 'socialAccountId or rosterKolId, plus a non-negative baseRate, are required.' },
        { status: 400 },
      )
    }

    if (rosterKolId) {
      // The creator has to exist in the roster. Without this an unknown id would
      // become a priced line that no order could ever name.
      const found = await getRosterIdentities([rosterKolId])
      if (!found.has(rosterKolId)) {
        return NextResponse.json({ error: 'Creator not found in the KOL roster.' }, { status: 404 })
      }
      await setRosterRateCard(orgId, rosterKolId, baseRate, access.userId, body?.note ?? null)
      return NextResponse.json({ ok: true, rosterRates: await listRosterRateCards(orgId) })
    }

    // Only accounts this org actually tracks may be priced.
    const dir = await listDirectory(orgId)
    if (!dir.accounts.some(a => a.id === accountId)) {
      return NextResponse.json({ error: 'Account not found in this organization.' }, { status: 404 })
    }

    await setRateCard(orgId, accountId, baseRate, access.userId, body?.note ?? null)
    return NextResponse.json({ ok: true, rates: await listRateCards(orgId) })
  } catch (err) {
    console.error('[PUT /api/organizations/[id]/discover/rates]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
