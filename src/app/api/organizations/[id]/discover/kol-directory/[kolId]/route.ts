import { NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getKolCreator } from '@/lib/discover/kolDirectory'

type Params = { params: Promise<{ id: string; kolId: string }> }

/**
 * GET /api/organizations/[id]/discover/kol-directory/[kolId]
 *
 * One creator from the commercial roster, with their standing inside it and any
 * sibling account they hold on the other platform. Org membership is required
 * for the same reason the list endpoint requires it — the roster is global, but
 * every Discover surface sits behind the org.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id: orgId, kolId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const data = await getKolCreator(kolId)
    if (!data) return NextResponse.json({ error: 'Creator tidak ditemukan di roster.' }, { status: 404 })

    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/kol-directory/[kolId]]', err)
    return NextResponse.json({
      error: 'Something went wrong.',
      detail: process.env.NODE_ENV === 'development'
        ? String(err instanceof Error ? err.message : err)
        : undefined,
    }, { status: 500 })
  }
}
