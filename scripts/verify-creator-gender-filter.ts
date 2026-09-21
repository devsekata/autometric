/**
 * Brand Profile gender → KOL Directory, by CREATOR gender.
 *
 *   npm run verify:creator-gender
 *
 * Runs the real Brand Profile PUT and the real Directory GET inside ONE
 * transaction that is always rolled back (same stubs as
 * verify:brand-profile-kol), so a saved Brand Profile is never changed.
 *
 *   1. Female / Male: every creator returned has creator_gender = that gender,
 *      none unknown, and the total equals the database count
 *   2. Any / Balanced: no gender filtering (total = unfiltered total)
 *   3. `?ids=` (Compare, Cart, SmartDiscovery, Brand Match) is NOT filtered;
 *      a request without `brandProfile=1` is NOT filtered
 *   4. Match % for the same creators is identical under Female and Any
 *   5. data: roster wins over name inference; unknown stays NULL; the value
 *      never comes from audience gender; manual_add creators were inferred
 *   6. EXPLAIN ANALYZE of the Directory query with the gender filter
 */
import { Pool, type PoolClient } from 'pg'
import { NextRequest } from 'next/server'
import { setSession } from './verify-brand-profile-kol/stubs/auth'
import { bindClient } from './verify-brand-profile-kol/stubs/kolDb'
import { PUT } from '@/app/api/organizations/[id]/discover/brand-profile/route'
import { GET as DIRECTORY } from '@/app/api/organizations/[id]/discover/kol-directory/route'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
type Row = { id: string }
type Payload = { rows: Row[]; total: number; brandMatch?: { rows: Record<string, { matchPct: number | null }> } }

async function directory(orgId: string, qs: string): Promise<Payload> {
  const res = await DIRECTORY(new NextRequest(
    `http://localhost/api/organizations/${orgId}/discover/kol-directory?${qs}`), params(orgId))
  if (res.status !== 200) throw new Error(`GET ${qs} → ${res.status} ${JSON.stringify(await res.json())}`)
  return res.json() as Promise<Payload>
}
/** Every id the filtered list returns, all pages. */
async function allIds(orgId: string, qs: string): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = []
  let total = 0
  for (let page = 1; ; page++) {
    const d = await directory(orgId, `${qs}&pageSize=60&page=${page}`)
    total = d.total
    ids.push(...d.rows.map(r => r.id))
    if (!d.rows.length || ids.length >= d.total) break
  }
  return { ids, total }
}
async function setGender(orgId: string, g: string, extra: Record<string, unknown> = {}) {
  const res = await PUT(new NextRequest(`http://localhost/api/organizations/${orgId}/discover/brand-profile`, {
    // The Ideal Creator Profile lists are cleared so only gender filters here;
    // verify:brand-profile-directory covers them.
    method: 'PUT', body: JSON.stringify({
      genderMajority: g, preferredPlatforms: [], preferredTiers: [], preferredCategories: [], ...extra,
    }), headers: { 'content-type': 'application/json' },
  }), params(orgId))
  if (res.status !== 200) throw new Error(`PUT genderMajority=${g} → ${res.status}`)
}
async function gendersOf(db: PoolClient, ids: string[]): Promise<Record<string, number>> {
  const { rows } = await db.query<{ g: string; n: number }>(`
    SELECT coalesce(g.creator_gender, 'unknown') g, count(*)::int n
      FROM unnest($1::uuid[]) x(id)
      LEFT JOIN LATERAL (
        SELECT c.creator_gender FROM public.kol_social_account ksa
          JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
         WHERE ksa.kol_id = x.id ORDER BY c.followers_count DESC NULLS LAST LIMIT 1) g ON TRUE
     GROUP BY 1`, [ids])
  return Object.fromEntries(rows.map(r => [r.g, r.n]))
}

;(async () => {
  const pool = new Pool({
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
    max: 2, connectionTimeoutMillis: 8_000,
  })

  // Expected counts straight from the table the Directory reads.
  const { rows: [exp] } = await pool.query<{ female: number; male: number; unknown: number; active: number }>(`
    SELECT count(*) FILTER (WHERE g.creator_gender = 'female')::int female,
           count(*) FILTER (WHERE g.creator_gender = 'male')::int   male,
           count(*) FILTER (WHERE g.creator_gender IS NULL)::int    unknown,
           count(*)::int active
      FROM public.kol_directory kd
      LEFT JOIN LATERAL (
        SELECT c.creator_gender FROM public.kol_social_account ksa
          JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
         WHERE ksa.kol_id = kd.id ORDER BY c.followers_count DESC NULLS LAST LIMIT 1) g ON TRUE
     WHERE kd.directory_status = 'active'`)
  console.log(`database: active=${exp.active} female=${exp.female} male=${exp.male} unknown=${exp.unknown}`)
  ok('creator_gender is populated (asset ran)', exp.female > 0 && exp.male > 0)

  const { rows: [before] } = await pool.query<{ profiles: number; sum: string }>(
    `SELECT count(*)::int profiles, coalesce(string_agg(organization_id::text || gender_majority || updated_at::text, ','
            ORDER BY organization_id), '') sum FROM public.brand_profile`)
  const { rows: [A] } = await pool.query<{ agency_id: string; user_id: string }>(`
    SELECT am.agency_id::text, am.user_id::text FROM public.agency_members am
      JOIN public.agencies a ON a.id = am.agency_id AND a.deleted_at IS NULL
     WHERE am.role = 'ADMIN' AND am.status = 'ACTIVE' ORDER BY am.agency_id LIMIT 1`)

  const client = await pool.connect()
  bindClient(client)
  const captured: { text: string; values: unknown[] }[] = []
  const origQuery = client.query.bind(client) as (...a: unknown[]) => unknown
  ;(client as unknown as { query: unknown }).query = (...a: unknown[]) => {
    if (typeof a[0] === 'string' && a[0].includes('filtered AS') && Array.isArray(a[1]))
      captured.push({ text: a[0], values: a[1] as unknown[] })
    return origQuery(...a)
  }
  let female: string[] = []
  try {
    await client.query('BEGIN')
    setSession(A.user_id)

    console.log('\n1. Female / Male')
    for (const [g, key] of [['Female', 'female'], ['Male', 'male']] as const) {
      await setGender(A.agency_id, g)
      const r = await allIds(A.agency_id, 'brandProfile=1&sort=followers&dir=desc')
      const got = await gendersOf(client, r.ids)
      ok(`${g}: only creator_gender=${key}, no other gender, no unknown`,
        Object.keys(got).length === 1 && got[key] === r.ids.length, JSON.stringify(got))
      ok(`${g}: total = database count, no duplicate creators`,
        r.total === exp[key] && new Set(r.ids).size === r.ids.length && r.ids.length === r.total,
        `total=${r.total} expected=${exp[key]} ids=${r.ids.length} distinct=${new Set(r.ids).size}`)
      if (g === 'Female') female = r.ids
    }
    await setGender(A.agency_id, 'Female')
    const ig = await directory(A.agency_id, 'brandProfile=1&platform=instagram&pageSize=1')
    const { rows: [igExp] } = await client.query<{ n: number }>(`
      SELECT count(*)::int n FROM public.kol_directory kd
        JOIN public.platforms pl ON pl.id = kd.platform_id AND pl.key = 'instagram'
        JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
       WHERE kd.directory_status = 'active' AND c.creator_gender = 'female'`)
    ok('Female combines with other filters (platform=instagram)', ig.total === igExp.n, `${ig.total} vs ${igExp.n}`)

    console.log('\n2. Any / Balanced')
    const unfiltered = (await directory(A.agency_id, 'pageSize=1')).total
    for (const g of ['Any', 'Balanced']) {
      await setGender(A.agency_id, g)
      const t = (await directory(A.agency_id, 'brandProfile=1&pageSize=1')).total
      ok(`${g}: no gender filtering`, t === unfiltered && t === exp.active, `total=${t} unfiltered=${unfiltered}`)
    }

    console.log('\n3. ?ids= and requests without brandProfile=1 are not filtered')
    await setGender(A.agency_id, 'Female')
    const { rows: others } = await client.query<{ id: string }>(`
      (SELECT kd.id::text FROM public.kol_directory kd
         JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
         JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
        WHERE kd.directory_status = 'active' AND c.creator_gender = 'male' LIMIT 3)
      UNION ALL
      (SELECT kd.id::text FROM public.kol_directory kd
        WHERE kd.directory_status = 'active' AND NOT EXISTS (
          SELECT 1 FROM public.kol_social_account ksa
            JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
           WHERE ksa.kol_id = kd.id AND c.creator_gender IS NOT NULL) LIMIT 3)`)
    const ids = [...others.map(o => o.id), ...female.slice(0, 2)]
    const byIds = await directory(A.agency_id, `ids=${ids.join(',')}&brandProfile=1`)
    ok('Female profile: ?ids= with male + unknown creators returns every id asked for',
      byIds.rows.length === ids.length && ids.every(id => byIds.rows.some(r => r.id === id)),
      `${byIds.rows.length}/${ids.length}`)
    const noFlag = (await directory(A.agency_id, 'pageSize=1')).total
    ok('Female profile: a request without brandProfile=1 (Hub, SmartDiscovery) is unfiltered',
      noFlag === exp.active, `${noFlag}`)

    console.log('\n4. Match % is not touched by gender')
    // What Matters chosen inside the rolled-back transaction, so Match % is real.
    await setGender(A.agency_id, 'Female', { whatMatters: ['strong_engagement', 'high_reach'] })
    const probe = [...female.slice(0, 5), ...others.map(o => o.id)]
    const mFemale = await directory(A.agency_id, `ids=${probe.join(',')}&match=1`)
    await setGender(A.agency_id, 'Any')
    const mAny = await directory(A.agency_id, `ids=${probe.join(',')}&match=1`)
    const same = probe.every(id => (mFemale.brandMatch?.rows[id]?.matchPct ?? null) === (mAny.brandMatch?.rows[id]?.matchPct ?? null))
    const scored = probe.filter(id => typeof mFemale.brandMatch?.rows[id]?.matchPct === 'number').length
    ok('same creators, Female vs Any → identical Match % (and male/unknown creators still get one)', same && scored > 0,
      probe.map(id => mFemale.brandMatch?.rows[id]?.matchPct ?? 'null').join(' '))

    console.log('\n6. EXPLAIN ANALYZE, Directory list with creatorGender=female')
    const q = captured.find(c => c.values[35] === 'female' && c.values[9] === null)
    if (!q) ok('captured the Directory query with the gender parameter', false)
    else {
      const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${q.text}`, q.values)
      const lines = plan.rows.map(r => r['QUERY PLAN'])
      const exec = lines.find(l => l.startsWith('Execution Time')) ?? '?'
      const filt = lines.filter(l => /creator_gender/.test(l)).map(l => l.trim()).slice(0, 2)
      const base = { ...q, values: q.values.map((v, i) => (i === 35 ? null : v)) }
      const plan0 = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE) ${base.text}`, base.values)
      const exec0 = plan0.rows.map(r => r['QUERY PLAN']).find(l => l.startsWith('Execution Time')) ?? '?'
      console.log(`        with gender filter:    ${exec}\n        without gender filter: ${exec0}`)
      for (const f of filt) console.log(`        ${f}`)
      ok('plan evaluates the gender filter on the card row (no extra join)', filt.length > 0)
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    bindClient(null)
    client.release()
  }

  console.log('\n5. data rules (read-only)')
  const { rows: [d] } = await pool.query<Record<string, number>>(`
    WITH r AS (
      SELECT social_account_id, min(btrim(influencer_gender)) kode
        FROM l0_raw.kol_roster_import
       WHERE social_account_id IS NOT NULL AND btrim(influencer_gender) IN ('0','1')
       GROUP BY 1 HAVING count(DISTINCT btrim(influencer_gender)) = 1)
    SELECT count(*) FILTER (WHERE r.kode IS NOT NULL)::int roster_cards,
           count(*) FILTER (WHERE r.kode IS NOT NULL AND c.creator_gender_source = 'roster'
                              AND c.creator_gender = CASE r.kode WHEN '1' THEN 'female' ELSE 'male' END)::int roster_ok,
           count(*) FILTER (WHERE r.kode IS NOT NULL AND c.creator_gender_source = 'name_inference')::int roster_overwritten,
           count(*) FILTER (WHERE r.kode IS NULL AND c.creator_gender_source = 'roster')::int roster_without_roster,
           count(*) FILTER (WHERE c.creator_gender IS NULL AND (c.creator_gender_source IS NOT NULL
                              OR c.creator_gender_confidence IS NOT NULL))::int unknown_with_source,
           count(*) FILTER (WHERE c.creator_gender IS NOT NULL AND c.female_pct IS NULL)::int set_without_audience,
           count(*) FILTER (WHERE c.creator_gender IS NOT NULL AND c.female_pct IS NOT NULL
                              AND c.creator_gender <> CASE WHEN c.female_pct >= 50 THEN 'female' ELSE 'male' END)::int differs_from_audience,
           count(*) FILTER (WHERE c.creator_gender_source = 'name_inference')::int inferred,
           count(*) FILTER (WHERE c.creator_gender_source = 'manual')::int manual
      FROM l2_gold.kol_profile_card c
      LEFT JOIN r ON r.social_account_id = c.social_account_id`)
  ok('every card with a valid roster code carries the roster value (source=roster)',
    d.roster_ok === d.roster_cards && d.roster_overwritten === 0, `${d.roster_ok}/${d.roster_cards}, overwritten by inference=${d.roster_overwritten}`)
  ok('source=roster only where the roster has a valid code', d.roster_without_roster === 0)
  ok('unknown stays fully NULL (no source/confidence without a value)', d.unknown_with_source === 0)
  ok('creator gender is not audience gender: set on cards with no audience data',
    d.set_without_audience > 0, `${d.set_without_audience} cards; ${d.differs_from_audience} differ from their audience majority`)
  console.log(`        name_inference=${d.inferred} manual=${d.manual}`)

  const { rows: newKol } = await pool.query<{ username: string; display_name: string | null; g: string | null; s: string | null; c: string | null }>(`
    SELECT kd.username, c.display_name, c.creator_gender g, c.creator_gender_source s, c.creator_gender_confidence c
      FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
     WHERE kd.source = 'manual_add' ORDER BY kd.created_at`)
  for (const k of newKol) console.log(`        manual_add ${k.username} | ${k.display_name} → ${k.g ?? 'unknown'} (${k.s ?? '-'}, ${k.c ?? '-'})`)
  ok('manual_add creators went through the inference (no roster row)',
    newKol.length > 0 && newKol.every(k => k.s === null || k.s === 'name_inference') && newKol.some(k => k.s === 'name_inference'))

  const { rows: [after] } = await pool.query<{ profiles: number; sum: string }>(
    `SELECT count(*)::int profiles, coalesce(string_agg(organization_id::text || gender_majority || updated_at::text, ','
            ORDER BY organization_id), '') sum FROM public.brand_profile`)
  ok('rollback: every saved Brand Profile is exactly as before', after.profiles === before.profiles && after.sum === before.sum,
    `${before.profiles} profiles`)

  await pool.end()
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => { console.error(err); process.exit(1) })
