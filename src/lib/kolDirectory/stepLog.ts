import { randomUUID } from 'crypto'
import { kolDbWrite } from '@/lib/kolDb'

/**
 * Per-step logging for the "Add New KOL" pipeline, into the two tables that
 * replace `initial_scrape_log`'s single end-of-run row:
 * `public.add_kol_scrape_log` (one row per Apify actor call) and
 * `public.add_kol_pipeline_log` (one row per harmonisation stored procedure).
 *
 * Shaped after `Steps` in `@/lib/discover/creatorProfiling.ts` — begin/done/fail
 * around one unit of work — but simpler: there is no in-memory step list to
 * keep synced with the UI, because the UI here reads the log tables directly
 * (`GET .../status`) rather than a persisted JSON blob. So this is just
 * insert-on-start, update-by-id-on-finish, with no read-back in between.
 *
 * The insert-then-dangle-on-crash behaviour is deliberate, not a bug to guard
 * against: if the process dies mid-step (server restart, unhandled crash) the
 * `status='running'` row is left exactly as it is. That row is the evidence of
 * which step was in flight when the process died — the status endpoint reads
 * "running for too long" as "stalled" rather than this code trying to detect
 * its own death and clean up after itself, which it structurally cannot do.
 */

export interface ScrapeStepHandle {
  finish(outcome: { status: 'success' | 'failed'; itemsFetched?: number | null; errorMessage?: string | null }): Promise<void>
}

export interface PipelineStepHandle {
  finish(outcome: { status: 'success' | 'failed'; errorMessage?: string | null }): Promise<void>
}

/**
 * Start (INSERT `status='running'`) one `add_kol_scrape_log` row for one
 * Apify actor call. Returns a handle whose `finish()` UPDATEs that same row
 * by id — never a second INSERT.
 */
export async function beginScrapeStep(args: {
  runId: string
  kolDirectoryId: string | null
  socialAccountId: string | null
  platform: string
  username: string
  step: 'profile' | 'posts' | 'profile_and_posts' | 'followers'
  actor: string
}): Promise<ScrapeStepHandle> {
  const id = randomUUID()
  const startedAt = new Date()
  try {
    await kolDbWrite().query(
      `INSERT INTO public.add_kol_scrape_log
         (id, run_id, kol_directory_id, social_account_id, platform, username, step, actor, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',$9)`,
      [id, args.runId, args.kolDirectoryId, args.socialAccountId, args.platform, args.username, args.step, args.actor, startedAt],
    )
  } catch (err) {
    console.error('[stepLog] failed to write add_kol_scrape_log start row:', err)
  }

  return {
    async finish(outcome) {
      const finishedAt = new Date()
      try {
        await kolDbWrite().query(
          `UPDATE public.add_kol_scrape_log
              SET status = $2, items_fetched = $3, error_message = $4,
                  finished_at = $5, duration_seconds = $6
            WHERE id = $1`,
          [
            id, outcome.status, outcome.itemsFetched ?? null, outcome.errorMessage ?? null,
            finishedAt, (finishedAt.getTime() - startedAt.getTime()) / 1000,
          ],
        )
      } catch (err) {
        console.error('[stepLog] failed to write add_kol_scrape_log finish row:', err)
      }
    },
  }
}

/**
 * Start (INSERT `status='running'`) one `add_kol_pipeline_log` row for one
 * harmonisation stored procedure call. Same insert-once/update-by-id shape as
 * `beginScrapeStep`.
 */
export async function beginPipelineStep(args: {
  runId: string
  kolDirectoryId: string | null
  platform: string
  step: 'sync_profile' | 'sync_post' | 'sync_follower' | 'build_unified_profile' | 'build_unified_post' | 'build_unified_follower'
}): Promise<PipelineStepHandle> {
  const id = randomUUID()
  const startedAt = new Date()
  try {
    await kolDbWrite().query(
      `INSERT INTO public.add_kol_pipeline_log
         (id, run_id, kol_directory_id, platform, step, status, started_at)
       VALUES ($1,$2,$3,$4,$5,'running',$6)`,
      [id, args.runId, args.kolDirectoryId, args.platform, args.step, startedAt],
    )
  } catch (err) {
    console.error('[stepLog] failed to write add_kol_pipeline_log start row:', err)
  }

  return {
    async finish(outcome) {
      const finishedAt = new Date()
      try {
        await kolDbWrite().query(
          `UPDATE public.add_kol_pipeline_log
              SET status = $2, error_message = $3,
                  finished_at = $4, duration_seconds = $5
            WHERE id = $1`,
          [id, outcome.status, outcome.errorMessage ?? null, finishedAt, (finishedAt.getTime() - startedAt.getTime()) / 1000],
        )
      } catch (err) {
        console.error('[stepLog] failed to write add_kol_pipeline_log finish row:', err)
      }
    },
  }
}

/**
 * Wrap one async unit of work with a scrape-log row: begin before it starts,
 * finish success/failed after it settles, and re-throw whatever it threw so
 * callers keep their existing error handling.
 */
export async function withScrapeStep<T>(
  args: Parameters<typeof beginScrapeStep>[0],
  itemsOf: (result: T) => number | null,
  work: () => Promise<T>,
): Promise<T> {
  const handle = await beginScrapeStep(args)
  try {
    const result = await work()
    await handle.finish({ status: 'success', itemsFetched: itemsOf(result) })
    return result
  } catch (err) {
    await handle.finish({ status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * Wrap one async unit of work (a stored-procedure call) with a pipeline-log
 * row, same begin/finish/re-throw shape as `withScrapeStep`.
 */
export async function withPipelineStep<T>(
  args: Parameters<typeof beginPipelineStep>[0],
  work: () => Promise<T>,
): Promise<T> {
  const handle = await beginPipelineStep(args)
  try {
    const result = await work()
    await handle.finish({ status: 'success' })
    return result
  } catch (err) {
    await handle.finish({ status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
