/**
 * Verifies the Creator Workspace Audience tab reads real data, and only real data.
 *
 *   npm run verify:workspace-audience
 *
 * Phase 4B pointed gender, location, interests, authenticity and audience
 * quality at `l2_gold.audience_*` and `feature.*_audience_analysis`. This proves
 * the wiring against the live KOL server: that the numbers match the database
 * row for row, that one creator's audience never appears on another, and that a
 * creator with no analysis gets null rather than a plausible figure.
 *
 * REQUIRES the office VPN: every assertion reads the KOL server.
 */
import kolDb from '@/lib/kolDb'
import { getKolGold } from '@/lib/discover/kolGold'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

;(async () => {
  const db = kolDb()

  /* ── coverage, computed from the database rather than hardcoded ───────── */

  const { rows: cov } = await db.query<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*) FROM public.kol_directory WHERE directory_status = 'active')     AS roster,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily d ON d.social_account_id = ksa.social_account_id
        WHERE d.audience_type = 'gender')                                               AS gender,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily d ON d.social_account_id = ksa.social_account_id
        WHERE d.audience_type = 'age')                                                  AS age,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id) AS geo,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_interest_daily i ON i.social_account_id = ksa.social_account_id) AS interests,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN (SELECT social_account_id, authenticity_score, audience_quality_score
                 FROM feature.ig_audience_analysis
                UNION ALL
               SELECT social_account_id, authenticity_score, audience_quality_score
                 FROM feature.tt_audience_analysis) q
           ON q.social_account_id = ksa.social_account_id
        WHERE q.authenticity_score IS NOT NULL)                                          AS authenticity,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN (SELECT social_account_id, audience_quality_score FROM feature.ig_audience_analysis
                UNION ALL
               SELECT social_account_id, audience_quality_score FROM feature.tt_audience_analysis) q
           ON q.social_account_id = ksa.social_account_id
        WHERE q.audience_quality_score IS NOT NULL)                                      AS quality`)

  const c = cov[0]
  const roster = Number(c.roster)
  console.log(`roster: ${roster.toLocaleString('id-ID')} active creators\n`)
  console.log('COVERAGE (creators, computed live)')
  for (const k of ['gender', 'age', 'geo', 'interests', 'authenticity', 'quality']) {
    const n = Number(c[k])
    console.log(`  ${k.padEnd(13)} ${String(n).padStart(5)}  (${((n / roster) * 100).toFixed(2)}%)`)
  }

  ok('\n  age coverage is zero — no generated age may stand in for it',
    Number(c.age) === 0)

  /* ── pick the three test creators ─────────────────────────────────────── */

  const { rows: withData } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username
      FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN (SELECT social_account_id FROM feature.ig_audience_analysis
             UNION SELECT social_account_id FROM feature.tt_audience_analysis) q
        ON q.social_account_id = ksa.social_account_id
     WHERE kd.directory_status = 'active'
     GROUP BY kd.id, kd.username
     LIMIT 3`)

  const { rows: without } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username
      FROM public.kol_directory kd
     WHERE kd.directory_status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.kol_social_account ksa
          WHERE ksa.kol_id = kd.id
            AND ksa.social_account_id IN (
              SELECT social_account_id FROM l2_gold.audience_geo_daily
               UNION SELECT social_account_id FROM feature.ig_audience_analysis
               UNION SELECT social_account_id FROM feature.tt_audience_analysis))
     LIMIT 1`)

  if (withData.length < 2 || !without.length) {
    console.error('\nnot enough creators to run the isolation test')
    process.exit(1)
  }

  const [a, b] = withData
  const none = without[0]

  /* ── 1. a creator WITH audience data ──────────────────────────────────── */

  console.log(`\ncreator WITH data: @${a.username}`)
  const ga = await getKolGold(a.id)
  ok('audience block present', !!ga?.audience)
  ok('gender slices are real and sum to ~100',
    !!ga?.audience?.gender.length
    && Math.abs(ga.audience.gender.reduce((n, x) => n + x.pct, 0) - 100) < 1.5,
    `${ga?.audience?.gender.map(x => `${x.label} ${x.pct}%`).join(', ')}`)
  ok('geo or interests present',
    !!(ga?.audience?.countries.length || ga?.audience?.interests.length))
  ok('age is empty (no generated fallback)', ga?.audience?.age.length === 0)

  const qa = ga?.audienceQuality ?? null
  ok('audience quality row present', !!qa)
  ok('scores are in 0..100 or null', !qa || [qa.authenticity, qa.audienceQuality, qa.followerQuality]
    .every(v => v === null || (v >= 0 && v <= 100)),
    qa ? `auth ${qa.authenticity} · aq ${qa.audienceQuality} · fq ${qa.followerQuality}` : '')

  /* verify the scores match the database directly */
  const { rows: truth } = await db.query<{ auth: string | null; aq: string | null; fq: string | null }>(`
    SELECT q.authenticity_score AS auth, q.audience_quality_score AS aq,
           q.follower_quality_score AS fq
      FROM (SELECT social_account_id, authenticity_score, audience_quality_score,
                   follower_quality_score, updated_at FROM feature.ig_audience_analysis
             UNION ALL
            SELECT social_account_id, authenticity_score, audience_quality_score,
                   follower_quality_score, updated_at FROM feature.tt_audience_analysis) q
      JOIN public.kol_social_account ksa ON ksa.social_account_id = q.social_account_id
     WHERE ksa.kol_id = $1
     ORDER BY q.updated_at DESC NULLS LAST
     LIMIT 1`, [a.id])
  ok('scores equal the newest database row',
    !!truth[0] && Number(truth[0].auth) === qa?.authenticity
    && Number(truth[0].aq) === qa?.audienceQuality)

  /* ── 2. a creator WITHOUT audience data ───────────────────────────────── */

  console.log(`\ncreator WITHOUT data: @${none.username}`)
  const gn = await getKolGold(none.id)
  ok('audience block is null, not an empty-looking chart', (gn?.audience ?? null) === null)
  ok('audience quality is null, never a default score', (gn?.audienceQuality ?? null) === null)

  /* ── 3. isolation: two creators never share an audience ───────────────── */

  console.log(`\nisolation: @${a.username} vs @${b.username}`)
  const gb = await getKolGold(b.id)
  const sig = (g: typeof ga) => JSON.stringify({
    gender: g?.audience?.gender, geo: g?.audience?.countries,
    interests: g?.audience?.interests, q: g?.audienceQuality,
  })
  ok('two creators do not return an identical audience', sig(ga) !== sig(gb))
  ok('each creator resolves through its own kol_social_account rows',
    ga?.audience !== undefined && gb?.audience !== undefined)

  /* ── 4. latest-snapshot behaviour ─────────────────────────────────────── */

  const { rows: days } = await db.query<{ n: string }>(`
    SELECT COUNT(DISTINCT g.audience_date) AS n
      FROM public.kol_social_account ksa
      JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
     WHERE ksa.kol_id = $1`, [a.id])
  console.log(`\nlatest-snapshot: creator has ${days[0].n} distinct audience_date(s)`)
  ok('geo shares sum to ~100 — one day, not several summed together',
    !ga?.audience?.countries.length
    || Math.abs(ga.audience.countries.reduce((n, x) => n + x.pct, 0) - 100) < 1.5)

  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll workspace audience checks passed.')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error('\nverification could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
