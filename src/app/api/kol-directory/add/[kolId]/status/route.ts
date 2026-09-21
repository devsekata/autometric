import { NextRequest, NextResponse } from 'next/server'
import { isKolLinkedToAgency, requireAgencyMember } from '@/lib/kolDirectory/agencyAccess'
import { getAddKolRunStatus } from '@/lib/kolDirectory/addKolRunStatus'

type Params = { params: Promise<{ kolId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/kol-directory/add/[kolId]/status?orgId=&runId=
 *
 * "Add New KOL" — the progress screen polls this while the scrape runs in the
 * background. The per-step status is computed by `getAddKolRunStatus` (see
 * `@/lib/kolDirectory/addKolRunStatus`) for the newest run of this
 * `kol_directory` row, or for `runId` when a retry pinned one.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const access = await requireAgencyMember(req.nextUrl.searchParams.get('orgId'))
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const { kolId } = await params
    // Progress is visible to the agency the creator was added for, not to
    // every signed-in user.
    if (!(await isKolLinkedToAgency(kolId, access.agencyId))) {
      return NextResponse.json({ error: 'KOL not found.' }, { status: 404 })
    }

    const runId = req.nextUrl.searchParams.get('runId')
    if (runId !== null && !UUID_RE.test(runId)) {
      return NextResponse.json({ error: 'runId is invalid.' }, { status: 400 })
    }

    const status = await getAddKolRunStatus(kolId, runId)
    if (status === 'not_found' || status === 'foreign_run') {
      return NextResponse.json({ error: 'KOL not found.' }, { status: 404 })
    }
    return NextResponse.json(status)
  } catch (err) {
    console.error('[GET /api/kol-directory/add/[kolId]/status]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
