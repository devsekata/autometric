import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyMember } from '@/lib/kolDirectory/agencyAccess'
import { refreshKolScrape, REFRESH_COOLDOWN_MS } from '@/lib/kolDirectory/addKolScrape'

type Params = { params: Promise<{ kolId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** "13 menit" / "45 detik" — how long is left on the cooldown. */
function waitLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  return minutes >= 1 ? `${minutes} menit` : `${Math.ceil(ms / 1000)} detik`
}

/**
 * POST /api/kol-directory/add/[kolId]/refresh   { orgId }
 *
 * D054 — run the Add KOL pipeline again over a creator the agency already
 * holds, without entering the handle again and without touching identity,
 * links, favorites or monitoring. The creator, its social account and its
 * handle are read from the KOL database; the body carries only the agency.
 *
 * Sibling of `../retry`, not a widening of it: retry answers "the last run
 * failed, run it again" (D013) and its gate is untouched here. Refresh answers
 * "these numbers are old", is allowed for Ready and Failed creators, is rate
 * limited, and reserves its run so two clicks cannot both start one.
 *
 * 202 { kolDirectoryId, runId } — the run started; poll
 *     `GET …/status?orgId=&runId=` for it.
 * 400 — orgId missing or malformed.
 * 401 — not signed in.
 * 403 — signed in, but not a member of that agency.
 * 404 — the agency has no active link to this creator.
 * 409 — with a machine-readable `code`:
 *       `invalid_identity`        not a usable roster row,
 *       `already_running`         a run of this creator is in flight,
 *       `cooldown`                too soon since the last run (`retryAfterMs`),
 *       `status_not_refreshable`  neither Ready nor Failed (`status`).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json().catch(() => null)
    const access = await requireAgencyMember(body?.orgId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const { kolId } = await params
    if (!UUID_RE.test(kolId)) return NextResponse.json({ error: 'KOL not found.' }, { status: 404 })

    const result = await refreshKolScrape(kolId, access.agencyId, access.userId)
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
    if (result.reason === 'already_running') {
      return NextResponse.json(
        { error: 'Proses untuk creator ini sedang berjalan.', code: 'already_running' },
        { status: 409 },
      )
    }
    if (result.reason === 'cooldown') {
      const waitMs = result.retryAfterMs ?? REFRESH_COOLDOWN_MS
      return NextResponse.json(
        {
          error: `Refresh baru bisa dijalankan lagi dalam ${waitLabel(waitMs)}.`,
          code: 'cooldown',
          retryAfterMs: waitMs,
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        error: 'Creator ini belum punya data yang bisa diperbarui. Tambahkan lewat Add KOL dulu.',
        code: 'status_not_refreshable',
        status: result.status ?? null,
      },
      { status: 409 },
    )
  } catch (err) {
    console.error('[POST /api/kol-directory/add/[kolId]/refresh]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
