import pool from '@/lib/db'
import type { DiscoverSource } from './types'

/**
 * The Discover "Inspirations" shortlist — org-scoped saved posts.
 *
 * See migrations/043: an entry is keyed by (organization_id, source,
 * post_row_id) because the two post tables have independent bigint id spaces,
 * and there is deliberately no FK to either of them (the medallion pipeline
 * rewrites those rows on re-sync).
 */

export interface InspirationRef {
  source: DiscoverSource
  postRowId: number
  platform: string
}

/** Idempotent add — re-saving an already-saved post is a no-op, not an error. */
export async function addInspiration(
  orgId: string, userId: string, ref: InspirationRef,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.discover_inspirations
       (organization_id, saved_by_user_id, source, post_row_id, platform)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, source, post_row_id) DO NOTHING`,
    [orgId, userId, ref.source, ref.postRowId, ref.platform],
  )
}

export async function removeInspiration(
  orgId: string, ref: Pick<InspirationRef, 'source' | 'postRowId'>,
): Promise<void> {
  await pool.query(
    `DELETE FROM public.discover_inspirations
      WHERE organization_id = $1 AND source = $2 AND post_row_id = $3`,
    [orgId, ref.source, ref.postRowId],
  )
}

/**
 * Toggle used by the bookmark button. Returns the resulting state so the client
 * can reconcile without a refetch.
 */
export async function toggleInspiration(
  orgId: string, userId: string, ref: InspirationRef,
): Promise<{ saved: boolean }> {
  const { rowCount } = await pool.query(
    `DELETE FROM public.discover_inspirations
      WHERE organization_id = $1 AND source = $2 AND post_row_id = $3`,
    [orgId, ref.source, ref.postRowId],
  )
  if (rowCount && rowCount > 0) return { saved: false }
  await addInspiration(orgId, userId, ref)
  return { saved: true }
}

export async function countInspirations(orgId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text n FROM public.discover_inspirations WHERE organization_id = $1`,
    [orgId],
  )
  return Number(rows[0]?.n ?? 0)
}
