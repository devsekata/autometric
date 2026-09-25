/**
 * Final audience classification in the Discovery readers:
 *   measured/inferred usable -> measured; unusable -> curated_* (migration 054); neither -> NULL.
 *
 *   npx dotenv -e .env.local -- npx tsx --tsconfig scripts/test/tsconfig.json scripts/verify-curated-audience.ts   (READ-ONLY)
 *
 * Pure checks (precedence, fallback, country label), then the REAL readers against
 * the DB: detail (`getKolGold`) and list/filter (`listKolDirectory`) for the active
 * population, compared with `AUDIENCE_SERVED` (the SQL form of scrapper-project
 * `audience_classification.py`). Writes nothing.
 */
import assert from 'node:assert/strict'
import kolDb from '../src/lib/kolDb'
import { getKolGold, withCuratedFallback, countryLabel } from '../src/lib/discover/kolGold'
import { listKolDirectory, type KolDirectoryQuery } from '../src/lib/discover/kolDirectory'
import { AUDIENCE_SERVED } from '../src/lib/discover/curatedAudience'

let n = 0
const check = (name: string, ok: boolean, detail = '') => {
  assert.ok(ok, `${name} ${detail}`)
  n++
  console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function listAll(q: KolDirectoryQuery) {
  const rows = []
  for (let page = 1; ; page++) {
    const r = await listKolDirectory({ ...q, page, pageSize: 60 })
    rows.push(...r.rows)
    if (rows.length >= r.total || !r.rows.length) return { rows, total: r.total }
  }
}

const FIELDS = ['gender', 'age', 'country', 'city'] as const
type Field = typeof FIELDS[number]

interface Served {
  kol_id: string; platform: string; female_pct: number | null; male_pct: number | null
  gender_measured: string | null; age_measured: string | null; country_measured: string | null; city_measured: string | null
  curated_gender: string | null; curated_age: string | null; curated_country: string | null; curated_city: string | null
  gender_final: string | null; age_final: string | null; country_final: string | null; city_final: string | null
}

async function main() {
  // ---- pure --------------------------------------------------------------------
  const measured = [{ label: 'ID', pct: 90, n: 9 }, { label: 'MY', pct: 10, n: 1 }]
  const m = withCuratedFallback(measured, true, 'SG')
  check('measured usable > curated', m.source === 'measured' && m.slices === measured)
  const u = withCuratedFallback(measured, false, 'SG')
  check('measured unusable -> curated', u.source === 'curated' && u.slices.length === 1 && u.slices[0].label === 'SG')
  const fb = withCuratedFallback([], false, 'ID')
  check('curated fallback when measured empty', fb.source === 'curated' && fb.slices[0].label === 'ID' && fb.slices[0].n === 0)
  check('neither -> empty, no fabricated slice', withCuratedFallback([], false, null).source === null
    && withCuratedFallback([], false, null).slices.length === 0)
  const labels = Object.fromEntries(['ID', 'JP', 'SA', 'TH', 'BD'].map(c => [c, countryLabel(c)]))
  console.log('   country labels:', JSON.stringify(labels))
  check('country code -> name', labels.ID === 'Indonesia' && labels.JP === 'Jepang' && labels.SA === 'Arab Saudi'
    && labels.TH === 'Thailand' && labels.BD === 'Bangladesh' && countryLabel('Jakarta') === 'Jakarta')

  // ---- DB: expected finals for the active population ---------------------------
  const db = kolDb()
  const served = await db.query<Served>(
    `SELECT ksa.kol_id::text, s.* FROM public.kol_directory kd
       JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       JOIN (${AUDIENCE_SERVED}) s ON s.social_account_id = ksa.social_account_id
      WHERE kd.directory_status = 'active'`)
  const byKol = new Map(served.rows.map(r => [r.kol_id, r]))
  check('one served row per active KOL', served.rows.length === byKol.size, `${served.rows.length} rows / ${byKol.size} KOL`)

  // TikTok rows come from feature.tt_audience_analysis, IG from ig_audience_analysis.
  const plat = await db.query<{ platform: string; tbl: string; n: number }>(
    `SELECT pl.key AS platform,
            CASE WHEN EXISTS (SELECT 1 FROM feature.tt_audience_analysis t WHERE t.social_account_id = ksa.social_account_id) THEN 'tt'
                 WHEN EXISTS (SELECT 1 FROM feature.ig_audience_analysis i WHERE i.social_account_id = ksa.social_account_id) THEN 'ig'
                 ELSE 'none' END AS tbl, count(*)::int AS n
       FROM public.kol_directory kd JOIN public.platforms pl ON pl.id = kd.platform_id
       JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      WHERE kd.directory_status = 'active' GROUP BY 1, 2 ORDER BY 1, 2`)
  console.log('   platform x feature table:', JSON.stringify(plat.rows))
  check('IG reads ig_audience_analysis, TikTok reads tt_audience_analysis',
    plat.rows.every(r => (r.platform === 'instagram' && r.tbl === 'ig') || (r.platform === 'tiktok' && r.tbl === 'tt')))
  const ttServed = served.rows.filter(r => r.platform === 'tiktok')
  const ttPlat = plat.rows.filter(r => r.platform === 'tiktok').reduce((a, r) => a + r.n, 0)
  check('TikTok served rows = TikTok KOLs, platform tiktok', ttServed.length === ttPlat && ttPlat > 0, `${ttServed.length}`)

  // ---- detail reader -------------------------------------------------------------
  const cov = Object.fromEntries(FIELDS.map(f => [f, { measured: 0, curated: 0, final: 0 }])) as
    Record<Field, { measured: number; curated: number; final: number }>
  let detailMismatch = 0
  let bothPresent = 0
  const golds = new Map<string, Awaited<ReturnType<typeof getKolGold>>>()
  for (const [id, s] of byKol) {
    const g = await getKolGold(id)
    golds.set(id, g)
    const a = g?.audience
    for (const f of FIELDS) {
      const measuredV = s[`${f}_measured`], finalV = s[`${f}_final`]
      if (measuredV && s[`curated_${f}`]) bothPresent++
      const want = measuredV ? 'measured' : s[`curated_${f}`] ? 'curated' : null
      const got = a?.source[f] ?? null
      const finalGot = a?.final[f] ?? null
      if (got !== want || finalGot !== finalV) {
        detailMismatch++
        if (detailMismatch <= 10) console.log('   MISMATCH', id, f, { want, got, finalV, finalGot })
      }
      if (got === 'measured') cov[f].measured++
      if (got === 'curated') cov[f].curated++
      if (finalGot) cov[f].final++
    }
    // curated slice = the curated label (country shown by name)
    if (a?.source.country === 'curated' && a.countries[0]?.label !== countryLabel(s.curated_country ?? '')) detailMismatch++
    if (a?.source.gender === 'curated' && a.gender[0]?.label !== s.curated_gender) detailMismatch++
  }
  console.log('\n   Field    | Measured | Curated fallback | Final')
  for (const f of FIELDS) {
    console.log(`   ${f.padEnd(8)} | ${String(cov[f].measured).padStart(8)} | ${String(cov[f].curated).padStart(16)} | ${cov[f].final}`)
  }
  console.log('')
  check('detail: source + final match the classification for every KOL/field', detailMismatch === 0, `mismatch ${detailMismatch}`)
  check('detail: final coverage 100 for all 4 fields', FIELDS.every(f => cov[f].final === byKol.size), `${byKol.size} KOL`)
  check('detail: measured + curated = final', FIELDS.every(f => cov[f].measured + cov[f].curated === cov[f].final))
  console.log(`   fields with both a usable measured value and a curated label: ${bothPresent} (served as measured above)`)
  const tt = ttServed[0]
  check('detail TikTok KOL reads its own final', golds.get(tt.kol_id)?.audience?.final.country === tt.country_final
    && golds.get(tt.kol_id)?.audience?.final.gender === tt.gender_final)

  // ---- list / filters ------------------------------------------------------------
  const all = await listAll({})
  check('list: active population, no duplicate', all.rows.length === byKol.size
    && new Set(all.rows.map(r => r.id)).size === all.rows.length && all.total === all.rows.length)

  const same = (name: string, got: string[], want: Set<string>, total: number) => {
    const g = new Set(got)
    const dup = g.size !== got.length || total !== got.length
    const missing = [...want].filter(x => !g.has(x)).length
    const extra = [...g].filter(x => !want.has(x)).length
    check(name, !dup && !missing && !extra, `${got.length} KOL (missing ${missing}, extra ${extra}, dup ${dup})`)
  }
  const kolsWhere = (pred: (s: Served, id: string) => boolean) =>
    new Set([...byKol].filter(([id, s]) => pred(s, id)).map(([id]) => id))

  for (const gv of ['female', 'male', 'balanced']) {
    const r = await listAll({ audienceGender: gv })
    same(`filter Audience Gender=${gv}`, r.rows.map(x => x.id), kolsWhere(s => s.gender_final === gv), r.total)
  }
  for (const av of [...new Set(served.rows.map(s => s.age_final).filter(Boolean))] as string[]) {
    const r = await listAll({ audienceAge: av })
    same(`filter Audience Age=${av}`, r.rows.map(x => x.id), kolsWhere(s => s.age_final === av), r.total)
  }
  for (const [q, col, side] of [[{ minFemalePct: 60 }, 'female_pct', 'female'], [{ minMalePct: 60 }, 'male_pct', 'male']] as const) {
    const r = await listAll(q)
    same(`filter ${col}>=60 (measured when usable, else curated)`, r.rows.map(x => x.id),
      kolsWhere(s => s.gender_measured ? Number(s[col]) >= 60 : s.curated_gender === side), r.total)
  }

  // Geo: measured presence where the level is usable, else the curated label.
  const presence = await db.query<{ kol_id: string; geo_level: string; geo_key: string }>(
    `SELECT DISTINCT ksa.kol_id::text, g.geo_level, g.geo_key
       FROM public.kol_directory kd JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
      WHERE kd.directory_status = 'active' AND g.geo_level IN ('country', 'city')`)
  const has = new Set(presence.rows.map(r => `${r.kol_id}|${r.geo_level}|${r.geo_key}`))
  const geoWant = (lvl: 'country' | 'city', key: string) => kolsWhere((s, id) =>
    s[`${lvl}_measured`] ? has.has(`${id}|${lvl}|${key}`) : s[`curated_${lvl}`] === key)
  for (const key of ['ID', 'JP', 'SA', 'TH', 'BD', 'MY']) {
    const r = await listAll({ audienceGeoKey: key, audienceGeoLevel: 'country' })
    const want = geoWant('country', key)
    same(`filter Audience Country=${key}`, r.rows.map(x => x.id), want, r.total)
    check(`  every KOL whose final country is ${key} is found`,
      [...kolsWhere(s => s.country_final === key)].every(id => want.has(id)))
  }
  const cities = [...new Set(served.rows.map(s => s.curated_city).filter(Boolean))].slice(0, 4) as string[]
  const measuredCity = served.rows.find(s => s.city_measured)?.city_measured
  for (const key of [...cities, ...(measuredCity ? [measuredCity] : [])]) {
    const r = await listAll({ audienceGeoKey: key, audienceGeoLevel: 'city' })
    const want = geoWant('city', key)
    same(`filter Audience City=${key}`, r.rows.map(x => x.id), want, r.total)
    check(`  every KOL whose final city is ${key} is found`,
      [...kolsWhere(s => s.city_final === key)].every(id => want.has(id)))
  }
  const noLevel = await listAll({ audienceGeoKey: 'ID' })
  check('filter country without level: no duplicate, superset of the country answer',
    new Set(noLevel.rows.map(r => r.id)).size === noLevel.rows.length
    && [...geoWant('country', 'ID')].every(id => noLevel.rows.some(r => r.id === id)))

  const combo = await listAll({ audienceGender: 'female', audienceGeoKey: 'ID', audienceGeoLevel: 'country' })
  const idSet = geoWant('country', 'ID')
  same('combined Gender=female + Country=ID', combo.rows.map(x => x.id),
    kolsWhere((s, id) => s.gender_final === 'female' && idSet.has(id)), combo.total)

  console.log(`\n${n} checks passed`)
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
