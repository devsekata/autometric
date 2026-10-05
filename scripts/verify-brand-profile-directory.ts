/**
 * Brand Profile → KOL Directory eligibility: Gender + Platform + Tier + Category.
 *
 *   npm run verify:brand-profile-directory
 *
 * Runs the real Brand Profile PUT and the real Directory GET inside ONE
 * transaction that is always rolled back (same stubs as
 * verify:brand-profile-kol), so no saved Brand Profile is changed. Every
 * expected count is computed here in SQL straight from the source tables —
 * kol_profile_card.creator_gender, platforms.key, kol_tiers, kol_categories —
 * not through the Directory query it checks.
 *
 *   1. each criterion alone: total = database count
 *   2. Female AND Instagram AND Mid-tier AND Beauty: every row meets all four,
 *      total = database count; several values in one field match any of them
 *   3. manual Directory filters still apply, AND-ed with the profile
 *   4. `?ids=` returns exactly the ids asked for, profile ignored
 *   5. a request without brandProfile=1 (DiscoverHub shelves) is unfiltered
 *   6. Match % for the same creators is identical under a full and an empty
 *      profile with the same What Matters
 *   7. My Creators (scope=mine) follows the profile
 *   8. static: only the main Directory list sends brandProfile=1
 *   9. rollback: brand_profile, brand_match_result and brand_match_state unchanged
 */
import { readFileSync } from 'node:fs'
import { Pool, type PoolClient } from 'pg'
import { NextRequest } from 'next/server'
import { setSession } from './verify-brand-profile-kol/stubs/auth'
import { bindClient } from './verify-brand-profile-kol/stubs/kolDb'
import { PUT } from '@/app/api/organizations/[id]/discover/brand-profile/route'
import { GET as DIRECTORY } from '@/app/api/organizations/[id]/discover/kol-directory/route'
import { getBrandProfile } from '@/lib/discover/brandMatch/profile'
import { WHAT_MATTERS_KEYS } from '@/lib/discover/whatMatters/brandMatch'
import {
  audienceRecordsFor, audienceScores, selectedAudienceCriteria,
} from '@/lib/discover/whatMatters/audienceMatch'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
type Row = { id: string }
type Payload = {
  rows: Row[]; total: number
  brandMatch?: { rows: Record<string, { matchPct: number | null; breakdown: { key: string; score: number | null }[] }> }
}

async function directory(orgId: string, qs: string): Promise<Payload> {
  const res = await DIRECTORY(new NextRequest(
    `http://localhost/api/organizations/${orgId}/discover/kol-directory?${qs}`), params(orgId))
  if (res.status !== 200) throw new Error(`GET ${qs} → ${res.status} ${JSON.stringify(await res.json())}`)
  return res.json() as Promise<Payload>
}
const total = async (orgId: string, qs: string) => (await directory(orgId, `${qs}&pageSize=1`)).total

/** Every id the filtered list returns, all pages. */
async function allIds(orgId: string, qs: string): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = []
  let t = 0
  for (let page = 1; ; page++) {
    const d = await directory(orgId, `${qs}&pageSize=60&page=${page}`)
    t = d.total
    ids.push(...d.rows.map(r => r.id))
    if (!d.rows.length || ids.length >= d.total) break
  }
  return { ids, total: t }
}

/** The four eligibility fields, plus anything else the caller sets. Unset = cleared. */
interface Profile {
  genderMajority?: string
  preferredPlatforms?: string[]
  preferredTiers?: string[]
  preferredCategories?: string[]
  whatMatters?: string[]
}
async function setProfile(orgId: string, p: Profile) {
  const body = {
    genderMajority: 'Any', preferredPlatforms: [], preferredTiers: [], preferredCategories: [], ...p,
  }
  const res = await PUT(new NextRequest(`http://localhost/api/organizations/${orgId}/discover/brand-profile`, {
    method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), params(orgId))
  if (res.status !== 200) throw new Error(`PUT ${JSON.stringify(body)} → ${res.status} ${JSON.stringify(await res.json())}`)
}

/**
 * The creator-side facts, per active creator, from the source tables. Gender
 * from the same card the Directory picks (largest account); tier from the
 * kol_tiers band; categories by taxonomy key, falling back to the name.
 */
const FACTS = `
  SELECT kd.id::text AS id, pl.key AS platform, t.name AS tier, g.creator_gender AS gender,
         (SELECT ARRAY_AGG(DISTINCT COALESCE(kc.taxonomy_key, kc.name))::text[]
            FROM public.kol_categories kc
           WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))) AS cats,
         kd.followers_count AS followers
    FROM public.kol_directory kd
    LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
    LEFT JOIN public.kol_tiers t
           ON kd.followers_count >= t.min_followers
          AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)
    LEFT JOIN LATERAL (
      SELECT c.creator_gender FROM public.kol_social_account ksa
        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
       WHERE ksa.kol_id = kd.id ORDER BY c.followers_count DESC NULLS LAST LIMIT 1) g ON TRUE
   WHERE kd.directory_status = 'active'`

interface Facts { id: string; platform: string | null; tier: string | null; gender: string | null; cats: string[] | null; followers: number | null }

async function expected(db: PoolClient | Pool, where: string, args: unknown[] = []): Promise<number> {
  const { rows: [r] } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM (${FACTS}) f WHERE ${where}`, args)
  return r.n
}

/** Fingerprint of a table, for the rollback check. */
async function fingerprint(pool: Pool, table: string): Promise<string> {
  const { rows: [r] } = await pool.query<{ v: string }>(
    `SELECT count(*) || ':' || coalesce(md5(string_agg(t::text, ',' ORDER BY t::text)), '') AS v FROM ${table} t`)
  return r.v
}

;(async () => {
  const pool = new Pool({
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
    max: 2, connectionTimeoutMillis: 8_000,
  })

  const tables = ['public.brand_profile', 'public.brand_match_result', 'public.brand_match_state']
  const before = await Promise.all(tables.map(t => fingerprint(pool, t)))

  // The ADMIN agency holding the most active My Creators links, so scope=mine
  // has something to filter.
  const { rows: [A] } = await pool.query<{ agency_id: string; user_id: string; mine: number }>(`
    SELECT am.agency_id::text, am.user_id::text,
           (SELECT count(*)::int FROM public.agency_kol_accounts k
             WHERE k.agency_id = am.agency_id AND k.is_active IS TRUE) mine
      FROM public.agency_members am
      JOIN public.agencies a ON a.id = am.agency_id AND a.deleted_at IS NULL
     WHERE am.role = 'ADMIN' AND am.status = 'ACTIVE'
     ORDER BY mine DESC, am.agency_id LIMIT 1`)
  const active = await expected(pool, 'TRUE')
  console.log(`agency ${A.agency_id} (${A.mine} My Creators links), active roster ${active}`)

  const client = await pool.connect()
  bindClient(client)
  try {
    await client.query('BEGIN')
    setSession(A.user_id)
    const org = A.agency_id

    console.log('\n1. each criterion alone')
    const singles: [string, Profile, string][] = [
      ['Gender=Female', { genderMajority: 'Female' }, `gender = 'female'`],
      ['Gender=Male', { genderMajority: 'Male' }, `gender = 'male'`],
      ['Platform=Instagram', { preferredPlatforms: ['instagram'] }, `platform = 'instagram'`],
      ['Tier=Mid-tier', { preferredTiers: ['Mid-tier'] }, `tier = 'Mid-tier'`],
      ['Category=Beauty', { preferredCategories: ['Beauty'] }, `'Beauty' = ANY (cats)`],
    ]
    for (const [label, p, where] of singles) {
      await setProfile(org, p)
      const got = await total(org, 'brandProfile=1')
      const exp = await expected(client, where)
      ok(`${label}: total = database count, < active roster`, got === exp && got < active, `${got} vs ${exp}`)
    }
    await setProfile(org, {})
    ok('empty profile (Any, no lists): nothing filtered', await total(org, 'brandProfile=1') === active)

    console.log('\n2. Female AND Instagram AND Mid-tier AND Beauty')
    const full: Profile = {
      genderMajority: 'Female', preferredPlatforms: ['instagram'],
      preferredTiers: ['Mid-tier'], preferredCategories: ['Beauty'],
    }
    const fullWhere = `gender = 'female' AND platform = 'instagram' AND tier = 'Mid-tier' AND 'Beauty' = ANY (cats)`
    await setProfile(org, full)
    const combo = await allIds(org, 'brandProfile=1&sort=followers&dir=desc')
    const comboExp = await expected(client, fullWhere)
    ok('total = database count of all four together, no duplicates',
      combo.total === comboExp && combo.ids.length === combo.total && new Set(combo.ids).size === combo.ids.length,
      `total=${combo.total} expected=${comboExp}`)
    const { rows: facts } = await client.query<Facts>(`SELECT * FROM (${FACTS}) f WHERE id = ANY ($1)`, [combo.ids])
    ok('every row is Female AND Instagram AND Mid-tier AND Beauty', facts.length === combo.ids.length && facts.every(f =>
      f.gender === 'female' && f.platform === 'instagram' && f.tier === 'Mid-tier' && (f.cats ?? []).includes('Beauty')),
    `${facts.length} rows checked`)
    const orEach = await expected(client,
      `gender = 'female' OR platform = 'instagram' OR tier = 'Mid-tier' OR 'Beauty' = ANY (cats)`)
    ok('AND, not OR: combined total is below the OR of the four', combo.total < orEach, `${combo.total} < ${orEach}`)

    await setProfile(org, { ...full, preferredTiers: ['Micro', 'Mid-tier'], preferredCategories: ['Beauty', 'Fashion'] })
    const multi = await total(org, 'brandProfile=1')
    const multiExp = await expected(client, `gender = 'female' AND platform = 'instagram'
      AND tier = ANY (ARRAY['Micro','Mid-tier']) AND cats && ARRAY['Beauty','Fashion']`)
    ok('several values in one field match any of them (Micro|Mid-tier, Beauty|Fashion)',
      multi === multiExp && multi >= combo.total, `${multi} vs ${multiExp}`)

    console.log('\n3. manual Directory filters still apply, AND-ed with the profile')
    await setProfile(org, full)
    const manual: [string, string, string][] = [
      ['follMin=100000', 'follMin=100000', `${fullWhere} AND followers >= 100000`],
      ['tier=Micro (conflicts with profile Mid-tier)', 'tier=Micro', 'FALSE'],
      ['platform=tiktok (conflicts with profile Instagram)', 'platform=tiktok', 'FALSE'],
      ['category=Beauty (same as profile)', 'category=Beauty', fullWhere],
    ]
    for (const [label, qs, where] of manual) {
      const got = await total(org, `brandProfile=1&${qs}`)
      const exp = await expected(client, where)
      ok(`profile + ${label}`, got === exp, `${got} vs ${exp}`)
    }
    const noProfileManual = await total(org, 'tier=Micro')
    ok('manual tier=Micro alone (no brandProfile=1) is unaffected by the profile',
      noProfileManual === await expected(client, `tier = 'Micro'`), `${noProfileManual}`)

    console.log('\n4. ?ids= ignores the profile')
    // Two creators failing each criterion: not female (or unknown), not
    // Instagram, not Mid-tier, not Beauty (or no category).
    const { rows: outside } = await client.query<{ id: string }>(`
      (SELECT id FROM (${FACTS}) f WHERE gender IS DISTINCT FROM 'female' ORDER BY id LIMIT 2)
      UNION ALL (SELECT id FROM (${FACTS}) f WHERE platform IS DISTINCT FROM 'instagram' ORDER BY id LIMIT 2)
      UNION ALL (SELECT id FROM (${FACTS}) f WHERE tier IS DISTINCT FROM 'Mid-tier' ORDER BY id DESC LIMIT 2)
      UNION ALL (SELECT id FROM (${FACTS}) f WHERE NOT coalesce('Beauty' = ANY (cats), false) ORDER BY followers DESC NULLS LAST LIMIT 2)`)
    const probeIds = [...outside.map(o => o.id), ...combo.ids.slice(0, 2)]
    const byIds = await directory(org, `ids=${probeIds.join(',')}&brandProfile=1`)
    ok('?ids= with creators failing the profile returns every id asked for',
      byIds.rows.length === probeIds.length && probeIds.every(id => byIds.rows.some(r => r.id === id)),
      `${byIds.rows.length}/${probeIds.length}`)

    console.log('\n5. requests without brandProfile=1 are unfiltered')
    ok('plain list (SmartDiscovery-style) = active roster', await total(org, 'sort=followers&dir=desc') === active)
    for (const qs of ['sort=recent&dir=desc', 'sort=followers&dir=desc', 'sort=created&dir=desc']) {
      const t = await total(org, qs)
      ok(`DiscoverHub shelf query "${qs}" = active roster`, t === active, `${t}`)
    }

    console.log('\n6. Match %: eligibility filters never touch it; Target Audience adds its criteria')
    const probe = [...combo.ids.slice(0, 4), ...outside.map(o => o.id)]
    const wm = ['strong_engagement', 'high_reach']
    const pct = (p: Payload, id: string) => p.brandMatch?.rows[id]?.matchPct ?? null
    await setProfile(org, { preferredPlatforms: ['instagram'], preferredTiers: ['Mid-tier'],
      preferredCategories: ['Beauty'], whatMatters: wm })
    const mFilters = await directory(org, `ids=${probe.join(',')}&match=1`)
    const pFilters = await getBrandProfile(org)
    await setProfile(org, { whatMatters: wm })
    const mEmpty = await directory(org, `ids=${probe.join(',')}&match=1`)
    const pEmpty = await getBrandProfile(org)
    const scored = probe.filter(id => typeof pct(mEmpty, id) === 'number').length
    ok('platform / tier / category filters alone → identical Match % (they are eligibility, not scoring)',
      selectedAudienceCriteria(pFilters).join() === selectedAudienceCriteria(pEmpty).join()
      && probe.every(id => pct(mFilters, id) === pct(mEmpty, id)) && scored > 0,
      probe.map(id => pct(mEmpty, id) ?? 'null').join(' '))

    // `full` sets genderMajority Female: that selects the Audience Gender
    // criterion, scored from the Audience Analysis L2 — never creator_gender.
    await setProfile(org, { ...full, whatMatters: wm })
    const mFull = await directory(org, `ids=${probe.join(',')}&match=1`)
    const pFull = await getBrandProfile(org)
    const recs = await audienceRecordsFor(probe)
    const wmKeys = new Set<string>(WHAT_MATTERS_KEYS)
    const bd = (p: Payload, id: string) => p.brandMatch?.rows[id]?.breakdown ?? []
    const expectFull = (id: string) => {
      const aud = audienceScores(recs.get(id), pFull)
      const vals = [
        ...bd(mEmpty, id).filter(b => wmKeys.has(b.key)).map(b => b.score),
        ...selectedAudienceCriteria(pFull).map(k => aud[k] ?? null),
      ].filter((v): v is number => v !== null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    const close = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9)
    ok('full profile → What Matters scores unchanged, plus Audience Gender from Audience Analysis',
      selectedAudienceCriteria(pFull).includes('audience_gender')
      && probe.every(id => close(pct(mFull, id), expectFull(id))
        && JSON.stringify(bd(mFull, id).filter(b => wmKeys.has(b.key)))
          === JSON.stringify(bd(mEmpty, id).filter(b => wmKeys.has(b.key)))),
      probe.map(id => `${pct(mFull, id) ?? 'null'}≟${expectFull(id) ?? 'null'}`).join(' '))

    console.log('\n7. My Creators follows the profile')
    const mineWhere = `id IN (SELECT kol_account_id::text FROM public.agency_kol_accounts
                               WHERE agency_id = $1 AND is_active IS TRUE)`
    await setProfile(org, {})
    const mineAll = await total(org, 'scope=mine&brandProfile=1')
    ok('empty profile: scope=mine = every active link', mineAll === await expected(client, mineWhere, [org]), `${mineAll}`)
    // Platform of the agency's own creators, so the filter has something to cut.
    const { rows: [pick] } = await client.query<{ platform: string }>(
      `SELECT platform FROM (${FACTS}) f WHERE ${mineWhere} AND platform IS NOT NULL
        GROUP BY 1 ORDER BY count(*) ASC LIMIT 1`, [org])
    if (!pick) ok('agency has My Creators with a platform to filter on', false)
    else {
      await setProfile(org, { preferredPlatforms: [pick.platform] })
      const mine = await allIds(org, 'scope=mine&brandProfile=1')
      const exp = await expected(client, `${mineWhere} AND platform = $2`, [org, pick.platform])
      ok(`profile Platform=${pick.platform}: scope=mine = own creators on ${pick.platform}`,
        mine.total === exp && mine.total <= mineAll, `${mine.total} vs ${exp} (of ${mineAll})`)
      await setProfile(org, full)
      const mineFull = await total(org, 'scope=mine&brandProfile=1')
      const mineFullExp = await expected(client, `${mineWhere} AND ${fullWhere}`, [org])
      ok('full profile: scope=mine = own creators meeting all four', mineFull === mineFullExp, `${mineFull} vs ${mineFullExp}`)
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    bindClient(null)
    client.release()
  }

  console.log('\n8. static: who sends brandProfile=1')
  const src = (p: string) => readFileSync(p, 'utf8')
  ok('KolDirectoryPage main list sends brandProfile=1', src('src/components/discover/KolDirectoryPage.tsx').includes(`params.set('brandProfile', '1')`))
  for (const f of ['DiscoverHub', 'DiscoverCompare', 'CampaignBuilder']) {
    ok(`${f} does not send brandProfile`, !src(`src/components/discover/${f}.tsx`).includes('brandProfile'))
  }
  const route = src('src/app/api/organizations/[id]/discover/kol-directory/route.ts')
  ok('route reads the Brand Profile once for the filters, never for ?ids=',
    route.includes(`sp.get('brandProfile') === '1' && !ids.length`)
    && (route.match(/getBrandProfile\(/g) ?? []).length === 2)
  ok('route does not filter on brand_category / age / geo / interests / style',
    !/profile\.(brandCategory|targetAge|targetCountry|targetCity|audienceInterests|contentStyles|brandPersonality|brandValues)/.test(route))

  console.log('\n9. rollback')
  const after = await Promise.all(tables.map(t => fingerprint(pool, t)))
  tables.forEach((t, i) => ok(`${t} exactly as before`, after[i] === before[i]))

  await pool.end()
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => { console.error(err); process.exit(1) })
