import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { DELIVERABLES, listRateCards, setRateCard } from '@/lib/discover/rates'
import { listDirectory } from '@/lib/discover/directory'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/discover/rates — rate cards + deliverable catalogue
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const [rates, dir] = await Promise.all([listRateCards(orgId), listDirectory(orgId)])
    return NextResponse.json({ rates, deliverables: DELIVERABLES, accounts: dir.accounts })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/rates]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// PUT /api/organizations/[id]/discover/rates — body: { socialAccountId, baseRate, note? }
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const accountId = typeof body?.socialAccountId === 'string' ? body.socialAccountId : ''
    const baseRate = Number(body?.baseRate)

    if (!accountId || !Number.isFinite(baseRate) || baseRate < 0) {
      return NextResponse.json({ error: 'socialAccountId and a non-negative baseRate are required.' }, { status: 400 })
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
