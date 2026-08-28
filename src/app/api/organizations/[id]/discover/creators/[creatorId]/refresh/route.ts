import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getCreator } from '@/lib/discover/creatorStore'
import { startProfiling } from '@/lib/discover/creatorProfiling'

type Params = { params: Promise<{ id: string; creatorId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/organizations/[id]/discover/creators/[creatorId]/refresh
 *
 * Runs profiling again — the same seven steps, recorded as a `refresh` run.
 *
 * This is what keeps a profile from being a one-time snapshot: the numbers land
 * on the creator row, and the day's figures are also written to
 * `discover_creator_snapshots`, so a refresh adds a point to the history instead
 * of erasing what the profile used to say.
 *
 * A run already under way is not restarted. Two runs against one account would
 * both write to the same row and the later writer would win by accident, so the
 * caller gets the run that is already going.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, creatorId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!UUID.test(creatorId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const creator = await getCreator(orgId, creatorId)
    if (!creator) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    if (creator.run?.status === 'running' || creator.profilingStatus === 'running') {
      return NextResponse.json({ creator, started: false, reason: 'A profiling run is already in progress.' })
    }

    startProfiling(orgId, creatorId, 'refresh')
    return NextResponse.json({ creator, started: true }, { status: 202 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/creators/[creatorId]/refresh]', err)
    return NextResponse.json({ error: 'The refresh could not be started.' }, { status: 500 })
  }
}
