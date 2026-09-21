/**
 * D054 Refresh — the Creator Profile's "run the pipeline again" action, checked
 * end to end against the KOL database and leaving nothing behind.
 *
 *   npm run verify:kol-refresh
 *
 * How it stays harmless:
 *   * every KOL query runs inside ONE transaction that is rolled back at the
 *     end (scripts/test/kolRollback.ts), fixtures included;
 *   * the warehouse is unreachable: DATABASE_URL points at an invalid host
 *     before any module loads;
 *   * `APIFY_API_TOKEN` is blanked before anything is imported, so even an
 *     accidental pipeline launch cannot reach an actor;
 *   * the ACCEPTED path is exercised through `prepareRefresh` only — it
 *     reserves the run and returns; `refreshKolScrape`, which is what actually
 *     starts the scrape, is never called. Every route-level case here is a
 *     refusal, so no route call can reach its 202 branch either;
 *   * the two-session advisory-lock proof opens its own connections, takes
 *     locks (which write nothing) and rolls both back.
 *
 * Covers: the D1 status gate (Ready and Failed allowed, Profiling and
 * no-status refused), the D2 cooldown from `MAX(add_kol_scrape_log.started_at)`,
 * the D5 reservation and its advisory lock, authorization and org isolation,
 * that a refusal writes nothing, that no identity / link / favorite /
 * monitoring row is touched, and that D013's retry gate, D092's expression and
 * the stall threshold are all still what they were.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

process.env.DATABASE_URL = 'postgres://tsdb-blocked.invalid:1/blocked'
for (const k of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT']) delete process.env[k]
// Belt and braces: no token, no actor, whatever else goes wrong.
process.env.APIFY_API_TOKEN = ''

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')

type Handler = (req: unknown, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function main() {
  const kolCfg = {
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
  }
  if (!kolCfg.host || !kolCfg.database) throw new Error('PG_*_KOL is not configured')

  /* ── static: the neighbours D054 must not have moved ─────────────────── */
  console.log('untouched neighbours')
  const retryRoute = read('src/app/api/kol-directory/add/[kolId]/retry/route.ts')
  ok('D013: the retry gate still refuses anything but a failed run',
    retryRoute.includes("code: 'not_failed'") && retryRoute.includes('Proses terakhir belum gagal'))
  ok('D013: retry still runs retryKolScrape, not the refresh path',
    retryRoute.includes('retryKolScrape') && !retryRoute.includes('refreshKolScrape'))
  const runStatusSrc = read('src/lib/kolDirectory/addKolRunStatus.ts')
  ok('the stall threshold is still 3 minutes, in one place',
    runStatusSrc.includes('export const STALLED_AFTER_MS = 3 * 60_000'))
  const dirSrc = read('src/lib/discover/kolDirectory.ts')
  ok('D092: the PROFILING_STATUS expression is unchanged',
    dirSrc.includes("WHEN run.failed THEN 'failed'")
    && dirSrc.includes("WHEN b.scrape_status = 'failed' AND NOT b.has_profile_card THEN 'failed'")
    && dirSrc.includes("WHEN run.started AND NOT run.complete THEN 'profiling'")
    && dirSrc.includes("WHEN b.has_profile_card THEN 'ready'"))
  ok('D092: the filter still applies it the same way',
    dirSrc.includes('AND ($36::text IS NULL OR ${PROFILING_STATUS} = $36)'))
  const scrapeSrc = read('src/lib/kolDirectory/addKolScrape.ts')
  ok('prepareRetry still gates on the newest run having failed',
    scrapeSrc.includes("if (status.overallStatus !== 'failed') return { ok: false, reason: 'not_failed'"))
  ok('refresh reuses runRestOfPipeline rather than a second pipeline',
    (scrapeSrc.match(/async function runRestOfPipeline/g) ?? []).length === 1)
  const refreshRoute = read('src/app/api/kol-directory/add/[kolId]/refresh/route.ts')
  ok('the refresh route reads no warehouse pool',
    !refreshRoute.includes("@/lib/db") && !scrapeSrc.includes("from '@/lib/db'"))
  ok('nothing in the refresh path touches a rate-card table',
    !refreshRoute.includes('rate_card') && !/rate_card/.test(scrapeSrc.split('── refresh (D054)')[1] ?? ''))
  const uiSrc = read('src/components/discover/KolCreatorWorkspace.tsx')
  ok('the profile keeps Monitoring, Remove and Similar as they were',
    uiSrc.includes('onMonitoring') && uiSrc.includes('my-creators/${kolId}') && uiSrc.includes('Similar'))
  ok('Refresh is drawn only for an agency that holds the creator',
    uiSrc.includes('{mine === true && (') && uiSrc.includes("label={refreshPhase === 'running' ? 'Memperbarui…' : 'Refresh'}"))
  ok('the profile polls the existing status endpoint, pinned to the run',
    uiSrc.includes('/api/kol-directory/add/${kolId}/status?') && uiSrc.includes("qs.set('runId', refreshRunId)"))
  ok('the Add KOL dialog was not reworked',
    !read('src/components/discover/AddKolDirectoryModal.tsx').includes('refresh/route')
    && !read('src/components/discover/AddKolDirectoryModal.tsx').includes('RefreshStrip'))

  /* ── live, inside one rolled-back transaction ────────────────────────── */
  const rb = await import('./test/kolRollback')
  await rb.start(kolCfg)
  const { setTestSession } = await import('./test/authStub')
  const { NextRequest } = await import('next/server')
  const refresh = await import('../src/app/api/kol-directory/add/[kolId]/refresh/route')
  const addScrape = await import('../src/lib/kolDirectory/addKolScrape')
  const runStatusLib = await import('../src/lib/kolDirectory/addKolRunStatus')
  const dirLib = await import('../src/lib/discover/kolDirectory')

  const call = async (route: unknown, method: string, url: string, params: Record<string, string>, body?: unknown) => {
    const req = new NextRequest(`http://kol.test${url}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    })
    const res = await (route as Handler)(req, { params: Promise.resolve(params) })
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null }
  }
  const as = (userId: string | null) => setTestSession(userId ? { user: { id: userId } } : null)

  try {
    const tag = `d054-${Date.now()}`
    const user = async (n: string) => (await rb.sql<{ id: string }>(
      `INSERT INTO public."user" (email, name, email_verified, role, user_type, created_at, updated_at)
       VALUES ($1, $2, true, 'USER', 'staff', now(), now()) RETURNING id`,
      [`${tag}-${n}@kol-test.invalid`, `D054 ${n}`])).rows[0].id
    const agency = async (n: string, owner: string) => (await rb.sql<{ id: string }>(
      `INSERT INTO public.agencies (name, slug, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now()) RETURNING id`, [`D054 ${n}`, `${tag}-${n}`, owner])).rows[0].id
    const member = (agencyId: string, userId: string, role: string) => rb.sql(
      `INSERT INTO public.agency_members (agency_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`, [agencyId, userId, role])
    const link = (agencyId: string, kolId: string, userId: string) => rb.sql(
      `INSERT INTO public.agency_kol_accounts
         (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
       SELECT $1, kd.id, kd.platform_id, 'active', true, $2, now(), now()
         FROM public.kol_directory kd WHERE kd.id = $3`, [agencyId, userId, kolId])

    const uA = await user('a'); const uB = await user('b'); const uC = await user('c')
    const A = await agency('a', uA); const B = await agency('b', uB)
    await member(A, uA, 'ADMIN'); await member(B, uB, 'ADMIN'); await member(A, uC, 'MEMBER')

    /** One Add KOL log row, `ago` before now. */
    const IG_STEPS = runStatusLib.ADD_KOL_STEP_KEYS.instagram
    const scrapeKeys = new Set(['profile', 'posts', 'followers', 'profile_and_posts'])
    const logAt = async (kolId: string, run: string, step: string, status: string, ago: string) => {
      if (scrapeKeys.has(step)) {
        await rb.sql(
          `INSERT INTO public.add_kol_scrape_log (run_id, kol_directory_id, platform, username, step, actor, status, started_at)
           VALUES ($1, $2, 'instagram', 'd054-fixture', $3, 'fixture', $4, now() - $5::interval)`,
          [run, kolId, step, status, ago])
      } else {
        await rb.sql(
          `INSERT INTO public.add_kol_pipeline_log (run_id, kol_directory_id, platform, step, status, started_at)
           VALUES ($1, $2, 'instagram', $3, $4, now() - $5::interval)`,
          [run, kolId, step, status, ago])
      }
    }

    // Creators the agency holds. Instagram, with an L2 card (so the roster says
    // Ready) and no run of their own — the shape of almost the whole roster.
    const { rows: pool } = await rb.sql<{ id: string }>(
      `SELECT kd.id FROM public.kol_directory kd
         JOIN public.platforms pl ON pl.id = kd.platform_id AND pl.key = 'instagram'
        WHERE kd.directory_status = 'active'
          AND EXISTS (SELECT 1 FROM public.kol_social_account ksa
                        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
                       WHERE ksa.kol_id = kd.id)
          AND NOT EXISTS (SELECT 1 FROM public.add_kol_scrape_log l WHERE l.kol_directory_id = kd.id)
          AND NOT EXISTS (SELECT 1 FROM public.add_kol_pipeline_log l WHERE l.kol_directory_id = kd.id)
        ORDER BY kd.id LIMIT 5`)
    ok('five untouched Instagram creators with an L2 card to test with', pool.length === 5, `${pool.length}/5`)
    const [kReady, kFailed, kProfiling, kCooldown, kUnlinked] = pool.map(r => r.id)
    for (const k of [kReady, kFailed, kProfiling, kCooldown]) await link(A, k, uA)

    // A creator with neither a run nor a card: none exists in the roster today,
    // so one is made here and rolled back with everything else.
    const kNoStatus = (await rb.sql<{ id: string }>(
      `INSERT INTO public.kol_directory (platform_id, username, username_normalized, directory_status, created_at, updated_at)
       SELECT pl.id, $1, $1, 'active', now(), now() FROM public.platforms pl WHERE pl.key = 'instagram'
       RETURNING id`, [`${tag}-nostatus`])).rows[0].id
    const saNoStatus = (await rb.sql<{ id: string }>(
      `INSERT INTO public.social_account (platform_id, username, data_source, created_at)
       SELECT pl.id, $1, 'csv', now() FROM public.platforms pl WHERE pl.key = 'instagram'
       RETURNING id`, [`${tag}-nostatus`])).rows[0].id
    await rb.sql(
      `INSERT INTO public.kol_social_account (kol_id, social_account_id, platform_id, created_at)
       SELECT $1, $2, pl.id, now() FROM public.platforms pl WHERE pl.key = 'instagram'`, [kNoStatus, saNoStatus])
    await link(A, kNoStatus, uA)

    // States. Failed and cooldown runs are dated so the cooldown does not
    // decide a case that is about something else.
    const runFailed = crypto.randomUUID()
    await logAt(kFailed, runFailed, 'profile', 'failed', '30 minutes')
    const runProfiling = crypto.randomUUID()
    await logAt(kProfiling, runProfiling, 'profile', 'running', '20 seconds')
    const runRecent = crypto.randomUUID()
    for (const s of IG_STEPS) await logAt(kCooldown, runRecent, s, 'success', '5 minutes')

    /* ── D092 cross-check: my gate and the filter must agree ───────────── */
    console.log('\nD054 status gate agrees with the D092 filter')
    const idsWith = async (status: 'ready' | 'profiling' | 'failed') =>
      (await dirLib.listKolDirectory({ agencyId: A, profilingStatus: status, pageSize: 60 }))
        .rows.map(r => r.id)
    const [readyIds, profilingIds, failedIds] = await Promise.all([idsWith('ready'), idsWith('profiling'), idsWith('failed')])
    ok('D092 sees kReady as Ready', readyIds.includes(kReady))
    ok('D092 sees kFailed as Failed', failedIds.includes(kFailed))
    ok('D092 sees kProfiling as Profiling', profilingIds.includes(kProfiling))
    ok('D092 sees kCooldown as Ready (its run finished)', readyIds.includes(kCooldown))
    ok('D092 gives the run-less, card-less creator no status at all',
      !readyIds.includes(kNoStatus) && !profilingIds.includes(kNoStatus) && !failedIds.includes(kNoStatus))

    /* ── D1 status gate ────────────────────────────────────────────────── */
    console.log('\nD1 which statuses may refresh')
    const countRuns = async (kolId: string) => (await rb.sql<{ n: number }>(
      `SELECT (SELECT count(*) FROM public.add_kol_scrape_log WHERE kol_directory_id = $1)
            + (SELECT count(*) FROM public.add_kol_pipeline_log WHERE kol_directory_id = $1) AS n`,
      [kolId])).rows[0].n
    const reservations = async (kolId: string) => (await rb.sql<{ n: number }>(
      `SELECT count(*)::int n FROM public.add_kol_pipeline_log
        WHERE kol_directory_id = $1 AND step = $2`, [kolId, addScrape.REFRESH_RESERVATION_STEP])).rows[0].n

    const beforeProfiling = await countRuns(kProfiling)
    let plan = await addScrape.prepareRefresh(kProfiling, A, uA)
    ok('Profiling → refused as already_running', !plan.ok && plan.reason === 'already_running',
      plan.ok ? 'accepted' : plan.reason)
    ok('refusing a profiling creator wrote nothing', await countRuns(kProfiling) === beforeProfiling)

    const beforeNoStatus = await countRuns(kNoStatus)
    plan = await addScrape.prepareRefresh(kNoStatus, A, uA)
    ok('no run and no card → refused as status_not_refreshable',
      !plan.ok && plan.reason === 'status_not_refreshable' && plan.status === null,
      plan.ok ? 'accepted' : `${plan.reason}/${String(plan.status)}`)
    ok('refusing it wrote nothing', await countRuns(kNoStatus) === beforeNoStatus)

    plan = await addScrape.prepareRefresh(kFailed, A, uA)
    ok('Failed → accepted', plan.ok && plan.status === 'failed', plan.ok ? plan.status : plan.reason)
    ok('the accepted refresh reserved exactly one run', await reservations(kFailed) === 1)
    ok('it started no scrape step of its own (no actor was called)',
      (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.add_kol_scrape_log
         WHERE kol_directory_id = $1 AND run_id = $2`, [kFailed, plan.ok ? plan.runId : null])).rows[0].n === 0)

    /* ── D2 cooldown ───────────────────────────────────────────────────── */
    console.log('\nD2 cooldown')
    const beforeCooldown = await countRuns(kCooldown)
    plan = await addScrape.prepareRefresh(kCooldown, A, uA)
    ok('a run 5 minutes ago → refused as cooldown', !plan.ok && plan.reason === 'cooldown',
      plan.ok ? 'accepted' : plan.reason)
    ok('the refusal says how long is left, under 15 minutes',
      !plan.ok && typeof plan.retryAfterMs === 'number' && plan.retryAfterMs > 0
      && plan.retryAfterMs <= addScrape.REFRESH_COOLDOWN_MS,
      !plan.ok ? `${Math.round((plan.retryAfterMs ?? 0) / 1000)}s` : '')
    ok('the cooldown refusal wrote nothing', await countRuns(kCooldown) === beforeCooldown)
    ok('cooldown reads the run log, not kol_directory.last_refreshed_at',
      scrapeSrc.includes('FROM public.add_kol_scrape_log WHERE kol_directory_id = $1')
      && !/REFRESH_COOLDOWN[\s\S]{0,400}last_refreshed_at/.test(scrapeSrc))
    // The same creator, its run moved beyond the window, is allowed again.
    await rb.sql(`UPDATE public.add_kol_scrape_log SET started_at = now() - interval '20 minutes'
                   WHERE kol_directory_id = $1`, [kCooldown])
    plan = await addScrape.prepareRefresh(kCooldown, A, uA)
    ok('a run 20 minutes ago → accepted', plan.ok, plan.ok ? 'accepted' : plan.reason)

    /* ── D5 concurrency ────────────────────────────────────────────────── */
    console.log('\nD5 two refreshes cannot both start')
    const first = await addScrape.prepareRefresh(kReady, A, uA)
    ok('first refresh accepted', first.ok, first.ok ? first.runId.slice(0, 8) : first.reason)
    const second = await addScrape.prepareRefresh(kReady, A, uA)
    ok('second refresh refused while the first is reserved',
      !second.ok && second.reason === 'already_running', second.ok ? 'accepted' : second.reason)
    ok('exactly one reservation exists for that creator', await reservations(kReady) === 1)
    ok('the reservation is the accepted run, and no other run was created',
      (await rb.sql<{ n: number }>(`SELECT count(DISTINCT run_id)::int n FROM public.add_kol_pipeline_log
         WHERE kol_directory_id = $1`, [kReady])).rows[0].n === 1)
    const reservationStep: string = addScrape.REFRESH_RESERVATION_STEP
    const engineSteps: readonly string[] = [
      ...runStatusLib.ADD_KOL_STEP_KEYS.instagram,
      ...runStatusLib.ADD_KOL_STEP_KEYS.tiktok,
      runStatusLib.RUN_FAILURE_STEP,
    ]
    ok('a reservation is invisible to the run engine (its step is not a step)',
      !engineSteps.includes(reservationStep), reservationStep)
    const afterReserve = await runStatusLib.getAddKolRunStatus(kReady)
    ok('a reserved creator is not reported as failed by the engine',
      afterReserve !== 'not_found' && afterReserve !== 'foreign_run' && afterReserve.overallStatus !== 'failed',
      typeof afterReserve === 'string' ? afterReserve : afterReserve.overallStatus)

    /* ── D7 authorization, through the route ───────────────────────────── */
    console.log('\nD7 authorization (route-level, refusals only)')
    const url = (k: string) => `/api/kol-directory/add/${k}/refresh`
    as(null)
    let r = await call(refresh.POST, 'POST', url(kProfiling), { kolId: kProfiling }, { orgId: A })
    ok('signed out → 401', r.status === 401, `status ${r.status}`)
    as(uA)
    r = await call(refresh.POST, 'POST', url(kProfiling), { kolId: kProfiling }, {})
    ok('no orgId → 400', r.status === 400, `status ${r.status}`)
    r = await call(refresh.POST, 'POST', url(kProfiling), { kolId: kProfiling }, { orgId: B })
    ok('member of A asking for agency B → 403', r.status === 403, `status ${r.status}`)
    as(uB)
    r = await call(refresh.POST, 'POST', url(kProfiling), { kolId: kProfiling }, { orgId: A })
    ok('member of B cannot refresh through agency A → 403', r.status === 403, `status ${r.status}`)
    as(uA)
    r = await call(refresh.POST, 'POST', url(kUnlinked), { kolId: kUnlinked }, { orgId: A })
    ok('a creator the agency does not hold → 404', r.status === 404, `status ${r.status}`)
    r = await call(refresh.POST, 'POST', url('not-a-uuid'), { kolId: 'not-a-uuid' }, { orgId: A })
    ok('a malformed id → 404', r.status === 404, `status ${r.status}`)
    // An inactive link is not a link.
    await rb.sql(`UPDATE public.agency_kol_accounts SET is_active = false
                   WHERE agency_id = $1 AND kol_account_id = $2`, [A, kProfiling])
    r = await call(refresh.POST, 'POST', url(kProfiling), { kolId: kProfiling }, { orgId: A })
    ok('an inactive link → 404', r.status === 404, `status ${r.status}`)
    await rb.sql(`UPDATE public.agency_kol_accounts SET is_active = true
                   WHERE agency_id = $1 AND kol_account_id = $2`, [A, kProfiling])

    console.log('\nroute refusals carry a machine-readable code')
    r = await call(refresh.POST, 'POST', url(kProfiling), { kolId: kProfiling }, { orgId: A })
    ok('profiling → 409 already_running', r.status === 409 && r.json?.code === 'already_running',
      `${r.status}/${String(r.json?.code)}`)
    r = await call(refresh.POST, 'POST', url(kNoStatus), { kolId: kNoStatus }, { orgId: A })
    ok('no status → 409 status_not_refreshable', r.status === 409 && r.json?.code === 'status_not_refreshable',
      `${r.status}/${String(r.json?.code)}`)
    r = await call(refresh.POST, 'POST', url(kReady), { kolId: kReady }, { orgId: A })
    ok('a reserved creator → 409 already_running', r.status === 409 && r.json?.code === 'already_running',
      `${r.status}/${String(r.json?.code)}`)
    await rb.sql(`UPDATE public.add_kol_scrape_log SET started_at = now() - interval '2 minutes'
                   WHERE kol_directory_id = $1`, [kCooldown])
    await rb.sql(`DELETE FROM public.add_kol_pipeline_log
                   WHERE kol_directory_id = $1 AND step = $2`, [kCooldown, addScrape.REFRESH_RESERVATION_STEP])
    r = await call(refresh.POST, 'POST', url(kCooldown), { kolId: kCooldown }, { orgId: A })
    ok('cooldown → 409 cooldown with retryAfterMs',
      r.status === 409 && r.json?.code === 'cooldown' && typeof r.json?.retryAfterMs === 'number',
      `${r.status}/${String(r.json?.code)}`)

    /* ── nothing else moved ────────────────────────────────────────────── */
    console.log('\nrefresh touches no agency state')
    const linksNow = (await rb.sql<{ n: number; active: number }>(
      `SELECT count(*)::int n, count(*) FILTER (WHERE is_active)::int active
         FROM public.agency_kol_accounts WHERE agency_id = $1`, [A])).rows[0]
    ok('the agency still holds exactly its five creators, all active',
      linksNow.n === 5 && linksNow.active === 5, `${linksNow.n}/${linksNow.active}`)
    ok('no monitoring flag was written',
      (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.agency_kol_accounts
         WHERE agency_id = $1 AND monitoring_enabled IS NOT TRUE`, [A])).rows[0].n === 0)
    ok('no favorite was written',
      (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.agency_kol_favorites
         WHERE agency_id = $1`, [A])).rows[0].n === 0)
    ok('no identity row was created by any refresh',
      (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.kol_social_account
         WHERE kol_id = ANY($1::uuid[])`, [[kReady, kFailed, kCooldown]])).rows[0].n === 3)
    ok('no creator was marked failed or refreshed by a reservation',
      (await rb.sql<{ n: number }>(`SELECT count(*)::int n FROM public.kol_directory
         WHERE id = ANY($1::uuid[]) AND (scrape_status = 'failed' OR last_refreshed_at > now() - interval '1 minute')`,
        [[kReady, kFailed, kCooldown]])).rows[0].n === 0)

    /* ── the lock itself, across two real sessions ─────────────────────── */
    console.log('\nthe advisory lock excludes a second session')
    const a = new pg.Client({ ...kolCfg, connectionTimeoutMillis: 10_000 })
    const b = new pg.Client({ ...kolCfg, connectionTimeoutMillis: 10_000 })
    await a.connect(); await b.connect()
    try {
      // Keys the rolled-back session above never took: its advisory locks are
      // transaction-scoped and that transaction is still open, so reusing one
      // of its keys here would block on the test's own session.
      const key = `kol-refresh:${A}:${kUnlinked}`
      await a.query(`SET lock_timeout = '3s'`); await b.query(`SET lock_timeout = '3s'`)
      await a.query('BEGIN'); await b.query('BEGIN')
      const taken = await a.query<{ got: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got`, [key])
      ok('one session takes the refresh lock', taken.rows[0].got === true)
      const held = await b.query<{ got: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got`, [key])
      ok('a second session cannot take the same refresh lock', held.rows[0].got === false)
      const other = await b.query<{ got: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got`, [`kol-refresh:${A}:${kNoStatus}`])
      ok('a different creator is not blocked by it', other.rows[0].got === true)
      const myCreatorsKey = await b.query<{ got: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got`, [`my-creators:${A}:${kUnlinked}`])
      ok('the D010/D013 my-creators lock is a different key and stays free', myCreatorsKey.rows[0].got === true)
    } finally {
      await a.query('ROLLBACK'); await b.query('ROLLBACK')
      await a.end(); await b.end()
    }
  } finally {
    await rb.finish()
  }

  console.log(bad === 0 ? '\nall checks passed' : `\n${bad} check(s) failed`)
  if (bad) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
