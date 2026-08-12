import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getAccountDetail, type AccountRelation } from '@/lib/discover/account'

type Params = { params: Promise<{ id: string; accountId: string }> }

const RELATIONS: AccountRelation[] = ['owned', 'competitor']

// GET /api/organizations/[id]/discover/account/[accountId]?relation=owned|competitor
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, accountId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const raw = (req.nextUrl.searchParams.get('relation') ?? 'owned').toLowerCase()
    if (!RELATIONS.includes(raw as AccountRelation)) {
      return NextResponse.json({ error: 'relation must be owned or competitor.' }, { status: 400 })
    }

    const data = await getAccountDetail(orgId, accountId, raw as AccountRelation)
    if (!data) return NextResponse.json({ error: 'Account not found in this organization.' }, { status: 404 })

    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/account/[accountId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
