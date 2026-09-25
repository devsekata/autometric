import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAgencyMember } from '@/lib/kolDirectory/agencyAccess'
import { startKolScrape, type AddKolPlatform } from '@/lib/kolDirectory/addKolScrape'
import { resolveExistingIdentity } from '@/lib/kolDirectory/addKolCheck'

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
    // What the client believes the existing roster ids are (from `check`).
    // Only compared, never used: the ids the scrape writes to are derived on
    // the server below.
    const claimedKolDirectoryId = (body?.existingKolDirectoryId as string | null | undefined) ?? null
    const claimedSocialAccountId = (body?.existingSocialAccountId as string | null | undefined) ?? null

    if (platform !== 'instagram' && platform !== 'tiktok') {
      return NextResponse.json({ error: 'platform must be "instagram" or "tiktok".' }, { status: 400 })
    }
    if (typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'username is required.' }, { status: 400 })
    }
    if (typeof profileUrl !== 'string' || !profileUrl.trim()) {
      return NextResponse.json({ error: 'profileUrl is required.' }, { status: 400 })
    }

    // Reuse an existing roster row only when the server finds it for THIS
    // handle. A client id that disagrees is refused rather than silently
    // corrected, so a forged id is visible instead of quietly ignored.
    const identity = await resolveExistingIdentity(platform, username)
    if (identity.state === 'invalid_input') {
      return NextResponse.json({ error: identity.message }, { status: 400 })
    }
    if (identity.state === 'already_in_directory') {
      return NextResponse.json(
        { error: 'This creator is already in the Creator Database.', kolDirectoryId: identity.kolDirectoryId },
        { status: 409 },
      )
    }
    const existingKolDirectoryId = identity.state === 'reuse' ? identity.kolDirectoryId : null
    const existingSocialAccountId = identity.state === 'reuse' ? identity.socialAccountId : null
    if ((claimedKolDirectoryId ?? null) !== existingKolDirectoryId
      || (claimedKolDirectoryId !== null && (claimedSocialAccountId ?? null) !== existingSocialAccountId)) {
      return NextResponse.json(
        { error: 'The creator record does not match this handle. Run the check again.' },
        { status: 409 },
      )
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
    console.error('[POST /api/kol-directory/add]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
