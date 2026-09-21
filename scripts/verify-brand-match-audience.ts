/**
 * Verifies the Target Audience criteria of Brand Match
 * (`src/lib/discover/whatMatters/audienceMatch.ts` + `brandMatch.ts`).
 *
 *   npm run verify:brand-match-audience               # in-memory + live (read-only)
 *   npm run verify:brand-match-audience -- --offline  # in-memory only
 *
 * In-memory: every audience scorer, selection by filled-in field, the combined
 * mean, the denominator rule for unselected / unmeasured criteria, and that the
 * What Matters-only path is unchanged.
 *
 * Live (reads the KOL database only; never writes, never touches
 * brand_profile): takes the active creator with the most complete audience
 * data, reads its L2 audience rows with independent SQL, recomputes every
 * criterion by hand from those rows, and checks `audienceRecordsFor` +
 * `brandMatchForDirectory` return exactly that — Brand Profile requirement →
 * Audience Analysis DB → criterion score → Match %.
 */
import kolDb from '@/lib/kolDb'
import {
  AUDIENCE_CRITERIA, AUDIENCE_MIN_KNOWN, NO_AUDIENCE_REQUIREMENTS, ageBucketOverlap,
  audienceAgeScore, audienceCityScore, audienceCountryScore, audienceGenderScore,
  audienceInterestScore, audienceRecordsFor, audienceScores, countryToIso2, selectedAudienceCriteria,
  type AudienceRequirements,
} from '@/lib/discover/whatMatters/audienceMatch'
import { brandMatchForDirectory, brandMatchFromScores } from '@/lib/discover/whatMatters/brandMatch'
import { whatMattersScore } from '@/lib/discover/whatMatters'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? a === b : Math.abs(a - b) < 1e-9
const offline = process.argv.includes('--offline')

const REQ = (over: Partial<AudienceRequirements>): AudienceRequirements => ({ ...NO_AUDIENCE_REQUIREMENTS, ...over })

function inMemory() {
  console.log('\nSelection = the Brand Profile field is filled in')
  check('empty profile selects nothing', selectedAudienceCriteria(NO_AUDIENCE_REQUIREMENTS).length === 0)
  check("gender 'Any' is not a requirement", selectedAudienceCriteria(REQ({ genderMajority: 'Any' })).length === 0)
  check('every filled field selects its criterion, fixed order',
    selectedAudienceCriteria(REQ({
      genderMajority: 'Female', targetAgeMin: 18, targetCountry: 'Indonesia', targetCity: 'Jakarta',
      audienceInterests: ['beauty'],
    })).join(',') === AUDIENCE_CRITERIA.join(','))
  check('interests outside interest_key are ignored (no new vocabulary)',
    selectedAudienceCriteria(REQ({ audienceInterests: ['Beauty & Lifestyle', 'xyz'] })).length === 0
    && selectedAudienceCriteria(REQ({ audienceInterests: ['Beauty'] })).join() === 'audience_interest')

  console.log('\n1. Gender')
  const g = { female: 30, male: 10, unknown: 60 }
  check('Female = female share of KNOWN gender (unknown excluded, like female_pct)', near(audienceGenderScore(g, 'Female'), 75))
  check('Male = male share of known', near(audienceGenderScore(g, 'Male'), 25))
  check('Balanced = 100 at 50/50, 0 at 100/0',
    near(audienceGenderScore({ female: 20, male: 20 }, 'Balanced'), 100)
    && near(audienceGenderScore({ female: 20, male: 0 }, 'Balanced'), 0)
    && near(audienceGenderScore(g, 'Balanced'), 50))
  check('only unknown → null, not 0 and not 100', audienceGenderScore({ unknown: 99 }, 'Female') === null)

  console.log('\n2. Age')
  check('bucket overlap by years: 18-24 in 23..35 = 2/7', near(ageBucketOverlap('18-24', 23, 35), 2 / 7))
  check('bucket fully inside = 1, outside = 0',
    ageBucketOverlap('25-34', 23, 35) === 1 && ageBucketOverlap('13-17', 23, 35) === 0)
  check('open 45+ counts whole once the range reaches 45',
    ageBucketOverlap('45+', 30, 50) === 1 && ageBucketOverlap('45+', 30, 44) === 0 && ageBucketOverlap('45+', 20, null) === 1)
  check('age score = overlap-weighted share of known ages',
    near(audienceAgeScore({ '18-24': 7, '25-34': 3, unknown: 90 }, 23, 35), (7 * 2 / 7 + 3) / 10 * 100))
  check(`fewer than ${AUDIENCE_MIN_KNOWN} known ages → null (one follower is not an audience)`,
    audienceAgeScore({ '18-24': 1, unknown: 99 }, 18, 24) === null)

  console.log('\n3. City')
  const city = { Jakarta: 6, Bandung: 3, Surabaya: 1 }
  check('city = share of known-city followers, case-insensitive', near(audienceCityScore(city, ' jakarta '), 60))
  check('absent city = 0 (measured, just not there)', near(audienceCityScore(city, 'Medan'), 0))

  console.log('\n4. Country')
  check("'Indonesia' → ID, 'id' → ID, unknown name → null",
    countryToIso2('Indonesia') === 'ID' && countryToIso2('id') === 'ID' && countryToIso2('Atlantis') === null)
  const co = { ID: 12, MY: 3, unknown: 85 }
  check('country = share of known-country followers (unknown excluded)', near(audienceCountryScore(co, 'Indonesia'), 80))
  check('unresolvable country → null, never a guess', audienceCountryScore(co, 'Atlantis') === null)

  console.log('\n5. Interest')
  const it = { religion: 10, music: 5, beauty: 5, unknown: 80 }
  check('interest = share of known interest mentions in the chosen keys',
    near(audienceInterestScore(it, ['beauty', 'music']), 50))
  check('only unknown → null', audienceInterestScore({ unknown: 50 }, ['beauty']) === null)

  console.log('\n6–10. Combined Match %')
  const req = REQ({ genderMajority: 'Female', targetCountry: 'Indonesia', audienceInterests: ['beauty'] })
  const rec = { gender: g, age: {}, city: {}, country: co, interest: it }
  const aScores = audienceScores(rec, req)
  const sel = selectedAudienceCriteria(req)
  const r = brandMatchFromScores({ engagement: 60 }, ['strong_engagement'], { selected: sel, scores: aScores })
  check('6. unselected criteria (age, city) are not in the breakdown or denominator',
    r.selected === 4 && !r.breakdown.some(b => b.key === 'audience_age' || b.key === 'audience_city'))
  check('9. Match % = mean(engagement, gender, country, interest)',
    near(r.matchPct, (60 + 75 + 80 + (5 / 20) * 100) / 4), String(r.matchPct))
  const missing = brandMatchFromScores({ engagement: 60 }, ['strong_engagement'],
    { selected: sel, scores: audienceScores(undefined, req) })
  check('7. no audience data → those criteria null, counted=false, Match % = engagement alone (not 100)',
    near(missing.matchPct, 60) && missing.contributing === 1 && missing.selected === 4
    && missing.breakdown.filter(b => b.key.startsWith('audience_')).every(b => b.score === null && !b.counted))
  const onlyAud = brandMatchFromScores({}, [], { selected: sel, scores: audienceScores(undefined, req) })
  check('10. everything unmeasured → null Match % with no_scores (no division by zero)',
    onlyAud.matchPct === null && onlyAud.unavailable === 'no_scores' && onlyAud.contributing === 0)
  const nothing = brandMatchFromScores({ engagement: 60 }, [], { selected: [], scores: {} })
  check('10. nothing chosen → null with no_selection', nothing.matchPct === null && nothing.unavailable === 'no_selection')
  const wmOnly = brandMatchFromScores({ engagement: 60, reach: 30 }, ['strong_engagement', 'high_reach'])
  check('8. What Matters-only path unchanged (= whatMattersScore, same breakdown)',
    near(wmOnly.matchPct, whatMattersScore({ engagement: 60, reach: 30 }, ['engagement', 'reach']))
    && wmOnly.breakdown.map(b => b.key).join() === 'strong_engagement,high_reach')
}

async function live() {
  console.log('\nLive — most complete audience in the KOL database (read-only)')
  const db = kolDb()
  const latest = (t: string, extra = '') => `
    SELECT a.* FROM ${t} a WHERE a.audience_date = (SELECT max(x.audience_date) FROM ${t} x
      WHERE x.social_account_id = a.social_account_id ${extra})`
  const { rows: [pick] } = await db.query<{ id: string; username: string }>(`
    WITH acc AS (SELECT kd.id, kd.username, s.social_account_id sa FROM public.kol_directory kd
                   JOIN public.kol_social_account s ON s.kol_id = kd.id WHERE kd.directory_status = 'active'),
         d AS (${latest('l2_gold.audience_demographics_daily', 'AND x.audience_type = a.audience_type')}),
         g AS (${latest('l2_gold.audience_geo_daily')}),
         i AS (${latest('l2_gold.audience_interest_daily')})
    SELECT acc.id::text, acc.username
      FROM acc
     ORDER BY
       (SELECT coalesce(sum(audience_count), 0) FROM d WHERE d.social_account_id = acc.sa AND d.audience_type = 'gender' AND d.dimension_key <> 'unknown')
         >= ${AUDIENCE_MIN_KNOWN} DESC,
       least((SELECT coalesce(sum(audience_count), 0) FROM g WHERE g.social_account_id = acc.sa AND g.geo_level = 'city' AND g.geo_key <> 'unknown'),
             (SELECT coalesce(sum(audience_count), 0) FROM g WHERE g.social_account_id = acc.sa AND g.geo_level = 'country' AND g.geo_key <> 'unknown'),
             (SELECT coalesce(sum(audience_count), 0) FROM i WHERE i.social_account_id = acc.sa AND i.interest_key <> 'unknown')) DESC,
       acc.id
     LIMIT 1`)
  if (!pick) { check('an active creator with audience data exists', false); return }
  console.log(`  KOL: @${pick.username} (${pick.id})`)

  // Independent read of the same L2 rows.
  const { rows: raw } = await db.query<{ dim: string; key: string; n: number }>(`
    WITH s AS (SELECT social_account_id FROM public.kol_social_account WHERE kol_id = $1)
    SELECT audience_type dim, dimension_key key, sum(audience_count)::float8 n
      FROM (${latest('l2_gold.audience_demographics_daily', 'AND x.audience_type = a.audience_type')}) d
     WHERE social_account_id IN (SELECT * FROM s) AND audience_type IN ('gender','age') GROUP BY 1,2
    UNION ALL
    SELECT geo_level, geo_key, sum(audience_count)::float8 FROM (${latest('l2_gold.audience_geo_daily')}) g
     WHERE social_account_id IN (SELECT * FROM s) AND geo_level IN ('city','country') GROUP BY 1,2
    UNION ALL
    SELECT 'interest', interest_key, sum(audience_count)::float8 FROM (${latest('l2_gold.audience_interest_daily')}) i
     WHERE social_account_id IN (SELECT * FROM s) GROUP BY 1,2`, [pick.id])
  const dist: Record<string, Record<string, number>> = { gender: {}, age: {}, city: {}, country: {}, interest: {} }
  for (const r of raw) dist[r.dim][r.key] = Number(r.n)
  for (const [k, v] of Object.entries(dist)) console.log(`  DB ${k.padEnd(8)} ${JSON.stringify(v)}`)

  const known = (d: Record<string, number>) => Object.entries(d).filter(([k]) => k !== 'unknown').reduce((s, [, v]) => s + v, 0)
  const top = (d: Record<string, number>) => Object.entries(d).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  // A test Brand Profile (in memory only): the creator's own top city/interest
  // plus a second interest, Female, Indonesia, 18–34.
  const interests = Object.entries(dist.interest).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k)
  const req = REQ({
    genderMajority: 'Female', targetAgeMin: 18, targetAgeMax: 34,
    targetCountry: 'Indonesia', targetCity: top(dist.city), audienceInterests: interests,
  })
  console.log(`  Brand Profile (test, not saved): ${JSON.stringify(req)}`)

  const enough = (d: Record<string, number>) => known(d) >= AUDIENCE_MIN_KNOWN
  const expect = {
    audience_gender: enough({ f: (dist.gender.female ?? 0) + (dist.gender.male ?? 0) })
      ? (dist.gender.female ?? 0) / ((dist.gender.female ?? 0) + (dist.gender.male ?? 0)) * 100 : null,
    audience_age: (() => {
      const k = Object.entries(dist.age).filter(([b]) => b !== 'unknown')
      const n = k.reduce((s, [, v]) => s + v, 0)
      return n >= AUDIENCE_MIN_KNOWN ? k.reduce((s, [b, v]) => s + v * ageBucketOverlap(b, 18, 34), 0) / n * 100 : null
    })(),
    audience_country: enough(dist.country) ? (dist.country.ID ?? 0) / known(dist.country) * 100 : null,
    audience_city: enough(dist.city) ? (dist.city[req.targetCity!] ?? 0) / known(dist.city) * 100 : null,
    audience_interest: enough(dist.interest)
      ? interests.reduce((s, k) => s + (dist.interest[k] ?? 0), 0) / known(dist.interest) * 100 : null,
  }

  const recs = await audienceRecordsFor([pick.id])
  const got = audienceScores(recs.get(pick.id), req)
  for (const k of AUDIENCE_CRITERIA) {
    check(`${k}: code ${got[k]?.toFixed?.(2) ?? 'null'} = hand-computed from DB ${expect[k]?.toFixed(2) ?? 'null'}`,
      near(got[k] ?? null, expect[k]))
  }

  const bm = await brandMatchForDirectory([pick.id], ['strong_engagement'], req)
  const row = bm.rows[pick.id]
  const eng = row?.breakdown.find(b => b.key === 'strong_engagement')?.score ?? null
  const parts = [eng, ...AUDIENCE_CRITERIA.map(k => expect[k])].filter((v): v is number => v !== null)
  const want = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
  console.log(`  breakdown: ${row?.breakdown.map(b => `${b.key}=${b.score === null ? 'null' : b.score.toFixed(2)}`).join(', ')}`)
  console.log(`  Match % = ${row?.matchPct === null ? 'null' : row?.matchPct?.toFixed(2)} (contributing ${row?.contributing}/${row?.selected})`)
  check('Match % present (not null) and = mean of engagement + measured audience criteria',
    row !== undefined && row.matchPct !== null && near(row.matchPct, want), `${row?.matchPct} vs ${want}`)
  check('unmeasured audience criteria stay out of the denominator',
    row !== undefined && row.contributing === parts.length && row.selected === 1 + selectedAudienceCriteria(req).length)
  check('directory payload lists the selected audience criteria',
    (bm.audienceCriteria ?? []).join() === selectedAudienceCriteria(req).join())

  // The single-follower age case, and a creator with no audience rows at all.
  const { rows: [ageOne] } = await db.query<{ id: string; username: string }>(`
    SELECT s.kol_id::text id, kd.username FROM l2_gold.audience_demographics_daily a
      JOIN public.kol_social_account s ON s.social_account_id = a.social_account_id
      JOIN public.kol_directory kd ON kd.id = s.kol_id
     WHERE a.audience_type = 'age' AND a.dimension_key <> 'unknown' AND a.audience_count > 0 LIMIT 1`)
  if (ageOne) {
    const ar = await audienceRecordsFor([ageOne.id])
    const s = audienceScores(ar.get(ageOne.id), REQ({ targetAgeMin: 18, targetAgeMax: 24 }))
    check(`@${ageOne.username}: known ages ${JSON.stringify(ar.get(ageOne.id)?.age)} → age score null, not 100`,
      s.audience_age === null)
  }
  const { rows: [none] } = await db.query<{ id: string }>(`
    SELECT kd.id::text FROM public.kol_directory kd JOIN public.kol_social_account s ON s.kol_id = kd.id
     WHERE kd.directory_status = 'active'
       AND NOT EXISTS (SELECT 1 FROM l2_gold.audience_demographics_daily a WHERE a.social_account_id = s.social_account_id)
     ORDER BY kd.id LIMIT 1`)
  const nb = await brandMatchForDirectory([none.id], [], req)
  check('creator with no Audience Analysis rows: audience-only Match % is null (no_scores), never invented',
    nb.rows[none.id]?.matchPct === null && nb.rows[none.id]?.unavailable === 'no_scores')
}

async function main() {
  inMemory()
  if (!offline) await live()
  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
