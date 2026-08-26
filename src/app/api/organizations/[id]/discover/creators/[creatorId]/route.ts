import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  deleteCreator, expireStaleRuns, getCreator, setMonitoring,
} from '@/lib/discover/creatorStore'

type Params = { params: Promise<{ id: string; creatorId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How long a run may sit unfinished before a read declares it dead. */
const STALE_RUN_MINUTES = 15

/**
 * GET /api/organizations/[id]/discover/creators/[creatorId]
 *
 * The full profile, its latest profiling run and its snapshot history. This is
 * what the progress screen polls while profiling is running, so it stays a
 * single round trip: the screen needs the steps and the profile together, and
 * two endpoints would let them disagree between polls.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, creatorId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!UUID.test(creatorId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    let creator = await getCreator(orgId, creatorId)
    if (!creator) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    // Profiling runs in the web process. If that process went away mid-run
    // nothing is left to record the failure, and the screen would poll a run
    // that can never settle. Swept here rather than on a timer, and only when
    // this creator's own run is the stale one — a poll every two seconds must
    // not drag an UPDATE across the whole table with it.
    const startedAt = creator.run ? new Date(creator.run.startedAt).getTime() : 0
    const stale = creator.run?.status === 'running'
      && Date.now() - startedAt > STALE_RUN_MINUTES * 60_000
    if (stale) {
      await expireStaleRuns(STALE_RUN_MINUTES)
      creator = (await getCreator(orgId, creatorId)) ?? creator
    }

    return NextResponse.json({ creator })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/creators/[creatorId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * PATCH — the one field a human owns: whether monitoring keeps this creator's
 * data fresh. Everything else on the row is measured, and is profiling's to write.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, creatorId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!UUID.test(creatorId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const body = await req.json().catch(() => ({})) as { monitoringEnabled?: unknown }
    if (typeof body.monitoringEnabled !== 'boolean') {
      return NextResponse.json({ error: '`monitoringEnabled` must be true or false.' }, { status: 400 })
    }

    const ok = await setMonitoring(orgId, creatorId, body.monitoringEnabled)
    if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    return NextResponse.json({ creator: await getCreator(orgId, creatorId) })
  } catch (err) {
    console.error('[PATCH /api/organizations/[id]/discover/creators/[creatorId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * DELETE — remove the creator from this org's database.
 *
 * The runs and snapshots go with it (ON DELETE CASCADE). That is the intent:
 * this roster is the org's own list, and a creator removed from it should leave
 * nothing behind that a later re-add would silently inherit.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId, creatorId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    if (!UUID.test(creatorId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const ok = await deleteCreator(orgId, creatorId)
    if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/discover/creators/[creatorId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
