import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { parseCreatorInput } from '@/lib/discover/creatorInput'
import {
  createCreator, expireStaleRuns, listCreatorFacets, listCreators,
} from '@/lib/discover/creatorStore'
import { startProfiling } from '@/lib/discover/creatorProfiling'
import type { CreatorVisibility } from '@/lib/discover/creatorFlow'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/creators
 *   ?q=&platform=&category=&tier=&follMin=&minEr=&status=&facets=1
 *
 * The org's own creator roster — the one this app writes. Basic Discovery
 * filters against exactly these params.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    // A run whose process died has nothing left to write its own failure, so the
    // list is where those are swept up: it is the screen you land on after a
    // restart, and a creator stuck at "profiling" forever is worse than one
    // showing a failure you can retry.
    await expireStaleRuns().catch(err => console.error('[creators] stale sweep failed:', err))

    const sp = req.nextUrl.searchParams
    /** An absent number must stay absent — see the same note in kol-directory. */
    const num = (key: string) => {
      const raw = sp.get(key)
      if (raw === null || raw.trim() === '') return null
      const v = Number(raw)
      return Number.isFinite(v) ? v : null
    }

    const creators = await listCreators(orgId, {
      q: sp.get('q'),
      platform: sp.get('platform'),
      category: sp.get('category'),
      tier: sp.get('tier'),
      status: sp.get('status'),
      minFollowers: num('follMin'),
      minErPct: num('minEr'),
    })

    return NextResponse.json({
      creators,
      facets: sp.get('facets') === '1' ? await listCreatorFacets(orgId) : undefined,
    })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/creators]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * POST /api/organizations/[id]/discover/creators
 *   { platform, input, visibility? }
 *
 * Creates the creator and starts profiling in the background.
 *
 * The handle is re-parsed here rather than trusted from the check response: the
 * browser sat between the two calls, and the row's identity must come from
 * something the server derived. `visibility` is accepted only as the user's
 * acknowledgement that they chose to continue with a private account — profiling
 * overwrites it with what the platform actually says a minute later.
 *
 * A duplicate is answered with `created: false` and the existing creator rather
 * than an error. The unique index is what makes that safe: two people adding the
 * same handle at the same moment both pass the modal's duplicate screen, and
 * only the database can settle which one wrote the row.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({})) as {
      platform?: unknown; input?: unknown; visibility?: unknown
    }
    const platform = typeof body.platform === 'string' ? body.platform : ''
    const input = typeof body.input === 'string' ? body.input : ''

    const parsed = parseCreatorInput(platform, input)
    if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 })

    const visibility: CreatorVisibility =
      body.visibility === 'private' || body.visibility === 'public' ? body.visibility : 'unknown'

    const { creator, created } = await createCreator({
      orgId,
      userId: access.userId,
      platform: parsed.platform,
      username: parsed.username,
      profileUrl: parsed.profileUrl,
      visibility,
    })

    // Only a new row starts a run. A duplicate reaching this endpoint means two
    // people pressed Start Profiling at once, and the second must not start a
    // second run against the same account.
    if (created) startProfiling(orgId, creator.id, 'initial')

    return NextResponse.json({ creator, created }, { status: created ? 201 : 200 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/creators]', err)
    return NextResponse.json({ error: 'The creator could not be added.' }, { status: 500 })
  }
}
