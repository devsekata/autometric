import kolDb, { kolDbWrite } from '@/lib/kolDb'
import {
  brandMatchForDirectory, cleanWhatMatters, currentDataVersion, WHAT_MATTERS_OPTIONS,
  type BrandMatchResult, type DirectoryBrandMatch,
} from './brandMatch'

/**
 * Brand Match, recalculated in the background and kept per agency.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `brandMatchForDirectory` computes Brand Match while a request waits. That
 * stays, unchanged: it is still the calculation, and still the fallback. What
 * this adds is the automation — a job (`scripts/brand-match-recalc.ts`, run by
 * the Dagster `brand_match_job`) recalculates an agency's Brand Match when its
 * Brand Profile is saved or when KOL data reaches L2, and keeps the result in
 * `brand_match_result` (migrations/kol/010).
 *
 * ── A stored row is used only while it is current ──────────────────────────
 * Every row records the two versions it was computed from: the agency's
 * `brand_profile.updated_at` and the KOL data fingerprint (`currentDataVersion`,
 * the same one `dropPopulationIfDataChanged` watches). `storedBrandMatchForDirectory`
 * serves stored rows only when both still match what is in the database now;
 * otherwise it returns null and the Directory computes on demand, exactly as
 * before. A stale result is never shown as the latest one.
 *
 * ── One version, never a mix ───────────────────────────────────────────────
 * The job reads both versions BEFORE computing and again AFTER. If either moved
 * — a save, or a pipeline run landing mid-way — the result is thrown away and
 * recomputed (up to MAX_ATTEMPTS); only a result whose inputs held still for the
 * whole computation is written, in one transaction. Jobs for the same agency are
 * serialised with a Postgres advisory lock, so two cannot interleave.
 *
 * ── Failure ────────────────────────────────────────────────────────────────
 * A failed job records `status = 'failed'` and the error, writes no result, and
 * rethrows — the Dagster job fails and retries. Nothing is ever written as 0 for
 * lack of data: a creator with no measured criterion keeps `match_pct` NULL.
 *
 * Tenant: every statement is scoped to one `agency_id`; rows of one agency are
 * never read or written by another agency's job or request.
 */

/** Recompute when the inputs moved during the computation, at most this often. */
const MAX_ATTEMPTS = 3
/** Creators scored per `brandMatchForDirectory` call. */
const CHUNK = 500

export type BrandMatchTrigger = 'brand_profile' | 'kol_data' | 'manual'

export interface RecalcOutcome {
  agencyId: string
  status: 'done' | 'no_selection'
  rows: number
  profileVersion: string | null
  dataVersion: string
  attempts: number
}

interface ProfileVersion { version: string | null; whatMatters: string[] }

/** The agency's profile version (µs-exact text) and choice, straight from the row. */
async function profileVersion(agencyId: string): Promise<ProfileVersion> {
  const { rows } = await kolDb().query<{ v: string; what_matters: string[] | null }>(
    `SELECT updated_at::text AS v, what_matters FROM public.brand_profile WHERE organization_id = $1`,
    [agencyId])
  return rows[0]
    ? { version: rows[0].v, whatMatters: cleanWhatMatters(rows[0].what_matters ?? []) }
    : { version: null, whatMatters: [] }
}

async function setState(agencyId: string, fields: {
  status: string; trigger: BrandMatchTrigger; profileVersion?: string | null; dataVersion?: string | null
  rows?: number | null; started?: boolean; finished?: boolean; error?: string | null
}): Promise<void> {
  await kolDbWrite().query(`
    INSERT INTO public.brand_match_state
      (agency_id, status, trigger, profile_updated_at, data_version, rows_written, started_at, finished_at, error)
    VALUES ($1, $2, $3, $4::timestamptz, $5, $6,
            CASE WHEN $7 THEN now() END, CASE WHEN $8 THEN now() END, $9)
    ON CONFLICT (agency_id) DO UPDATE SET
      status = EXCLUDED.status,
      trigger = EXCLUDED.trigger,
      profile_updated_at = COALESCE(EXCLUDED.profile_updated_at, brand_match_state.profile_updated_at),
      data_version = COALESCE(EXCLUDED.data_version, brand_match_state.data_version),
      rows_written = EXCLUDED.rows_written,
      started_at = COALESCE(EXCLUDED.started_at, brand_match_state.started_at),
      finished_at = EXCLUDED.finished_at,
      error = EXCLUDED.error`,
    [agencyId, fields.status, fields.trigger, fields.profileVersion ?? null, fields.dataVersion ?? null,
      fields.rows ?? null, !!fields.started, !!fields.finished, fields.error ?? null])
}

/**
 * Recalculates one agency's Brand Match over every active creator and stores it.
 * Serialised per agency; retried internally when the inputs change mid-way.
 */
export async function recalculateBrandMatch(
  agencyId: string, trigger: BrandMatchTrigger,
): Promise<RecalcOutcome> {
  const lock = await kolDbWrite().connect()
  try {
    await lock.query(`SELECT pg_advisory_lock(hashtext('brand_match:' || $1))`, [agencyId])
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const before = await profileVersion(agencyId)
        const dataBefore = await currentDataVersion()

        // No profile, or nothing chosen: there is no Brand Match to keep.
        if (!before.version || !before.whatMatters.length) {
          const client = await kolDbWrite().connect()
          try {
            await client.query('BEGIN')
            await client.query(`DELETE FROM public.brand_match_result WHERE agency_id = $1`, [agencyId])
            await client.query('COMMIT')
          } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }
          await setState(agencyId, {
            status: 'no_selection', trigger, profileVersion: before.version, dataVersion: dataBefore,
            rows: 0, started: true, finished: true,
          })
          return { agencyId, status: 'no_selection', rows: 0, profileVersion: before.version,
            dataVersion: dataBefore, attempts: attempt }
        }

        await setState(agencyId, {
          status: 'running', trigger, profileVersion: before.version, dataVersion: dataBefore, started: true,
        })

        const { rows: creators } = await kolDb().query<{ id: string }>(
          `SELECT id::text FROM public.kol_directory WHERE directory_status = 'active' ORDER BY id`)
        const results: [string, BrandMatchResult][] = []
        for (let i = 0; i < creators.length; i += CHUNK) {
          const ids = creators.slice(i, i + CHUNK).map(c => c.id)
          const bm = await brandMatchForDirectory(ids, before.whatMatters)
          for (const [id, r] of Object.entries(bm.rows)) results.push([id, r])
        }

        // Did anything move while we computed? Then this result mixes versions.
        const after = await profileVersion(agencyId)
        const dataAfter = await currentDataVersion()
        if (after.version !== before.version || dataAfter !== dataBefore) continue

        const client = await kolDbWrite().connect()
        try {
          await client.query('BEGIN')
          await client.query(`DELETE FROM public.brand_match_result WHERE agency_id = $1`, [agencyId])
          for (let i = 0; i < results.length; i += CHUNK) {
            const part = results.slice(i, i + CHUNK)
            await client.query(`
              INSERT INTO public.brand_match_result
                (agency_id, kol_directory_id, match_pct, unavailable, contributing, selected, breakdown,
                 profile_updated_at, data_version, calculated_at)
              SELECT $1, x.id, x.pct, x.unavailable, x.contributing, x.selected, x.breakdown,
                     $2::timestamptz, $3, now()
                FROM unnest($4::uuid[], $5::numeric[], $6::text[], $7::smallint[], $8::smallint[], $9::jsonb[])
                  AS x(id, pct, unavailable, contributing, selected, breakdown)`,
              [agencyId, before.version, dataBefore,
                part.map(([id]) => id),
                part.map(([, r]) => r.matchPct),
                part.map(([, r]) => r.unavailable ?? null),
                part.map(([, r]) => r.contributing),
                part.map(([, r]) => r.selected),
                part.map(([, r]) => JSON.stringify(r.breakdown))])
          }
          await client.query('COMMIT')
        } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }

        await setState(agencyId, {
          status: 'done', trigger, profileVersion: before.version, dataVersion: dataBefore,
          rows: results.length, finished: true,
        })
        return { agencyId, status: 'done', rows: results.length, profileVersion: before.version,
          dataVersion: dataBefore, attempts: attempt }
      }
      throw new Error(`inputs kept changing during ${MAX_ATTEMPTS} attempts; nothing written`)
    } finally {
      await lock.query(`SELECT pg_advisory_unlock(hashtext('brand_match:' || $1))`, [agencyId])
    }
  } catch (err) {
    await setState(agencyId, {
      status: 'failed', trigger, finished: true, rows: null,
      error: String(err instanceof Error ? err.message : err).slice(0, 2000),
    }).catch(() => {})
    throw err
  } finally {
    lock.release()
  }
}

/**
 * Every agency that has a Brand Profile, or still has stored results or state
 * (so a deleted profile's results are cleaned up too).
 */
export async function agenciesToRecalculate(): Promise<string[]> {
  const { rows } = await kolDb().query<{ id: string }>(`
    SELECT a.id::text FROM public.agencies a
     WHERE a.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM public.brand_profile bp WHERE bp.organization_id = a.id)
         OR EXISTS (SELECT 1 FROM public.brand_match_state s WHERE s.agency_id = a.id)
         OR EXISTS (SELECT 1 FROM public.brand_match_result r WHERE r.agency_id = a.id))
     ORDER BY a.id`)
  return rows.map(r => r.id)
}

/**
 * The Directory's Brand Match from stored rows — only when they are current:
 * the job finished, for this exact profile version and this exact data
 * fingerprint. Otherwise null, and the caller computes on demand.
 */
export async function storedBrandMatchForDirectory(
  agencyId: string, creatorIds: string[], whatMatters: readonly string[],
): Promise<DirectoryBrandMatch | null> {
  const chosen = cleanWhatMatters(whatMatters)
  if (!chosen.length || !creatorIds.length) return null

  const { rows: [fresh] } = await kolDb().query<{ ok: boolean }>(`
    SELECT (s.status = 'done'
            AND s.profile_updated_at = bp.updated_at
            AND s.data_version = $2) AS ok
      FROM public.brand_match_state s
      JOIN public.brand_profile bp ON bp.organization_id = s.agency_id
     WHERE s.agency_id = $1`, [agencyId, await currentDataVersion()])
  if (!fresh?.ok) return null

  const { rows } = await kolDb().query<{
    id: string; match_pct: string | null; unavailable: string | null
    contributing: number; selected: number; breakdown: BrandMatchResult['breakdown']
  }>(`
    SELECT kol_directory_id::text AS id, match_pct::text, unavailable, contributing, selected, breakdown
      FROM public.brand_match_result
     WHERE agency_id = $1 AND kol_directory_id = ANY ($2::uuid[])`, [agencyId, creatorIds])

  const out: Record<string, BrandMatchResult> = {}
  for (const r of rows) {
    const result: BrandMatchResult = {
      matchPct: r.match_pct === null ? null : Number(r.match_pct),
      contributing: r.contributing,
      selected: r.selected,
      breakdown: r.breakdown,
    }
    if (r.unavailable === 'no_scores' || r.unavailable === 'no_selection') result.unavailable = r.unavailable
    out[r.id] = result
  }
  return { whatMatters: chosen, options: WHAT_MATTERS_OPTIONS, rows: out }
}
