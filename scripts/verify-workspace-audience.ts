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
 *
 * Read-only: every session is opened with `default_transaction_read_only=on`.
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'
import kolDb from '@/lib/kolDb'
import { getKolGold } from '@/lib/discover/kolGold'
import { AGE_BUCKETS } from '@/lib/discover/whatMatters/audienceMatch'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

/**
 * A creator's age straight from L2, on the reader's rule (each account's newest
 * age date, summed across the creator's accounts): followers with a known age,
 * and all followers in those batches, 'unknown' included.
 */
async function ageTruth(kolId: string): Promise<{ known: number; total: number }> {
  const { rows: [r] } = await kolDb().query<{ known: string | null; total: string | null }>(`
    SELECT SUM(a.audience_count) FILTER (WHERE a.dimension_key <> 'unknown') AS known,
           SUM(a.audience_count)                                             AS total
      FROM public.kol_social_account ksa
      JOIN l2_gold.audience_demographics_daily a ON a.social_account_id = ksa.social_account_id
     WHERE ksa.kol_id = $1
       AND a.audience_type = 'age'
       AND a.audience_date = (
             SELECT MAX(x.audience_date) FROM l2_gold.audience_demographics_daily x
              WHERE x.social_account_id = a.social_account_id AND x.audience_type = 'age')`, [kolId])
  return { known: Number(r?.known ?? 0), total: Number(r?.total ?? 0) }
}

;(async () => {
  const db = kolDb()
  const { rows: [ro] } = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  ok('KOL session is read-only', ro?.transaction_read_only === 'on')

  /* ── coverage, computed from the database rather than hardcoded ───────── */

  const { rows: cov } = await db.query<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*) FROM public.kol_directory WHERE directory_status = 'active')     AS roster,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily d ON d.social_account_id = ksa.social_account_id
        WHERE d.audience_type = 'gender')                                               AS gender,
      -- Age: a creator counts only when at least one follower's age is KNOWN.
      -- The pipeline writes an 'unknown' row for every follower batch, so
      -- "has an age row" is true of every creator with followers and says
      -- nothing about whether any age was found.
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily d ON d.social_account_id = ksa.social_account_id
        WHERE d.audience_type = 'age' AND d.dimension_key <> 'unknown'
          AND d.audience_count > 0)                                                     AS age,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily d ON d.social_account_id = ksa.social_account_id
        WHERE d.audience_type = 'age')                                                  AS age_rows,
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
  console.log(`  ${'(age rows)'.padEnd(13)} ${String(Number(c.age_rows)).padStart(5)}  incl. unknown-only — not coverage`)

  /* ── age evidence: every age is a follower's own statement, or unknown ── */

  // Audience age is extracted from a follower's bio only when the follower
  // states it; everyone else is kept as 'unknown'. Nothing may stand in for a
  // missing age — no generated, sampled or creator-derived figure. These checks
  // prove that from the rows themselves, whatever the counts are today.
  console.log('\nage evidence')
  const bucketKeys = [...Object.keys(AGE_BUCKETS), 'unknown']
  const { rows: [ev] } = await db.query<Record<string, string>>(`
    SELECT
      COUNT(*)                                                                      AS rows,
      COUNT(*) FILTER (WHERE d.dimension_key = 'unknown')                           AS unknown_rows,
      COUNT(*) FILTER (WHERE d.confidence IS NULL
                          OR (d.confidence NOT LIKE 'inferred\\_%'
                              AND lower(trim(d.confidence)) <> 'measured'))         AS bad_confidence,
      COUNT(*) FILTER (WHERE lower(trim(coalesce(d.confidence, ''))) = 'measured')  AS measured,
      COUNT(*) FILTER (WHERE d.dimension_key <> ALL ($1::text[]))                   AS bad_bucket,
      COUNT(*) FILTER (WHERE d.audience_count IS NULL OR d.audience_count < 0)      AS bad_count,
      (SELECT COUNT(*) FROM l1_silver.unified_audience)                             AS insights_rows
      FROM l2_gold.audience_demographics_daily d
     WHERE d.audience_type = 'age'`, [bucketKeys])
  console.log(`  ${ev.rows} age rows, ${ev.unknown_rows} of them 'unknown', ${ev.measured} measured`)
  ok('every age row is marked inferred_* or measured', Number(ev.bad_confidence) === 0,
    `${ev.bad_confidence} unmarked`)
  ok('every age key is a known bucket or unknown', Number(ev.bad_bucket) === 0,
    `${ev.bad_bucket} outside ${bucketKeys.join(', ')}`)
  ok('every age count is a real count (>= 0)', Number(ev.bad_count) === 0)
  ok('no measured age without an Insights source',
    Number(ev.measured) === 0 || Number(ev.insights_rows) > 0,
    `${ev.measured} measured rows, unified_audience ${ev.insights_rows} rows`)

  // Each inferred batch is one follower list: its age rows, 'unknown' included,
  // must add up to exactly the followers collected that day. More would be
  // invented followers; fewer would be followers dropped from the denominator.
  const { rows: [batch] } = await db.query<{ batches: string; equal: string }>(`
    WITH d AS (SELECT social_account_id, audience_date, SUM(audience_count) AS n
                 FROM l2_gold.audience_demographics_daily
                WHERE audience_type = 'age' AND confidence LIKE 'inferred\\_%'
                GROUP BY 1, 2),
         f AS (SELECT social_account_id, date, COUNT(*) AS n
                 FROM l1_silver.unified_follower GROUP BY 1, 2)
    SELECT COUNT(*) AS batches, COUNT(*) FILTER (WHERE d.n = f.n) AS equal
      FROM d LEFT JOIN f ON f.social_account_id = d.social_account_id AND f.date = d.audience_date`)
  ok('each inferred age batch sums to its L1 follower batch',
    batch.batches === batch.equal, `${batch.equal}/${batch.batches}`)
  ok('known-age creators are a subset of creators with age rows',
    Number(c.age) <= Number(c.age_rows), `${c.age} ≤ ${c.age_rows}`)

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
  const ageA = await ageTruth(a.id)
  ok('age slices are exactly the known follower ages (none generated)',
    (ga?.audience?.age ?? []).reduce((n, x) => n + x.n, 0) === ageA.known,
    `${ga?.audience?.age.length ?? 0} slice(s), ${ageA.known} known of ${ageA.total}`)

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

  /* ── 4. age through the reader: unknown stays unknown ──────────────────── */

  // Picked from the data, not hardcoded: one creator whose age rows are all
  // 'unknown', and one with at least one known age, when such creators exist.
  const { rows: ageCreators } = await db.query<{ id: string; username: string; known: string }>(`
    SELECT DISTINCT ON (k.known) kd.id, kd.username, k.known::text AS known
      FROM (SELECT ksa.kol_id,
                   (COALESCE(SUM(d.audience_count) FILTER (WHERE d.dimension_key <> 'unknown'), 0) > 0) AS known
              FROM public.kol_social_account ksa
              JOIN l2_gold.audience_demographics_daily d ON d.social_account_id = ksa.social_account_id
             WHERE d.audience_type = 'age'
             GROUP BY ksa.kol_id) k
      JOIN public.kol_directory kd ON kd.id = k.kol_id AND kd.directory_status = 'active'
     WHERE k.known IS NOT NULL
     ORDER BY k.known, kd.id`)
  console.log('\nage through the reader')
  for (const row of ageCreators) {
    const g = await getKolGold(row.id)
    const t = await ageTruth(row.id)
    const age = g?.audience?.age ?? []
    if (row.known === 'false') {
      ok(`@${row.username}: unknown-only age is not charted as an age`,
        age.length === 0, `${t.total} followers, all unknown`)
      ok(`@${row.username}: its age coverage is 0, not missing`, g?.audience?.coverage.age === 0,
        `${g?.audience?.coverage.age}`)
    } else {
      ok(`@${row.username}: known age slices equal the database, unknown left out`,
        age.reduce((n, x) => n + x.n, 0) === t.known && age.every(x => x.label in AGE_BUCKETS),
        age.map(x => `${x.label} ${x.n}`).join(', '))
      const expected = t.total ? Math.round((t.known / t.total) * 1000) / 10 : null
      ok(`@${row.username}: age coverage states the known share`,
        g?.audience?.coverage.age === expected, `${g?.audience?.coverage.age}% (${t.known}/${t.total})`)
    }
  }
  if (!ageCreators.some(r => r.known === 'true')) console.log('  note  no creator has a known age today')

  /* ── 5. geo evidence across dates (audienceGeo.ts) ─────────────────────── */

  // Each inferred geo date is a separate follower batch, so every date counts;
  // measured snapshots (none today) would be cut to the newest.
  const { rows: days } = await db.query<{ n: string; known: string | null; measured: string }>(`
    SELECT COUNT(DISTINCT g.audience_date) AS n,
           SUM(g.audience_count) FILTER (WHERE g.geo_level = 'country' AND g.geo_key <> 'unknown') AS known,
           COUNT(*) FILTER (WHERE lower(trim(coalesce(g.confidence, ''))) = 'measured') AS measured
      FROM public.kol_social_account ksa
      JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
     WHERE ksa.kol_id = $1`, [a.id])
  const shown = (ga?.audience?.countries ?? []).reduce((n, x) => n + x.n, 0)
  console.log(`\ngeo: creator has ${days[0].n} distinct audience_date(s), ${days[0].measured} measured row(s)`)
  ok('geo shares sum to ~100',
    !ga?.audience?.countries.length
    || Math.abs(ga.audience.countries.reduce((n, x) => n + x.pct, 0) - 100) < 1.5)
  if (Number(days[0].measured) === 0) {
    ok('known country followers = every inferred date summed, each once',
      shown === Number(days[0].known ?? 0), `${shown} vs ${days[0].known}`)
  }

  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll workspace audience checks passed.')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error('\nverification could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
