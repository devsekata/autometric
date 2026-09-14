import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getCreatorLink, markCreatorChecked, parseLinkKey, toLinkRef } from '@/lib/discover/creatorLinks'
import { getRosterScrapeTarget } from '@/lib/discover/kolDirectory'
import { startProfiling } from '@/lib/discover/creatorProfiling'
import { startKolScrape, type AddKolPlatform } from '@/lib/kolDirectory/addKolScrape'
import { profileUrlFor } from '@/lib/discover/creatorInput'
import kolDb from '@/lib/kolDb'

type Params = { params: Promise<{ id: string }> }

/**
 * POST — pull this creator's numbers again, now.
 *
 *   { key | (source, id) }
 *
 * "Refresh Data" on the Tracked Accounts screen. Tracking is a standing
 * intention; this is the manual pull that does not wait for it.
 *
 * The two id spaces refresh through their own pipelines, because a creator's
 * data belongs to the database that holds them:
 *
 *   * `account` — a creator this org profiled itself. `startProfiling(…,
 *     'refresh')`, exactly what the My Creators card's refresh button already
 *     runs; the run is logged in `discover_creator_runs` and the roster polls it.
 *   * `roster` — a creator in the commercial KOL database. `startKolScrape`
 *     against the row that already exists, which is the same pipeline Add KOL
 *     runs and the only thing that refreshes a roster creator at all. Both
 *     existing ids are passed: given only the directory id it would take the
 *     "imported but never linked" path and fork a second `social_account`.
 *
 * Both are asynchronous and answer 202: a scrape takes minutes, and holding the
 * request open for it would time out long before the data landed.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null) as
      { key?: unknown; source?: unknown; id?: unknown } | null

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
     * Only a creator this org actually tracks may be refreshed from here.
     *
     * A scrape costs an Apify run, and this endpoint takes an id from the
     * browser. Requiring a live tracking row means the org has to have said "we
     * are watching this creator" before it can spend a run on them — and it is
     * the same check that keeps the refresh from quietly creating tracking
     * state as a side effect.
     */
    const link = await getCreatorLink(orgId, ref)
    if (!link || link.tracking === 'none') {
      return NextResponse.json(
        { error: 'This creator is not tracked by your organization. Start tracking them first.' },
        { status: 409 },
      )
    }

    if (ref.source === 'account') {
      startProfiling(orgId, ref.id, 'refresh')
      await markCreatorChecked(orgId, ref)
      return NextResponse.json({ started: true, pipeline: 'profiling' }, { status: 202 })
    }

    const target = await getRosterScrapeTarget(ref.id)
    if (!target) {
      return NextResponse.json({ error: 'This creator is no longer in the Creator Database.' }, { status: 404 })
    }
    if (target.platform !== 'instagram' && target.platform !== 'tiktok') {
      // The scrape pipeline has actors for two platforms. Saying which creator
      // cannot be refreshed, and why, beats a generic failure the user would
      // read as an outage.
      return NextResponse.json(
        { error: `Refreshing is only available for Instagram and TikTok creators (this one is ${target.platform ?? 'unknown'}).` },
        { status: 400 },
      )
    }

    const session = await auth()
    const triggeredBy = session?.user?.email ?? null

    // Best-effort, exactly as the Add KOL route does it: `public.user` on the
    // KOL server is not populated from this app, so a miss must not stop a
    // refresh. See the note in `POST /api/kol-directory/add`.
    let agencyId: string | null = null
    let createdByUserId: string | null = null
    if (session?.user?.email) {
      try {
        const { rows } = await kolDb().query<{ agency_id: string | null; id: string }>(
          `SELECT agency_id, id FROM public.user WHERE email = $1 LIMIT 1`,
          [session.user.email],
        )
        agencyId = rows[0]?.agency_id ?? null
        createdByUserId = rows[0]?.id ?? null
      } catch (err) {
        console.warn('[discover/links/refresh] agency lookup failed, continuing without it:', err)
      }
    }

    await startKolScrape({
      platform: target.platform as AddKolPlatform,
      username: target.username,
      // The roster stores a profile URL for most rows but not all; the
      // fallback is built by the same helper intake uses, which knows TikTok
      // handles carry an `@` and Instagram's do not.
      profileUrl: target.profileUrl ?? profileUrlFor(target.platform, target.username),
      triggeredBy,
      agencyId,
      createdByUserId,
      existingKolDirectoryId: target.id,
      existingSocialAccountId: target.socialAccountId,
    })

    await markCreatorChecked(orgId, ref)
    return NextResponse.json({ started: true, pipeline: 'scrape', kolId: target.id }, { status: 202 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/links/refresh]', err)
    return NextResponse.json({ error: 'The refresh could not be started.' }, { status: 500 })
  }
}
