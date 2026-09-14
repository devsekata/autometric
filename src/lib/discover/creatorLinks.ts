import pool from '@/lib/db'
import { toIso } from './util'
import type { CreatorLink, LinkCounts, LinkRef, LinkSource, TrackingStatus } from './types'

/**
 * The organization's relationship with a creator — My Creators, and tracking.
 *
 * `public.discover_creator_links` (migration 053). See that file for why the two
 * facts share a table and why `target_id` carries no foreign key; the short
 * version is that a Discovery creator lives in one of two databases and only one
 * of them is this one.
 *
 * ── What this module is not ────────────────────────────────────────────────
 * It is not a creator store. Nothing here copies a name, a follower count or an
 * avatar out of the KOL database — a link row is (org, source, id) and the state
 * of two decisions. Hydrating those ids back into creators is
 * `listRosterCreators` / `listTrackedCreators` in the API layer, which asks
 * `listKolDirectory({ ids })` for the roster side and `listCreators` for the
 * org's own. That keeps one copy of every creator fact, on the server that owns
 * it, which is the whole reason My Creators is a flag and not a table of
 * creators.
 *
 * ── Sources ─────────────────────────────────────────────────────────────────
 * `roster` is a row on the commercial KOL server; `account` is a row in
 * `public.discover_creators`, the creators this org profiled itself. The same
 * two words, in the same order, as `discover_favorites` and
 * `useDiscoverSelection` — a caller that can build a favourite key can build one
 * of these.
 */

export type { LinkSource, TrackingStatus, LinkRef, CreatorLink, LinkCounts } from './types'

export const LINK_SOURCES: LinkSource[] = ['account', 'roster']
export const TRACKING_STATUSES: TrackingStatus[] = ['none', 'active', 'paused']

/**
 * The client's key for a link, identical to `selectionKey` and `favoriteKey`:
 * a bare UUID for an account, `roster:<uuid>` for a KOL-database creator.
 *
 * Kept identical so a card can test three different sets — favourites, compare
 * and links — with the same string, without knowing which database the creator
 * came from.
 */
export const linkKey = (ref: LinkRef): string =>
  ref.source === 'roster' ? `roster:${ref.id}` : ref.id

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parses a client key back into a reference, or null when it is not one.
 *
 * Shape-checked because the value goes into a `uuid` column, where a malformed
 * string aborts the statement rather than matching nothing.
 */
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
  target_source: LinkSource
  target_id: string
  in_roster: boolean
  roster_added_at: Date | string | null
  tracking_status: TrackingStatus
  tracking_started_at: Date | string | null
  tracking_changed_at: Date | string | null
  last_checked_at: Date | string | null
  next_check_at: Date | string | null
}

const COLS = `
  target_source, target_id, in_roster, roster_added_at,
  tracking_status, tracking_started_at, tracking_changed_at,
  last_checked_at, next_check_at`

const toLink = (r: LinkRow): CreatorLink => ({
  source: r.target_source,
  id: r.target_id,
  inRoster: r.in_roster,
  rosterAddedAt: toIso(r.roster_added_at),
  tracking: r.tracking_status,
  trackingStartedAt: toIso(r.tracking_started_at),
  trackingChangedAt: toIso(r.tracking_changed_at),
  lastCheckedAt: toIso(r.last_checked_at),
  nextCheckAt: toIso(r.next_check_at),
})

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * Every link this org holds that still means something.
 *
 * A row whose flags have all been cleared — un-saved and un-tracked — is
 * history: it keeps its `tracking_started_at` so "we watched them once" stays
 * answerable, but it is not a state any screen draws, so it is not returned.
 * The Creator Database grid drops this straight into two `Set`s.
 */
export async function listCreatorLinks(orgId: string): Promise<CreatorLink[]> {
  const { rows } = await pool.query<LinkRow>(
    `SELECT ${COLS}
       FROM public.discover_creator_links
      WHERE organization_id = $1
        AND (in_roster OR tracking_status <> 'none')
      ORDER BY updated_at DESC`,
    [orgId],
  )
  return rows.map(toLink)
}

/** One creator's link, or null when this org has no relationship with them. */
export async function getCreatorLink(orgId: string, ref: LinkRef): Promise<CreatorLink | null> {
  const { rows } = await pool.query<LinkRow>(
    `SELECT ${COLS}
       FROM public.discover_creator_links
      WHERE organization_id = $1 AND target_source = $2 AND target_id = $3`,
    [orgId, ref.source, ref.id],
  )
  return rows[0] ? toLink(rows[0]) : null
}

/**
 * The KOL-database creators this org has adopted, newest first.
 *
 * Ids only — hydrating them is the caller's job, because only the caller knows
 * whether it wants the directory row, the profile or just the count.
 */
export async function listRosterCreatorIds(orgId: string): Promise<string[]> {
  const { rows } = await pool.query<{ target_id: string }>(
    `SELECT target_id
       FROM public.discover_creator_links
      WHERE organization_id = $1 AND target_source = 'roster' AND in_roster
      ORDER BY roster_added_at DESC NULLS LAST`,
    [orgId],
  )
  return rows.map(r => r.target_id)
}

/** Links whose tracking is live — active or paused, both sources. */
export async function listTrackedLinks(orgId: string): Promise<CreatorLink[]> {
  const { rows } = await pool.query<LinkRow>(
    `SELECT ${COLS}
       FROM public.discover_creator_links
      WHERE organization_id = $1 AND tracking_status <> 'none'
      ORDER BY tracking_changed_at DESC NULLS LAST`,
    [orgId],
  )
  return rows.map(toLink)
}

/**
 * The Discovery dashboard's two org-side numbers, in one round trip.
 *
 * `active` and `paused` are counted separately rather than derived from a list,
 * because the dashboard needs the figures and not the creators — loading a
 * hundred rows to call `.length` on them is the shape this avoids.
 */
export async function countCreatorLinks(orgId: string): Promise<LinkCounts> {
  const { rows } = await pool.query<{ roster: string; tracked: string; paused: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE in_roster AND target_source = 'roster')  AS roster,
       COUNT(*) FILTER (WHERE tracking_status = 'active')              AS tracked,
       COUNT(*) FILTER (WHERE tracking_status = 'paused')              AS paused
     FROM public.discover_creator_links
     WHERE organization_id = $1`,
    [orgId],
  )
  const r = rows[0]
  return {
    roster: Number(r?.roster ?? 0),
    tracked: Number(r?.tracked ?? 0),
    paused: Number(r?.paused ?? 0),
  }
}

/* ── writes ───────────────────────────────────────────────────────────────── */

export interface LinkUpdate {
  /** Add to or remove from My Creators. Omitted leaves the flag as it was. */
  inRoster?: boolean
  /** Start, pause, resume or stop tracking. Omitted leaves the status as it was. */
  tracking?: TrackingStatus
}

/**
 * Applies whichever of the two decisions the caller named, and returns the row
 * as it now stands.
 *
 * One upsert rather than a read-then-write: two people pressing Save on the same
 * creator at the same moment is an ordinary thing on a shared workspace, and the
 * unique index is what settles it. `COALESCE($n, …)` on every optional field is
 * what lets one statement express "change tracking, leave the roster flag
 * alone" — a partial update, without a second query to find out what the other
 * half currently is.
 *
 * The timestamps follow the values rather than being passed in:
 *
 *   * `roster_added_at` is set when the flag goes true and cleared when it goes
 *     false, so "saved three weeks ago" cannot survive an un-save and reappear
 *     as the date of a later one.
 *   * `tracking_started_at` is set on the *first* transition into tracking and
 *     then left alone — pausing and resuming is the same monitoring
 *     relationship, and resetting the date would erase how long it has run.
 *   * `tracking_changed_at` moves on every status change, which is what the
 *     Tracked Accounts screen prints beside a paused creator.
 */
export async function updateCreatorLink(
  orgId: string, userId: string | null, ref: LinkRef, patch: LinkUpdate,
): Promise<CreatorLink> {
  const inRoster = patch.inRoster ?? null
  const tracking = patch.tracking ?? null

  const { rows } = await pool.query<LinkRow>(
    `INSERT INTO public.discover_creator_links (
       organization_id, target_source, target_id,
       in_roster, roster_added_at, roster_added_by,
       tracking_status, tracking_started_at, tracking_changed_at, tracking_started_by)
     VALUES (
       $1, $2, $3,
       COALESCE($4::boolean, false),
       CASE WHEN $4::boolean THEN now() END,
       CASE WHEN $4::boolean THEN $6::uuid END,
       COALESCE($5::varchar, 'none'),
       CASE WHEN $5::varchar IN ('active', 'paused') THEN now() END,
       CASE WHEN $5::varchar IS NOT NULL THEN now() END,
       CASE WHEN $5::varchar IN ('active', 'paused') THEN $6::uuid END)
     ON CONFLICT (organization_id, target_source, target_id) DO UPDATE SET
       in_roster = COALESCE($4::boolean, public.discover_creator_links.in_roster),
       roster_added_at = CASE
         WHEN $4::boolean IS NULL THEN public.discover_creator_links.roster_added_at
         WHEN $4::boolean THEN COALESCE(public.discover_creator_links.roster_added_at, now())
         ELSE NULL
       END,
       roster_added_by = CASE
         WHEN $4::boolean IS NULL THEN public.discover_creator_links.roster_added_by
         WHEN $4::boolean THEN COALESCE(public.discover_creator_links.roster_added_by, $6::uuid)
         ELSE NULL
       END,
       tracking_status = COALESCE($5::varchar, public.discover_creator_links.tracking_status),
       -- Set once, on the first move into tracking, and kept across pause and
       -- resume. A creator tracked, stopped, then tracked again starts a new
       -- relationship and gets a new date.
       tracking_started_at = CASE
         WHEN $5::varchar IS NULL THEN public.discover_creator_links.tracking_started_at
         WHEN $5::varchar = 'none' THEN public.discover_creator_links.tracking_started_at
         WHEN public.discover_creator_links.tracking_status = 'none' THEN now()
         ELSE public.discover_creator_links.tracking_started_at
       END,
       tracking_changed_at = CASE
         WHEN $5::varchar IS NULL OR $5::varchar = public.discover_creator_links.tracking_status
           THEN public.discover_creator_links.tracking_changed_at
         ELSE now()
       END,
       tracking_started_by = CASE
         WHEN $5::varchar IS NULL OR $5::varchar = 'none'
           THEN public.discover_creator_links.tracking_started_by
         ELSE COALESCE(public.discover_creator_links.tracking_started_by, $6::uuid)
       END,
       updated_at = now()
     RETURNING ${COLS}`,
    [orgId, ref.source, ref.id, inRoster, tracking, userId],
  )
  return toLink(rows[0])
}

/**
 * Records that a refresh was requested for a tracked creator.
 *
 * `last_checked_at` is the request, not the result. Every refresh path here is
 * asynchronous — a scrape takes minutes — so nothing at the moment of writing
 * knows whether new numbers will land, and the screens read the creator record's
 * own `lastRefreshedAt` when they need to say how old the data is. This column
 * answers the different question of whether a pull is already in flight, so a
 * second Refresh press is visibly redundant.
 *
 * Separate from `updateCreatorLink` because it is written by a refresh, not by a
 * user decision, and must never touch the two decision columns. A no-op for a
 * creator this org does not track: it should not quietly create a tracking row
 * as a side effect.
 */
export async function markCreatorChecked(
  orgId: string, ref: LinkRef, nextCheckAt: Date | null = null,
): Promise<void> {
  await pool.query(
    `UPDATE public.discover_creator_links
        SET last_checked_at = now(), next_check_at = $4, updated_at = now()
      WHERE organization_id = $1 AND target_source = $2 AND target_id = $3
        AND tracking_status <> 'none'`,
    [orgId, ref.source, ref.id, nextCheckAt],
  )
}
