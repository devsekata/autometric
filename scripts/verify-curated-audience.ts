/**
 * Final audience classification in the engkol_v2 Discovery readers — READ-ONLY.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/verify-curated-audience.ts
 *
 * Adapted from the reconcile branch's verifier (7d7460e, same path). The target's
 * production readers are the source of truth; the checks follow what engkol_v2
 * deliberately does, not what that branch did:
 *
 *   - no `countryLabel`: the target shows the curated country key as stored;
 *   - Female / Male minimum sliders read the card split only (kept from HEAD),
 *     so they are checked against `kol_profile_card`, and a curated label must
 *     NOT satisfy them;
 *   - geo is read by `audienceGeoFor()` and the geo filter is measured-only, so
 *     no curated geo fallback is expected there.
 *
 * Every finding is collected; nothing stops at the first. `error` = the target's
 * own contract is broken; `warning` = two readers disagree and a person has to
 * decide whether that is expected; `info` = counted, expected behaviour.
 * Identifiers printed are KOL ids only.
 *
 * SELECT-only. The session is forced read-only below and checked before any read.
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'

import kolDb from '@/lib/kolDb'
import { getKolGold, withCuratedFallback, type AudienceSource, type GoldAudience } from '@/lib/discover/kolGold'
import { listKolDirectory, type KolDirectoryQuery } from '@/lib/discover/kolDirectory'
import { AUDIENCE_SERVED, AGE_BUCKETS, GENDER_SHARE_MIN } from '@/lib/discover/curatedAudience'
import { audienceGeoFor } from '@/lib/discover/audienceGeo'

type Level = 'error' | 'warning' | 'info'
interface Finding {
  category: string
  kolId?: string
  field?: string
  expected: unknown
  actual: unknown
  reason: string
}
const findings: Record<Level, Finding[]> = { error: [], warning: [], info: [] }
let checks = 0
const note = (level: Level, f: Finding) => { findings[level].push(f) }
const check = (ok: boolean, f: Finding) => { checks++; if (!ok) note('error', f) }

const FIELDS = ['gender', 'age', 'country', 'city'] as const
type Field = typeof FIELDS[number]

interface Served {
  kol_id: string; kol_platform: string | null; platform: string
  female_pct: number | null; male_pct: number | null
  gender_measured: string | null; age_measured: string | null; country_measured: string | null; city_measured: string | null
  curated_gender: string | null; curated_age: string | null; curated_country: string | null; curated_city: string | null
  gender_final: string | null; age_final: string | null; country_final: string | null; city_final: string | null
}

/** kolGold treats an empty or 'unknown' curated value as no label. */
const usableLabel = (v: string | null | undefined) => {
  const t = (v ?? '').trim()
  return t && t.toLowerCase() !== 'unknown' ? t : null
}
/** kolGold's rule for a KOL with several accounts: rows by platform, first non-null wins. */
const firstOf = <K extends keyof Served>(rows: Served[], k: K): Served[K] | null =>
  rows.find(r => r[k] !== null && r[k] !== undefined)?.[k] ?? null
const slicesOf = (a: GoldAudience, f: Field) =>
  f === 'gender' ? a.gender : f === 'age' ? a.age : f === 'country' ? a.countries : a.cities
const coverageOf = (a: GoldAudience, f: Field) =>
  f === 'gender' ? a.coverage.gender : f === 'age' ? a.coverage.age : f === 'country' ? a.coverage.geo : null
const dash = (s: string) => s.replace(/[–—]/g, '-').trim().toLowerCase()

async function listAll(q: KolDirectoryQuery): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = []
  let total = 0
  for (let page = 1; page <= 500; page++) {
    const r = await listKolDirectory({ ...q, page, pageSize: 60 })
    total = r.total
    ids.push(...r.rows.map(x => x.id))
    if (ids.length >= r.total || !r.rows.length) break
  }
  return { ids, total }
}

/** Duplicates, missing and extra ids of one directory answer, all recorded. */
function compareSet(category: string, got: { ids: string[]; total: number }, want: Set<string>, why: string) {
  const g = new Set(got.ids)
  check(g.size === got.ids.length, {
    category: `${category}.duplicate`, expected: g.size, actual: got.ids.length,
    reason: 'a KOL appears more than once in the list',
  })
  check(got.total === got.ids.length, {
    category: `${category}.total`, expected: got.ids.length, actual: got.total,
    reason: 'total_count disagrees with the rows paged out',
  })
  for (const id of want) if (!g.has(id)) check(false, { category: `${category}.missing`, kolId: id, expected: 'in list', actual: 'absent', reason: why })
  for (const id of g) if (!want.has(id)) check(false, { category: `${category}.extra`, kolId: id, expected: 'absent', actual: 'in list', reason: why })
}

async function main() {
  const db = kolDb()

  // ---- session guard: nothing else runs unless the session refuses writes ------
  const ro = await db.query<{ default_transaction_read_only: string }>('SHOW default_transaction_read_only')
  if (ro.rows[0]?.default_transaction_read_only !== 'on') {
    console.error('ABORT: the KOL session is not read-only (default_transaction_read_only != on). Nothing was read.')
    process.exit(2)
  }
  console.log('session: default_transaction_read_only = on')

  // ---- pure: the fallback helper kolGold uses (kept from the source) -----------
  const measured = [{ label: 'ID', pct: 90, n: 9 }, { label: 'MY', pct: 10, n: 1 }]
  const m = withCuratedFallback(measured, true, 'SG')
  check(m.source === 'measured' && m.slices === measured,
    { category: 'pure.measured_wins', expected: 'measured', actual: m.source, reason: 'usable measured must beat a curated label' })
  const u = withCuratedFallback(measured, false, 'SG')
  check(u.source === 'curated' && u.slices.length === 1 && u.slices[0].label === 'SG' && u.slices[0].n === 0,
    { category: 'pure.unusable_to_curated', expected: 'curated SG, n=0', actual: u, reason: 'unusable measured falls back to the label' })
  const none = withCuratedFallback([], false, null)
  check(none.source === null && none.slices.length === 0,
    { category: 'pure.no_fabricated_slice', expected: 'null, []', actual: none, reason: 'neither source must yield nothing' })
  // Target-only: kolGold drops an 'unknown' curated label (UNCLASSIFIED).
  const unk = withCuratedFallback([], false, 'unknown')
  check(unk.source === null, { category: 'pure.unknown_label', expected: null, actual: unk.source, reason: "'unknown' is not a label" })
  // Removed from the source: countryLabel checks (not part of the target).

  // ---- population ----------------------------------------------------------------
  const active = await db.query<{ id: string }>(
    `SELECT kd.id::text AS id FROM public.kol_directory kd WHERE kd.directory_status = 'active'`)
  const activeIds = active.rows.map(r => r.id)
  const served = await db.query<Served>(
    `SELECT ksa.kol_id::text AS kol_id, pl.key AS kol_platform, s.platform,
            s.female_pct::float8 AS female_pct, s.male_pct::float8 AS male_pct,
            s.gender_measured, s.age_measured, s.country_measured, s.city_measured,
            s.curated_gender, s.curated_age, s.curated_country, s.curated_city,
            s.gender_final, s.age_final, s.country_final, s.city_final
       FROM public.kol_directory kd
       LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
       JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       JOIN (${AUDIENCE_SERVED}) s ON s.social_account_id = ksa.social_account_id
      WHERE kd.directory_status = 'active'
      ORDER BY ksa.kol_id, s.platform`)
  const byKol = new Map<string, Served[]>()
  for (const r of served.rows) {
    const list = byKol.get(r.kol_id)
    if (list) list.push(r)
    else byKol.set(r.kol_id, [r])
  }
  console.log(`active KOL: ${activeIds.length}, with an Analysis Audience row: ${byKol.size}, served rows: ${served.rows.length}`)
  for (const [id, rows] of byKol) {
    // The source asserted one row per KOL; kolGold handles several (first non-null
    // by platform), so several accounts are counted, not failed.
    if (rows.length > 1) note('info', { category: 'served.multi_account', kolId: id, expected: 1, actual: rows.length, reason: 'kolGold takes the first non-null per field' })
  }

  // ---- B. AUDIENCE_SERVED: final = measured when usable, else curated --------------
  const bothPresent: Record<Field, number> = { gender: 0, age: 0, country: 0, city: 0 }
  for (const r of served.rows) {
    // Adapted from the source's table check: each row comes from its platform's table.
    if (r.kol_platform && r.platform !== r.kol_platform) {
      note('warning', { category: 'served.platform_table', kolId: r.kol_id, expected: r.kol_platform, actual: r.platform,
        reason: 'audience row read from the other platform table than the directory row' })
    }
    for (const f of FIELDS) {
      const mv = r[`${f}_measured`], cv = r[`curated_${f}`], fv = r[`${f}_final`]
      const want = mv ?? cv ?? null
      check(fv === want, { category: 'served.final_rule', kolId: r.kol_id, field: f, expected: want, actual: fv,
        reason: 'final must be measured when usable, else curated, else null' })
      if (mv && cv) bothPresent[f]++
      if (!mv && cv && !usableLabel(cv)) {
        note('warning', { category: 'served.unknown_curated_final', kolId: r.kol_id, field: f, expected: null, actual: fv,
          reason: "AUDIENCE_SERVED serves curated 'unknown' as final; kolGold shows no curated slice for it" })
      }
    }
  }

  // ---- C. detail reader (getKolGold) vs the classification ----------------------
  const cls: Record<Field, { measured: number; curated: number; none: number }> =
    Object.fromEntries(FIELDS.map(f => [f, { measured: 0, curated: 0, none: 0 }])) as never
  const detailFinal = new Map<string, Record<Field, string | null>>()
  for (const id of activeIds) {
    const rows = byKol.get(id) ?? []
    const gold = await getKolGold(id)
    const a = gold?.audience ?? null
    const fin = {} as Record<Field, string | null>
    for (const f of FIELDS) {
      const mv = firstOf(rows, `${f}_measured`) as string | null
      const cv = usableLabel(firstOf(rows, `curated_${f}`) as string | null)
      const fv = firstOf(rows, `${f}_final`) as string | null
      fin[f] = a?.final[f] ?? null
      const want: AudienceSource = mv ? 'measured' : cv ? 'curated' : null
      const got: AudienceSource = a?.source[f] ?? null
      const slices = a ? slicesOf(a, f) : []
      cls[f][want ?? 'none']++

      check(fin[f] === fv, { category: 'detail.final', kolId: id, field: f, expected: fv, actual: fin[f],
        reason: 'GoldAudience.final must equal the served final (first non-null by platform)' })

      if (want === 'measured') {
        if (got === 'measured') {
          if (slices.some(s => !(s.n > 0))) {
            check(false, { category: 'detail.measured_slice_without_count', kolId: id, field: f, expected: 'n > 0', actual: slices,
              reason: 'a measured chart slice has no follower count behind it' })
          }
          // Case C: usable in the classification, but the target reader's top slice differs.
          const top = slices[0]
          const differs = f === 'gender'
            ? (mv === 'balanced' ? top.pct >= GENDER_SHARE_MIN : dash(top.label) !== dash(mv!))
            : dash(top.label) !== dash(mv!)
          if (differs) {
            note('warning', { category: 'detail.top_slice_differs', kolId: id, field: f, expected: mv,
              actual: `${top.label} ${top.pct}% (n=${top.n}) of ${slices.length} slices`,
              reason: 'the classification and the target L2/audienceGeoFor reader read different rows' })
          }
        } else if (got === null && slices.length === 0) {
          // Case B: usable in the classification, but the target reader has no slices.
          note('warning', { category: 'detail.measured_usable_no_slices', kolId: id, field: f, expected: `measured ${mv}`, actual: 'no slices',
            reason: 'classification finds a usable value; the target reader returns nothing to chart' })
        } else {
          check(false, { category: 'detail.source', kolId: id, field: f, expected: want, actual: got, reason: 'usable measured must be served as measured' })
        }
      } else if (want === 'curated') {
        // Case A: curated is a label, never a chart.
        check(got === 'curated', { category: 'detail.source', kolId: id, field: f, expected: 'curated', actual: got,
          reason: 'unusable measured with a curated label must be served as curated' })
        check(slices.length === 1 && slices[0].label === cv && slices[0].n === 0, {
          category: 'detail.curated_slice_shape', kolId: id, field: f, expected: `[${cv}, n=0]`, actual: slices,
          reason: 'the curated fallback is one label slice with no count, never mixed with measured slices' })
        if (a && f !== 'city') {
          check(coverageOf(a, f) === null, { category: 'detail.curated_has_coverage', kolId: id, field: f, expected: null, actual: coverageOf(a, f),
            reason: 'a curated dimension has no classified share to report' })
        }
      } else {
        check(got === null && slices.length === 0, { category: 'detail.source', kolId: id, field: f, expected: null,
          actual: { got, slices: slices.length }, reason: 'neither measured nor curated must show nothing' })
      }
    }
    detailFinal.set(id, fin)
  }

  // ---- D. directory: population, Audience Gender / Age filters ------------------
  const activeSet = new Set(activeIds)
  compareSet('directory.population', await listAll({}), activeSet, 'the unfiltered list is the active roster')

  const anyServed = (pred: (s: Served) => boolean) =>
    new Set([...byKol].filter(([, rows]) => rows.some(pred)).map(([id]) => id))
  const genderSets = new Map<string, Set<string>>()
  for (const gv of ['female', 'male', 'balanced']) {
    // EXISTS over any account, as the directory SQL does.
    const want = anyServed(s => s.gender_final === gv)
    genderSets.set(gv, want)
    const got = await listAll({ audienceGender: gv })
    compareSet(`directory.gender[${gv}]`, got, want, 'Audience Gender filter = AUDIENCE_SERVED.gender_final')
    for (const id of got.ids) {
      if (detailFinal.get(id)?.gender !== gv) {
        note('warning', { category: 'directory.filter_vs_detail_final', kolId: id, field: 'gender', expected: gv, actual: detailFinal.get(id)?.gender ?? null,
          reason: 'filter matches any account; the profile shows the first account per field' })
      }
    }
  }
  const ageValues = new Set<string>([...AGE_BUCKETS, ...served.rows.map(s => s.age_final).filter((v): v is string => !!v)])
  for (const av of ageValues) {
    if (!(AGE_BUCKETS as readonly string[]).includes(av)) {
      note('warning', { category: 'directory.age_value_not_selectable', field: 'age', expected: AGE_BUCKETS.join('|'), actual: av,
        reason: 'a served age value has no chip in the filter UI' })
    }
    const want = anyServed(s => s.age_final === av)
    const got = await listAll({ audienceAge: av })
    compareSet(`directory.age[${av}]`, got, want, 'Audience Age filter = AUDIENCE_SERVED.age_final')
    for (const id of got.ids) {
      if (detailFinal.get(id)?.age !== av) {
        note('warning', { category: 'directory.filter_vs_detail_final', kolId: id, field: 'age', expected: av, actual: detailFinal.get(id)?.age ?? null,
          reason: 'filter matches any account; the profile shows the first account per field' })
      }
    }
  }

  // ---- E. existing measured behaviour: sliders stay on the card split ----------
  // Adapted: the source expected a curated fallback here; the target keeps HEAD.
  // Same card as BASE's lateral: highest followers_count first.
  const card = await db.query<{ kol_id: string; female_pct: number | null; male_pct: number | null }>(
    `SELECT DISTINCT ON (kd.id) kd.id::text AS kol_id,
            c.female_pct::float8 AS female_pct, c.male_pct::float8 AS male_pct
       FROM public.kol_directory kd
       JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
      WHERE kd.directory_status = 'active'
      ORDER BY kd.id, c.followers_count DESC NULLS LAST`)
  const cardBy = new Map(card.rows.map(r => [r.kol_id, r]))
  for (const [key, col, side] of [['minFemalePct', 'female_pct', 'female'], ['minMalePct', 'male_pct', 'male']] as const) {
    const want = new Set(activeIds.filter(id => (cardBy.get(id)?.[col] ?? -1) >= 60))
    const got = await listAll({ [key]: 60 })
    compareSet(`slider.${col}>=60`, got, want, 'the slider reads the card split only (HEAD behaviour)')
    const gotSet = new Set(got.ids)
    for (const [id, rows] of byKol) {
      const curatedOnly = !firstOf(rows, 'gender_measured') && usableLabel(firstOf(rows, 'curated_gender')) === side
      if (curatedOnly && !want.has(id)) {
        if (gotSet.has(id)) check(false, { category: 'slider.curated_leak', kolId: id, field: 'gender', expected: 'absent', actual: 'in list',
          reason: 'a curated label satisfied the card-only slider' })
        else note('info', { category: `slider.${side}_curated_not_used`, kolId: id, expected: 'absent', actual: 'absent',
          reason: 'curated-only creator correctly left to the gender filter, not the slider' })
      }
    }
  }

  // ---- F. geo: measured-only, as read by audienceGeoFor ------------------------
  // Adapted: the source expected a curated country/city fallback; the target has none.
  const dist = await audienceGeoFor(activeIds, db)
  const readerHas = (id: string, level: string, key: string) => (dist.get(id)?.[level]?.[key] ?? 0) > 0
  const raw = await db.query<{ kol_id: string; level: string; key: string }>(
    `SELECT DISTINCT ksa.kol_id::text AS kol_id, g.geo_level AS level, g.geo_key AS key
       FROM public.kol_directory kd
       JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
      WHERE kd.directory_status = 'active'`)
  const rawHas = new Set(raw.rows.map(r => `${r.kol_id}|${r.level}|${r.key}`))
  const topKeys = (level: string, k: number) => {
    const c = new Map<string, number>()
    for (const d of dist.values()) for (const key of Object.keys(d[level] ?? {})) c.set(key, (c.get(key) ?? 0) + 1)
    return [...c].sort((x, y) => y[1] - x[1]).slice(0, k).map(([key]) => key)
  }
  const curatedKeys = (f: 'country' | 'city', k: number, not: string[]) =>
    [...new Set(served.rows.map(s => usableLabel(s[`curated_${f}`])).filter((v): v is string => !!v && !not.includes(v)))].slice(0, k)
  const countryKeys = topKeys('country', 5)
  const cityKeys = topKeys('city', 3)
  const plan: ['country' | 'city', string][] = [
    ...[...countryKeys, ...curatedKeys('country', 2, countryKeys)].map(k => ['country', k] as ['country', string]),
    ...[...cityKeys, ...curatedKeys('city', 2, cityKeys)].map(k => ['city', k] as ['city', string]),
  ]
  const geoAnswers = new Map<string, Set<string>>()
  for (const [level, key] of plan) {
    const got = await listAll({ audienceGeoKey: key, audienceGeoLevel: level })
    const gotSet = new Set(got.ids)
    geoAnswers.set(`${level}|${key}`, gotSet)
    check(gotSet.size === got.ids.length, { category: 'geo.duplicate', field: level, expected: gotSet.size, actual: got.ids.length,
      reason: `${level}=${key}: a KOL appears more than once` })
    for (const id of activeIds) {
      const inReader = readerHas(id, level, key)
      const inRaw = rawHas.has(`${id}|${level}|${key}`)
      if (inReader && !gotSet.has(id)) check(false, { category: 'geo.missing', kolId: id, field: level, expected: key, actual: 'absent',
        reason: 'audienceGeoFor shows this key; the filter does not find the creator' })
      if (gotSet.has(id) && !inRaw) check(false, { category: 'geo.extra', kolId: id, field: level, expected: 'absent', actual: key,
        reason: 'the filter matched a creator with no geo row for this key' })
      if (gotSet.has(id) && inRaw && !inReader) note('warning', { category: 'geo.filter_matches_rows_reader_drops', kolId: id, field: level,
        expected: `absent (${key} not in audienceGeoFor)`, actual: 'in list',
        reason: 'filter matches any geo row; audienceGeoFor keeps only the newest measured snapshot / counts > 0' })
      // No curated geo fallback on the target filter.
      const rows = byKol.get(id) ?? []
      const curatedOnly = !firstOf(rows, `${level}_measured`) && usableLabel(firstOf(rows, `curated_${level}`)) === key
      if (curatedOnly && !inRaw) {
        if (gotSet.has(id)) check(false, { category: 'geo.curated_fallback_leak', kolId: id, field: level, expected: 'absent', actual: 'in list',
          reason: 'a curated label satisfied the measured-only geo filter' })
        else note('info', { category: 'geo.curated_not_filterable', kolId: id, field: level, expected: `profile shows curated ${key}`, actual: 'not in filter',
          reason: 'expected on the target: the geo filter is measured-only' })
      }
    }
  }
  if (countryKeys[0]) {
    const k = countryKeys[0]
    const noLevel = await listAll({ audienceGeoKey: k })
    const s = new Set(noLevel.ids)
    check(s.size === noLevel.ids.length, { category: 'geo.no_level_duplicate', expected: s.size, actual: noLevel.ids.length,
      reason: `${k} without a level: a KOL appears more than once` })
    const byCountry = geoAnswers.get(`country|${k}`) ?? new Set<string>()
    for (const id of byCountry) if (!s.has(id)) check(false, { category: 'geo.no_level_not_superset', kolId: id, expected: 'in list', actual: 'absent',
      reason: `${k} without a level must include every country=${k} match` })
    const combo = await listAll({ audienceGender: 'female', audienceGeoKey: k, audienceGeoLevel: 'country' })
    const female = genderSets.get('female') ?? new Set<string>()
    compareSet(`combo.female+country[${k}]`, combo, new Set([...byCountry].filter(id => female.has(id))),
      'combined filters = intersection of the single answers')
  }

  // ---- report ----------------------------------------------------------------------
  console.log('\nClassification per active KOL (detail rule: first non-null by platform)')
  console.log('  field    | measured | curated | none  | both measured+curated (measured served)')
  for (const f of FIELDS) {
    console.log(`  ${f.padEnd(8)} | ${String(cls[f].measured).padStart(8)} | ${String(cls[f].curated).padStart(7)} | ${String(cls[f].none).padStart(5)} | ${bothPresent[f]}`)
  }
  for (const level of ['error', 'warning', 'info'] as const) {
    const byCat = new Map<string, Finding[]>()
    for (const x of findings[level]) {
      const list = byCat.get(x.category)
      if (list) list.push(x)
      else byCat.set(x.category, [x])
    }
    console.log(`\n${level.toUpperCase()}S: ${findings[level].length}`)
    for (const [cat, list] of [...byCat].sort()) {
      console.log(`  ${cat}: ${list.length}`)
      if (level === 'info') continue
      for (const x of list.slice(0, 5)) {
        console.log(`    - ${x.kolId ?? ''}${x.field ? ` [${x.field}]` : ''} expected=${JSON.stringify(x.expected)} actual=${JSON.stringify(x.actual)} — ${x.reason}`)
      }
    }
  }
  console.log(`\n${checks} checks, ${findings.error.length} errors, ${findings.warning.length} warnings, ${findings.info.length} info`)
  process.exitCode = findings.error.length ? 1 : 0
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => {
    try { await kolDb().end() } catch { /* pool never opened (e.g. env missing) */ }
  })
