/**
 * Verifies Creator Workspace Performance and Content Analytics read real data,
 * and that a creator with no data gets nothing rather than something invented.
 *
 *   npm run verify:workspace-performance-content
 *
 * Phase 4C replaced the `kolSample` overlay with a straight read of
 * `l1_silver.unified_post` (via `kolMeasured`) and the `l2_gold` rollups (via
 * `kolGold`). The point of this script is the third creator: one with no
 * harvested posts must come back with nulls and empty arrays, because that is
 * exactly the case the old code filled in with generated figures.
 *
 * REQUIRES the office VPN: every assertion reads the KOL server.
 */
import kolDb from '@/lib/kolDb'
import { getKolCreator } from '@/lib/discover/kolDirectory'
import { getKolMeasured } from '@/lib/discover/kolMeasured'
import { getKolGold } from '@/lib/discover/kolGold'
import { creatorIntel } from '@/lib/discover/kolIntel'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** Loads a creator exactly as the workspace page does. */
async function load(kolId: string) {
  const payload = await getKolCreator(kolId)
  if (!payload) throw new Error(`creator ${kolId} not found`)
  const [measured, gold] = await Promise.all([getKolMeasured(kolId), getKolGold(kolId)])
  return { creator: payload.creator, intel: creatorIntel(payload.creator, measured), gold }
}

;(async () => {
  const db = kolDb()

  /* ── coverage, computed live ───────────────────────────────────────────── */

  const { rows: cov } = await db.query<Record<string, string>>(`
    WITH c AS (SELECT ksa.kol_id, ksa.social_account_id FROM public.kol_social_account ksa)
    SELECT
      (SELECT COUNT(*) FROM public.kol_directory WHERE directory_status = 'active')       AS roster,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id)                                    AS posts,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id WHERE p.views > 0)                  AS views,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id WHERE p.likes > 0)                  AS likes,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id WHERE p.shares > 0)                 AS shares,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id WHERE p.saved > 0)                  AS saves,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id WHERE p.reach > 0)                  AS reach,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l1_silver.unified_post p
         ON p.social_account_id = c.social_account_id
        WHERE p.hashtags IS NOT NULL AND array_length(p.hashtags, 1) > 0)                 AS hashtags,
      (SELECT COUNT(DISTINCT c.kol_id) FROM c JOIN l2_gold.kol_metric_daily d
         ON d.social_account_id = c.social_account_id)                                    AS trend`)

  const c = cov[0]
  const roster = Number(c.roster)
  console.log(`roster: ${roster.toLocaleString('id-ID')} active creators\n`)
  console.log('COVERAGE (creators, computed live)')
  for (const k of ['posts', 'views', 'likes', 'shares', 'saves', 'reach', 'hashtags', 'trend']) {
    const n = Number(c[k])
    console.log(`  ${k.padEnd(9)} ${String(n).padStart(5)}  (${((n / roster) * 100).toFixed(2)}%)`)
  }
  ok('\n  reach coverage is zero — views must never be relabelled as reach',
    Number(c.reach) === 0)

  /* ── pick three creators: full, partial, none ──────────────────────────── */

  const { rows: full } = await db.query<{ id: string; username: string; n: string }>(`
    SELECT kd.id, kd.username, COUNT(*) AS n
      FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
     WHERE kd.directory_status = 'active' AND p.views > 0 AND p.likes > 0
     GROUP BY kd.id, kd.username
     ORDER BY COUNT(*) DESC
     LIMIT 2`)

  const { rows: partial } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username
      FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
     WHERE kd.directory_status = 'active'
     GROUP BY kd.id, kd.username
    HAVING COUNT(*) FILTER (WHERE p.views > 0) = 0 AND COUNT(*) > 0
     LIMIT 1`)

  const { rows: none } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username
      FROM public.kol_directory kd
     WHERE kd.directory_status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.kol_social_account ksa
          JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
         WHERE ksa.kol_id = kd.id)
     LIMIT 1`)

  if (full.length < 2 || !none.length) {
    console.error('\nnot enough creators to run the isolation test'); process.exit(1)
  }

  /* ── 1. a creator with good coverage ───────────────────────────────────── */

  const A = await load(full[0].id)
  console.log(`\ncreator WITH data: @${full[0].username} (${full[0].n} measured posts)`)
  ok('content grid holds real posts', A.intel.content.recent.length > 0,
    `${A.intel.content.recent.length} posts`)
  ok('real views on at least one post', A.intel.content.recent.some(i => i.views !== null))
  ok('real likes on at least one post', A.intel.content.recent.some(i => i.likes !== null))
  ok('real comments on at least one post', A.intel.content.recent.some(i => i.comments !== null))
  ok('performance totals are numbers where measured',
    A.intel.performance.likes !== null && A.intel.performance.views !== null,
    `likes ${A.intel.performance.likes} · views ${A.intel.performance.views}`)
  ok('avg views present', A.intel.kpi.avgViews !== null, String(A.intel.kpi.avgViews))
  ok('content formats are real and sum to ~100',
    A.intel.content.formats.length > 0
    && Math.abs(A.intel.content.formats.reduce((n, f) => n + f.pct, 0) - 100) < 2)
  ok('reach is null — no reach column exists on this server',
    A.intel.kpi.avgReach === null && A.intel.performance.reach === null)
  ok('impressions is null — no impressions column exists',
    A.intel.performance.impressions === null)

  /* every post's figures must match the database */
  const { rows: truth } = await db.query<{ n: string; likes: string; views: string }>(`
    SELECT COUNT(*) AS n, SUM(p.likes) AS likes, SUM(p.views) AS views
      FROM public.kol_social_account ksa
      JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
     WHERE ksa.kol_id = $1`, [full[0].id])
  ok('total likes equal the database sum',
    Number(truth[0].likes) === A.intel.performance.likes,
    `db ${truth[0].likes} vs app ${A.intel.performance.likes}`)

  /* ── 2. a creator with partial coverage ────────────────────────────────── */

  if (partial.length) {
    const P = await load(partial[0].id)
    console.log(`\ncreator PARTIAL: @${partial[0].username}`)
    ok('has posts but no views — views null, not zero',
      P.intel.content.recent.length > 0 && P.intel.kpi.avgViews === null)
    ok('posts without views carry null, never 0',
      P.intel.content.recent.every(i => i.views === null || i.views > 0))
    ok('erPct null where views are null',
      P.intel.content.recent.every(i => i.views !== null || i.erPct === null))
  } else {
    console.log('\ncreator PARTIAL: none in this database (every posting creator has views)')
  }

  /* ── 3. a creator with NO data — the critical case ─────────────────────── */

  const N = await load(none[0].id)
  console.log(`\ncreator WITHOUT data: @${none[0].username}`)
  ok('content grid is empty — no generated posts', N.intel.content.recent.length === 0)
  ok('top content is empty', N.intel.content.top.length === 0)
  ok('formats empty', N.intel.content.formats.length === 0)
  ok('hashtags empty', N.intel.content.hashtags.length === 0)
  ok('posting frequency null', N.intel.content.postsPer30d === null)
  ok('every performance total is null, never 0',
    Object.values(N.intel.performance).every(v => v === null),
    JSON.stringify(N.intel.performance))
  ok('every kpi is null, never 0',
    Object.values(N.intel.kpi).every(v => v === null))
  ok('all real flags false', Object.values(N.intel.real).every(v => v === false))
  ok('measured payload is null', N.intel.measured === null)

  /* ── 4. creator isolation ──────────────────────────────────────────────── */

  const B = await load(full[1].id)
  console.log(`\nisolation: @${full[0].username} vs @${full[1].username}`)
  const permA = new Set(A.intel.content.recent.map(i => i.permalink).filter(Boolean))
  const permB = B.intel.content.recent.map(i => i.permalink).filter(Boolean)
  ok('no post appears on both creators', !permB.some(x => permA.has(x)))
  ok('performance totals differ', A.intel.performance.likes !== B.intel.performance.likes)
  ok('content grids differ',
    JSON.stringify(A.intel.content.recent) !== JSON.stringify(B.intel.content.recent))

  /* ── 5. platform isolation ─────────────────────────────────────────────── */

  const platforms = new Set(A.intel.content.recent.map(i => i.platform))
  ok('posts carry a single resolved platform for this creator', platforms.size <= 1,
    [...platforms].join(', '))

  /* ── 6. no generated values anywhere in these two areas ───────────────── */

  console.log('\nno generated fallback')
  ok('intel exposes no trend series (was generated)',
    !('trend' in (A.intel as unknown as Record<string, unknown>)))
  ok('intel exposes no emvUsd (was a hashed CPM)',
    !('emvUsd' in A.intel.kpi))
  ok('no content item carries a sentiment field (comments analysis is empty)',
    A.intel.content.recent.every(i => !('sentiment' in i)))

  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll performance/content checks passed.')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error('\nverification could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
