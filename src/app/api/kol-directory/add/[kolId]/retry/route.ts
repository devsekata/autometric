import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyMember } from '@/lib/kolDirectory/agencyAccess'
import { retryKolScrape } from '@/lib/kolDirectory/addKolScrape'

type Params = { params: Promise<{ kolId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/kol-directory/add/[kolId]/retry   { orgId }
 *
 * "Add New KOL" — run the scrape again for a creator whose last run failed,
 * without entering the handle again. The creator, its social account and its
 * handle are read from the KOL database; the body carries only the agency,
 * whose active membership and active link to the creator are both required.
 *
 * 202 { kolDirectoryId, runId } — the new run started; poll
 *     `GET …/status?orgId=&runId=` for it.
 * 404 — the agency has no active link to this creator.
 * 409 — nothing to retry: the creator is not a usable roster row, or its last
 *       run has not failed (still running, or already succeeded).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json().catch(() => null)
    const access = await requireAgencyMember(body?.orgId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const { kolId } = await params
    if (!UUID_RE.test(kolId)) return NextResponse.json({ error: 'KOL not found.' }, { status: 404 })

    const result = await retryKolScrape(kolId, access.agencyId, access.userId)
    if (result.ok) {
      return NextResponse.json({ kolDirectoryId: result.kolDirectoryId, runId: result.runId }, { status: 202 })
    }
    if (result.reason === 'not_linked') {
      return NextResponse.json({ error: 'KOL not found.' }, { status: 404 })
    }
    if (result.reason === 'invalid_identity') {
      return NextResponse.json(
        { error: 'Creator ini tidak bisa diproses ulang. Tambahkan lagi lewat Add KOL.', code: 'invalid_identity' },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        error: result.status === 'success'
          ? 'Proses terakhir sudah berhasil, tidak ada yang perlu diulang.'
          : 'Proses terakhir belum gagal, jadi belum bisa diulang.',
        code: 'not_failed',
        status: result.status ?? null,
      },
      { status: 409 },
    )
  } catch (err) {
    console.error('[POST /api/kol-directory/add/[kolId]/retry]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
