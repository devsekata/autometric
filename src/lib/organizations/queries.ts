import pool from '@/lib/db'
import type { Organization } from './types'

export type { Organization as OrgRow }

// ─── Helpers ──────────────────────────────────────────────────────────────────

// `pg` failures arrive in three shapes and none of them puts everything in
// `message`:
//   * DatabaseError — SQL rejected by the server; useful bits live in
//     `code`/`detail`/`hint`/`constraint`.
//   * socket errors — `code`/`address`/`port` (ECONNREFUSED, ENOTFOUND).
//   * AggregateError — Node tries every address a host resolves to; when they
//     all fail it collects them into `.errors` and leaves `message` an EMPTY
//     STRING. This is the shape that produced the blank log line: a pool built
//     from an undefined connection string falls back to localhost, both the
//     IPv4 and IPv6 attempts are refused, and the result is an error that
//     prints as bare `Error:` with nothing after it.
// Flattening all three keeps the real cause in the log.
function describeDbError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { raw: String(err), rawType: typeof err }
  const e = err as Error & Record<string, unknown>
  const fields: Record<string, unknown> = {
    name: e.name,
    message: e.message || '(empty message)',
  }
  for (const key of [
    'code', 'detail', 'hint', 'position', 'severity', 'constraint',
    'table', 'column', 'routine', 'schema',      // pg DatabaseError
    'errno', 'syscall', 'address', 'port',       // socket-level failures
  ]) {
    if (e[key] != null) fields[key] = e[key]
  }
  // AggregateError hides every real reason in here.
  if (Array.isArray(e.errors)) {
    fields.aggregated = (e.errors as unknown[]).map((sub) =>
      sub instanceof Error
        ? [sub.message, (sub as Error & { code?: string }).code,
           (sub as Error & { address?: string }).address,
           (sub as Error & { port?: number }).port]
            .filter(Boolean).join(' ')
        : String(sub)
    )
  }
  if (e.cause instanceof Error) fields.cause = describeDbError(e.cause)
  return fields
}

// "Organization" here is `public.agencies` — on this branch (engkol_v1) the app's
// single database is the commercial `kol` database, which has no
// `organizations`/`organization_members`/`brands` (plural) tables at all. Its
// real tenant model is `agencies` (`slug`, `deleted_at`) with membership in
// `agency_members` (`role`, `status`, `joined_at`) and `public.brand`
// (singular, `agency_id`, `is_active` rather than `deleted_at`). This file
// used to target the old names directly; every query below was rewritten to
// the names that actually exist, keeping the same `Organization` shape so
// nothing downstream (layouts, the org switcher, `createOrg`, etc.) has to
// change.
const ORG_SELECT = `
  SELECT
    o.id,
    o.name,
    o.slug,
    o.created_at,
    me.role,
    (
      SELECT COUNT(*)::int
      FROM public.agency_members
      WHERE agency_id = o.id AND status = 'ACTIVE'
    ) AS member_count,
    (
      SELECT COUNT(*)::int
      FROM public.brand
      WHERE agency_id = o.id AND is_active = true
    ) AS brand_count,
    COALESCE(
      (
        SELECT json_agg(x.obj)
        FROM (
          SELECT jsonb_build_object('name', u.name) AS obj
          FROM public.agency_members am2
          JOIN public.user u ON u.id = am2.user_id
          WHERE am2.agency_id = o.id AND am2.status = 'ACTIVE'
          ORDER BY am2.joined_at NULLS LAST
          LIMIT 5
        ) x
      ),
      '[]'::json
    ) AS members_preview
  FROM public.agencies o
  JOIN public.agency_members me
    ON me.agency_id = o.id
    AND me.user_id = $1
    AND me.status = 'ACTIVE'
  WHERE o.deleted_at IS NULL`

export async function getOrgBasicBySlug(
  slug: string
): Promise<{ id: string; name: string; slug: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM public.agencies WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
    [slug]
  )
  return rows[0] ?? null
}

export async function getMemberRole(
  orgId: string,
  userId: string
): Promise<'ADMIN' | 'MEMBER' | null> {
  if (!isUserId(userId)) return null
  const { rows } = await pool.query<{ role: 'ADMIN' | 'MEMBER' }>(
    // Joining agencies keeps every org-scoped API in step with the soft
    // delete: once the agency is marked deleted, role lookups return null and
    // the routes answer 404 instead of operating on a deleted agency.
    `SELECT am.role FROM public.agency_members am
     JOIN public.agencies o ON o.id = am.agency_id AND o.deleted_at IS NULL
     WHERE am.agency_id = $1 AND am.user_id = $2 AND am.status = 'ACTIVE'
     LIMIT 1`,
    [orgId, userId]
  )
  return rows[0]?.role ?? null
}

/**
 * Callers throughout the app resolve the session id as `session?.user?.id ?? ''`
 * and hand the result straight to these queries. For an anonymous request that
 * empty string reaches Postgres as a uuid parameter and raises
 * `22P02 invalid input syntax for type uuid`, so a signed-out visitor produced a
 * DB exception and a stack trace in the log instead of a clean "no orgs" —
 * visible on every org route, including the layout that wraps them.
 *
 * An id that is not a uuid can never match a row, so short-circuiting is
 * behaviour-preserving: same result, minus the exception.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUserId = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v)

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listOrgsForUser(userId: string): Promise<Organization[]> {
  if (!isUserId(userId)) return []
  try {
    const { rows } = await pool.query(
      `${ORG_SELECT} ORDER BY o.created_at DESC`,
      [userId]
    )
    return rows
  } catch (err) {
    const detail = describeDbError(err)
    // console.error's object formatting gets JSON-serialised into the Next dev
    // log, which silently drops `undefined` values — stringify it here so the
    // line is never just `{}`.
    console.error(
      `[listOrgsForUser] query failed userId=${userId ?? '(none)'} ${JSON.stringify(detail)}`
    )
    // Rethrow carrying the flattened detail: an empty-message rethrow is what
    // made this invisible in the first place.
    throw new Error(
      `listOrgsForUser failed (userId=${userId ?? '(none)'}): ${JSON.stringify(detail)}`,
      { cause: err }
    )
  }
}

export async function getOrgForUser(
  orgId: string,
  userId: string
): Promise<Organization | null> {
  if (!isUserId(userId)) return null
  const { rows } = await pool.query(
    `${ORG_SELECT} AND o.id = $2`,
    [userId, orgId]
  )
  return rows[0] ?? null
}

export async function getOrgBySlugForUser(
  slug: string,
  userId: string
): Promise<Organization | null> {
  if (!isUserId(userId)) return null
  const { rows } = await pool.query(
    `${ORG_SELECT} AND o.slug = $2`,
    [userId, slug]
  )
  return rows[0] ?? null
}

export async function createOrg(
  name: string,
  slug: string,
  userId: string
): Promise<Organization> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: orgRows } = await client.query<{ id: string; name: string; slug: string; created_at: string }>(
      `INSERT INTO public.agencies (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, created_at`,
      [name, slug, userId]
    )
    const org = orgRows[0]

    await client.query(
      `INSERT INTO public.agency_members (agency_id, user_id, role, status, invited_by, joined_at)
       VALUES ($1, $2, 'ADMIN', 'ACTIVE', $2, NOW())`,
      [org.id, userId]
    )

    await client.query('COMMIT')

    return {
      ...org,
      role: 'ADMIN',
      member_count: 1,
      brand_count: 0,
      members_preview: [],
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function updateOrg(
  orgId: string,
  name: string,
  userId: string
): Promise<Organization | null> {
  const { rowCount } = await pool.query(
    `UPDATE public.agencies
     SET name = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL`,
    [name, orgId]
  )
  if (!rowCount) return null
  // Re-read through ORG_SELECT so the caller gets real member/brand counts and
  // role rather than placeholders.
  return getOrgForUser(orgId, userId)
}

// Soft delete: the medallion layers hold ON DELETE RESTRICT foreign keys to
// public.brands, so a real DELETE aborts for any org whose brands have gold
// data. Marking `deleted_at` hides the org everywhere (every read path filters
// on it) while the analytics history stays intact. Restoring is a manual
// `UPDATE organizations SET deleted_at = NULL`.
//
// Callers must ensure the org has no live brands first — see the DELETE route.
export async function softDeleteOrg(orgId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE public.agencies SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [orgId]
  )
  return (rowCount ?? 0) > 0
}
