import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import kolDb from '@/lib/kolDb'

type Params = { params: Promise<{ kolId: string }> }

/**
 * GET /api/kol-directory/add/[kolId]/status
 *
 * "Add New KOL" — the progress screen polls this while `scrapeNewKol` runs in
 * the background. Reads the two per-step log tables `addKolScrape.ts` writes
 * (`add_kol_scrape_log`, `add_kol_pipeline_log`) for the most recent run of
 * this `kol_directory` row and renders a fixed, per-platform step list —
 * scrape steps first, then pipeline steps — with each step's live status.
 *
 * Steps with no row yet are `'pending'` (the run has not reached them). A
 * step stuck at `'running'` for longer than `STALLED_AFTER_MS` is reported as
 * `'failed'` in THIS RESPONSE ONLY — the underlying row is never touched, so
 * it stays exact evidence of where the process actually died (e.g. a server
 * restart mid-step, which is what `initial_scrape_log`'s old single
 * end-of-run row could never show). Every step after a stalled one that is
 * still pending is folded into the same failure, since nothing downstream of
 * a dead process step will ever run.
 */

const STALLED_AFTER_MS = 3 * 60_000

type StepKind = 'scrape' | 'pipeline'
type StepStatus = 'pending' | 'running' | 'success' | 'failed'

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

interface KolDirectoryRow {
  id: string
  username: string | null
  scrape_status: string | null
  followers_count: number | null
  last_refreshed_at: Date | string | null
  platform_key: string | null
}

interface RunIdRow {
  run_id: string | null
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

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { kolId } = await params

    const { rows: kdRows } = await kolDb().query<KolDirectoryRow>(
      `SELECT kd.id, kd.username, kd.scrape_status, kd.followers_count, kd.last_refreshed_at, pl.key AS platform_key
         FROM public.kol_directory kd
         JOIN public.platforms pl ON pl.id = kd.platform_id
        WHERE kd.id = $1`,
      [kolId],
    )
    const kd = kdRows[0]
    if (!kd) return NextResponse.json({ error: 'KOL not found.' }, { status: 404 })

    const stepDefs = kd.platform_key === 'tiktok' ? TIKTOK_STEPS : IG_STEPS

    // Latest run_id for this kol_directory row — the newest started_at across
    // both log tables. Either table alone can be empty (e.g. the run died
    // before a single pipeline step began), so this checks both.
    const { rows: runRows } = await kolDb().query<RunIdRow>(
      `SELECT run_id FROM (
         SELECT run_id, started_at FROM public.add_kol_scrape_log WHERE kol_directory_id = $1
         UNION ALL
         SELECT run_id, started_at FROM public.add_kol_pipeline_log WHERE kol_directory_id = $1
       ) x
       ORDER BY started_at DESC
       LIMIT 1`,
      [kolId],
    )
    const runId = runRows[0]?.run_id ?? null

    const steps: StatusStep[] = stepDefs.map(d => ({ key: d.key, label: d.label, kind: d.kind, status: 'pending', detail: null }))

    if (runId) {
      const [{ rows: scrapeRows }, { rows: pipelineRows }] = await Promise.all([
        kolDb().query<ScrapeLogRow>(
          `SELECT step, status, error_message, items_fetched, started_at
             FROM public.add_kol_scrape_log
            WHERE run_id = $1`,
          [runId],
        ),
        kolDb().query<PipelineLogRow>(
          `SELECT step, status, error_message, started_at
             FROM public.add_kol_pipeline_log
            WHERE run_id = $1`,
          [runId],
        ),
      ])

      const scrapeByStep = new Map(scrapeRows.map(r => [r.step, r]))
      const pipelineByStep = new Map(pipelineRows.map(r => [r.step, r]))

      const now = Date.now()
      let priorStalledOrFailed = false

      for (const step of steps) {
        if (priorStalledOrFailed) {
          if (step.status === 'pending') {
            step.status = 'failed'
            step.detail = 'Proses berhenti sebelum selesai (server restart atau error tak tertangani).'
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
            step.detail = 'Proses berhenti sebelum selesai (server restart atau error tak tertangani).'
            priorStalledOrFailed = true
          } else {
            step.status = 'running'
            step.detail = null
          }
        }
      }
    }

    const overallStatus: StepStatus =
      steps.some(s => s.status === 'failed') ? 'failed'
        : steps.every(s => s.status === 'success') ? 'success'
        : steps.some(s => s.status === 'running' || s.status === 'success') ? 'running'
        : 'pending'

    return NextResponse.json({
      runId,
      overallStatus,
      steps,
      kolDirectory: {
        id: kd.id,
        username: kd.username,
        scrapeStatus: kd.scrape_status ?? 'pending',
        followersCount: kd.followers_count,
        lastRefreshedAt: kd.last_refreshed_at ? new Date(kd.last_refreshed_at).toISOString() : null,
      },
    })
  } catch (err) {
    console.error('[GET /api/kol-directory/add/[kolId]/status]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
