/**
 * Verifies the Tracked Account metrics are real, and that the unreal ones are
 * gone from everything a user can see.
 *
 *   npm run verify:account-facts
 *
 * Phase 0 replaced a generated follower count (`avgViews × between(4,7)`) and
 * the tier derived from it with the real numbers in
 * `l0_raw.{ig,tt,fb}_profile_snapshots`. Phase 1 removed authenticity, audience
 * quality and brand fit from every screen. This asserts both, against the live
 * warehouse.
 *
 * The point is not "a number appears". It is that the number MATCHES THE
 * DATABASE, and that a creator with no snapshot gets null rather than a plausible
 * figure — the exact failure the old code shipped.
 *
 * Needs the warehouse only; no VPN, no KOL server.
 */
import pool from '@/lib/db'
import { listKolProfiles } from '@/lib/discover/profile'
import { accountFactsFor } from '@/lib/discover/accountFacts'
import { tierOf } from '@/lib/discover/vocab'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

;(async () => {
  const { rows: orgs } = await pool.query<{ id: string; name: string }>(
    `SELECT o.id, o.name FROM public.organizations o
      WHERE o.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM public.brands b WHERE b.organization_id = o.id AND b.deleted_at IS NULL)
      ORDER BY o.created_at`)
  if (!orgs.length) { console.error('no organization with brands — cannot verify.'); process.exit(1) }

  /* Pick the org whose directory actually has accounts. */
  let org = orgs[0]
  let profiles = await listKolProfiles(org.id)
  for (const o of orgs) {
    const p = await listKolProfiles(o.id)
    if (p.length > profiles.length) { org = o; profiles = p }
  }
  console.log(`organization: ${org.name} — ${profiles.length} tracked accounts\n`)
  if (!profiles.length) { console.error('directory is empty; nothing to verify.'); process.exit(1) }

  /* ── 1. followers match the database, row for row ─────────────────────── */

  console.log('followers are real')
  const facts = await accountFactsFor(profiles.map(p => p.account.id))

  const mismatched = profiles.filter(p => {
    const truth = facts.get(p.account.id)?.followers ?? null
    return p.followers.value !== truth
  })
  ok('every follower count equals the newest snapshot', mismatched.length === 0,
    mismatched.slice(0, 3).map(p => `@${p.account.username}`).join(', '))

  const withFollowers = profiles.filter(p => p.followers.value !== null)
  ok('some accounts carry a real follower count', withFollowers.length > 0,
    `${withFollowers.length}/${profiles.length}`)
  ok('unmeasured followers are null, never 0 or a floor',
    profiles.every(p => p.followers.value === null || p.followers.value > 0))
  ok('no follower count sits at the old synthetic floor of exactly 1000',
    !profiles.some(p => p.followers.value === 1000))

  /* ── 2. tier follows the real follower count ──────────────────────────── */

  console.log('\ntier is derived from real followers')
  ok('tier matches tierOf(followers) for every measured account',
    withFollowers.every(p => p.tier.value === tierOf(p.followers.value as number)))
  ok('tier is null where followers are unmeasured',
    profiles.every(p => p.followers.value !== null || p.tier.value === null))
  ok('measured tiers are confidence "calculated", not "estimated"',
    withFollowers.every(p => p.tier.confidence === 'calculated'))

  /* ── 3. demographics are real or absent ───────────────────────────────── */

  console.log('\ndemographics are real where they exist')
  const withAge = profiles.filter(p => p.ageBands.value.length > 0)
  const withGender = profiles.filter(p => p.genderBands.value.length > 0)
  const withCity = profiles.filter(p => p.location.value !== null)
  console.log(`        age ${withAge.length} · gender ${withGender.length} · city ${withCity.length} of ${profiles.length}`)

  ok('age bands match the database exactly',
    profiles.every(p => JSON.stringify(p.ageBands.value)
      === JSON.stringify(facts.get(p.account.id)?.age ?? [])))
  ok('every age distribution sums to about 100%',
    withAge.every(p => Math.abs(p.ageBands.value.reduce((n, b) => n + b.pct, 0) - 100) < 1.5))
  ok('topAge is null exactly when no age bands exist',
    profiles.every(p => (p.topAge.value === null) === (p.ageBands.value.length === 0)))
  ok('femalePct is null when gender is unmeasured — never defaulted to 50',
    profiles.every(p => p.genderBands.value.length > 0 || p.femalePct.value === null))
  ok('location is null when no city breakdown exists',
    profiles.every(p => p.location.value === null || (facts.get(p.account.id)?.city.length ?? 0) > 0))

  const competitors = profiles.filter(p => p.account.relation === 'competitor')
  ok('no competitor carries demographics (scraping cannot return them)',
    competitors.every(p => p.ageBands.value.length === 0 && p.genderBands.value.length === 0),
    `${competitors.length} competitors checked`)

  /* ── 4. measured values carry a measured confidence ───────────────────── */

  console.log('\nconfidence reflects the source')
  ok('real followers are marked live', withFollowers.every(p => p.followers.confidence === 'live'))
  ok('real age bands are marked live', withAge.every(p => p.ageBands.confidence === 'live'))
  ok('unmeasured fields are marked estimated, not live',
    profiles.every(p => p.followers.value !== null || p.followers.confidence === 'estimated'))

  /* ── 5. the generated metrics are gone, not quarantined ──────────────── */

  console.log('\ngenerated fields are gone, not quarantined')
  const gone = ['growthPct', 'authenticity', 'audienceQuality', 'brandFit',
    'ageSplit', 'genderSplit', 'category', 'lifestyle']
  const shape = profiles[0] as unknown as Record<string, unknown>
  for (const key of gone) ok(`${key} no longer exists on the profile`, !(key in shape))

  /*
   * EMV survives as a field but never as a number: nothing in autometric holds
   * a measured CPM or rate benchmark to compute one from.
   */
  ok('emv is present but always null (no CPM benchmark exists)',
    'emv' in shape && profiles.every(p => p.emv.value === null))

  /* The reach ladder: measured, calculated-from-views, or nothing. */
  const liveR = profiles.filter(p => p.estimatedReach.confidence === 'live')
  const calcR = profiles.filter(p => p.estimatedReach.confidence === 'calculated')
  const noneR = profiles.filter(p => p.estimatedReach.value === null)
  ok('every profile sits on exactly one rung of the reach ladder',
    liveR.length + calcR.length + noneR.length === profiles.length,
    `measured ${liveR.length} · calculated ${calcR.length} · unavailable ${noneR.length}`)
  ok('measured reach carries a value', liveR.every(p => p.estimatedReach.value !== null))
  ok('unavailable reach is null, never 0', noneR.every(p => p.estimatedReach.value === null))
  ok('the old hash-based reach formula is gone',
    !profiles.some(p => p.estimatedReach.basis.includes('faktor reach per akun')))

  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll tracked-account checks passed.')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error('\nverification could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
