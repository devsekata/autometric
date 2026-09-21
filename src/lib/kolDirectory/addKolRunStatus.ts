import kolDb from '@/lib/kolDb'

/**
 * Progress of one "Add New KOL" run, read from the two per-step log tables
 * `addKolScrape.ts` writes (`add_kol_scrape_log`, `add_kol_pipeline_log`).
 *
 * Shared by the status endpoint (what the dialog draws) and the retry endpoint
 * (whether a retry is allowed), so the two can never disagree about whether a
 * run failed.
 *
 * Steps with no row yet are `'pending'` (the run has not reached them). A
 * step stuck at `'running'` for longer than `STALLED_AFTER_MS` is reported as
 * `'failed'` in THIS RESPONSE ONLY — the underlying row is never touched, so
 * it stays exact evidence of where the process actually died (e.g. a server
 * restart mid-step). Every step after a stalled one that is still pending is
 * folded into the same failure, since nothing downstream of a dead process
 * step will ever run.
 *
 * A failed `add_kol_pipeline_log` row with `step = 'run'` is a failure that
 * happened outside any step (a profile payload that carried an error, a raw
 * insert, the roster update). It fails the run: every step that has not
 * succeeded is reported failed, the first of them carrying the error.
 */

export const STALLED_AFTER_MS = 3 * 60_000

/** `add_kol_pipeline_log.step` of the row recording a failure outside any step. */
export const RUN_FAILURE_STEP = 'run'

export type StepKind = 'scrape' | 'pipeline'
export type StepStatus = 'pending' | 'running' | 'success' | 'failed'

interface StepDef {
  key: string
  label: string
  kind: StepKind
}

const IG_STEPS: StepDef[] = [
  { key: 'profile', label: 'Mengambil profil', kind: 'scrape' },
  { key: 'posts', label: 'Mengambil 10 post terbaru', kind: 'scrape' },
  { key: 'followers', label: 'Mengambil sampel 100 follower', kind: 'scrape' },
  { key: 'sync_profile', label: 'Menyelaraskan data profil', kind: 'pipeline' },
  { key: 'sync_post', label: 'Menyelaraskan data post', kind: 'pipeline' },
  { key: 'sync_follower', label: 'Menyelaraskan data follower', kind: 'pipeline' },
  { key: 'build_unified_profile', label: 'Menyusun profil gabungan', kind: 'pipeline' },
  { key: 'build_unified_post', label: 'Menyusun data post gabungan', kind: 'pipeline' },
  { key: 'build_unified_follower', label: 'Menyusun data follower gabungan', kind: 'pipeline' },
]

const TIKTOK_STEPS: StepDef[] = [
  { key: 'profile_and_posts', label: 'Mengambil profil dan 10 post terbaru', kind: 'scrape' },
  { key: 'followers', label: 'Mengambil sampel 100 follower', kind: 'scrape' },
  { key: 'sync_profile', label: 'Menyelaraskan data profil', kind: 'pipeline' },
  { key: 'sync_post', label: 'Menyelaraskan data post', kind: 'pipeline' },
  { key: 'sync_follower', label: 'Menyelaraskan data follower', kind: 'pipeline' },
  { key: 'build_unified_profile', label: 'Menyusun profil gabungan', kind: 'pipeline' },
  { key: 'build_unified_post', label: 'Menyusun data post gabungan', kind: 'pipeline' },
  { key: 'build_unified_follower', label: 'Menyusun data follower gabungan', kind: 'pipeline' },
]

/**
 * The step keys a run of each platform has to finish, for SQL that must judge
 * a run by the same rules as `getAddKolRunStatus` (the My Creators profiling
 * filter). Same lists, not copies.
 */
export const ADD_KOL_STEP_KEYS = {
  instagram: IG_STEPS.map(s => s.key),
  tiktok: TIKTOK_STEPS.map(s => s.key),
} as const

const STOPPED = 'Proses berhenti sebelum selesai (server restart atau error tak tertangani).'

interface KolDirectoryRow {
  id: string
  username: string | null
  scrape_status: string | null
  followers_count: number | null
  last_refreshed_at: Date | string | null
  platform_key: string | null
}

interface ScrapeLogRow {
  step: string
  status: string
  error_message: string | null
  items_fetched: number | null
  started_at: Date | string
}

interface PipelineLogRow {
  step: string
  status: string
  error_message: string | null
  started_at: Date | string
}

export interface StatusStep {
  key: string
  label: string
  kind: StepKind
  status: StepStatus
  detail?: string | null
}

export interface RunStatus {
  runId: string | null
  overallStatus: StepStatus
  steps: StatusStep[]
  kolDirectory: {
    id: string
    username: string | null
    scrapeStatus: string
    followersCount: number | null
    lastRefreshedAt: string | null
  }
}

/**
 * The run's status. `runId` pins one run — the one a retry just started, which
 * may have no log row yet (then every step is pending); without it the newest
 * run of the creator is read.
 *
 * Returns `'not_found'` for an unknown creator, and `'foreign_run'` when the
 * pinned run belongs to another creator.
 */
export async function getAddKolRunStatus(
  kolId: string, runId: string | null = null,
): Promise<RunStatus | 'not_found' | 'foreign_run'> {
  const db = kolDb()
  const { rows: kdRows } = await db.query<KolDirectoryRow>(
    `SELECT kd.id, kd.username, kd.scrape_status, kd.followers_count, kd.last_refreshed_at, pl.key AS platform_key
       FROM public.kol_directory kd
       JOIN public.platforms pl ON pl.id = kd.platform_id
      WHERE kd.id = $1`,
    [kolId],
  )
  const kd = kdRows[0]
  if (!kd) return 'not_found'

  const stepDefs = kd.platform_key === 'tiktok' ? TIKTOK_STEPS : IG_STEPS

  let run = runId
  if (run) {
    const { rows } = await db.query(
      `SELECT 1 FROM public.add_kol_scrape_log WHERE run_id = $1 AND kol_directory_id IS DISTINCT FROM $2
       UNION ALL
       SELECT 1 FROM public.add_kol_pipeline_log WHERE run_id = $1 AND kol_directory_id IS DISTINCT FROM $2
       LIMIT 1`,
      [run, kolId],
    )
    if (rows.length) return 'foreign_run'
  } else {
    // Latest run_id for this kol_directory row — the newest started_at across
    // both log tables. Either table alone can be empty (e.g. the run died
    // before a single pipeline step began), so this checks both.
    const { rows } = await db.query<{ run_id: string | null }>(
      `SELECT run_id FROM (
         SELECT run_id, started_at FROM public.add_kol_scrape_log WHERE kol_directory_id = $1
         UNION ALL
         SELECT run_id, started_at FROM public.add_kol_pipeline_log WHERE kol_directory_id = $1
       ) x
       ORDER BY started_at DESC
       LIMIT 1`,
      [kolId],
    )
    run = rows[0]?.run_id ?? null
  }

  const steps: StatusStep[] = stepDefs.map(d => ({ key: d.key, label: d.label, kind: d.kind, status: 'pending', detail: null }))

  if (run) {
    const [{ rows: scrapeRows }, { rows: pipelineRows }] = await Promise.all([
      db.query<ScrapeLogRow>(
        `SELECT step, status, error_message, items_fetched, started_at
           FROM public.add_kol_scrape_log
          WHERE run_id = $1 AND kol_directory_id = $2`,
        [run, kolId],
      ),
      db.query<PipelineLogRow>(
        `SELECT step, status, error_message, started_at
           FROM public.add_kol_pipeline_log
          WHERE run_id = $1 AND kol_directory_id = $2`,
        [run, kolId],
      ),
    ])

    const scrapeByStep = new Map(scrapeRows.map(r => [r.step, r]))
    const pipelineByStep = new Map(pipelineRows.map(r => [r.step, r]))
    const runFailure = pipelineRows.find(r => r.step === RUN_FAILURE_STEP && r.status === 'failed') ?? null

    const now = Date.now()
    let priorStalledOrFailed = false

    for (const step of steps) {
      if (priorStalledOrFailed) {
        if (step.status === 'pending') {
          step.status = 'failed'
          step.detail = STOPPED
        }
        continue
      }

      const row = step.kind === 'scrape' ? scrapeByStep.get(step.key) : pipelineByStep.get(step.key)
      if (!row) continue // still pending

      if (row.status === 'success') {
        step.status = 'success'
        step.detail = step.kind === 'scrape' && 'items_fetched' in row && row.items_fetched !== null
          ? `${row.items_fetched} item`
          : null
      } else if (row.status === 'failed') {
        step.status = 'failed'
        step.detail = row.error_message
        priorStalledOrFailed = true
      } else {
        // status === 'running'
        const startedAt = new Date(row.started_at).getTime()
        if (Number.isFinite(startedAt) && now - startedAt > STALLED_AFTER_MS) {
          step.status = 'failed'
          step.detail = STOPPED
          priorStalledOrFailed = true
        } else {
          step.status = 'running'
          step.detail = null
        }
      }
    }

    if (runFailure) {
      let first = true
      for (const step of steps) {
        if (step.status === 'success' || step.status === 'failed') continue
        step.status = 'failed'
        step.detail = first ? runFailure.error_message : STOPPED
        first = false
      }
      // Every step succeeded and the run still failed (e.g. the roster update
      // afterwards): the failure has to show somewhere.
      if (first && !steps.some(s => s.status === 'failed')) {
        const last = steps[steps.length - 1]
        last.status = 'failed'
        last.detail = runFailure.error_message
      }
    }
  }

  const overallStatus: StepStatus =
    steps.some(s => s.status === 'failed') ? 'failed'
      : steps.every(s => s.status === 'success') ? 'success'
      : steps.some(s => s.status === 'running' || s.status === 'success') ? 'running'
      : 'pending'

  return {
    runId: run,
    overallStatus,
    steps,
    kolDirectory: {
      id: kd.id,
      username: kd.username,
      scrapeStatus: kd.scrape_status ?? 'pending',
      followersCount: kd.followers_count,
      lastRefreshedAt: kd.last_refreshed_at ? new Date(kd.last_refreshed_at).toISOString() : null,
    },
  }
}
