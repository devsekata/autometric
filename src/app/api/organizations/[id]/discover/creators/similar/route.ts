import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { findSimilarCreators, type CandidateSource } from '@/lib/discover/creatorSimilar'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/organizations/[id]/discover/creators/similar
 *   ?ref=<uuid>&source=creator|roster&platform=&city=&tier=&maxRate=&cheaper=1&limit=
 *
 * Smart Discovery. `source` says which roster the reference lives in: a creator
 * this org added, or one from the commercial KOL directory. Both are valid
 * references — the difference is what can be scored, and the result says so.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const ref = sp.get('ref') ?? ''
    if (!UUID.test(ref)) {
      return NextResponse.json({ error: 'A reference creator is required.' }, { status: 400 })
    }
    const source: CandidateSource = sp.get('source') === 'roster' ? 'roster' : 'creator'

    const num = (key: string) => {
      const raw = sp.get(key)
      if (raw === null || raw.trim() === '') return null
      const v = Number(raw)
      return Number.isFinite(v) ? v : null
    }

    const result = await findSimilarCreators(orgId, ref, source, {
      platform: sp.get('platform'),
      city: sp.get('city'),
      tier: sp.get('tier'),
      maxRate: num('maxRate'),
      cheaperThanReference: sp.get('cheaper') === '1',
      limit: num('limit') ?? 12,
    })

    if (!result) return NextResponse.json({ error: 'The reference creator was not found.' }, { status: 404 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/creators/similar]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
