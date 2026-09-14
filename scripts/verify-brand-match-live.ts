/**
 * Verifies the whole Brand Match flow against the real databases.
 *
 *   npm run verify:brand-match
 *
 *     Brand Profile → Save → Database → Brand Match Engine
 *       → public.kol_directory → Real Match Score → Match Status
 *
 * REQUIRES the office VPN: every assertion reads the KOL server through
 * `@/lib/kolDb`, and the profile round-trips through the warehouse.
 *
 * ── What this is actually checking ─────────────────────────────────────────
 * Not "does a number appear". A hardcoded 98 would pass that. It checks that
 * the number MOVES for the right reasons and STOPS for the right reasons:
 *
 *   * a saved profile survives a re-read (so the directory sees it immediately)
 *   * scores come from real `public.kol_directory` rows, by id
 *   * changing the brand's category re-ranks the same creators
 *   * an unscoreable profile yields NO scores rather than zeros
 *   * unmeasured creators carry N/A components, not 0
 *   * every score is reproducible — same inputs, same number, twice
 *   * the distribution is not a constant, and not the prototype's 98/94
 *
 * It writes to `discover_brand_profiles` for one organization and restores the
 * previous row when it finishes, so running it does not leave a workspace
 * configured by a test.
 */
import pool from '@/lib/db'
// The Brand Profile moved to the KOL server (`migrations/kol/001`). The org
// lookup below still reads `public.organizations`, which only exists on the
// warehouse — that is this harness picking a realistic id, not the feature
// reaching across. Every read and write of the PROFILE goes to `kol`.
import { kolDbWrite } from '@/lib/kolDb'
import { listKolDirectory } from '@/lib/discover/kolDirectory'
import {
  getBrandProfile, isScoreable, matchCreators, saveBrandProfile, score,
  scoringRecordsFor, toScoringBrand, NA, type BrandProfile,
} from '@/lib/discover/brandMatch'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const BANDS = ['Excellent Match', 'Strong Match', 'Good Match', 'Moderate Match', 'Low Match', 'Not Scored']

;(async () => {
  /* ── pick a real organization ───────────────────────────────────────────── */

  const { rows: orgs } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1')
  if (!orgs.length) {
    console.error('no organization in the warehouse — cannot verify.')
    process.exit(1)
  }
  const org = orgs[0]
  console.log(`organization: ${org.name} (${org.id})\n`)

  const before = await getBrandProfile(org.id)
  const hadRow = before.updatedAt !== null

  try {
    /* ── 1. save → database → read back ───────────────────────────────────── */

    console.log('brand profile persistence')
    const saved = await saveBrandProfile(org.id, {
      brandName: 'Verification Brand',
      brandDescription: 'A beauty brand, written by verify-brand-match-live.',
      brandCategory: 'Beauty',
      brandPersonality: ['Confident', 'Warm'],
      brandKeywords: ['skincare', 'glowing', 'serum'],
      brandHashtags: ['#skincare', 'glowup'],
      captionTerms: ['skincare', 'makeup'],
      genderMajority: 'Female',
      targetCountry: 'Indonesia',
      targetCity: 'Jakarta',
      audienceInterests: ['beauty', 'fashion'],
      preferredCategories: ['Beauty', 'Lifestyle'],
      preferredPlatforms: ['instagram'],
      preferredTiers: ['Micro', 'Mid-tier'],
      minFollowers: 10_000,
      requireCategory: true,
    }, null)

    const reread = await getBrandProfile(org.id)
    ok('profile persists across a fresh read', reread.brandCategory === 'Beauty'
      && reread.brandKeywords.join(',') === 'skincare,glowing,serum')
    ok('hashtags are normalised without the leading #',
      reread.brandHashtags.every(h => !h.startsWith('#')), reread.brandHashtags.join(' '))
    ok('gender majority round-trips', reread.genderMajority === 'Female')
    ok('ideal creator profile round-trips',
      reread.preferredTiers.join(',') === 'Micro,Mid-tier' && reread.minFollowers === 10_000)
    ok('profile is scoreable', isScoreable(reread))
    ok('a non-canonical category is rejected',
      await saveBrandProfile(org.id, { brandCategory: 'Sportswear' }, null)
        .then(() => false).catch(() => true))

    /* ── 2. real creators out of public.kol_directory ─────────────────────── */

    console.log('\nreal creator records')
    // Deliberately the creators most likely to carry signal, so the components
    // being exercised are the ones the database can actually answer.
    const page = await listKolDirectory({ minErPct: 0.01, pageSize: 40, sort: 'followers', dir: 'desc' })
    ok('directory returned real rows', page.rows.length > 0, `${page.rows.length} of ${page.total}`)

    const ids = page.rows.map(r => r.id)
    const records = await scoringRecordsFor(ids)
    ok('every row has a scoring record', records.size === ids.length,
      `${records.size}/${ids.length}`)
    ok('records carry the roster identity', [...records.values()].every(r => !!r.handle))

    const withEr = [...records.values()].filter(r => r.er !== null).length
    const withAud = [...records.values()].filter(r => r.audienceQuality !== null).length
    const withCat = [...records.values()].filter(r => r.category !== null).length
    console.log(`        coverage on this page — category ${withCat}, ER ${withEr}, audience analysis ${withAud}`)

    /* ── 3. the engine ────────────────────────────────────────────────────── */

    console.log('\nbrand match engine')
    const run1 = await matchCreators(org.id, ids)
    ok('engine scored the page', run1.matches.size === ids.length,
      `${run1.matches.size} scored`)

    const scores = [...run1.matches.values()]
    const numeric = scores.map(m => m.score).filter((v): v is number => v !== null)
    ok('scores are real numbers in range', numeric.length > 0
      && numeric.every(v => v >= 0 && v <= 100))
    ok('every status is one of the engine bands',
      scores.every(m => BANDS.includes(m.level)))

    const distinct = new Set(numeric)
    ok('the score is not a constant', distinct.size > 1,
      `${distinct.size} distinct values across ${numeric.length} creators`)
    ok('no prototype placeholder scores dominate',
      !(numeric.filter(v => v === 98 || v === 94).length > numeric.length / 2))

    const lo = Math.min(...numeric); const hi = Math.max(...numeric)
    console.log(`        range ${lo}–${hi}, ${distinct.size} distinct`)
    for (const band of BANDS) {
      const n = scores.filter(m => m.level === band).length
      if (n) console.log(`        ${band.padEnd(16)} ${n}`)
    }

    /* ── 4. determinism ───────────────────────────────────────────────────── */

    console.log('\ndeterminism')
    const run2 = await matchCreators(org.id, ids)
    const same = ids.every(id =>
      run1.matches.get(id)?.score === run2.matches.get(id)?.score
      && run1.matches.get(id)?.level === run2.matches.get(id)?.level)
    ok('the same inputs produce the same score twice', same)

    /* ── 5. N/A is not zero ───────────────────────────────────────────────── */

    console.log('\nmissing data stays missing')
    const brand = toScoringBrand(reread)
    const rawScores = ids.map(id => {
      const rec = records.get(id)
      return rec ? score(rec, brand) : null
    }).filter((x): x is NonNullable<typeof x> => !!x)

    const unmeasuredAudience = rawScores.filter(s => s.audienceScore === NA)
    ok('unmeasured audience is N/A, never 0', unmeasuredAudience.length > 0
      && !rawScores.some(s => s.audienceScore === 0 && s.interestScore === NA),
      `${unmeasuredAudience.length}/${rawScores.length} have no audience analysis`)
    ok('age is N/A for everyone — no age column exists on this server',
      rawScores.every(s => s.ageScore === NA))
    ok('personality is N/A for everyone — no creator-personality column exists',
      rawScores.every(s => s.personalityScore === NA))
    ok('available weight is below 100 where components are missing',
      rawScores.some(s => s.availableWeight < 100),
      `min ${Math.min(...rawScores.map(s => s.availableWeight))}%`)
    ok('a partial score still reports which dimensions are unmeasured',
      scores.some(m => m.signals.some(s => s.pct === null && !!s.unavailable)))

    /* ── 6. the profile actually drives the score ─────────────────────────── */

    console.log('\nthe profile drives the score')
    await saveBrandProfile(org.id, { brandCategory: 'Tech', audienceInterests: ['technology', 'gaming'] }, null)
    const techRun = await matchCreators(org.id, ids)
    const moved = ids.filter(id =>
      techRun.matches.get(id)?.score !== run1.matches.get(id)?.score)
    ok('changing the brand category re-ranks the same creators', moved.length > 0,
      `${moved.length}/${ids.length} scores changed Beauty → Tech`)

    const beautyTop = [...run1.matches.entries()].sort((a, b) => (b[1].score ?? -1) - (a[1].score ?? -1))[0]
    const techTop = [...techRun.matches.entries()].sort((a, b) => (b[1].score ?? -1) - (a[1].score ?? -1))[0]
    const nameOf = (id: string) => page.rows.find(r => r.id === id)?.username ?? id
    console.log(`        Beauty top: @${nameOf(beautyTop[0])} ${beautyTop[1].score} (${beautyTop[1].level})`)
    console.log(`        Tech   top: @${nameOf(techTop[0])} ${techTop[1].score} (${techTop[1].level})`)

    /* ── 7. no profile means no score ─────────────────────────────────────── */

    console.log('\nan unstated brand gets no score')
    await kolDbWrite().query('DELETE FROM public.brand_profile WHERE organization_id = $1', [org.id])
    const blank = await matchCreators(org.id, ids)
    ok('no saved profile yields no matches at all', blank.matches.size === 0)
    ok('and says so rather than returning zeros', blank.scoreable === false)

    /* ── 8. the explanation names dimensions, never weights ───────────────── */

    console.log('\nexplanation hygiene')
    const texts = scores.map(m => m.summary.toLowerCase())
    const leaks = texts.filter(t => /weight|bobot|\bw_[a-z]/.test(t))
    ok('no explanation exposes a scoring weight', leaks.length === 0,
      leaks[0] ?? '')
    // Four bars, not the engine's six components: Category Matching folds
    // Brand & Business with Content & Category, and Past Performance folds
    // Performance Quality with Brand Safety. The fold is presentation only —
    // the Final Match Score is still computed from the six.
    ok('explanations name the four creator-facing bars',
      scores.some(m => m.signals.length === 4))
    ok('the bars are the four the product states',
      scores.every(m => m.signals.map(s => s.id).join(',')
        === 'category,audience,values,performance'),
      scores[0]?.signals.map(s => s.id).join(',') ?? '')
    console.log(`        e.g. ${scores.find(m => m.score !== null)?.summary}`)
  } finally {
    /* ── restore ──────────────────────────────────────────────────────────── */
    await kolDbWrite().query('DELETE FROM public.brand_profile WHERE organization_id = $1', [org.id])
    if (hadRow) await restore(before)
    console.log(`\nrestored the organization's previous brand profile state (${hadRow ? 'row re-saved' : 'no row, as before'}).`)
  }

  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll brand match checks passed.')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error('\nverification could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})

/** Puts back exactly what was there, field for field. */
async function restore(p: BrandProfile): Promise<void> {
  await saveBrandProfile(p.organizationId, {
    brandId: p.brandId, brandName: p.brandName, brandDescription: p.brandDescription,
    brandCategory: p.brandCategory, brandPersonality: p.brandPersonality,
    brandKeywords: p.brandKeywords, brandHashtags: p.brandHashtags,
    captionTerms: p.captionTerms, genderMajority: p.genderMajority,
    targetCountry: p.targetCountry, targetCity: p.targetCity,
    audienceInterests: p.audienceInterests, preferredCategories: p.preferredCategories,
    preferredPlatforms: p.preferredPlatforms, preferredTiers: p.preferredTiers,
    contentStyles: p.contentStyles, minFollowers: p.minFollowers, minErPct: p.minErPct,
    requireCategory: p.requireCategory, verifiedOnly: p.verifiedOnly,
  }, null)
}
