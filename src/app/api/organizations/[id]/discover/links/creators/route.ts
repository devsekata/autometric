import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listCreatorLinks, linkKey } from '@/lib/discover/creatorLinks'
import { listKolDirectory, type KolDirectoryRow } from '@/lib/discover/kolDirectory'
import { listCreators } from '@/lib/discover/creatorStore'
import type { CreatorSummary } from '@/lib/discover/creatorFlow'
import type { CreatorLink, LinkedCreator } from '@/lib/discover/types'

type Params = { params: Promise<{ id: string }> }

/**
 * The creators behind this org's links — My Creators' adopted half, and Tracked
 * Accounts.
 *
 * The link table stores ids and decisions, nothing else (see
 * @/lib/discover/creatorLinks). This route is where those ids become creators
 * again, and it does it by asking each id's *own* database rather than by
 * reading a copy: `roster` ids go to the KOL database through the same
 * `listKolDirectory` the Creator Database uses, `account` ids to
 * `discover_creators`. That is the whole reason My Creators is a flag and not a
 * table of creator rows — one creator, one record, on the server that keeps it
 * fresh.
 *
 *   GET ?facet=roster    creators adopted into My Creators (KOL database only)
 *   GET ?facet=tracked   creators being monitored, both sources, active + paused
 */

/**
 * `listKolDirectory` caps a page at 60 rows, so a long list is asked for in
 * batches. Sequential rather than parallel: this runs against a database on a
 * private network and a saved list of 300 creators should not open five
 * connections at once to answer one screen.
 */
const ID_BATCH = 60

async function rosterRows(ids: string[]): Promise<Map<string, KolDirectoryRow>> {
  const out = new Map<string, KolDirectoryRow>()
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const { rows } = await listKolDirectory({ ids: ids.slice(i, i + ID_BATCH) })
    for (const r of rows) out.set(r.id, r)
  }
  return out
}

const fromRoster = (r: KolDirectoryRow, link: CreatorLink): LinkedCreator => ({
  key: linkKey(link),
  source: 'roster',
  id: r.id,
  username: r.username,
  displayName: r.displayName,
  avatarUrl: r.avatarUrl,
  profileUrl: r.profileUrl,
  platform: r.platform,
  categories: r.categories,
  city: r.city,
  followers: r.followers,
  erPct: r.erPct,
  tier: r.tier,
  lastRefreshedAt: r.lastRefreshedAt,
  link,
})

const fromOwn = (c: CreatorSummary, link: CreatorLink): LinkedCreator => ({
  key: linkKey(link),
  source: 'account',
  id: c.id,
  username: c.username,
  displayName: c.displayName,
  avatarUrl: c.avatarUrl,
  profileUrl: c.profileUrl,
  platform: c.platform,
  // The org's own creators carry a single category; the roster carries several.
  // One shape wins, and it is the wider one — a list is a superset of a value.
  categories: c.category ? [c.category] : [],
  city: c.city,
  followers: c.followers,
  erPct: c.erPct,
  tier: c.tier,
  lastRefreshedAt: c.lastRefreshedAt,
  link,
})

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const facet = req.nextUrl.searchParams.get('facet') === 'tracked' ? 'tracked' : 'roster'
    const links = await listCreatorLinks(orgId)

    const wanted = facet === 'tracked'
      ? links.filter(l => l.tracking !== 'none')
      : links.filter(l => l.inRoster && l.source === 'roster')

    if (!wanted.length) return NextResponse.json({ creators: [], notes: [] })

    const notes: string[] = []
    const creators: LinkedCreator[] = []

    /* ── the KOL database's half ── */
    const rosterLinks = wanted.filter(l => l.source === 'roster')
    if (rosterLinks.length) {
      try {
        const rows = await rosterRows(rosterLinks.map(l => l.id))
        for (const l of rosterLinks) {
          const row = rows.get(l.id)
          // A link whose creator is no longer in the active directory is kept in
          // the table but not rendered: the row may come back (the directory has
          // a status column), and silently deleting the org's saved list because
          // a creator was deactivated upstream is not this route's call.
          if (row) creators.push(fromRoster(row, l))
        }
        const missing = rosterLinks.length - rows.size
        if (missing > 0) {
          notes.push(
            `${missing} creator${missing > 1 ? 's are' : ' is'} no longer active in the Creator Database and could not be shown.`,
          )
        }
      } catch (err) {
        // The KOL database is on a private network. Saying it was unreachable is
        // the difference between "you have saved nothing" and "we could not read
        // what you saved".
        notes.push('The Creator Database could not be reached, so creators saved from it are missing from this list.')
        console.warn('[discover/links/creators] roster unavailable:', err instanceof Error ? err.message : err)
      }
    }

    /* ── the org's own creators ── */
    const ownLinks = wanted.filter(l => l.source === 'account')
    if (ownLinks.length) {
      // The org's own roster is a handful of rows, so it is read whole and
      // matched in memory rather than queried once per id.
      const own = new Map((await listCreators(orgId)).map(c => [c.id, c]))
      for (const l of ownLinks) {
        const c = own.get(l.id)
        if (c) creators.push(fromOwn(c, l))
      }
    }

    /**
     * Ordered by the decision, not by the creator: this list answers "what have
     * we saved / what are we watching", and the most recent decision is the one
     * the reader is most likely to be looking for.
     */
    const at = (c: LinkedCreator) =>
      facet === 'tracked'
        ? (c.link.trackingChangedAt ?? c.link.trackingStartedAt ?? '')
        : (c.link.rosterAddedAt ?? '')
    creators.sort((a, b) => at(b).localeCompare(at(a)))

    return NextResponse.json({ creators, notes })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/links/creators]', err)
    return NextResponse.json({ error: 'Unable to load these creators.' }, { status: 500 })
  }
}
