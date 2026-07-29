import pool from '@/lib/db'
import type { Organization } from './types'

export type { Organization as OrgRow }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_SELECT = `
  SELECT
    o.id,
    o.name,
    o.slug,
    o.created_at,
    me.role,
    (
      SELECT COUNT(*)::int
      FROM organization_members
      WHERE organization_id = o.id AND status = 'ACTIVE'
    ) AS member_count,
    (
      SELECT COUNT(*)::int
      FROM brands
      WHERE organization_id = o.id AND deleted_at IS NULL
    ) AS brand_count,
    COALESCE(
      (
        SELECT json_agg(x.obj)
        FROM (
          SELECT jsonb_build_object('name', u.name) AS obj
          FROM organization_members om2
          JOIN users u ON u.id = om2.user_id
          WHERE om2.organization_id = o.id AND om2.status = 'ACTIVE'
          ORDER BY om2.joined_at NULLS LAST
          LIMIT 5
        ) x
      ),
      '[]'::json
    ) AS members_preview
  FROM organizations o
  JOIN organization_members me
    ON me.organization_id = o.id
    AND me.user_id = $1
    AND me.status = 'ACTIVE'
  WHERE o.deleted_at IS NULL`

export async function getOrgBasicBySlug(
  slug: string
): Promise<{ id: string; name: string; slug: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
    [slug]
  )
  return rows[0] ?? null
}

export async function getMemberRole(
  orgId: string,
  userId: string
): Promise<'ADMIN' | 'MEMBER' | null> {
  const { rows } = await pool.query<{ role: 'ADMIN' | 'MEMBER' }>(
    // Joining organizations keeps every org-scoped API in step with the soft
    // delete: once the org is marked deleted, role lookups return null and the
    // routes answer 404 instead of operating on a deleted org.
    `SELECT om.role FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
     WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'ACTIVE'
     LIMIT 1`,
    [orgId, userId]
  )
  return rows[0]?.role ?? null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listOrgsForUser(userId: string): Promise<Organization[]> {
  const { rows } = await pool.query(
    `${ORG_SELECT} ORDER BY o.created_at DESC`,
    [userId]
  )
  return rows
}

export async function getOrgForUser(
  orgId: string,
  userId: string
): Promise<Organization | null> {
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
      `INSERT INTO organizations (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, created_at`,
      [name, slug, userId]
    )
    const org = orgRows[0]

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, email, role, status, invited_by, joined_at)
       SELECT $1, $2, email, 'ADMIN', 'ACTIVE', $2, NOW()
       FROM users WHERE id = $2`,
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
    `UPDATE organizations
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
    `UPDATE organizations SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [orgId]
  )
  return (rowCount ?? 0) > 0
}
