/**
 * Verifies the Brand Profile ported from `origin/engkol_v2`: one API, one form,
 * on the KOL database, scoped to the agency, and never touching `public.brand`.
 *
 *   npm run verify:brand-profile-kol               # static + live (needs VPN)
 *   npm run verify:brand-profile-kol -- --offline  # static only
 *
 * Runs under `scripts/verify-brand-profile-kol/tsconfig.json`, which points
 * `@/auth` and `@/lib/kolDb` at two stubs:
 *
 *   @/auth       lets the script choose the session (none / admin / member).
 *                Authorisation itself is NOT stubbed: the route still calls
 *                `requireOrgMemberById` → `getMemberRole`, which reads the real
 *                `agency_members`.
 *   @/lib/kolDb  binds every query to ONE client inside a transaction that is
 *                always rolled back. The real route handlers and the real SQL run
 *                against the KOL database; no row survives the run.
 *
 * There is no MEMBER in `agency_members` today (every active member is an
 * ADMIN), so the 403 case adds one membership row inside that same transaction
 * — rolled back with everything else — for an existing user on an agency they
 * do not belong to.
 *
 * Inside one transaction `now()` is fixed, so to show `updated_at` moving, the
 * test row's `updated_at` is moved one hour back between two saves — standing in
 * for the second save arriving in a later request.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { NextRequest } from 'next/server'
// The stubs by file path: the same modules `@/auth` and `@/lib/kolDb` resolve
// to under this script's tsconfig, named directly so the project-wide `tsc`
// (which maps those aliases to the real modules) type-checks this file too.
import { setSession } from './verify-brand-profile-kol/stubs/auth'
import { bindClient } from './verify-brand-profile-kol/stubs/kolDb'
import { GET, PUT } from '@/app/api/organizations/[id]/discover/brand-profile/route'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const offline = process.argv.includes('--offline')
const read = (p: string) => readFileSync(p, 'utf8')
const IMPORTS_TSDB = /^\s*import\b.*['"]@\/lib\/db['"]/m
const INSERT_BRAND = /INSERT\s+INTO\s+(public\.)?"?brand"?(\s|\()/i

const LIB_DIR = 'src/lib/discover/brandMatch'
const PROFILE = `${LIB_DIR}/profile.ts`
const ROUTE = 'src/app/api/organizations/[id]/discover/brand-profile/route.ts'
const FORM = 'src/components/discover/BrandProfileForm.tsx'

/* ── 1. static ─────────────────────────────────────────────────────────────── */

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name).replace(/\\/g, '/')])
}

console.log('\nstatic')
{
  const libFiles = readdirSync(LIB_DIR).filter(f => f.endsWith('.ts')).map(f => `${LIB_DIR}/${f}`)
  const surface = [...libFiles, ROUTE, FORM]

  for (const f of surface) ok(`${f} does not import @/lib/db`, !IMPORTS_TSDB.test(read(f)))
  ok('no INSERT into public.brand anywhere in the Brand Profile code',
    !surface.some(f => INSERT_BRAND.test(read(f))), surface.filter(f => INSERT_BRAND.test(read(f))).join(', '))
  ok('no brand-resolving code path (resolveBrandLink) remains', !surface.some(f => read(f).includes('resolveBrandLink(')))

  const profile = read(PROFILE)
  const upsert = profile.slice(profile.indexOf('INSERT INTO public.brand_profile'), profile.indexOf('RETURNING ${COLUMNS}'))
  ok('the upsert neither inserts nor updates brand_id', upsert.length > 0 && !/\bbrand_id\b/.test(upsert.replace(/--.*$/gm, '')))
  ok('the upsert is keyed on UNIQUE (organization_id) and sets updated_at = NOW()',
    upsert.includes('ON CONFLICT (organization_id) DO UPDATE') && /updated_at = NOW\(\)/.test(upsert))
  ok('what_matters is inserted and updated by the upsert',
    /what_matters,/.test(upsert) && /what_matters = EXCLUDED\.what_matters/.test(upsert))
  ok('what_matters is cleaned to the six-key vocabulary on read and on save',
    profile.includes("cleanWhatMatters(r.what_matters ?? [])")
    && profile.includes("cleanWhatMatters(input.whatMatters)"))
  ok('brandId in the input is rejected', /NOT_SETTABLE = \['brandId'\]/.test(profile) && profile.includes('throw new BrandProfileError('))

  // Placeholder count matches the parameter list: VALUES $1..$N + NOW().
  const cols = upsert.slice(upsert.indexOf('(') + 1, upsert.indexOf(')')).split(',').map(c => c.trim()).filter(Boolean)
  const placeholders = (upsert.match(/\$\d+/g) ?? []).length
  ok('INSERT column count = placeholders + NOW()', cols.length === placeholders + 1, `${cols.length} cols, ${placeholders} params`)

  const model = read(`${LIB_DIR}/model.ts`)
  let v2Model: string | null = null
  try { v2Model = execSync('git show origin/engkol_v2:src/lib/discover/brandMatch/model.ts', { encoding: 'utf8' }) } catch { /* no remote ref */ }
  if (v2Model !== null) ok('model.ts is v2\'s, unchanged', v2Model.replace(/\r\n/g, '\n') === model.replace(/\r\n/g, '\n'))

  const route = read(ROUTE)
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function PUT'))
  const put = route.slice(route.indexOf('export async function PUT'))
  ok('GET and PUT both authorise with requireOrgMemberById', get.includes('requireOrgMemberById(') && put.includes('requireOrgMemberById('))
  ok('PUT refuses non-admins before reading the body',
    put.indexOf("access.role !== 'ADMIN'") > -1 && put.indexOf("access.role !== 'ADMIN'") < put.indexOf('req.json()'))
  ok('PUT saves under the authorised organization and the session user',
    put.includes('saveBrandProfile(orgId, body as BrandProfileInput, access.userId)'))

  const form = read(FORM)
  ok('the form never sends organizationId, brandId or updatedAt',
    /NOT_SENT = \['organizationId', 'brandId', 'updatedAt'\]/.test(form) && form.includes('!(NOT_SENT as readonly string[]).includes(k)'))
  ok('the form keeps nothing in browser storage', !/\b(localStorage|sessionStorage|indexedDB)\s*[.[]/.test(form))
  // The form follows the prototype (`brandProfileHTML` in scrapper-project
  // app/AUTOME~1.HTM.html): five sections, in order, and nothing else.
  const sections = [...form.matchAll(/<Section\b[^>]*\btitle="([^"]+)"/g)].map(m => m[1])
  ok('the form has the five prototype sections, in order',
    sections.join(' | ') === 'Company Profile | Target Audience | Brand Identity | Ideal Creator Profile | What matters most when evaluating creators?',
    sections.join(' | '))
  ok('the form carries no Brand Safety and none of the removed extras',
    !/brand.?safety/i.test(form)
    && !/Brand Keywords|Performance Targets|Minimum followers|Minimum engagement|Brand tone/.test(form))
  // Fields the form no longer shows (keywords, tone, targets, minimums) keep
  // their saved values: the whole loaded draft is sent back, not only what is
  // rendered, so hiding a field never erases it.
  ok('the form edits Company Website and Brand Values (saved fields, not placeholders)',
    form.includes("set('companyWebsite'") && form.includes("toggle('brandValues'")
    && form.includes("set('brandValues'") && !/Not saved/.test(form))
  // Every form field is backed by a brand_profile column (migrations/kol/009
  // left exactly these, plus id / organization_id / brand_id / timestamps).
  const UI_FIELDS: [string, string][] = [
    ['brandName', 'brand_name'], ['brandCategory', 'brand_category'],
    ['companyWebsite', 'company_website'], ['brandDescription', 'brand_description'],
    ['targetAgeMin', 'target_age_min'], ['targetAgeMax', 'target_age_max'],
    ['genderMajority', 'gender_majority'], ['targetCountry', 'target_country'],
    ['targetCity', 'target_city'], ['audienceInterests', 'audience_interests'],
    ['brandPersonality', 'brand_personality'], ['brandValues', 'brand_values'],
    ['preferredCategories', 'preferred_categories'], ['preferredPlatforms', 'preferred_platforms'],
    ['preferredTiers', 'preferred_tiers'], ['contentStyles', 'content_styles'],
    ['whatMatters', 'what_matters'],
  ]
  const unbacked = UI_FIELDS.filter(([k, col]) =>
    !(form.includes(`'${k}'`) || form.includes(`.${k}`)) || !profile.includes(col))
  ok('every Brand Profile form field has a brand_profile column behind it (17 fields)',
    unbacked.length === 0, unbacked.map(([k]) => k).join(', '))
  const LEGACY = /\b(brandKeywords|brandHashtags|captionTerms|brandTone|performanceTargets|minFollowers|minErPct|requireCategory|verifiedOnly|brand_keywords|brand_hashtags|caption_terms|brand_tone|performance_targets|min_followers|min_er_pct|require_category|verified_only)\b/
  ok('no legacy field in the form, the profile type, or its read/write SQL',
    !LEGACY.test(form) && !LEGACY.test(profile), (form.match(LEGACY) ?? profile.match(LEGACY) ?? [''])[0])
  ok('fields hidden from the form are sent back unchanged on save',
    form.includes('setDraft(d.profile)') && form.includes('Object.entries(draft).filter'))

  // Exactly one Brand Profile API and one Brand Profile UI.
  // One API owns the Brand Profile (writes it); other routes may READ it, and
  // only through getBrandProfile — never their own SQL on brand_profile.
  const apiFiles = listFiles('src/app/api')
  const writers = apiFiles.filter(f => /saveBrandProfile\(/.test(read(f)))
  ok('exactly one API route writes the Brand Profile', writers.length === 1 && writers[0] === ROUTE, writers.join(', '))
  const rawSql = apiFiles.filter(f => /\bbrand_profile\b/.test(read(f).replace(/^\s*(\*|\/\/).*$/gm, '')))
  ok('no API route queries brand_profile directly', rawSql.length === 0, rawSql.join(', '))
  const formUsers = listFiles('src').filter(f => /from '\.\/BrandProfileForm'|BrandProfileForm'/.test(read(f)) && !f.endsWith('BrandProfileForm.tsx'))
  ok('exactly one place mounts the Brand Profile form', formUsers.length === 1 && formUsers[0].endsWith('DiscoverWorkspace.tsx'), formUsers.join(', '))
  ok('the Step 1 duplicates are gone',
    !existsSync('src/lib/discover/brandProfile.ts') && !existsSync('src/components/discover/BrandProfileSettings.tsx'))

  // The tenant layer is this branch's, not v2's.
  ok('tenant lookups run on the KOL server (agencies), not the warehouse',
    !IMPORTS_TSDB.test(read('src/lib/organizations/queries.ts'))
    && /FROM public\.agency_members/.test(read('src/lib/organizations/queries.ts')))
}

/* ── 2. live ───────────────────────────────────────────────────────────────── */

type Json = Record<string, any>
const url = (orgId: string) => `http://localhost/api/organizations/${orgId}/discover/brand-profile`
const params = (orgId: string) => ({ params: Promise.resolve({ id: orgId }) })
async function callGet(orgId: string) {
  const res = await GET(new NextRequest(url(orgId)), params(orgId))
  return { status: res.status, body: await res.json() as Json }
}
async function callPut(orgId: string, body: unknown) {
  const req = new NextRequest(url(orgId), {
    method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
  const res = await PUT(req, params(orgId))
  return { status: res.status, body: await res.json() as Json }
}

async function live() {
  const missing = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL'].filter(k => !process.env[k])
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`)
  const pool = new Pool({
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
    max: 2, connectionTimeoutMillis: 8_000,
  })

  const counts = async (db: Pick<Pool, 'query'>) => {
    const { rows: [r] } = await db.query(
      `SELECT (SELECT count(*) FROM public.brand_profile)::int  AS profiles,
              (SELECT count(*) FROM public.brand)::int          AS brands,
              (SELECT count(*) FROM public.agency_members)::int AS members`)
    return r as { profiles: number; brands: number; members: number }
  }

  try {
    const { rows: [who] } = await pool.query(`SELECT current_database() AS db`)
    ok('connected to the KOL database', who.db === process.env.PG_DB_KOL, who.db)
    const { rows: [col] } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'brand_profile' AND column_name = 'what_matters'`)
    if (col.n !== 1) {
      ok('migration 007 applied (brand_profile.what_matters exists)', false,
        'run `npm run migrate:kol` first; live checks need the column')
      return
    }
    const before = await counts(pool)

    const { rows: colRows } = await pool.query<{ c: string }>(
      `SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'brand_profile' ORDER BY column_name`)
    const EXPECTED_COLUMNS = [
      'audience_interests', 'brand_category', 'brand_description', 'brand_id', 'brand_name',
      'brand_personality', 'brand_values', 'company_website', 'content_styles', 'created_at',
      'gender_majority', 'id', 'organization_id', 'preferred_categories', 'preferred_platforms',
      'preferred_tiers', 'target_age_max', 'target_age_min', 'target_city', 'target_country',
      'updated_at', 'updated_by', 'what_matters',
    ]
    ok('brand_profile has exactly the 23 columns the form and API need (migration 009 applied)',
      JSON.stringify(colRows.map(r => r.c)) === JSON.stringify(EXPECTED_COLUMNS),
      colRows.map(r => r.c).join(','))

    // Two agencies, each with its own admin; A's admin is not a member of B.
    const { rows: admins } = await pool.query<{ agency_id: string; user_id: string }>(
      `SELECT am.agency_id::text, am.user_id::text
         FROM public.agency_members am
         JOIN public.agencies a ON a.id = am.agency_id AND a.deleted_at IS NULL
        WHERE am.role = 'ADMIN' AND am.status = 'ACTIVE'
        ORDER BY am.agency_id`)
    const A = admins[0]
    const B = admins.find(x => x.agency_id !== A?.agency_id
      && !admins.some(y => y.agency_id === x.agency_id && y.user_id === A.user_id))
    if (!A || !B) { ok('two agencies with distinct admins exist to test against', false); return }

    const { rows: existing } = await pool.query(
      `SELECT organization_id::text FROM public.brand_profile WHERE organization_id = ANY($1::uuid[])`,
      [[A.agency_id, B.agency_id]])
    ok('neither test agency has a saved profile yet (so create is really a create)', existing.length === 0)

    const client = await pool.connect()
    bindClient(client)
    try {
      await client.query('BEGIN')

      console.log('\nlive: authorisation (inside the rolled-back transaction)')
      setSession(null)
      ok('1. unauthenticated GET → 401', (await callGet(A.agency_id)).status === 401)
      ok('2. unauthenticated PUT → 401', (await callPut(A.agency_id, { brandName: 'x' })).status === 401)

      setSession(randomUUID())
      ok('   a signed-in non-member → 401', (await callGet(A.agency_id)).status === 401)

      await client.query(
        `INSERT INTO public.agency_members (user_id, agency_id, role, status)
         VALUES ($1, $2, 'MEMBER', 'ACTIVE')`, [A.user_id, B.agency_id])
      setSession(A.user_id)
      const memberPut = await callPut(B.agency_id, { brandName: 'should not save' })
      ok('3. non-admin (MEMBER) PUT → 403', memberPut.status === 403, JSON.stringify(memberPut.body))
      const memberGet = await callGet(B.agency_id)
      ok('   MEMBER GET → 200, read-only', memberGet.status === 200 && memberGet.body.canEdit === false)

      console.log('\nlive: admin read and write')
      const g = await callGet(A.agency_id)
      ok('4. admin GET → 200 with a profile for the agency',
        g.status === 200 && g.body.profile?.organizationId === A.agency_id && g.body.canEdit === true
        && Array.isArray(g.body.vocabulary?.categories) && g.body.vocabulary.categories.length === 9)
      ok('   GET serves the six What Matters options and an empty choice',
        g.body.vocabulary?.whatMatters?.length === 6
        && JSON.stringify(g.body.profile?.whatMatters) === '[]')

      const full = {
        brandName: 'verify-brand-profile-kol (rolled back)',
        brandCategory: 'Beauty',
        brandPersonality: ['Warm'],
        companyWebsite: '  autometric.io  ',
        brandValues: ['Trust', 'Innovation', 'trust', '  Craftsmanship  ', ''],
        // Legacy keys (columns dropped by 009) a stale client might still send:
        // accepted, ignored, not stored, not echoed back.
        brandTone: ['straightforward'],
        brandKeywords: ['serum'],
        brandHashtags: ['#glowup'],
        minFollowers: 1000, verifiedOnly: true,
        genderMajority: 'Female',
        targetCity: 'Jakarta',
        audienceInterests: ['beauty', 'not-a-key'],
        targetAgeMin: 18, targetAgeMax: 34,
        performanceTargets: { engagement_rate: 3, median_views: 50000 },
        preferredCategories: ['Beauty', 'Nope'],
        whatMatters: ['high_reach', 'strong_engagement', 'brand_safety', 'nope', 'high_reach'],
        // Server-owned keys a client must not be able to set:
        organizationId: B.agency_id,
        updatedBy: randomUUID(),
      }
      const p1 = await callPut(A.agency_id, full)
      ok('5. admin PUT → 200', p1.status === 200, JSON.stringify(p1.body).slice(0, 160))

      const row = async (orgId: string) => (await client.query(
        `SELECT id::text, organization_id::text, brand_id, brand_name, brand_category, brand_personality,
                company_website, brand_values, brand_description,
                gender_majority, target_city, audience_interests,
                target_age_min, target_age_max, preferred_categories, what_matters,
                updated_by::text, created_at, updated_at, (updated_at = now()) AS at_now
           FROM public.brand_profile WHERE organization_id = $1`, [orgId])).rows

      const r1 = await row(A.agency_id)
      ok('   the row is in public.brand_profile', r1.length === 1)
      const x = r1[0] ?? {}
      ok('12. PUT Company Website + Brand Values → stored (trimmed; values de-duplicated, custom kept)',
        x.company_website === 'autometric.io'
        && JSON.stringify(x.brand_values) === '["Trust","Innovation","Craftsmanship"]',
        JSON.stringify({ w: x.company_website, v: x.brand_values }))
      const reload = await callGet(A.agency_id)
      ok('   GET after the save (a page refresh) returns both',
        reload.status === 200 && reload.body.profile?.companyWebsite === 'autometric.io'
        && JSON.stringify(reload.body.profile?.brandValues) === '["Trust","Innovation","Craftsmanship"]')
      ok('   What Matters still six keys, no brand_safety, after the save',
        reload.body.vocabulary?.whatMatters?.length === 6
        && !reload.body.vocabulary.whatMatters.some((o: Json) => /safety/i.test(o.key + o.label))
        && JSON.stringify(reload.body.profile?.whatMatters) === '["strong_engagement","high_reach"]')
      ok('   values persisted as sent',
        x.brand_name === full.brandName && x.brand_category === 'Beauty'
        && x.target_age_min === 18 && x.target_age_max === 34
        && x.gender_majority === 'Female' && x.target_city === 'Jakarta')
      ok('   vocabulary applied: unknown interest and category dropped',
        JSON.stringify(x.audience_interests) === '["beauty"]'
        && JSON.stringify(x.preferred_categories) === '["Beauty"]')
      const LEGACY_KEYS = ['brandTone', 'brandKeywords', 'brandHashtags', 'captionTerms', 'performanceTargets',
        'minFollowers', 'minErPct', 'requireCategory', 'verifiedOnly']
      ok('14. legacy keys in the request → still 200, not stored, not returned by PUT or GET',
        p1.status === 200 && LEGACY_KEYS.every(k => !(k in (p1.body.profile ?? {})) && !(k in (reload.body.profile ?? {}))))
      ok('   what_matters stored cleaned: known keys only, canonical order, no brand_safety',
        JSON.stringify(x.what_matters) === '["strong_engagement","high_reach"]', JSON.stringify(x.what_matters))
      ok('   updated_at = now()', x.at_now === true)
      ok('7. organization_id comes from the authorised route, not the body',
        x.organization_id === A.agency_id && (await row(B.agency_id)).length === 0)
      ok('8. updated_by is the session user, not the body', x.updated_by === A.user_id)
      ok('9. brand_id is left NULL on create', x.brand_id === null)

      // Stand-in for the next request (now() is fixed inside a transaction).
      await client.query(
        `UPDATE public.brand_profile SET updated_at = updated_at - interval '1 hour' WHERE organization_id = $1`,
        [A.agency_id])
      const aged = (await row(A.agency_id))[0]

      const p2 = await callPut(A.agency_id, { brandDescription: 'partial edit' })
      const y = (await row(A.agency_id))[0] ?? {}
      ok('6. partial PUT → 200 and updates only what was sent',
        p2.status === 200 && y.brand_description === 'partial edit')
      ok('   partial PUT keeps every other field',
        y.brand_category === 'Beauty'
        && y.target_age_min === 18 && y.target_age_max === 34
        && JSON.stringify(y.brand_personality) === '["Warm"]' && JSON.stringify(y.audience_interests) === '["beauty"]'
        && JSON.stringify(y.what_matters) === '["strong_engagement","high_reach"]'
        && y.gender_majority === 'Female'
        && y.company_website === 'autometric.io'
        && JSON.stringify(y.brand_values) === '["Trust","Innovation","Craftsmanship"]')
      ok('   same row (same id, same created_at), updated_at moved to now()',
        y.id === x.id && y.created_at.getTime() === aged.created_at.getTime()
        && y.updated_at.getTime() > aged.updated_at.getTime() && y.at_now === true,
        `${aged.updated_at.toISOString()} → ${y.updated_at.toISOString()}`)

      console.log('\nlive: tenant isolation')
      setSession(A.user_id)
      await client.query(`DELETE FROM public.agency_members WHERE user_id = $1 AND agency_id = $2`, [A.user_id, B.agency_id])
      const crossGet = await callGet(B.agency_id)
      const crossPut = await callPut(B.agency_id, { companyWebsite: 'intruder.example', brandValues: ['Trust'] })
      ok('13. admin of agency A cannot read agency B\'s profile (401)', crossGet.status === 401, String(crossGet.status))
      ok('   …nor write it (401), and B has no row afterwards',
        crossPut.status === 401 && (await row(B.agency_id)).length === 0, String(crossPut.status))
      ok('   A\'s own website and values are untouched by the attempt',
        (await row(A.agency_id))[0]?.company_website === 'autometric.io')

      console.log('\nlive: validation and brand_id')
      const bid = await callPut(A.agency_id, { brandId: randomUUID() })
      ok('9. brandId in the body → 400', bid.status === 400, bid.body.error)
      ok('   …and brand_id is still NULL', (await row(A.agency_id))[0]?.brand_id === null)
      ok('   brandCategory outside the nine → 400', (await callPut(A.agency_id, { brandCategory: 'Technology' })).status === 400)
      ok('   genderMajority outside Any/Female/Male/Balanced → 400', (await callPut(A.agency_id, { genderMajority: 'All' })).status === 400)
      ok('   target age min > max → 400', (await callPut(A.agency_id, { targetAgeMin: 40, targetAgeMax: 20 })).status === 400)
      ok('   a non-object body → 400', (await callPut(A.agency_id, [1, 2])).status === 400)

      const during = await counts(client)
      ok('10. no public.brand row was created', during.brands === before.brands, `before=${before.brands} during=${during.brands}`)
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      bindClient(null)
      client.release()
    }

    console.log('\nlive: after rollback')
    const after = await counts(pool)
    ok('11. rollback leaves brand_profile, brand and agency_members unchanged',
      after.profiles === before.profiles && after.brands === before.brands && after.members === before.members,
      JSON.stringify({ before, after }))
  } finally {
    await pool.end().catch(() => {})
  }
}

;(async () => {
  if (!offline) await live()
  console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
