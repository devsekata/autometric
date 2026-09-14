/**
 * Brand Fit — reading and writing `feature.brand_fit_analysis`.
 *
 * This is the ONLY file in Brand Fit that writes. Everything else reads through
 * `kolDb()`; this one reaches for `kolDbWrite()`, and it does so in one place so
 * that `grep kolDbWrite` still answers the question "what writes to the KOL
 * server" honestly.
 *
 * ── Grain ──────────────────────────────────────────────────────────────────
 *     (agency_kol_account_id, brand_id)
 *
 * unchanged, and enforced by `uq_brand_fit_analysis` in the database rather than
 * by anything here. The upsert targets that constraint by name-in-effect, so a
 * second run for the same pair updates the row instead of adding a duplicate.
 *
 * No table is created, dropped, renamed or re-grained by this module.
 */
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import type { BrandFitAnalysis } from './engine'
import type { Queryable } from './records'
import type { PoolClient } from 'pg'

export interface StoredBrandFit {
  agencyKolAccountId: string
  brandId: string
  partnershipScore: number | null
  subScores: BrandFitAnalysis['sub_scores'] | null
  audienceOverlapPct: number | null
  overlapSummary: string | null
  categoryFitTags: BrandFitAnalysis['category_fit_tags'] | null
  recommendations: BrandFitAnalysis['recommendations'] | null
  updatedAt: string
}

interface Row {
  agency_kol_account_id: string
  brand_id: string
  partnership_score: string | null
  sub_scores: BrandFitAnalysis['sub_scores'] | null
  audience_overlap_pct: string | null
  overlap_summary: string | null
  category_fit_tags: BrandFitAnalysis['category_fit_tags'] | null
  recommendations: BrandFitAnalysis['recommendations'] | null
  updated_at: string
}

const num = (v: string | null): number | null => (v === null ? null : Number(v))

const fromRow = (r: Row): StoredBrandFit => ({
  agencyKolAccountId: r.agency_kol_account_id,
  brandId: r.brand_id,
  partnershipScore: num(r.partnership_score),
  subScores: r.sub_scores,
  audienceOverlapPct: num(r.audience_overlap_pct),
  overlapSummary: r.overlap_summary,
  categoryFitTags: r.category_fit_tags,
  recommendations: r.recommendations,
  updatedAt: r.updated_at,
})

const COLUMNS = `agency_kol_account_id, brand_id, partnership_score, sub_scores,
                 audience_overlap_pct, overlap_summary, category_fit_tags,
                 recommendations, updated_at`

/** Everything stored for one brand, newest first. Read-only pool. */
export async function getBrandFitForBrand(
  brandId: string, limit = 200,
): Promise<StoredBrandFit[]> {
  const { rows } = await kolDb().query<Row>(
    `SELECT ${COLUMNS} FROM feature.brand_fit_analysis
      WHERE brand_id = $1
      ORDER BY partnership_score DESC NULLS LAST, agency_kol_account_id
      LIMIT $2`,
    [brandId, limit])
  return rows.map(fromRow)
}

/** One stored pair, or null if it has never been computed. */
export async function getBrandFit(
  agencyKolAccountId: string, brandId: string,
): Promise<StoredBrandFit | null> {
  const { rows } = await kolDb().query<Row>(
    `SELECT ${COLUMNS} FROM feature.brand_fit_analysis
      WHERE agency_kol_account_id = $1 AND brand_id = $2`,
    [agencyKolAccountId, brandId])
  return rows[0] ? fromRow(rows[0]) : null
}

export interface AnalysisToStore {
  agencyKolAccountId: string
  brandId: string
  analysis: BrandFitAnalysis
}

/**
 * Writes a batch of analyses, one statement, inside one transaction.
 *
 * `meta` is deliberately NOT persisted: it is diagnostic — why a component was
 * not measured, which dimensions were compared — and belongs to the response,
 * not to the six columns the table was designed around. Storing it would make
 * the table's shape depend on what the API happens to want to explain today.
 *
 * A NULL score is written as NULL. Nothing is coerced to 0 on the way in, which
 * is the whole point of carrying nulls this far.
 */
export async function saveBrandFit(
  batch: AnalysisToStore[], external?: Queryable,
): Promise<number> {
  if (!batch.length) return 0

  // A caller that supplied a client owns the transaction — including whether it
  // ends in COMMIT or ROLLBACK. That is what lets the verification script prove
  // this exact upsert works without leaving a row behind.
  const client = external ?? await kolDbWrite().connect()
  const owned = !external
  try {
    if (owned) await client.query('BEGIN')
    const { rowCount } = await client.query(
      `INSERT INTO feature.brand_fit_analysis
         (agency_kol_account_id, brand_id, partnership_score, sub_scores,
          audience_overlap_pct, overlap_summary, category_fit_tags, recommendations,
          updated_at)
       SELECT * FROM unnest(
         $1::uuid[], $2::uuid[], $3::numeric[], $4::jsonb[],
         $5::numeric[], $6::text[], $7::jsonb[], $8::jsonb[]
       ) AS t(agency_kol_account_id, brand_id, partnership_score, sub_scores,
              audience_overlap_pct, overlap_summary, category_fit_tags, recommendations),
         LATERAL (SELECT now()) AS n(updated_at)
       ON CONFLICT (agency_kol_account_id, brand_id) DO UPDATE SET
         partnership_score    = EXCLUDED.partnership_score,
         sub_scores           = EXCLUDED.sub_scores,
         audience_overlap_pct = EXCLUDED.audience_overlap_pct,
         overlap_summary      = EXCLUDED.overlap_summary,
         category_fit_tags    = EXCLUDED.category_fit_tags,
         recommendations      = EXCLUDED.recommendations,
         updated_at           = now()`,
      [
        batch.map(b => b.agencyKolAccountId),
        batch.map(b => b.brandId),
        batch.map(b => b.analysis.partnership_score),
        batch.map(b => JSON.stringify(b.analysis.sub_scores)),
        batch.map(b => b.analysis.audience_overlap_pct),
        batch.map(b => b.analysis.overlap_summary),
        batch.map(b => JSON.stringify(b.analysis.category_fit_tags)),
        batch.map(b => JSON.stringify(b.analysis.recommendations)),
      ])
    if (owned) await client.query('COMMIT')
    return rowCount ?? 0
  } catch (err) {
    if (owned) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (owned) (client as PoolClient).release()
  }
}
