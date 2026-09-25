import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  SAVED_FILTERS_MAX, cleanName, listSavedFilters, saveFilter, validateFilters,
} from '@/lib/discover/savedFilters'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/saved-filters
 *
 * The signed-in user's Saved Lists in this agency, most recently saved first.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    return NextResponse.json({ lists: await listSavedFilters(access.orgId, access.userId) })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/saved-filters]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * POST /api/organizations/[id]/discover/saved-filters   { name, filters }
 *
 * Saves the current Creator Database filters under a name. Saving under a name
 * the user already has updates that list (200); a new name creates one (201).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({})) as { name?: unknown; filters?: unknown }
    const name = cleanName(body.name)
    if (!name) return NextResponse.json({ error: 'A name of 1–80 characters is required.' }, { status: 400 })
    const filters = validateFilters(body.filters)
    if (!filters) return NextResponse.json({ error: 'filters must be a filter set object.' }, { status: 400 })

    const result = await saveFilter(access.orgId, access.userId, name, filters)
    if (!result.ok) {
      return NextResponse.json(
        { error: `You can keep up to ${SAVED_FILTERS_MAX} saved lists. Delete one first.` },
        { status: 409 },
      )
    }
    return NextResponse.json({ list: result.list, created: result.created }, { status: result.created ? 201 : 200 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/saved-filters]', err)
    return NextResponse.json({ error: 'The list could not be saved.' }, { status: 500 })
  }
}
