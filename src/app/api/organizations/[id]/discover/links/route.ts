import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  countCreatorLinks, listCreatorLinks, parseLinkKey, toLinkRef, updateCreatorLink,
  TRACKING_STATUSES, type TrackingStatus,
} from '@/lib/discover/creatorLinks'

type Params = { params: Promise<{ id: string }> }

/**
 * The organization's relationship with creators — My Creators, and tracking.
 *
 * One endpoint for both because they are one row (see migration 053): the
 * Creator Database grid draws a Saved state and a Tracking state on the same
 * card, and asking two endpoints for two halves of one fact is how the two come
 * to disagree on screen.
 *
 * Unlike favourites, these are org-wide rather than personal — My Creators is
 * the workspace's roster and tracking spends the workspace's refresh budget — so
 * the handlers scope by org and record the user only for attribution.
 */

/**
 * GET — every live link, plus the counts the Discovery dashboard prints.
 *
 * Compact by design: ids and states, no creator data. The grid already holds the
 * creators; what it is missing is which of them this org has saved or is
 * watching, and that is a set membership test.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const [links, counts] = await Promise.all([
      listCreatorLinks(orgId),
      countCreatorLinks(orgId),
    ])
    return NextResponse.json({ links, counts })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/links]', err)
    return NextResponse.json({ error: 'Unable to load saved creators.' }, { status: 500 })
  }
}

/**
 * POST — change one creator's relationship.
 *
 *   { key | (source, id), inRoster?: boolean, tracking?: 'none'|'active'|'paused' }
 *
 * Both fields are optional and independent: sending only `tracking` leaves My
 * Creators membership exactly as it was, which is what Pause has to do.
 * Rejecting a body that names neither is deliberate — a request that changes
 * nothing is a caller bug, and answering it with 200 hides that.
 *
 * The response carries the whole link set again, not only the row that changed.
 * The client's state is a pair of `Set`s and the server is authoritative over
 * them; returning the set means a change made in another tab reconciles on the
 * next press instead of drifting until reload.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null) as {
      key?: unknown; source?: unknown; id?: unknown
      inRoster?: unknown; tracking?: unknown
    } | null

    const ref = typeof body?.key === 'string'
      ? parseLinkKey(body.key)
      : toLinkRef(body?.source, body?.id)

    if (!ref) {
      return NextResponse.json(
        { error: 'A creator key, or source (account|roster) and a UUID id, is required.' },
        { status: 400 },
      )
    }

    /**
     * My Creators membership is only a fact about a KOL-database creator. A row
     * in `discover_creators` belongs to this org already — it carries an
     * `organization_id` — so flagging one here would be the same fact written
     * twice in two places that can then disagree.
     */
    if (body?.inRoster !== undefined && ref.source === 'account') {
      return NextResponse.json(
        { error: 'Creators your organization added are already in My Creators.' },
        { status: 400 },
      )
    }

    const inRoster = typeof body?.inRoster === 'boolean' ? body.inRoster : undefined
    const tracking = TRACKING_STATUSES.includes(body?.tracking as TrackingStatus)
      ? body!.tracking as TrackingStatus
      : undefined

    if (inRoster === undefined && tracking === undefined) {
      return NextResponse.json(
        { error: 'Nothing to change — send inRoster and/or tracking.' },
        { status: 400 },
      )
    }

    const link = await updateCreatorLink(orgId, access.userId, ref, { inRoster, tracking })
    const [links, counts] = await Promise.all([
      listCreatorLinks(orgId),
      countCreatorLinks(orgId),
    ])
    return NextResponse.json({ link, links, counts })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/links]', err)
    return NextResponse.json({ error: 'Unable to update this creator.' }, { status: 500 })
  }
}
