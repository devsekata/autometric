import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import kolDb from '@/lib/kolDb'
import { startKolScrape, type AddKolPlatform } from '@/lib/kolDirectory/addKolScrape'

/**
 * POST /api/kol-directory/add
 *
 * "Add New KOL" — step two. Inserts the roster identity (`kol_directory` →
 * `social_account` → `kol_social_account`) and returns its id right away; the
 * scrape itself (profile, posts, followers, harmonisation) keeps running in
 * the background — see `startKolScrape`. The UI is expected to poll
 * `GET /api/kol-directory/add/[kolId]/status` for progress.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
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

    const triggeredBy = session.user.email ?? null

    // Best-effort agency resolution: `public.user` is currently empty, so this
    // will not find a row for anyone yet — that must not block adding a KOL.
    // A row that cannot be tied to an agency still lands in `kol_directory`;
    // `insertIdentity` just skips the `agency_kol_accounts` insert for it.
    let agencyId: string | null = null
    let createdByUserId: string | null = null
    if (session.user.email) {
      try {
        const { rows } = await kolDb().query<{ agency_id: string | null; id: string }>(
          `SELECT agency_id, id FROM public.user WHERE email = $1 LIMIT 1`,
          [session.user.email],
        )
        agencyId = rows[0]?.agency_id ?? null
        createdByUserId = rows[0]?.id ?? null
      } catch (err) {
        console.warn('[POST /api/kol-directory/add] agency lookup failed, continuing without it:', err)
      }
    }

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
