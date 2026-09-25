import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { addMyCreator, removeMyCreator } from './myCreators'
import { toIso } from './util'
import type { CreatorLink, LinkCounts, LinkRef, LinkSource, TrackingStatus } from './types'

/**
 * The agency's relationship with a creator — My Creators, and monitoring —
 * kept on the KOL server in `public.agency_kol_accounts`.
 *
 * This module used to read `discover_creator_links` on the analytics warehouse
 * (migration 053, dropped). The contract (`CreatorLink`, the `links` API, the
 * client hook) is unchanged; the storage is the KOL table that already holds the
 * same two decisions:
 *
 *   in My Creators   `is_active IS TRUE`            (add/remove: `myCreators.ts`)
 *   tracking         `monitoring_enabled`            (migration kol/006, D015/D051)
 *                      true  → 'active'  ("Monitored")
 *                      false → 'paused'
 *                    not in My Creators → 'none'
 *
 * The KOL model has no tracking outside My Creators: monitoring is a property of
 * the link. So starting tracking on a creator adds it to My Creators, and
 * 'none' on a creator that stays in My Creators pauses it.
 *
 * ── Not in the KOL schema (returned null, never invented) ──────────────────
 *   trackingStartedAt, trackingChangedAt, lastCheckedAt, nextCheckAt — there is
 *   no column for them; `markCreatorChecked` is a no-op for the same reason.
 *   `account` links (the org's own warehouse-profiled creators) have no KOL
 *   equivalent: reads return none and writes are refused by the route.
 *
 * Every function takes an agency id the caller has already authorised
 * (`requireOrgMemberById` → `agency_members`).
 */

export type { LinkSource, TrackingStatus, LinkRef, CreatorLink, LinkCounts } from './types'

export const LINK_SOURCES: LinkSource[] = ['account', 'roster']
export const TRACKING_STATUSES: TrackingStatus[] = ['none', 'active', 'paused']

/**
 * The client's key for a link, identical to `selectionKey`: a bare UUID for an
 * account, `roster:<uuid>` for a KOL-database creator.
 */
export const linkKey = (ref: LinkRef): string =>
  ref.source === 'roster' ? `roster:${ref.id}` : ref.id

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Parses a client key back into a reference, or null when it is not one. */
export function parseLinkKey(key: string): LinkRef | null {
  if (typeof key !== 'string') return null
  const roster = key.startsWith('roster:')
  const id = roster ? key.slice('roster:'.length) : key
  if (!UUID.test(id)) return null
  return { source: roster ? 'roster' : 'account', id }
}

/** Builds a reference from a split body, for callers that send the two fields. */
export function toLinkRef(source: unknown, id: unknown): LinkRef | null {
  if (!LINK_SOURCES.includes(source as LinkSource) || typeof id !== 'string') return null
  return parseLinkKey(source === 'roster' ? `roster:${id}` : id)
}

/* ── row → payload ────────────────────────────────────────────────────────── */

interface LinkRow {
  kol_account_id: string
  created_at: Date | string | null
  monitoring_enabled: boolean
}

const toLink = (r: LinkRow): CreatorLink => ({
  source: 'roster',
  id: r.kol_account_id,
  inRoster: true,
  rosterAddedAt: toIso(r.created_at),
  tracking: r.monitoring_enabled ? 'active' : 'paused',
  trackingStartedAt: null,
  trackingChangedAt: null,
  lastCheckedAt: null,
  nextCheckAt: null,
})

// One row per creator: the pair is unique (migration kol/003), and the ORDER BY
// only makes the pick deterministic should an older duplicate still exist.
const ACTIVE_LINKS = `
  SELECT DISTINCT ON (a.kol_account_id)
         a.kol_account_id::text AS kol_account_id, a.created_at, a.monitoring_enabled
    FROM public.agency_kol_accounts a
   WHERE a.agency_id = $1 AND a.is_active IS TRUE AND a.kol_account_id IS NOT NULL`

/* ── reads ────────────────────────────────────────────────────────────────── */

/** Every creator this agency has in My Creators, newest first. */
export async function listCreatorLinks(agencyId: string): Promise<CreatorLink[]> {
  const { rows } = await kolDb().query<LinkRow>(
    `SELECT * FROM (${ACTIVE_LINKS} ORDER BY a.kol_account_id, a.created_at DESC NULLS LAST) l
      ORDER BY l.created_at DESC NULLS LAST`,
    [agencyId],
  )
  return rows.map(toLink)
}

/** One creator's link, or null when this agency has no relationship with them. */
export async function getCreatorLink(agencyId: string, ref: LinkRef): Promise<CreatorLink | null> {
  if (ref.source !== 'roster') return null
  const { rows } = await kolDb().query<LinkRow>(
    `${ACTIVE_LINKS} AND a.kol_account_id = $2 ORDER BY a.kol_account_id, a.created_at DESC NULLS LAST`,
    [agencyId, ref.id],
  )
  return rows[0] ? toLink(rows[0]) : null
}

/** The KOL-database creators this agency has in My Creators, newest first. */
export async function listRosterCreatorIds(agencyId: string): Promise<string[]> {
  return (await listCreatorLinks(agencyId)).map(l => l.id)
}

/** Links whose monitoring is live — Monitored or Paused. */
export async function listTrackedLinks(agencyId: string): Promise<CreatorLink[]> {
  return listCreatorLinks(agencyId)
}

/** The Discovery dashboard's agency-side numbers, in one round trip. */
export async function countCreatorLinks(agencyId: string): Promise<LinkCounts> {
  const { rows } = await kolDb().query<{ roster: string; tracked: string; paused: string }>(
    `SELECT COUNT(*)                                    AS roster,
            COUNT(*) FILTER (WHERE monitoring_enabled)  AS tracked,
            COUNT(*) FILTER (WHERE NOT monitoring_enabled) AS paused
       FROM (${ACTIVE_LINKS} ORDER BY a.kol_account_id, a.created_at DESC NULLS LAST) l`,
    [agencyId],
  )
  const r = rows[0]
  return { roster: Number(r?.roster ?? 0), tracked: Number(r?.tracked ?? 0), paused: Number(r?.paused ?? 0) }
}

/* ── writes ───────────────────────────────────────────────────────────────── */

export interface LinkUpdate {
  /** Add to or remove from My Creators. Omitted leaves membership as it was. */
  inRoster?: boolean
  /** Monitor, pause, or stop. Omitted leaves monitoring as it was. */
  tracking?: TrackingStatus
}

export class LinkUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'LinkUnavailableError' }
}

/**
 * Applies whichever of the two decisions the caller named, and returns the link
 * as it now stands (a 'none' link when the creator is no longer in My Creators).
 *
 * Membership goes through `addMyCreator` / `removeMyCreator`, the same writers
 * `/discover/my-creators` uses: removal deactivates the row (never deletes it —
 * Brand Fit, campaign and report rows reference it), and adding reactivates it.
 */
export async function updateCreatorLink(
  agencyId: string, userId: string | null, ref: LinkRef, patch: LinkUpdate,
): Promise<CreatorLink> {
  if (ref.source !== 'roster') {
    throw new LinkUnavailableError('Tracked accounts outside the Creator Database are not available on the KOL database.')
  }
  const wantsTracking = patch.tracking === 'active' || patch.tracking === 'paused'

  if (patch.inRoster === false) {
    await removeMyCreator(agencyId, ref.id)
  } else if (patch.inRoster === true || wantsTracking) {
    if (!userId) throw new LinkUnavailableError('A signed-in user is required to add a creator.')
    const added = await addMyCreator(agencyId, ref.id, userId)
    if (!added.ok) throw new LinkUnavailableError('This creator is not in the Creator Database.')
  }

  if (patch.tracking !== undefined && patch.inRoster !== false) {
    await kolDbWrite().query(
      `UPDATE public.agency_kol_accounts
          SET monitoring_enabled = $3,
              updated_at = CASE WHEN monitoring_enabled IS DISTINCT FROM $3 THEN now() ELSE updated_at END
        WHERE agency_id = $1 AND kol_account_id = $2 AND is_active IS TRUE`,
      [agencyId, ref.id, patch.tracking === 'active'],
    )
  }

  return (await getCreatorLink(agencyId, ref)) ?? {
    ...ref, inRoster: false, rosterAddedAt: null, tracking: 'none',
    trackingStartedAt: null, trackingChangedAt: null, lastCheckedAt: null, nextCheckAt: null,
  }
}

/**
 * Formerly stamped `last_checked_at` on the warehouse link. The KOL schema has
 * no such column, so this records nothing; the creator's own
 * `kol_directory.last_refreshed_at` remains the freshness signal.
 */
export async function markCreatorChecked(
  _agencyId: string, _ref: LinkRef, _nextCheckAt: Date | null = null,
): Promise<void> {}
