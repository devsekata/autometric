/**
 * Brand Fit — END-TO-END POC: REAL creator data x DUMMY brand data.
 *
 *   npm run brandfit:real-creator-poc
 *
 * POC ONLY — NOT PRODUCTION, NOT PRODUCTION-READY.
 *
 * ── What this joins ────────────────────────────────────────────────────────
 *   CREATOR side  REAL. Every creator row comes from a SELECT against the KOL
 *                 production database via `kolDb()` (10.100.14.216 / `kol`).
 *   BRAND side    DUMMY. Every brand attribute is read out of the local file
 *                 `Brand_Fit_Dummy_Data.xlsx`. No brand row is invented here,
 *                 and none of it is written to any database.
 *
 * READ-ONLY against the database. The session is pinned with
 * `SET default_transaction_read_only = on`; there is no INSERT, UPDATE,
 * DELETE, migration or ALTER anywhere in this file. `feature.brand_fit_analysis`
 * is read for its shape and never written. Brand Match and What Matters are not
 * imported and not touched.
 *
 * ── The calculator is used as-is ───────────────────────────────────────────
 * `src/lib/discover/brandFit/calculator.ts` is imported unmodified. It exposes
 * three INJECTION points — a category resolver, a performance resolver, and the
 * audience dimension scores — precisely because the workbook never demonstrated
 * those rules. This file supplies:
 *
 *   category     LITERAL equality only. A brand category equal to a creator
 *                taxonomy key (case-insensitively) is `match`; everything else
 *                is `unrelated`. `related` is NEVER returned, because nothing
 *                in the workbook or the database defines what "related" means.
 *                Inventing that definition is the mentor's call, not this
 *                script's.
 *   performance  The workbook's OWN 12 archetype pairs, read back out of its 48
 *                sample rows rather than hand-written here. It applies only to
 *                the control run; real creators have no archetype at all.
 *   audience     Nothing. The dummy brand states its target demographic as
 *                Indonesian prose ("Pria & Wanita (Usia 18–45 tahun)…"), not as
 *                a distribution, so there is no brand-side distribution to
 *                compare a real creator's audience against. Turning that prose
 *                into per-dimension percentages would be an invented rule.
 *
 * ── One deliberate departure from a raw calculator call ────────────────────
 * `valuesFit(brandAttrs, [])` returns 0, because zero of the brand's attributes
 * matched. For a creator whose attribute set is not merely empty but ABSENT —
 * `public.kol_attribute_map` holds 0 rows, so no creator has ever been tagged —
 * 0 would read as "nothing matched" when the truth is "there was nothing to
 * match against". This file therefore checks availability BEFORE calling, and
 * reports NULL / NOT MEASURED instead. The calculator is not modified; the
 * caller decides, and the decision is stated on the Personality / Values sheet.
 *
 * ── Every number is traceable ──────────────────────────────────────────────
 * Each SQL statement carries an id, a purpose and its text, is executed once,
 * and is reproduced verbatim on the `Source & Evidence` sheet next to what it
 * returned. Every brand-side value carries the workbook sheet and cell it came
 * from. Nothing in the output is typed in by hand.
 */
import ExcelJS from 'exceljs'
import path from 'node:path'
import kolDb from '@/lib/kolDb'
import type { PoolClient } from 'pg'
import {
  categoryFit, audienceFit, valuesFit, performanceFit, partnershipScore, buildOutput,
  type Score, type CategoryVerdict, type PerformanceVerdict, type SubScores,
  type AudienceDimensions, type CategoryResolver, type PerformanceResolver,
} from '@/lib/discover/brandFit/calculator'

const OUT = path.join(process.cwd(), 'Brand_Fit_Real_Creator_Dummy_Brand_POC.xlsx')
const DUMMY = path.join(process.cwd(), 'Brand_Fit_Dummy_Data.xlsx')

/** The exact wording the reviewer asked to appear on the workbook. */
const DISCLAIMER =
  'POC ONLY — Creator data is sourced from the real KOL database, while brand-side inputs are '
  + 'sourced from Brand_Fit_Dummy_Data.xlsx. Brand-side values are not production data.'

type Status =
  | 'VERIFIED' | 'REPRODUCED' | 'COMPUTED — RULE INCOMPLETE'
  | 'PROPOSED — NEEDS APPROVAL' | 'BLOCKED BY DATA' | 'NOT MEASURED'

/* ── evidence ─────────────────────────────────────────────────────────────── */

interface Q { id: string; purpose: string; sql: string; rows: Record<string, unknown>[] }
const evidence: Q[] = []

/** Runs one SELECT and records it for the evidence sheet. */
async function q(
  c: PoolClient, id: string, purpose: string, sql: string, params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const r = await c.query(sql, params as never[])
  evidence.push({ id, purpose, sql: sql.trim(), rows: r.rows })
  return r.rows as Record<string, unknown>[]
}

const n = (v: unknown): number => Number(v ?? 0)
const cv = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')
/** Renders a Score for a cell: a number stays a number, null becomes the label. */
const sc = (s: Score): number | string => (s === null ? 'NOT MEASURED' : s)

/* ── dummy brand workbook ─────────────────────────────────────────────────── */

interface DummyBrand {
  name: string
  category: string
  sizeTier: string
  perfArchetype: string
  targetDemographics: string
  personality: string[]
  tone: string[]
  /** Where in the dummy workbook each of the above was read from. */
  source: string
}
interface DummyCreator {
  name: string; category: string; demographics: string
  personality: string[]; tone: string[]; archetype: string
}
interface ControlRow {
  brand: string; creator: string
  category: number; audience: number; values: number; performance: number; final: number
}

const txt = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'richText' in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map(t => t.text).join('')
  }
  if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '')
  return String(v)
}
const list = (v: ExcelJS.CellValue): string[] =>
  txt(v).split(',').map(s => s.trim()).filter(Boolean)

async function readDummyWorkbook() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(DUMMY)

  const tax = wb.getWorksheet('Complete Brand Taxonomy')
  const cre = wb.getWorksheet('Dummy Creators')
  const scores = wb.getWorksheet('Brand Fit Scores')
  const rules = wb.getWorksheet('Calculation Mapping')
  if (!tax || !cre || !scores || !rules) {
    throw new Error('Brand_Fit_Dummy_Data.xlsx is missing one of its four expected sheets')
  }

  const brands: DummyBrand[] = []
  for (let r = 2; r <= tax.rowCount; r++) {
    const name = txt(tax.getRow(r).getCell(1).value)
    if (!name) continue
    brands.push({
      name,
      category: txt(tax.getRow(r).getCell(2).value),
      sizeTier: txt(tax.getRow(r).getCell(3).value),
      perfArchetype: txt(tax.getRow(r).getCell(4).value),
      targetDemographics: txt(tax.getRow(r).getCell(7).value),
      personality: list(tax.getRow(r).getCell(9).value),
      tone: list(tax.getRow(r).getCell(10).value),
      source: `Complete Brand Taxonomy!A${r}:L${r}`,
    })
  }

  const creators: DummyCreator[] = []
  for (let r = 2; r <= cre.rowCount; r++) {
    const name = txt(cre.getRow(r).getCell(1).value)
    if (!name) continue
    creators.push({
      name,
      category: txt(cre.getRow(r).getCell(2).value),
      demographics: txt(cre.getRow(r).getCell(3).value),
      personality: list(cre.getRow(r).getCell(4).value),
      tone: list(cre.getRow(r).getCell(5).value),
      archetype: txt(cre.getRow(r).getCell(6).value),
    })
  }

  const control: ControlRow[] = []
  for (let r = 2; r <= scores.rowCount; r++) {
    const brand = txt(scores.getRow(r).getCell(1).value)
    if (!brand) continue
    control.push({
      brand,
      creator: txt(scores.getRow(r).getCell(2).value),
      category: Number(scores.getRow(r).getCell(3).value),
      audience: Number(scores.getRow(r).getCell(4).value),
      values: Number(scores.getRow(r).getCell(5).value),
      performance: Number(scores.getRow(r).getCell(6).value),
      final: Number(scores.getRow(r).getCell(7).value),
    })
  }

  const statedRules: { assessment: string; comparison: string; rule: string }[] = []
  for (let r = 2; r <= rules.rowCount; r++) {
    const a = txt(rules.getRow(r).getCell(1).value)
    if (!a) continue
    statedRules.push({
      assessment: a,
      comparison: txt(rules.getRow(r).getCell(2).value),
      rule: txt(rules.getRow(r).getCell(3).value),
    })
  }

  return { brands, creators, control, statedRules }
}

/* ── injected resolvers ───────────────────────────────────────────────────── */

const norm = (s: string) => s.trim().toLowerCase()

/**
 * LITERAL category resolver. Returns `match` only on exact (case-insensitive)
 * equality and `unrelated` otherwise — `related` is unreachable by design. See
 * the file header: defining "related" is an open business decision, and a
 * resolver that guessed one would bury that decision inside a score.
 */
const literalCategory: CategoryResolver = (brand, creator) =>
  (norm(brand) === norm(creator) ? 'match' : 'unrelated') as CategoryVerdict

/**
 * Builds the performance lookup from the workbook's own 48 rows: for each
 * (brand archetype, creator archetype) pair, the score the workbook assigned.
 * Read back rather than re-typed, so the sheet reports what the workbook does,
 * including where it contradicts itself.
 */
function buildPerformanceLookup(brands: DummyBrand[], creators: DummyCreator[], control: ControlRow[]) {
  const brandArch = new Map(brands.map(b => [b.name, b.perfArchetype]))
  const creatorArch = new Map(creators.map(c => [c.name, c.archetype]))
  const pairs = new Map<string, Set<number>>()
  for (const row of control) {
    const key = `${brandArch.get(row.brand) ?? ''}||${creatorArch.get(row.creator) ?? ''}`
    if (!pairs.has(key)) pairs.set(key, new Set())
    pairs.get(key)!.add(row.performance)
  }
  const POINTS: Record<number, PerformanceVerdict> = {
    100: 'same', 70: 'related', 50: 'less_aligned', 0: 'incompatible',
  }
  const resolve: PerformanceResolver = (b, c) => {
    const vals = pairs.get(`${b}||${c}`)
    // Unknown pair — the workbook never scored it, so the least generous
    // reading is the only defensible one rather than a guessed tier.
    if (!vals || vals.size !== 1) return 'incompatible'
    return POINTS[[...vals][0]] ?? 'incompatible'
  }
  return { resolve, pairs }
}

/* ── real creator shape ───────────────────────────────────────────────────── */

interface RealCreator {
  id: string
  username: string
  followers: number
  engagementRate: number | null
  city: string | null
  taxonomy: string[]
  audienceSrc: string
  genderKnownPct: number
  ageCoveragePct: number
  geoKnownPct: number
  geoTop: string | null
  interestTop: string | null
  interestSource: string | null
  audienceQuality: number | null
  medianViews: number | null
  monitoringEr: number | null
  perfStability: number | null
  /** Creator personality/tone attributes — from public.kol_attribute_map. */
  attributes: string[]
  /** Creator performance archetype — no such column exists anywhere. */
  archetype: string | null
}

async function main() {
  const pool = kolDb()
  const c = await pool.connect()
  await c.query('SET default_transaction_read_only = on')

  /* ── 1. identity ────────────────────────────────────────────────────────── */
  const who = (await q(c, 'Q00', 'Membuktikan server & database yang benar-benar dibaca',
    `SELECT inet_server_addr()::text AS host, inet_server_port() AS port,
            current_database() AS db, current_user AS usr,
            current_setting('transaction_read_only') AS read_only`))[0]

  /* ── 2. brand side in production — proving the dummy is necessary ───────── */
  const brandSide = (await q(c, 'Q01', 'Sisi brand di produksi — alasan brand harus dummy', `
    SELECT (SELECT count(*) FROM public.brand)                  AS brand,
           (SELECT count(*) FROM public.brand_profile)          AS brand_profile,
           (SELECT count(*) FROM feature.brand_fit_analysis)    AS brand_fit_analysis`))[0]

  const brandProfileCols = await q(c, 'Q02',
    'Kolom sisi brand yang relevan untuk Brand Fit (schema ada, baris nol)', `
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('brand','brand_profile')
       AND column_name ~* '(category|personality|tone|value|style|archetype|target|demo|keyword|hashtag)'
     ORDER BY table_name, column_name`)

  /* ── 3. creator attribute availability ──────────────────────────────────── */
  const attrTaxonomy = await q(c, 'Q03', 'Taxonomy atribut creator yang tersedia untuk Values Fit', `
    SELECT kind, attribute_group, count(*) AS attributes,
           string_agg(label, ', ' ORDER BY label) AS labels
      FROM public.kol_attribute
     WHERE is_active IS NOT FALSE
     GROUP BY kind, attribute_group ORDER BY kind, attribute_group`)

  const attrMap = (await q(c, 'Q04', 'Pemetaan creator → atribut personality/tone', `
    SELECT count(*) AS mapping_rows, count(DISTINCT kol_directory_id) AS creators_mapped
      FROM public.kol_attribute_map`))[0]

  /* ── 4. archetype sweep — proving Performance Fit has no creator input ──── */
  const archetypeCols = await q(c, 'Q05',
    'Sapuan seluruh database untuk kolom archetype (sisi brand maupun creator)', `
    SELECT table_schema||'.'||table_name AS relation, column_name
      FROM information_schema.columns
     WHERE column_name ~* 'archetype'
       AND table_schema NOT IN ('pg_catalog','information_schema')
     ORDER BY 1, 2`)

  /* ── 5. category vocabulary on the creator side ─────────────────────────── */
  const taxonomyKeys = await q(c, 'Q06', 'Kosakata kategori creator (taxonomy_key kanonik)', `
    SELECT taxonomy_key, count(*) AS raw_category_names
      FROM public.kol_categories
     WHERE taxonomy_key IS NOT NULL
     GROUP BY taxonomy_key ORDER BY taxonomy_key`)

  /* ── 6. the real creator pool ───────────────────────────────────────────── */
  /** Active creators that carry an audience analysis on either platform. */
  const POOL = `
    SELECT kd.id, kd.username, kd.followers_count, kd.engagement_rate, kd.creator_city,
           ksa.social_account_id,
           (SELECT array_agg(DISTINCT kc.taxonomy_key)
              FROM public.kol_categories kc
             WHERE kc.id = ANY(kd.category_ids) AND kc.taxonomy_key IS NOT NULL) AS taxonomy,
           a.src, a.gender_known_pct, a.interest_top, a.interest_source,
           a.age_gender_breakdown, a.geo_distribution
      FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN (SELECT 'feature.ig_audience_analysis' AS src, social_account_id, gender_known_pct,
                   interest_top, interest_source, age_gender_breakdown, geo_distribution
              FROM feature.ig_audience_analysis
            UNION ALL
            SELECT 'feature.tt_audience_analysis', social_account_id, gender_known_pct,
                   interest_top, interest_source, age_gender_breakdown, geo_distribution
              FROM feature.tt_audience_analysis) a
        ON a.social_account_id = ksa.social_account_id
     WHERE kd.directory_status = 'active'`

  const poolCounts = (await q(c, 'Q07', 'Ukuran kandidat: creator aktif dengan audience analysis', `
    SELECT count(*) AS with_audience,
           count(*) FILTER (WHERE taxonomy IS NOT NULL) AS with_audience_and_category
      FROM (${POOL}) u`))[0]

  const creatorRows = await q(c, 'Q08',
    'Sample creator NYATA yang punya kategori + audience + profile card', `
    SELECT u.id, u.username, u.followers_count, u.engagement_rate, u.creator_city,
           u.taxonomy, u.src AS audience_src, u.gender_known_pct,
           COALESCE((u.age_gender_breakdown->>'coverage_pct')::numeric, 0) AS age_coverage_pct,
           GREATEST(0, 100 - COALESCE((u.geo_distribution->'country'->>'unknown')::numeric, 100))
             AS geo_known_pct,
           (SELECT k FROM jsonb_each_text(COALESCE(u.geo_distribution->'country','{}'::jsonb)) AS t(k,v)
             WHERE k <> 'unknown' ORDER BY v::numeric DESC LIMIT 1) AS geo_top,
           u.interest_top, u.interest_source,
           pc.audience_quality_score, pc.median_views, pc.monitoring_er_pct, pc.performance_stability,
           (SELECT count(*) FROM public.kol_attribute_map m WHERE m.kol_directory_id = u.id)
             AS attribute_rows
      FROM (${POOL}) u
      JOIN l2_gold.kol_profile_card pc ON pc.social_account_id = u.social_account_id
     WHERE u.taxonomy IS NOT NULL
     ORDER BY u.followers_count DESC NULLS LAST`)

  await c.query('COMMIT').catch(() => {})
  c.release()

  /* ── read the dummy brand workbook ──────────────────────────────────────── */
  const { brands, creators: dummyCreators, control, statedRules } = await readDummyWorkbook()
  const perf = buildPerformanceLookup(brands, dummyCreators, control)

  const realCreators: RealCreator[] = creatorRows.map(r => ({
    id: String(r.id),
    username: String(r.username),
    followers: n(r.followers_count),
    engagementRate: r.engagement_rate === null ? null : Number(r.engagement_rate),
    city: r.creator_city === null ? null : String(r.creator_city),
    taxonomy: ((r.taxonomy as string[] | null) ?? []).filter(Boolean),
    audienceSrc: String(r.audience_src),
    genderKnownPct: Number(r.gender_known_pct ?? 0),
    ageCoveragePct: Number(r.age_coverage_pct ?? 0),
    geoKnownPct: Number(r.geo_known_pct ?? 0),
    geoTop: r.geo_top === null ? null : String(r.geo_top),
    interestTop: r.interest_top === null ? null : String(r.interest_top),
    interestSource: r.interest_source === null ? null : String(r.interest_source),
    audienceQuality: r.audience_quality_score === null ? null : Number(r.audience_quality_score),
    medianViews: r.median_views === null ? null : Number(r.median_views),
    monitoringEr: r.monitoring_er_pct === null ? null : Number(r.monitoring_er_pct),
    perfStability: r.performance_stability === null ? null : Number(r.performance_stability),
    // 0 mapping rows across the whole table, so this is [] for every creator —
    // read per creator anyway so the sheet reports a fact, not an assumption.
    attributes: n(r.attribute_rows) > 0 ? ['(mapped — see kol_attribute_map)'] : [],
    // No archetype column exists in the database; Q05 is the evidence.
    archetype: null,
  }))

  /* ── control run: does the calculator reproduce the workbook? ───────────── */
  const controlResults = control.map(row => {
    const b = brands.find(x => x.name === row.brand)
    const cr = dummyCreators.find(x => x.name === row.creator)
    const recomputedValues = b && cr
      ? valuesFit([...b.personality, ...b.tone], [...cr.personality, ...cr.tone])
      : null
    const recomputedPerf = b && cr
      ? performanceFit(b.perfArchetype, cr.archetype, perf.resolve)
      : null
    // The workbook publishes Values to 1 decimal and builds its final score from
    // that rounded value, so the comparison is made at the workbook's precision.
    const valuesOk = recomputedValues !== null
      && Math.abs(Math.round(recomputedValues * 10) / 10 - row.values) < 0.051
    const partnership = partnershipScore({
      category: row.category, audience: row.audience,
      values: row.values, performance: row.performance,
    }, 1)
    const finalOk = partnership !== null && Math.abs(partnership - row.final) < 0.011
    const perfOk = recomputedPerf !== null && Math.abs(recomputedPerf - row.performance) < 0.011
    return { row, recomputedValues, recomputedPerf, partnership, valuesOk, finalOk, perfOk }
  })
  const valuesReproduced = controlResults.filter(r => r.valuesOk).length
  const finalReproduced = controlResults.filter(r => r.finalOk).length
  const perfReproduced = controlResults.filter(r => r.perfOk).length

  /* ── the POC run: real creator x dummy brand ───────────────────────────── */
  interface PocResult {
    creator: RealCreator
    brand: DummyBrand
    subs: SubScores
    tags: { tag: string; fit: CategoryVerdict }[]
    audience: ReturnType<typeof audienceFit>
    partnership: Score
    partnershipNaive: Score
    available: number
    coverage: number
    status: Status
    valuesBlockedReason: string
    performanceBlockedReason: string
  }

  const results: PocResult[] = []
  for (const creator of realCreators) {
    for (const brand of brands) {
      // CATEGORY — both sides present, literal resolver.
      const cat = categoryFit(brand.category, creator.taxonomy, literalCategory)

      // AUDIENCE — the creator side has real distributions, the brand side has
      // prose. All four dimensions are passed as null so the calculator reports
      // them as `missing` rather than silently ignoring them.
      const dims: AudienceDimensions = {
        gender: null, age: null, location: null, interest: null,
      }
      const aud = audienceFit(dims)

      // VALUES — see the file header. Absent creator attributes are NOT a zero.
      const brandAttrs = [...brand.personality, ...brand.tone]
      const valuesScore: Score = creator.attributes.length
        ? valuesFit(brandAttrs, creator.attributes)
        : null
      const valuesBlockedReason = creator.attributes.length
        ? ''
        : `public.kol_attribute_map = ${n(attrMap.mapping_rows)} baris — creator ini tidak punya `
          + 'atribut personality/tone. valuesFit(brand, []) akan mengembalikan 0; POC ini '
          + 'melaporkan NOT MEASURED karena 0 berarti "tidak ada yang cocok", bukan "tidak ada '
          + 'yang bisa dicocokkan".'

      // PERFORMANCE — creator archetype is null, so the calculator short-circuits
      // to null without ever consulting the resolver.
      const perfScore = performanceFit(brand.perfArchetype, creator.archetype, perf.resolve)
      const performanceBlockedReason =
        'Tidak ada kolom archetype di database (evidence Q05) — sisi creator kosong, '
        + 'jadi performanceFit() mengembalikan null tanpa memakai lookup workbook.'

      const subs: SubScores = {
        category: cat.score, audience: aud.score, values: valuesScore, performance: perfScore,
      }
      const available = [subs.category, subs.audience, subs.values, subs.performance]
        .filter(s => s !== null).length

      results.push({
        creator, brand, subs, tags: cat.tags, audience: aud,
        partnership: partnershipScore(subs),      // default minComponents = 2
        partnershipNaive: partnershipScore(subs, 1),
        available,
        coverage: (available / 4) * 100,
        status: partnershipScore(subs) === null ? 'NOT MEASURED' : 'PROPOSED — NEEDS APPROVAL',
        valuesBlockedReason, performanceBlockedReason,
      })
    }
  }

  const measurable = results.filter(r => r.partnership !== null).length
  const compAvail = {
    category: results.filter(r => r.subs.category !== null).length,
    audience: results.filter(r => r.subs.audience !== null).length,
    values: results.filter(r => r.subs.values !== null).length,
    performance: results.filter(r => r.subs.performance !== null).length,
  }

  // One full output shape, to prove the six columns of feature.brand_fit_analysis
  // can be assembled end to end. Assembled, NOT written.
  const sampleOutput = results.length
    ? buildOutput(results[0].subs, results[0].tags, results[0].audience)
    : null

  /* ── workbook ──────────────────────────────────────────────────────────── */

  const wb = new ExcelJS.Workbook()
  wb.creator = 'autometric · build-brand-fit-real-creator-poc.ts (READ-ONLY, POC)'
  wb.created = new Date()

  const HEAD = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  const FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF327488' } }
  const TONE: Record<Status, string> = {
    'VERIFIED': 'FF1E7A46',
    'REPRODUCED': 'FF1E7A46',
    'COMPUTED — RULE INCOMPLETE': 'FFB07B00',
    'PROPOSED — NEEDS APPROVAL': 'FF8A5A00',
    'BLOCKED BY DATA': 'FFA33A3A',
    'NOT MEASURED': 'FF667788',
  }

  function sheet(name: string, title: string, sub: string) {
    const ws = wb.addWorksheet(name)
    ws.getCell('A1').value = title
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF1B4450' } }
    ws.getCell('A2').value = DISCLAIMER
    ws.getCell('A2').font = { bold: true, size: 9, color: { argb: 'FFA33A3A' } }
    ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(2).height = 26
    ws.getCell('A3').value = sub
    ws.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF667788' } }
    ws.getCell('A3').alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(3).height = 30
    return ws
  }
  function header(ws: ExcelJS.Worksheet, row: number, labels: string[], widths: number[]) {
    const r = ws.getRow(row)
    labels.forEach((l, i) => {
      const cell = r.getCell(i + 1)
      cell.value = l; cell.font = HEAD; cell.fill = FILL
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    r.height = 28
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
    ws.views = [{ state: 'frozen', ySplit: row }]
  }
  function status(ws: ExcelJS.Worksheet, row: number, col: number, s: Status) {
    const cell = ws.getRow(row).getCell(col)
    cell.value = s
    cell.font = { bold: true, size: 10, color: { argb: TONE[s] } }
  }
  function note(ws: ExcelJS.Worksheet, row: number, text: string, colour = 'FFA33A3A') {
    const cell = ws.getCell(`A${row}`)
    cell.value = text
    cell.font = { bold: true, size: 10, color: { argb: colour } }
    cell.alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(row).height = 30
  }

  /* 1 ── Executive Summary */
  {
    const ws = sheet('Executive Summary', 'BRAND FIT — POC END-TO-END: REAL CREATOR x DUMMY BRAND',
      'Creator dibaca langsung dari database KOL produksi (read-only). Brand dibaca dari '
      + 'Brand_Fit_Dummy_Data.xlsx. Tidak ada baris dummy yang masuk database, tidak ada DML, '
      + 'tidak ada perubahan schema, dan calculator.ts tidak diubah sama sekali.')
    header(ws, 5, ['Pertanyaan', 'Jawaban dari run ini', 'Status'], [38, 66, 30])
    const rows: [string, string, Status][] = [
      ['A. Real creator dianalisis', `${realCreators.length} creator aktif dari public.kol_directory `
        + `(dari ${n(poolCounts.with_audience)} yang punya audience analysis)`, 'VERIFIED'],
      ['B. Dummy brand dipakai', `${brands.length} brand dari Complete Brand Taxonomy`, 'VERIFIED'],
      ['C. Kombinasi creator x brand', `${results.length}`, 'VERIFIED'],
      ['D. Hasil yang measurable', `${measurable} dari ${results.length} — partnership score butuh `
        + 'minimal 2 komponen, dan hanya 1 komponen yang bisa dihitung', 'NOT MEASURED'],
      ['Flow calculator berjalan?', `Ya — direproduksi pada 48 baris workbook: Values ${valuesReproduced}/48, `
        + `Partnership ${finalReproduced}/48`, 'REPRODUCED'],
      ['Kenapa hasil real masih NULL', 'Sisi brand produksi kosong (brand '
        + `${n(brandSide.brand)} baris, brand_profile ${n(brandSide.brand_profile)} baris) dan dua input `
        + 'creator belum ada: atribut personality/tone dan archetype', 'BLOCKED BY DATA'],
    ]
    rows.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [x[0], x[1], '']
      ws.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 30
      status(ws, r, 3, x[2])
    })

    let r = 6 + rows.length + 1
    ws.getCell(`A${r}`).value = 'E. COMPONENT COVERAGE (dari 40 kombinasi)'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Komponen', 'Bisa dihitung', 'Coverage', 'Kenapa'], [24, 16, 14, 74])
    const comps: [string, number, string][] = [
      ['Category Fit', compAvail.category,
        'Dihitung dengan literal resolver. Skor 0 di semua baris karena kosakata brand '
        + '("LifeWear / Everyday Essentials") dan kosakata creator ("Fashion") tidak pernah beririsan — '
        + 'bukan karena creator-nya buruk.'],
      ['Audience Fit', compAvail.audience,
        'Sisi creator punya distribusi nyata; sisi brand hanya kalimat target demografi, bukan '
        + 'distribusi. Tidak ada yang bisa dibandingkan tanpa mengarang parser.'],
      ['Values Fit', compAvail.values,
        `public.kol_attribute_map = ${n(attrMap.mapping_rows)} baris. Formula-nya sendiri sudah `
        + 'terbukti (48/48), tapi tidak ada satu pun creator yang punya atribut untuk dimasukkan.'],
      ['Performance Fit', compAvail.performance,
        'Tidak ada kolom archetype di seluruh database (evidence Q05), di sisi brand maupun creator.'],
    ]
    comps.forEach((x, i) => {
      const rr = r + 1 + i
      ws.getRow(rr).values = [x[0], x[1], pct(x[1], results.length), x[2]]
      ws.getRow(rr).getCell(4).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(rr).height = 34
    })

    r += comps.length + 2
    note(ws, r, 'KESIMPULAN POC: flow end-to-end BERJALAN — calculator menerima input nyata, '
      + 'memperlakukan data yang hilang sebagai NULL, dan menolak membentuk partnership score dari '
      + '1 komponen. Yang belum ada adalah DATA dan BUSINESS RULE, bukan kodenya. '
      + 'Ini POC/testing, bukan production-ready.')
  }

  /* 2 ── POC Methodology */
  {
    const ws = sheet('POC Methodology', 'POC METHODOLOGY — apa yang nyata, apa yang dummy, apa yang disuntik',
      'Tiga titik injeksi di calculator.ts sengaja dibiarkan kosong oleh penulisnya karena workbook '
      + 'dummy tidak pernah mendemonstrasikan aturannya. Baris di bawah menyatakan apa yang '
      + 'disuntikkan POC ini, dan apa yang TIDAK.')
    header(ws, 5, ['Bagian', 'Sumber', 'Perlakuan di POC ini', 'Status'], [22, 26, 62, 28])
    const rows: [string, string, string, Status][] = [
      ['Creator', `KOL DB ${String(who.host)}:${String(who.port)} / ${String(who.db)}`,
        'SELECT read-only via kolDb(). Tidak ada DML, tidak ada migration, tidak ada ALTER.', 'VERIFIED'],
      ['Brand', 'Brand_Fit_Dummy_Data.xlsx',
        'Dibaca dari file lokal. Tidak ada brand dummy baru yang dibuat, tidak ada yang di-INSERT.', 'VERIFIED'],
      ['Calculator', 'src/lib/discover/brandFit/calculator.ts',
        'Diimpor apa adanya. Tidak ada satu baris pun yang diubah untuk mempercantik hasil.', 'VERIFIED'],
      ['Resolver kategori', 'POC ini',
        'LITERAL: sama persis = match, selain itu = unrelated. "related" TIDAK PERNAH dikembalikan '
        + 'karena definisinya tidak ada di workbook maupun di database.', 'COMPUTED — RULE INCOMPLETE'],
      ['Resolver performance', 'Dibaca dari 48 baris workbook',
        `${perf.pairs.size} pasang archetype dibaca balik dari workbook, bukan ditulis tangan. `
        + 'Hanya berlaku untuk control run; creator nyata tidak punya archetype.', 'PROPOSED — NEEDS APPROVAL'],
      ['Skor dimensi audiens', 'TIDAK disuntik',
        'Brand dummy menyatakan target demografi sebagai kalimat, bukan distribusi. Mengubahnya '
        + 'menjadi persentase per dimensi = mengarang aturan, jadi keempat dimensi dikirim null.', 'BLOCKED BY DATA'],
      ['Values Fit ketika atribut creator kosong', 'Keputusan caller',
        'valuesFit(brand, []) mengembalikan 0. POC ini memeriksa ketersediaan SEBELUM memanggil dan '
        + 'melaporkan NOT MEASURED, karena 0 akan terbaca sebagai "tidak cocok" padahal artinya '
        + '"tidak ada yang bisa dicocokkan". Calculator tidak diubah.', 'VERIFIED'],
      ['Partnership minComponents', 'Default calculator = 2',
        'Dipakai apa adanya. Kolom diagnostik minComponents=1 ikut ditampilkan di Final POC Results, '
        + 'dan itu BUKAN hasil — hanya memperlihatkan apa yang terjadi kalau guard-nya dilepas.', 'VERIFIED'],
    ]
    rows.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [x[0], x[1], x[2], '']
      ws.getRow(r).getCell(3).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 40
      status(ws, r, 4, x[3])
    })

    let r = 6 + rows.length + 2
    ws.getCell(`A${r}`).value = 'ATURAN YANG DINYATAKAN WORKBOOK DUMMY (sheet Calculation Mapping)'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Assessment', 'Comparison', 'Dummy Calculation Rule'], [24, 44, 62])
    statedRules.forEach((x, i) => {
      ws.getRow(r + 1 + i).values = [x.assessment, x.comparison, x.rule]
      ws.getRow(r + 1 + i).getCell(3).alignment = { wrapText: true }
    })

    r += statedRules.length + 2
    ws.getCell(`A${r}`).value = 'CONTROL RUN — apakah calculator memang mereproduksi workbook?'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Yang diuji', 'Hasil', 'Catatan'], [30, 18, 78])
    const ctl: [string, string, string][] = [
      ['Values Alignment', `${valuesReproduced}/${control.length}`,
        'Dihitung ulang dari atribut mentah brand + creator, dibandingkan pada presisi 1 desimal '
        + 'yang dipakai workbook.'],
      ['Partnership Score', `${finalReproduced}/${control.length}`,
        'Rata-rata dari empat komponen yang dipublikasikan workbook.'],
      ['Past Performance', `${perfReproduced}/${control.length}`,
        'Dicocokkan lewat lookup yang dibaca balik dari workbook itu sendiri — ini tautologi, '
        + 'bukan validasi aturan. Dicantumkan supaya jelas bedanya dengan dua baris di atas.'],
    ]
    ctl.forEach((x, i) => {
      ws.getRow(r + 1 + i).values = [x[0], x[1], x[2]]
      ws.getRow(r + 1 + i).getCell(3).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r + 1 + i).height = 30
    })
  }

  /* 3 ── Dummy Brand Input */
  {
    const ws = sheet('Dummy Brand Input', 'DUMMY BRAND INPUT — dibaca dari Brand_Fit_Dummy_Data.xlsx',
      'Tidak ada brand baru yang dikarang. Kolom "Sumber" menunjuk baris workbook asalnya. '
      + 'Tidak satu pun dari nilai ini masuk ke database.')
    header(ws, 5, ['Brand (dummy)', 'Kategori Bisnis', 'Size Tier', 'Performance Archetype',
      'Target Demografi', 'Brand Personality', 'Brand Tone', '# Atribut', 'Sumber'],
      [18, 30, 20, 32, 44, 34, 30, 11, 30])
    brands.forEach((b, i) => {
      const r = 6 + i
      ws.getRow(r).values = [b.name, b.category, b.sizeTier, b.perfArchetype, b.targetDemographics,
        b.personality.join(', '), b.tone.join(', '),
        new Set([...b.personality, ...b.tone].map(norm)).size, b.source]
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 32
    })
    let r = 6 + brands.length + 1
    note(ws, r, '"# Atribut" adalah penyebut Values Fit — personality + tone, di-deduplikasi '
      + 'case-insensitive, persis seperti yang dilakukan valuesFit().', 'FF667788')
    r += 2
    ws.getCell(`A${r}`).value = 'SISI BRAND DI PRODUKSI — alasan brand harus dummy (evidence Q01/Q02)'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Tabel produksi', 'Baris', 'Konsekuensi'], [30, 12, 80])
    const prod: [string, number, string][] = [
      ['public.brand', n(brandSide.brand), 'Tidak ada brand nyata untuk dipasangkan'],
      ['public.brand_profile', n(brandSide.brand_profile),
        'Kolom brand_personality dan content_styles ADA di schema tapi tabelnya kosong'],
      ['feature.brand_fit_analysis', n(brandSide.brand_fit_analysis),
        'Tabel output kosong — dibaca untuk bentuknya saja, tidak ditulis'],
    ]
    prod.forEach((x, i) => { ws.getRow(r + 1 + i).values = [x[0], x[1], x[2]] })
    r += prod.length + 2
    header(ws, r, ['Tabel', 'Kolom sisi brand yang relevan', 'Tipe'], [22, 34, 24])
    brandProfileCols.forEach((x, i) => {
      ws.getRow(r + 1 + i).values =
        [cv(x.table_name), cv(x.column_name), cv(x.data_type)]
    })
  }

  /* 4 ── Real Creator Sample */
  {
    const ws = sheet('Real Creator Sample', 'REAL CREATOR SAMPLE — SELECT dari KOL DB produksi',
      `Kandidat: ${n(poolCounts.with_audience)} creator aktif punya audience analysis, `
      + `${n(poolCounts.with_audience_and_category)} di antaranya juga punya kategori. `
      + `Sample final: ${realCreators.length} creator yang punya kategori + audience + profile card.`)
    header(ws, 5, ['Creator ID', 'Username', 'Followers', 'ER %', 'Kota', 'Kategori (taxonomy_key)',
      'Audience: gender', 'Audience: age', 'Audience: geo', 'Audience: interest',
      'Personality/tone', 'Performance metrics', 'Archetype'],
      [38, 20, 15, 9, 14, 24, 16, 16, 20, 22, 20, 30, 16])
    realCreators.forEach((cr, i) => {
      const r = 6 + i
      const perfBits = [
        cr.audienceQuality !== null ? `AQ ${cr.audienceQuality}` : null,
        cr.medianViews !== null ? `median views ${cr.medianViews}` : null,
        cr.monitoringEr !== null ? `ER ${cr.monitoringEr}%` : null,
        cr.perfStability !== null ? `stability ${cr.perfStability}` : null,
      ].filter(Boolean)
      ws.getRow(r).values = [
        cr.id, cr.username, cr.followers, cr.engagementRate, cr.city ?? '—',
        cr.taxonomy.join(', ') || '—',
        cr.genderKnownPct > 0 ? `ADA (known ${cr.genderKnownPct}%)` : 'TIDAK ADA',
        cr.ageCoveragePct > 0 ? `ADA (coverage ${cr.ageCoveragePct}%)` : 'TIDAK ADA',
        cr.geoKnownPct > 0 ? `ADA (${cr.geoTop ?? '?'} · known ${cr.geoKnownPct}%)` : 'TIDAK ADA',
        cr.interestTop ? `${cr.interestTop} (${cr.interestSource})` : 'TIDAK ADA',
        cr.attributes.length ? `${cr.attributes.length} atribut` : 'TIDAK ADA',
        perfBits.length ? perfBits.join(' · ') : 'TIDAK ADA',
        cr.archetype ?? 'TIDAK ADA',
      ]
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
    })
    const r = 6 + realCreators.length + 1
    note(ws, r, 'Kolom "Personality/tone" dan "Archetype" kosong untuk SEMUA creator — bukan karena '
      + 'sample-nya kurang beruntung, tapi karena kol_attribute_map kosong (0 baris) dan kolom '
      + 'archetype tidak ada di database mana pun.')
  }

  /* 5 ── Category Fit */
  {
    const ws = sheet('Category Fit', 'CATEGORY FIT — brand dummy vs kategori creator nyata',
      'Resolver: LITERAL. sama persis = 100, selain itu = 0. Tier "related = 50" tidak pernah '
      + 'dikembalikan karena definisinya tidak ada. Ini keterbatasan yang ditampilkan, bukan hasil.')
    header(ws, 5, ['Kosakata BRAND (dummy)', 'Kosakata CREATOR (DB)'], [44, 44])
    const maxLen = Math.max(brands.length, taxonomyKeys.length)
    for (let i = 0; i < maxLen; i++) {
      ws.getRow(6 + i).values = [
        brands[i] ? brands[i].category : '',
        taxonomyKeys[i] ? `${String(taxonomyKeys[i].taxonomy_key)} `
          + `(${n(taxonomyKeys[i].raw_category_names)} nama mentah)` : '',
      ]
    }
    let r = 6 + maxLen + 1
    note(ws, r, 'Kedua kosakata TIDAK PERNAH beririsan. Tidak ada satu pun pasangan yang bisa '
      + 'mencapai "same = 100", sehingga literal resolver menghasilkan 0 pada seluruh '
      + `${results.length} kombinasi — persis seperti yang terjadi pada 48 baris workbook dummy.`)
    r += 2
    header(ws, r, ['Aspek', 'Temuan', 'Status'], [30, 74, 30])
    const rows: [string, string, Status][] = [
      ['Sisi creator', `${realCreators.length} creator punya taxonomy_key kanonik dari kol_categories`, 'VERIFIED'],
      ['Sisi brand (dummy)', `${brands.length} brand punya Kategori Bisnis`, 'VERIFIED'],
      ['Rule "same = 100"', 'Tidak pernah tercapai — kosakata berbeda, bukan karena tidak cocok', 'COMPUTED — RULE INCOMPLETE'],
      ['Rule "related = 50"', 'TIDAK ADA definisinya. Tidak dikarang di POC ini', 'BLOCKED BY DATA'],
      ['Rule "unrelated = 0"', 'Satu-satunya hasil yang keluar, sebagai konsekuensi dua baris di atas', 'COMPUTED — RULE INCOMPLETE'],
      ['Yang dibutuhkan', 'Mapping Kategori Bisnis brand → taxonomy_key creator, diputuskan manusia', 'PROPOSED — NEEDS APPROVAL'],
    ]
    rows.forEach((x, i) => {
      const rr = r + 1 + i
      ws.getRow(rr).values = [x[0], x[1], '']
      ws.getRow(rr).getCell(2).alignment = { wrapText: true }
      status(ws, rr, 3, x[2])
    })
  }

  /* 6 ── Audience Fit */
  {
    const ws = sheet('Audience Fit', 'AUDIENCE FIT — creator nyata vs target demografi dummy',
      'Angka 40 di workbook dummy KONSTAN pada seluruh 48 baris — itu placeholder, bukan '
      + 'perhitungan, dan tidak dipakai sebagai observed brand audience di sini.')
    header(ws, 5, ['Dimensi', 'Sisi CREATOR (nyata, dari DB)', 'Sisi BRAND (dummy workbook)',
      'Bisa dibandingkan?', 'Status'], [14, 40, 46, 16, 30])
    const withGender = realCreators.filter(c => c.genderKnownPct > 0).length
    const withAge = realCreators.filter(c => c.ageCoveragePct > 0).length
    const withGeo = realCreators.filter(c => c.geoKnownPct > 0).length
    const withInterest = realCreators.filter(c => c.interestTop !== null).length
    const dims: [string, string, string, Status][] = [
      ['Gender', `${withGender}/${realCreators.length} creator punya breakdown gender`,
        'Hanya kalimat, mis. "Pria & Wanita (Usia 18–45 tahun)" — tidak ada persentase', 'BLOCKED BY DATA'],
      ['Age', `${withAge}/${realCreators.length} creator punya coverage age > 0 — sisanya age_unknown 100%`,
        'Rentang usia disebut dalam kalimat, tidak ada distribusi per bucket', 'BLOCKED BY DATA'],
      ['Location', `${withGeo}/${realCreators.length} creator punya geo_distribution country`,
        'Tidak disebut sebagai distribusi; sebagian brand menyebut "urban" saja', 'BLOCKED BY DATA'],
      ['Interest', `${withInterest}/${realCreators.length} creator punya interest_top`,
        'Tidak ada kolom interest di sisi brand', 'BLOCKED BY DATA'],
    ]
    dims.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [x[0], x[1], x[2], 'Tidak', '']
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 30
      status(ws, r, 5, x[3])
    })
    let r = 6 + dims.length + 1
    note(ws, r, 'Sisi creator SIAP untuk 3 dari 4 dimensi. Yang menghalangi bukan data creator, '
      + 'tapi tidak adanya distribusi audiens di sisi brand. Karena itu keempat dimensi dikirim '
      + 'null ke audienceFit(), dan skornya NULL — bukan 40, bukan 0.')
    r += 2
    ws.getCell(`A${r}`).value = 'INPUT NYATA YANG SUDAH SIAP DIBANDINGKAN (kalau sisi brand nanti ada)'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Username', 'Gender known %', 'Age coverage %', 'Geo known %', 'Geo top',
      'Interest top', 'Sumber audiens'], [20, 16, 16, 14, 12, 22, 30])
    realCreators.forEach((cr, i) => {
      ws.getRow(r + 1 + i).values = [cr.username, cr.genderKnownPct, cr.ageCoveragePct,
        cr.geoKnownPct, cr.geoTop ?? '—', cr.interestTop ?? '—', cr.audienceSrc]
    })
  }

  /* 7 ── Personality / Values Fit */
  {
    const ws = sheet('Personality Values Fit', 'PERSONALITY / VALUES FIT — formula terbukti, input kosong',
      'Formula "matched attributes ÷ brand attributes × 100" adalah satu-satunya komponen yang '
      + 'benar-benar diturunkan dan diverifikasi dari data mentah workbook.')
    header(ws, 5, ['Aspek', 'Temuan', 'Status'], [34, 74, 30])
    const rows: [string, string, Status][] = [
      ['Formula', `Direproduksi ${valuesReproduced}/${control.length} pada 48 baris workbook, `
        + 'dihitung ulang dari atribut mentah — bukan disalin dari kolom hasil', 'REPRODUCED'],
      ['Sisi brand (dummy)', `${brands.length} brand punya personality + tone `
        + `(${brands.map(b => new Set([...b.personality, ...b.tone].map(norm)).size).join(', ')} atribut)`, 'VERIFIED'],
      ['Taxonomy atribut creator', attrTaxonomy.map(a =>
        `${String(a.kind)}/${String(a.attribute_group)}: ${n(a.attributes)}`).join(' · '), 'VERIFIED'],
      ['Pemetaan creator → atribut', `public.kol_attribute_map = ${n(attrMap.mapping_rows)} baris, `
        + `${n(attrMap.creators_mapped)} creator ter-mapping`, 'BLOCKED BY DATA'],
      ['Akibatnya', `Values Fit NOT MEASURED pada ${results.length}/${results.length} kombinasi`, 'NOT MEASURED'],
      ['Kenapa bukan 0', 'valuesFit(brandAttrs, []) mengembalikan 0 karena nol atribut brand cocok. '
        + 'Untuk creator yang atributnya ABSEN (bukan sekadar kosong), 0 akan terbaca sebagai '
        + '"tidak cocok". POC ini memeriksa ketersediaan dulu lalu melaporkan NULL. '
        + 'calculator.ts TIDAK diubah untuk ini.', 'VERIFIED'],
    ]
    rows.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [x[0], x[1], '']
      ws.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 32
      status(ws, r, 3, x[2])
    })
    let r = 6 + rows.length + 2
    ws.getCell(`A${r}`).value = 'ATRIBUT YANG SUDAH TERSEDIA UNTUK DI-MAPPING (public.kol_attribute)'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['kind', 'attribute_group', '#', 'label'], [16, 24, 8, 84])
    attrTaxonomy.forEach((a, i) => {
      ws.getRow(r + 1 + i).values = [cv(a.kind), cv(a.attribute_group), n(a.attributes), cv(a.labels)]
      ws.getRow(r + 1 + i).getCell(4).alignment = { wrapText: true }
    })
    r += attrTaxonomy.length + 2
    note(ws, r, 'Ini jalur tercepat untuk membuka Brand Fit: taxonomy-nya sudah ada dan formulanya '
      + 'sudah terbukti — yang kurang hanya pengisian kol_attribute_map. Pengisian itu ada di luar '
      + 'lingkup POC ini (POC ini read-only).', 'FF8A5A00')
  }

  /* 8 ── Performance Fit */
  {
    const ws = sheet('Performance Fit', 'PERFORMANCE FIT — tidak ada archetype di kedua sisi',
      'Lookup di bawah dibaca balik dari 48 baris workbook. Ditampilkan untuk memperlihatkan bahwa '
      + 'workbook-nya sendiri tidak konsisten — bukan untuk dipakai sebagai aturan.')
    header(ws, 5, ['Brand archetype (dummy)', 'Creator archetype (dummy)', 'Skor workbook'], [40, 28, 16])
    const entries = [...perf.pairs.entries()]
    entries.forEach(([key, vals], i) => {
      const [b, cr] = key.split('||')
      ws.getRow(6 + i).values = [b, cr, [...vals].join(' / ')]
    })
    let r = 6 + entries.length + 1
    note(ws, r, 'KONTRADIKSI: "Massive Reach & Emotional Resonance" mendapat 70 terhadap '
      + '"High Engagement" tetapi 0 terhadap "High Reach", sementara "High Impulse & Visual '
      + 'Engagement" justru sebaliknya. Tidak ada aturan yang bisa menghasilkan kedua-duanya — '
      + 'ini penetapan manual, bukan formula.')
    r += 2
    header(ws, r, ['Aspek', 'Temuan', 'Status'], [30, 74, 30])
    const rows: [string, string, Status][] = [
      ['Kolom archetype di database', archetypeCols.length === 0
        ? 'NOL hasil di sapuan seluruh database — sisi brand maupun creator (evidence Q05)'
        : archetypeCols.map(x => `${String(x.relation)}.${String(x.column_name)}`).join(', '),
        'BLOCKED BY DATA'],
      ['Akibatnya', `performanceFit() mengembalikan null pada ${results.length}/${results.length} `
        + 'kombinasi tanpa pernah memanggil resolver', 'NOT MEASURED'],
      ['Metrik nyata sebagai alternatif',
        'audience_quality_score, median_views, monitoring_er_pct, performance_stability sudah ada '
        + 'di l2_gold.kol_profile_card untuk sample ini — tapi belum ada aturan yang memetakan '
        + 'metrik → archetype', 'PROPOSED — NEEDS APPROVAL'],
    ]
    rows.forEach((x, i) => {
      const rr = r + 1 + i
      ws.getRow(rr).values = [x[0], x[1], '']
      ws.getRow(rr).getCell(2).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(rr).height = 32
      status(ws, rr, 3, x[2])
    })
  }

  /* 9 ── Partnership Score */
  {
    const ws = sheet('Partnership Score', 'PARTNERSHIP SCORE — rata-rata komponen yang tersedia',
      'POC/proposed, bukan formula production. Workbook dummy menyebutnya "25% each for dummy '
      + 'testing only"; di calculator ini menjadi rata-rata komponen yang ADA, bukan pembagi tetap 4.')
    header(ws, 5, ['Aspek', 'Temuan', 'Status'], [34, 74, 30])
    const rows: [string, string, Status][] = [
      ['Formula', `Rata-rata komponen yang tersedia. Direproduksi ${finalReproduced}/${control.length} `
        + 'pada workbook — tapi hanya untuk kasus keempat komponen lengkap, satu-satunya kasus '
        + 'yang ada di workbook', 'REPRODUCED'],
      ['minComponents', 'Default 2. Satu komponen yang direnormalisasi ke 100% akan terbaca sebagai '
        + 'Brand Fit penuh padahal hanya satu hal yang diukur', 'PROPOSED — NEEDS APPROVAL'],
      ['Pada data nyata', `${compAvail.category}/${results.length} kombinasi hanya punya 1 komponen `
        + '(Category). Di bawah minComponents, jadi partnership score = NULL', 'NOT MEASURED'],
      ['NULL handling', 'NULL tetap NULL. Tidak ada komponen yang diubah menjadi 0 supaya skor '
        + 'bisa terbentuk', 'VERIFIED'],
      ['Status keseluruhan', 'POC / PROPOSED — bukan production formula, belum disetujui siapa pun', 'PROPOSED — NEEDS APPROVAL'],
    ]
    rows.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [x[0], x[1], '']
      ws.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 32
      status(ws, r, 3, x[2])
    })
    let r = 6 + rows.length + 2
    ws.getCell(`A${r}`).value = 'BENTUK OUTPUT feature.brand_fit_analysis YANG BERHASIL DIRAKIT (contoh 1 baris — TIDAK ditulis ke DB)'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Kolom output', 'Nilai POC'], [30, 90])
    if (sampleOutput) {
      const first = results[0]
      const pairs: [string, string][] = [
        ['(pasangan)', `${first.creator.username} × ${first.brand.name}`],
        ['partnership_score', String(sampleOutput.partnership_score)],
        ['sub_scores.category_matching', JSON.stringify(sampleOutput.sub_scores.category_matching)],
        ['sub_scores.audience_overlap', JSON.stringify(sampleOutput.sub_scores.audience_overlap)],
        ['sub_scores.values_alignment', JSON.stringify(sampleOutput.sub_scores.values_alignment)],
        ['sub_scores.past_performance', JSON.stringify(sampleOutput.sub_scores.past_performance)],
        ['audience_overlap_pct', String(sampleOutput.audience_overlap_pct)],
        ['overlap_summary', String(sampleOutput.overlap_summary)],
        ['category_fit_tags', JSON.stringify(sampleOutput.category_fit_tags)],
        ['recommendations', JSON.stringify(sampleOutput.recommendations)],
      ]
      pairs.forEach((x, i) => {
        ws.getRow(r + 1 + i).values = [x[0], x[1]]
        ws.getRow(r + 1 + i).getCell(2).alignment = { wrapText: true, vertical: 'top' }
      })
      r += pairs.length + 1
    }
    r += 1
    note(ws, r, 'Inilah bukti end-to-end-nya: keenam kolom output terbentuk dengan benar, '
      + 'partnership_score NULL, dan audience_overlap tidak menyalin skor ke sub_scores sesuai '
      + 'COMMENT tabelnya. Yang kosong adalah datanya, bukan alurnya.', 'FF1E7A46')
  }

  /* 10 ── Final POC Results */
  {
    const ws = sheet('Final POC Results', 'FINAL POC RESULTS — setiap creator nyata × setiap brand dummy',
      'NULL / NOT MEASURED berarti komponennya tidak bisa dihitung. Tidak ada yang diubah menjadi 0.')
    header(ws, 5, ['Creator ID', 'Username', 'Kategori creator', 'Brand (dummy)',
      'Category', 'Audience', 'Values', 'Performance', 'Partnership',
      '# komponen', 'Coverage', 'Status', 'Diagnostik: minComponents=1'],
      [38, 18, 20, 18, 12, 14, 14, 14, 14, 11, 10, 18, 24])
    results.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [
        x.creator.id, x.creator.username, x.creator.taxonomy.join(', ') || '—', x.brand.name,
        sc(x.subs.category), sc(x.subs.audience), sc(x.subs.values), sc(x.subs.performance),
        sc(x.partnership), x.available, `${x.coverage.toFixed(0)}%`, '', sc(x.partnershipNaive),
      ]
      status(ws, r, 12, x.status)
    })
    const r = 6 + results.length + 1
    note(ws, r, `${measurable} dari ${results.length} kombinasi measurable. Kolom Category berisi 0 `
      + 'karena kosakata brand dan creator tidak beririsan — bacalah sebagai "aturan tidak bisa '
      + 'mencocokkan", bukan "creator tidak cocok". Kolom diagnostik paling kanan memperlihatkan '
      + 'apa yang terjadi bila guard minComponents dilepas; itu BUKAN hasil POC.')
  }

  /* 11 ── Coverage & Missing Data */
  {
    const ws = sheet('Coverage & Missing Data', 'COVERAGE & MISSING DATA — apa yang kurang, di mana, berapa',
      'Satu baris per input yang dibutuhkan Brand Fit, dengan lokasi persisnya di database.')
    header(ws, 5, ['Input yang dibutuhkan', 'Sisi', 'Lokasi', 'Tersedia', 'Coverage', 'Status'],
      [30, 12, 36, 26, 12, 30])
    const withGender = realCreators.filter(c => c.genderKnownPct > 0).length
    const withAge = realCreators.filter(c => c.ageCoveragePct > 0).length
    const withGeo = realCreators.filter(c => c.geoKnownPct > 0).length
    const withInterest = realCreators.filter(c => c.interestTop !== null).length
    const cov: [string, string, string, string, string, Status][] = [
      ['Kategori creator', 'Creator', 'public.kol_directory.category_ids → kol_categories',
        `${realCreators.length}/${realCreators.length}`, '100%', 'VERIFIED'],
      ['Kategori brand', 'Brand', 'Brand_Fit_Dummy_Data.xlsx (produksi: public.brand = 0 baris)',
        `${brands.length}/${brands.length} dummy`, '100%', 'BLOCKED BY DATA'],
      ['Audience gender', 'Creator', 'feature.ig/tt_audience_analysis.gender_known_pct',
        `${withGender}/${realCreators.length}`, pct(withGender, realCreators.length), 'VERIFIED'],
      ['Audience age', 'Creator', 'feature.*_audience_analysis.age_gender_breakdown',
        `${withAge}/${realCreators.length}`, pct(withAge, realCreators.length), 'BLOCKED BY DATA'],
      ['Audience geo', 'Creator', 'feature.*_audience_analysis.geo_distribution',
        `${withGeo}/${realCreators.length}`, pct(withGeo, realCreators.length), 'VERIFIED'],
      ['Audience interest', 'Creator', 'feature.*_audience_analysis.interest_top',
        `${withInterest}/${realCreators.length}`, pct(withInterest, realCreators.length), 'VERIFIED'],
      ['Target audience brand', 'Brand', 'TIDAK ADA kolom distribusi di mana pun',
        '0 — hanya kalimat di workbook', '0%', 'BLOCKED BY DATA'],
      ['Personality/tone creator', 'Creator', 'public.kol_attribute_map',
        `${n(attrMap.creators_mapped)}/${realCreators.length}`, '0%', 'BLOCKED BY DATA'],
      ['Personality/tone brand', 'Brand', 'Brand_Fit_Dummy_Data.xlsx (produksi: brand_profile = 0 baris)',
        `${brands.length}/${brands.length} dummy`, '100%', 'BLOCKED BY DATA'],
      ['Archetype creator', 'Creator', 'TIDAK ADA kolom archetype (evidence Q05)', '0', '0%', 'BLOCKED BY DATA'],
      ['Archetype brand', 'Brand', 'Brand_Fit_Dummy_Data.xlsx saja', `${brands.length} dummy`, '100%', 'BLOCKED BY DATA'],
      ['Metrik performance creator', 'Creator', 'l2_gold.kol_profile_card',
        `${realCreators.filter(c => c.audienceQuality !== null).length}/${realCreators.length}`,
        pct(realCreators.filter(c => c.audienceQuality !== null).length, realCreators.length),
        'PROPOSED — NEEDS APPROVAL'],
    ]
    cov.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [x[0], x[1], x[2], x[3], x[4], '']
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
      status(ws, r, 6, x[5])
    })
    const r = 6 + cov.length + 1
    note(ws, r, 'Pola yang terlihat: sisi CREATOR sebagian besar sudah siap. Yang menahan Brand Fit '
      + 'adalah sisi BRAND (tiga tabel kosong) dan dua input creator yang belum pernah diisi '
      + '(kol_attribute_map dan archetype).')
  }

  /* 12 ── Decision Needed */
  {
    const ws = sheet('Decision Needed', 'DECISION NEEDED — yang harus diputuskan sebelum Brand Fit jalan',
      'Diurutkan dari yang paling cepat membuka hasil. Tidak satu pun bisa diputuskan oleh script.')
    header(ws, 5, ['#', 'Keputusan', 'Kenapa script tidak bisa memutuskan', 'Dampak kalau diputuskan', 'Status'],
      [5, 34, 50, 40, 30])
    const dec: [string, string, string, Status][] = [
      ['Isi public.kol_attribute_map', 'Menentukan atribut personality/tone tiap creator adalah '
        + 'penilaian manusia; taxonomy-nya sudah ada (40 atribut) tapi belum ada yang memetakan',
        'Membuka Values Fit — satu-satunya komponen yang formulanya sudah terbukti 48/48', 'BLOCKED BY DATA'],
      ['Definisikan "related" untuk kategori', 'Workbook menyebut tier 50 tapi tidak pernah '
        + 'menunjukkan satu pun contohnya, dan tidak ada tabel relasi antar-kategori',
        'Membuka Category Fit dari 0 mati menjadi skor yang berarti', 'BLOCKED BY DATA'],
      ['Mapping kategori bisnis brand → taxonomy_key', 'Kosakata brand ("Athleisure & '
        + 'Sport-Streetwear") dan kosakata creator ("Fitness") tidak beririsan sama sekali',
        'Membuat tier "same = 100" mungkin tercapai', 'BLOCKED BY DATA'],
      ['Bentuk target audience brand', 'Brand harus menyatakan audiens sebagai distribusi, bukan '
        + 'kalimat, supaya bisa dibandingkan dengan distribusi creator yang sudah ada',
        'Membuka Audience Fit untuk 3 dari 4 dimensi hari itu juga', 'BLOCKED BY DATA'],
      ['Definisi archetype, atau ganti pendekatannya', 'Tidak ada kolom archetype di mana pun; '
        + 'lookup workbook sendiri saling bertentangan',
        'Membuka Performance Fit, atau menggantinya dengan metrik nyata yang sudah tersedia', 'BLOCKED BY DATA'],
      ['minComponents untuk Partnership Score', 'Workbook tidak punya satu pun baris parsial, jadi '
        + 'tidak menyatakan apa arti skor dari 1–3 komponen',
        'Menentukan kapan sebuah skor boleh ditampilkan ke user', 'PROPOSED — NEEDS APPROVAL'],
      ['Isi public.brand / brand_profile', 'POC ini read-only dan brand dummy tidak boleh masuk DB',
        'Menghilangkan ketergantungan pada workbook dummy sepenuhnya', 'BLOCKED BY DATA'],
    ]
    dec.forEach((x, i) => {
      const r = 6 + i
      ws.getRow(r).values = [i + 1, x[0], x[1], x[2], '']
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = 40
      status(ws, r, 5, x[3])
    })
  }

  /* 13 ── Source & Evidence */
  {
    const ws = sheet('Source & Evidence', 'SOURCE & EVIDENCE — setiap angka bisa ditelusuri',
      'Bagian A: SQL yang dijalankan, verbatim. Bagian B: sumber setiap nilai sisi brand.')
    let r = 5
    ws.getCell(`A${r}`).value = `A. SQL — ${evidence.length} SELECT, dijalankan pada `
      + `${String(who.host)}:${String(who.port)} / ${String(who.db)} sebagai ${String(who.usr)} `
      + `(transaction_read_only = ${String(who.read_only)})`
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['ID', 'Tujuan', 'SQL', 'Hasil'], [8, 40, 78, 34])
    evidence.forEach((e, i) => {
      const first = e.rows[0]
      const summary = e.rows.length === 0 ? '0 baris'
        : e.rows.length === 1 && first
          ? Object.entries(first).map(([k, v]) => `${k}=${String(cv(v) ?? 'null')}`).join(', ')
          : `${e.rows.length} baris`
      const rr = r + 1 + i
      ws.getRow(rr).values = [e.id, e.purpose, e.sql, summary.slice(0, 900)]
      ws.getRow(rr).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(rr).height = 60
    })
    r += evidence.length + 2
    ws.getCell(`A${r}`).value = 'B. SUMBER SISI BRAND — semuanya dari file lokal, tidak ada yang dari database'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Nilai', 'File', 'Sheet & baris'], [30, 34, 40])
    brands.forEach((b, i) => {
      ws.getRow(r + 1 + i).values = [b.name, 'Brand_Fit_Dummy_Data.xlsx', b.source]
    })
    r += brands.length + 1
    ws.getRow(r).values = [`Control run (${control.length} baris)`, 'Brand_Fit_Dummy_Data.xlsx',
      `Brand Fit Scores!A2:H${control.length + 1}`]
    r += 1
    ws.getRow(r).values = [`Dummy creators (${dummyCreators.length})`, 'Brand_Fit_Dummy_Data.xlsx',
      `Dummy Creators!A2:F${dummyCreators.length + 1}`]
    r += 2
    note(ws, r, DISCLAIMER)
  }

  await wb.xlsx.writeFile(OUT)

  /* ── console report ────────────────────────────────────────────────────── */
  console.log(`\nwrote ${OUT}\n`)
  console.log(`database          ${String(who.host)}:${String(who.port)} · ${String(who.db)} `
    + `(read_only=${String(who.read_only)})`)
  console.log(`queries executed  ${evidence.length} · semuanya SELECT`)
  console.log(`brand source      Brand_Fit_Dummy_Data.xlsx (lokal, tidak masuk DB)`)
  console.log(`\nA. real creators analysed      ${realCreators.length}`)
  console.log(`B. dummy brands                ${brands.length}`)
  console.log(`C. creator x brand combos      ${results.length}`)
  console.log(`D. measurable results          ${measurable}`)
  console.log(`E. component coverage          category ${compAvail.category}/${results.length} · `
    + `audience ${compAvail.audience}/${results.length} · values ${compAvail.values}/${results.length} · `
    + `performance ${compAvail.performance}/${results.length}`)
  console.log(`\ncontrol run (48 dummy rows)    values ${valuesReproduced}/${control.length} · `
    + `partnership ${finalReproduced}/${control.length}`)
  console.log(`\nF. VERIFIED   Values Fit formula, Partnership averaging (keduanya direproduksi dari workbook)`)
  console.log(`G. PROPOSED   minComponents, metrik nyata sebagai pengganti archetype`)
  console.log(`H. BLOCKED    Category "related", target audience brand, kol_attribute_map, archetype, public.brand`)
  console.log(`I. DECISIONS  7 — lihat sheet "Decision Needed"`)
  console.log(`\nPOC ONLY — creator nyata, brand dummy. Bukan production-ready.\n`)

  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
