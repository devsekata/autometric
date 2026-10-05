import type { Pool } from 'pg'
import kolDb from '@/lib/kolDb'

/**
 * Audience geo — the one rule for reading `l2_gold.audience_geo_daily`, shared
 * by every reader so the creator page, Brand Match and the audience classifier
 * see the same audience.
 *
 * ── Why not "newest audience_date" ────────────────────────────────────────
 * The derived path (scrapper-project `audience_gold`) writes one set of rows
 * per (account, `unified_follower.date`): each date is the BATCH of followers
 * scraped that day, not a daily re-count of the same followers. Measured on the
 * KOL database (2026-09-24): every (account, date) in L2 matches one L1 batch,
 * the per-date totals equal the L1 follower counts exactly, and no follower
 * appears on two dates. Reading only the newest date therefore dropped every
 * earlier batch — 28 of 101 accounts have more than one.
 *
 * So the rows are selected per (account, geo_level):
 *
 *   measured  (`confidence = 'measured'`, platform-reported Insights)
 *             → only the newest measured snapshot. Snapshots of a measured
 *               audience ARE re-counts of the same people; summing them would
 *               count each follower once per snapshot.
 *   inferred  (`confidence = 'inferred_*'`, or anything else not 'measured')
 *             → every date. Each date is a disjoint follower batch.
 *
 * When an account has measured rows for a level, those win and its inferred
 * rows for that level are not added on top: the two are different scales (a
 * platform total vs a follower sample) and must never be summed together.
 */

export const MEASURED_CONFIDENCE = 'measured'

export interface GeoRow {
  kolId: string
  accountId: string
  /** `audience_date` as 'YYYY-MM-DD', so string order is date order. */
  date: string
  level: string
  key: string
  n: number
  confidence: string | null
}

/** geo_level → geo_key → follower count. */
export type GeoDistribution = Record<string, Record<string, number>>

const isMeasured = (r: GeoRow) => (r.confidence ?? '').trim().toLowerCase() === MEASURED_CONFIDENCE

/**
 * Applies the rule above. Pure, so it is tested without a database
 * (`scripts/verify-audience-geo.ts`).
 */
export function selectGeoEvidence(rows: readonly GeoRow[]): GeoRow[] {
  const groups = new Map<string, GeoRow[]>()
  for (const r of rows) {
    const k = `${r.accountId}\u0000${r.level}`
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }
  const out: GeoRow[] = []
  for (const g of groups.values()) {
    const measured = g.filter(isMeasured)
    if (measured.length) {
      const newest = measured.reduce((m, r) => (r.date > m ? r.date : m), '')
      out.push(...measured.filter(r => r.date === newest))
    } else {
      out.push(...g)
    }
  }
  return out
}

/** Selected rows summed per creator, level and key. */
export function geoDistributions(rows: readonly GeoRow[]): Map<string, GeoDistribution> {
  const out = new Map<string, GeoDistribution>()
  for (const r of selectGeoEvidence(rows)) {
    if (!r.key || !(r.n > 0)) continue
    let d = out.get(r.kolId)
    if (!d) { d = {}; out.set(r.kolId, d) }
    const lv = (d[r.level] ??= {})
    lv[r.key] = (lv[r.key] ?? 0) + r.n
  }
  return out
}

const GEO_SQL = `
  SELECT ksa.kol_id::text           AS kol_id,
         g.social_account_id::text  AS account_id,
         g.audience_date::text      AS date,
         g.geo_level                AS level,
         g.geo_key                  AS key,
         g.audience_count::float8   AS n,
         g.confidence
    FROM public.kol_social_account ksa
    JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
   WHERE ksa.kol_id = ANY ($1::uuid[])`

/** creator id → geo distribution. Creators with no geo rows are absent. */
export async function audienceGeoFor(
  kolIds: string[],
  db: Pool = kolDb(),
): Promise<Map<string, GeoDistribution>> {
  if (!kolIds.length) return new Map()
  const { rows } = await db.query<{
    kol_id: string; account_id: string; date: string; level: string | null
    key: string | null; n: number | null; confidence: string | null
  }>(GEO_SQL, [kolIds])
  return geoDistributions(rows
    .filter(r => r.level !== null && r.key !== null && r.n !== null)
    .map(r => ({
      kolId: r.kol_id, accountId: r.account_id, date: r.date, level: r.level!,
      key: r.key!, n: Number(r.n), confidence: r.confidence,
    })))
}
