import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAgencyMember } from '@/lib/kolDirectory/agencyAccess'
import { IdentityMismatchError, startKolScrape, type AddKolPlatform } from '@/lib/kolDirectory/addKolScrape'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/kol-directory/add
 *
 * "Add New KOL" — step two. Inserts the roster identity (`kol_directory` →
 * `social_account` → `kol_social_account`) and returns its id right away; the
 * scrape itself (profile, posts, followers, harmonisation) keeps running in
 * the background — see `startKolScrape`. The UI is expected to poll
 * `GET /api/kol-directory/add/[kolId]/status` for progress.
 *
 * Body carries `orgId`: the caller must be an active member of that agency,
 * and the new creator is linked to it.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const access = await requireAgencyMember(body?.orgId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const platform = body?.platform as AddKolPlatform | undefined
    const username = body?.username as string | undefined
    const profileUrl = body?.profileUrl as string | undefined
    // Set by the client when `check` found an existing `kol_directory` row
    // (and, separately, an existing `kol_social_account` link) for this
    // handle that was never scraped through to follower data — see
    // `addKolCheck.ts`. Reused so this insert does not fork a duplicate
    // roster entry for the same KOL.
    const existingKolDirectoryId = (body?.existingKolDirectoryId as string | null | undefined) ?? null
    const existingSocialAccountId = (body?.existingSocialAccountId as string | null | undefined) ?? null

    if (platform !== 'instagram' && platform !== 'tiktok') {
      return NextResponse.json({ error: 'platform must be "instagram" or "tiktok".' }, { status: 400 })
    }
    if (typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'username is required.' }, { status: 400 })
    }
    if (typeof profileUrl !== 'string' || !profileUrl.trim()) {
      return NextResponse.json({ error: 'profileUrl is required.' }, { status: 400 })
    }
    const badId = (v: unknown) => v !== null && (typeof v !== 'string' || !UUID_RE.test(v))
    if (badId(existingKolDirectoryId) || badId(existingSocialAccountId)
      || (existingSocialAccountId && !existingKolDirectoryId)) {
      return NextResponse.json({ error: 'Invalid existing creator ids.' }, { status: 400 })
    }

    const session = await auth()
    const triggeredBy = session?.user?.email ?? null
    // The membership check above proves the user row exists on the KOL server,
    // so its id is safe for `agency_kol_accounts.created_by`.
    const agencyId = access.agencyId
    const createdByUserId = access.userId

    const { kolDirectoryId } = await startKolScrape({
      platform, username, profileUrl, triggeredBy, agencyId, createdByUserId,
      existingKolDirectoryId, existingSocialAccountId,
    })

    return NextResponse.json({ kolDirectoryId })
  } catch (err) {
    // The check result the client sent no longer matches the roster; nothing
    // was written and no scrape started.
    if (err instanceof IdentityMismatchError) {
      return NextResponse.json(
        { error: 'Data creator sudah berubah. Cek ulang akun sebelum menambahkan.' },
        { status: 409 },
      )
    }
    console.error('[POST /api/kol-directory/add]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
