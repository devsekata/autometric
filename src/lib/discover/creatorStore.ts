import pool from '@/lib/db'
import { toIso } from './util'
import { profileUrlFor, type CreatorPlatform } from './creatorInput'
import type {
  CreatorContent, CreatorProfile, CreatorRun, CreatorSnapshot, CreatorSummary,
  CreatorVisibility, ExistingCreatorRef, FlowStep, ProfilingStatus,
} from './creatorFlow'

/**
 * Storage for the creators an org adds by hand — `public.discover_creators` and
 * the two tables hanging off it (see migration 049).
 *
 * This is the only roster in Discover that this app writes. The commercial KOL
 * directory is read-only from here (`@/lib/kolDb`) and `social_accounts` holds
 * accounts tracked for dashboards, which are not creators to hire. Intake fills
 * the gap between them, so everything about a hand-added creator lives here:
 * the identity, whatever profiling measured, the run log the progress screen
 * reads, and the daily snapshots monitoring compares against.
 *
 * Nothing in this module invents a number. A column stays null until something
 * measured it, and the read shapes carry those nulls through to the UI rather
 * than coalescing them to zero, so "not measured yet" never renders as "zero".
 */

/* ── row → payload ────────────────────────────────────────────────────────── */

interface CreatorRow {
  id: string
  platform: string
  username: string
  profile_url: string | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  visibility: string
  verified: boolean
  category: string | null
  city: string | null
  followers: string | number | null
  following: string | number | null
  posts_count: string | number | null
  avg_likes: string | number | null
  avg_comments: string | number | null
  avg_views: string | number | null
  er_pct: string | number | null
  tier: string | null
  content: CreatorContent | null
  profiling_status: string
  profiling_error: string | null
  monitoring_enabled: boolean
  last_refreshed_at: Date | string | null
  created_at: Date | string
}

/**
 * `pg` returns BIGINT and NUMERIC as strings — the driver will not narrow them
 * to a JS number because it cannot promise the value fits. Every numeric column
 * here does fit (follower counts and percentages), so they are converted once,
 * on the way out, and null stays null.
 */
const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const SUMMARY_COLS = `
  id, platform, username, profile_url, display_name, avatar_url, bio,
  visibility, verified, category, city, followers, following, posts_count,
  avg_likes, avg_comments, avg_views, er_pct, tier, content,
  profiling_status, profiling_error, monitoring_enabled, last_refreshed_at, created_at`

function toSummary(r: CreatorRow): CreatorSummary {
  return {
    id: r.id,
    platform: r.platform as CreatorPlatform,
    username: r.username,
    profileUrl: r.profile_url ?? profileUrlFor(r.platform, r.username),
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    visibility: r.visibility as CreatorVisibility,
    verified: r.verified,
    category: r.category,
    city: r.city,
    followers: num(r.followers),
    erPct: num(r.er_pct),
    tier: r.tier,
    profilingStatus: r.profiling_status as ProfilingStatus,
    profilingError: r.profiling_error,
    monitoringEnabled: r.monitoring_enabled,
    lastRefreshedAt: toIso(r.last_refreshed_at),
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  }
}

function toProfile(r: CreatorRow, run: CreatorRun | null, history: CreatorSnapshot[]): CreatorProfile {
  return {
    ...toSummary(r),
    bio: r.bio,
    following: num(r.following),
    postsCount: num(r.posts_count),
    avgLikes: num(r.avg_likes),
    avgComments: num(r.avg_comments),
    avgViews: num(r.avg_views),
    content: r.content,
    run,
    history,
  }
}

/** The compact shape the duplicate screen shows for a creator already stored. */
export const toExistingRef = (c: CreatorSummary): ExistingCreatorRef => ({
  id: c.id,
  username: c.username,
  platform: c.platform,
  displayName: c.displayName,
  avatarUrl: c.avatarUrl,
  followers: c.followers,
  erPct: c.erPct,
  category: c.category,
  profilingStatus: c.profilingStatus,
  lastRefreshedAt: c.lastRefreshedAt,
})

/* ── reads ────────────────────────────────────────────────────────────────── */

export interface CreatorListQuery {
  q?: string | null
  platform?: string | null
  category?: string | null
  /** The city profiling read off the account — Basic Discovery's Location. */
  city?: string | null
  tier?: string | null
  minFollowers?: number | null
  minErPct?: number | null
  status?: string | null
}

/**
 * The org's creators, newest first.
 *
 * Filtered in SQL even though this roster is small. It is small *today* — an
 * org that runs intake for a year has thousands, and a filter that works by
 * shipping every row to the browser stops working exactly when it starts to
 * matter.
 */
export async function listCreators(orgId: string, f: CreatorListQuery = {}): Promise<CreatorSummary[]> {
  const where: string[] = ['organization_id = $1']
  const params: unknown[] = [orgId]
  /**
   * One value, one placeholder index, however many times the fragment mentions
   * it. `replaceAll` and not `replace`: the search predicate names `$n` twice
   * (username and display name), and replacing only the first leaves a literal
   * `$n` in the statement — a syntax error, not a wrong result.
   */
  const add = (sql: string, value: unknown) => {
    params.push(value)
    where.push(sql.replaceAll('$n', `$${params.length}`))
  }

  if (f.q?.trim()) {
    // `%` and `_` typed into the search box are literals, not LIKE wildcards.
    const term = `%${f.q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`
    add(`(username ILIKE $n OR display_name ILIKE $n)`, term)
  }
  if (f.platform) add('platform = $n', f.platform)
  if (f.category) add('category = $n', f.category)
  if (f.city) add('city = $n', f.city)
  if (f.tier) add('tier = $n', f.tier)
  if (f.status) add('profiling_status = $n', f.status)
  // A minimum of zero is not a minimum: `followers >= 0` would drop every
  // creator whose count was never measured, which is every creator still being
  // profiled. Only a positive floor filters.
  if (f.minFollowers && f.minFollowers > 0) add('followers >= $n', f.minFollowers)
  if (f.minErPct && f.minErPct > 0) add('er_pct >= $n', f.minErPct)

  const { rows } = await pool.query<CreatorRow>(
    `SELECT ${SUMMARY_COLS} FROM public.discover_creators
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC`,
    params,
  )
  return rows.map(toSummary)
}

/** Distinct values across the org's creators, for the filter chips. */
export async function listCreatorFacets(orgId: string): Promise<{
  categories: { name: string; count: number }[]
  platforms: { key: string; count: number }[]
  cities: { name: string; count: number }[]
  tiers: { name: string; count: number }[]
  total: number
}> {
  const [cats, plats, cities, tiers, total] = await Promise.all([
    pool.query<{ name: string; count: string }>(
      `SELECT category AS name, COUNT(*)::text AS count FROM public.discover_creators
        WHERE organization_id = $1 AND category IS NOT NULL
        GROUP BY category ORDER BY COUNT(*) DESC`, [orgId]),
    pool.query<{ key: string; count: string }>(
      `SELECT platform AS key, COUNT(*)::text AS count FROM public.discover_creators
        WHERE organization_id = $1 GROUP BY platform ORDER BY COUNT(*) DESC`, [orgId]),
    // Ordered by how many creators are in each, not alphabetically: the list
    // is a filter, and the cities worth offering first are the ones this org
    // actually works in.
    pool.query<{ name: string; count: string }>(
      `SELECT city AS name, COUNT(*)::text AS count FROM public.discover_creators
        WHERE organization_id = $1 AND city IS NOT NULL AND city <> ''
        GROUP BY city ORDER BY COUNT(*) DESC, city`, [orgId]),
    pool.query<{ name: string; count: string }>(
      `SELECT tier AS name, COUNT(*)::text AS count FROM public.discover_creators
        WHERE organization_id = $1 AND tier IS NOT NULL
        GROUP BY tier ORDER BY MAX(followers) DESC`, [orgId]),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.discover_creators WHERE organization_id = $1`, [orgId]),
  ])
  return {
    categories: cats.rows.map(r => ({ name: r.name, count: Number(r.count) })),
    platforms: plats.rows.map(r => ({ key: r.key, count: Number(r.count) })),
    cities: cities.rows.map(r => ({ name: r.name, count: Number(r.count) })),
    tiers: tiers.rows.map(r => ({ name: r.name, count: Number(r.count) })),
    total: Number(total.rows[0]?.count ?? 0),
  }
}

/**
 * One creator by handle, which is the duplicate check.
 *
 * Compared case-insensitively because the unique index is, and because handles
 * are: @Raditya and @raditya are one account, and letting the second one in
 * would give the org two profiles of one person and two refresh jobs fighting
 * over the same source.
 */
export async function findCreatorByHandle(
  orgId: string, platform: string, username: string,
): Promise<CreatorSummary | null> {
  const { rows } = await pool.query<CreatorRow>(
    `SELECT ${SUMMARY_COLS} FROM public.discover_creators
      WHERE organization_id = $1 AND platform = $2 AND LOWER(username) = LOWER($3)`,
    [orgId, platform, username],
  )
  return rows[0] ? toSummary(rows[0]) : null
}

export async function getCreator(orgId: string, id: string): Promise<CreatorProfile | null> {
  const { rows } = await pool.query<CreatorRow>(
    `SELECT ${SUMMARY_COLS} FROM public.discover_creators WHERE organization_id = $1 AND id = $2`,
    [orgId, id],
  )
  if (!rows[0]) return null
  const [run, history] = await Promise.all([getLatestRun(id), listSnapshots(id)])
  return toProfile(rows[0], run, history)
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * Identity only.
 *
 * The preview the validation screen showed is deliberately not carried in here:
 * it reached the browser, and anything that reaches the browser can come back
 * edited. Every number on a creator row is written by profiling, from the
 * platform, on the server — so a row is either measured or null, never asserted.
 */
export interface CreateCreatorInput {
  orgId: string
  userId: string | null
  platform: CreatorPlatform
  username: string
  profileUrl: string
  visibility: CreatorVisibility
}

/**
 * Create the row, or hand back the one that already exists.
 *
 * `ON CONFLICT DO NOTHING` and then a re-read, rather than a check-then-insert:
 * two people adding the same creator at the same moment both pass a prior check
 * and only the index can settle it. The caller gets `created: false` and shows
 * the existing profile, which is what the duplicate screen would have said.
 */
export async function createCreator(
  input: CreateCreatorInput,
): Promise<{ creator: CreatorSummary; created: boolean }> {
  const { rows } = await pool.query<CreatorRow>(
    `INSERT INTO public.discover_creators
       (organization_id, platform, username, profile_url, visibility, created_by, profiling_status)
     VALUES ($1,$2,$3,$4,$5,$6,'queued')
     ON CONFLICT (organization_id, platform, LOWER(username)) DO NOTHING
     RETURNING ${SUMMARY_COLS}`,
    [input.orgId, input.platform, input.username, input.profileUrl, input.visibility, input.userId],
  )
  if (rows[0]) return { creator: toSummary(rows[0]), created: true }

  const existing = await findCreatorByHandle(input.orgId, input.platform, input.username)
  if (!existing) throw new Error('Creator could not be created and no existing row was found.')
  return { creator: existing, created: false }
}

/** Everything profiling measures. Undefined fields are left untouched. */
export interface CreatorMeasurements {
  displayName?: string | null
  avatarUrl?: string | null
  bio?: string | null
  verified?: boolean
  visibility?: CreatorVisibility
  category?: string | null
  city?: string | null
  followers?: number | null
  following?: number | null
  postsCount?: number | null
  avgLikes?: number | null
  avgComments?: number | null
  avgViews?: number | null
  erPct?: number | null
  tier?: string | null
  content?: CreatorContent | null
}

const COLUMN_OF: Record<keyof CreatorMeasurements, string> = {
  displayName: 'display_name', avatarUrl: 'avatar_url', bio: 'bio', verified: 'verified',
  visibility: 'visibility', category: 'category', city: 'city', followers: 'followers',
  following: 'following', postsCount: 'posts_count', avgLikes: 'avg_likes',
  avgComments: 'avg_comments', avgViews: 'avg_views', erPct: 'er_pct', tier: 'tier',
  content: 'content',
}

/**
 * Write what a run measured.
 *
 * Only the keys actually present are written. A refresh whose content leg failed
 * must not blank out last week's content characteristics: an absent measurement
 * and a measurement of nothing are different, and overwriting the first with the
 * second is how a refresh quietly destroys data.
 */
export async function saveMeasurements(
  creatorId: string, m: CreatorMeasurements,
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = [creatorId]
  for (const [key, value] of Object.entries(m)) {
    if (value === undefined) continue
    const col = COLUMN_OF[key as keyof CreatorMeasurements]
    if (!col) continue
    params.push(key === 'content' ? JSON.stringify(value) : value)
    sets.push(`${col} = $${params.length}${key === 'content' ? '::jsonb' : ''}`)
  }
  if (!sets.length) return
  await pool.query(
    `UPDATE public.discover_creators SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
    params,
  )
}

export async function setProfilingStatus(
  creatorId: string, status: ProfilingStatus, error: string | null = null,
): Promise<void> {
  // `$2` is cast explicitly because it is used twice with different expected
  // types — assigned to a varchar column and compared against a text literal —
  // and Postgres refuses to deduce one type for both ("inconsistent types
  // deduced for parameter $2").
  await pool.query(
    `UPDATE public.discover_creators
        SET profiling_status = $2::text,
            profiling_error  = $3,
            -- Only a completed run counts as a refresh. Marking the timestamp
            -- on a failed one would make a stale profile look fresh.
            last_refreshed_at = CASE WHEN $2::text = 'ready' THEN now() ELSE last_refreshed_at END,
            updated_at = now()
      WHERE id = $1`,
    [creatorId, status, error],
  )
}

export async function setMonitoring(orgId: string, id: string, enabled: boolean): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE public.discover_creators SET monitoring_enabled = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, enabled],
  )
  return (rowCount ?? 0) > 0
}

export async function deleteCreator(orgId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM public.discover_creators WHERE organization_id = $1 AND id = $2`,
    [orgId, id],
  )
  return (rowCount ?? 0) > 0
}

/* ── runs ─────────────────────────────────────────────────────────────────── */

interface RunRow {
  id: string | number
  kind: string
  status: string
  step: number
  steps: FlowStep[]
  error: string | null
  started_at: Date | string
  finished_at: Date | string | null
}

const toRun = (r: RunRow): CreatorRun => ({
  id: Number(r.id),
  kind: r.kind as CreatorRun['kind'],
  status: r.status as CreatorRun['status'],
  step: r.step,
  steps: Array.isArray(r.steps) ? r.steps : [],
  error: r.error,
  startedAt: toIso(r.started_at) ?? new Date().toISOString(),
  finishedAt: toIso(r.finished_at),
})

export async function startRun(
  creatorId: string, kind: 'initial' | 'refresh', steps: FlowStep[],
): Promise<CreatorRun> {
  const { rows } = await pool.query<RunRow>(
    `INSERT INTO public.discover_creator_runs (creator_id, kind, status, step, steps)
     VALUES ($1, $2, 'running', 0, $3::jsonb)
     RETURNING id, kind, status, step, steps, error, started_at, finished_at`,
    [creatorId, kind, JSON.stringify(steps)],
  )
  return toRun(rows[0])
}

/**
 * Record the state of the run's steps.
 *
 * The whole array is rewritten each time rather than patched in SQL. The array
 * is six entries long and the writer already holds it in memory; a jsonb path
 * update would be the clever version of a one-line assignment, and would make
 * the step list two sources instead of one.
 */
export async function saveRunSteps(runId: number, steps: FlowStep[]): Promise<void> {
  const settled = steps.filter(s => s.state === 'done' || s.state === 'skipped').length
  await pool.query(
    `UPDATE public.discover_creator_runs SET steps = $2::jsonb, step = $3 WHERE id = $1`,
    [runId, JSON.stringify(steps), settled],
  )
}

export async function finishRun(
  runId: number, status: 'done' | 'failed', steps: FlowStep[], error: string | null = null,
): Promise<void> {
  const settled = steps.filter(s => s.state === 'done' || s.state === 'skipped').length
  await pool.query(
    `UPDATE public.discover_creator_runs
        SET status = $2, steps = $3::jsonb, step = $4, error = $5, finished_at = now()
      WHERE id = $1`,
    [runId, status, JSON.stringify(steps), settled, error],
  )
}

export async function getLatestRun(creatorId: string): Promise<CreatorRun | null> {
  const { rows } = await pool.query<RunRow>(
    `SELECT id, kind, status, step, steps, error, started_at, finished_at
       FROM public.discover_creator_runs
      WHERE creator_id = $1
      ORDER BY started_at DESC, id DESC
      LIMIT 1`,
    [creatorId],
  )
  return rows[0] ? toRun(rows[0]) : null
}

/**
 * Runs that never finished, so a restarted server does not leave a creator
 * showing a progress screen forever.
 *
 * Profiling runs in the request handler's process (fire-and-forget, the same
 * shape the competitor initial sync uses). If that process goes away mid-run,
 * nothing is left to write the failure — so the next read of a stale run marks
 * it failed rather than leaving a spinner that can never resolve.
 */
export async function expireStaleRuns(maxAgeMinutes = 15): Promise<void> {
  await pool.query(
    `WITH stale AS (
       UPDATE public.discover_creator_runs
          SET status = 'failed', finished_at = now(),
              error = 'Profiling stopped before it finished — the server restarted, or the source timed out. Refresh to try again.'
        WHERE status = 'running'
          AND started_at < now() - ($1 || ' minutes')::interval
        RETURNING creator_id
     )
     UPDATE public.discover_creators c
        SET profiling_status = 'failed',
            profiling_error = 'Profiling stopped before it finished. Refresh to try again.',
            updated_at = now()
       FROM stale
      WHERE c.id = stale.creator_id AND c.profiling_status IN ('queued', 'running')`,
    [String(maxAgeMinutes)],
  )
}

/* ── snapshots ────────────────────────────────────────────────────────────── */

export interface SnapshotInput {
  followers?: number | null
  following?: number | null
  postsCount?: number | null
  erPct?: number | null
  avgLikes?: number | null
  avgComments?: number | null
}

/**
 * One point per creator per day.
 *
 * Upserted on the Jakarta date so refreshing twice in a day corrects that day
 * rather than adding a second point — the same key the l0_raw snapshot tables
 * use, so a chart drawn from either reads the same way.
 */
export async function saveSnapshot(creatorId: string, s: SnapshotInput): Promise<void> {
  await pool.query(
    `INSERT INTO public.discover_creator_snapshots
       (creator_id, followers, following, posts_count, er_pct, avg_likes, avg_comments)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (creator_id, captured_on) DO UPDATE SET
       followers    = COALESCE(EXCLUDED.followers,    discover_creator_snapshots.followers),
       following    = COALESCE(EXCLUDED.following,    discover_creator_snapshots.following),
       posts_count  = COALESCE(EXCLUDED.posts_count,  discover_creator_snapshots.posts_count),
       er_pct       = COALESCE(EXCLUDED.er_pct,       discover_creator_snapshots.er_pct),
       avg_likes    = COALESCE(EXCLUDED.avg_likes,    discover_creator_snapshots.avg_likes),
       avg_comments = COALESCE(EXCLUDED.avg_comments, discover_creator_snapshots.avg_comments),
       captured_at  = now()`,
    [
      creatorId, s.followers ?? null, s.following ?? null, s.postsCount ?? null,
      s.erPct ?? null, s.avgLikes ?? null, s.avgComments ?? null,
    ],
  )
}

export async function listSnapshots(creatorId: string, limit = 90): Promise<CreatorSnapshot[]> {
  const { rows } = await pool.query<{
    captured_on: string
    followers: string | null; following: string | null; posts_count: string | null
    er_pct: string | null; avg_likes: string | null; avg_comments: string | null
  }>(
    // `captured_on::text` rather than the DATE itself: node-pg hydrates a DATE
    // into a JS `Date` at the *server's* midnight, and every later conversion to
    // ISO shifts it into UTC — which moves a Jakarta date back a day. Postgres
    // already formats it as YYYY-MM-DD; taking that string keeps the calendar
    // day the snapshot was actually keyed on.
    `SELECT captured_on::text, followers, following, posts_count, er_pct, avg_likes, avg_comments
       FROM public.discover_creator_snapshots
      WHERE creator_id = $1
      ORDER BY captured_on DESC
      LIMIT $2`,
    [creatorId, limit],
  )
  // Read newest-first so the LIMIT keeps the recent window, returned oldest-first
  // because that is the direction a chart is drawn in.
  return rows.reverse().map(r => ({
    capturedOn: r.captured_on,
    followers: num(r.followers),
    following: num(r.following),
    postsCount: num(r.posts_count),
    erPct: num(r.er_pct),
    avgLikes: num(r.avg_likes),
    avgComments: num(r.avg_comments),
  }))
}
