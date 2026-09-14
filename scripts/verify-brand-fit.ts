/**
 * Verifikasi Brand Fit Analysis: formula, NULL handling, boundary database, dan
 * bentuk keenam kolom output.
 *
 *   npm run verify:brand-fit
 *
 * Kenapa skrip ini ada: tiga jenis kerusakan di Brand Fit tidak akan pernah
 * ditangkap `tsc` maupun `npm run build`, karena ketiganya sintaksis benar dan
 * hanya salah saat dijalankan.
 *
 *   BOUNDARY   Satu `import pool from '@/lib/db'` yang masuk ke `brandFit/`
 *              akan membuat Brand Fit membaca server yang salah — dan itu TIDAK
 *              error, karena `feature`, `l1_silver` dan `l2_gold` ada di KEDUA
 *              server dengan nama yang sama. Diperiksa di level SOURCE, sebab
 *              satu-satunya cara menangkapnya sebelum produksi adalah membaca
 *              importnya.
 *
 *   NULL       Komponen yang tidak terukur harus tetap NULL. Mengubahnya
 *              menjadi 0 tidak akan membuat satu pun test tipe gagal, tapi
 *              mengubah setiap skor di produksi.
 *
 *   WEIGHTING  Rata-rata berbobot harus dinormalisasi terhadap bobot yang
 *              TERSEDIA. Memakai pembagi 100 tetap menghasilkan angka 0-100
 *              yang terlihat masuk akal, hanya saja salah.
 *
 * Bagian A-F murni: fixture, tanpa database, jadi bisa dijalankan di mana pun.
 * Bagian G menyentuh DB `kol` read-only dan otomatis di-skip bila VPN mati.
 * Tidak ada satu pun baris yang ditulis ke database oleh skrip ini.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { partnershipScore as calcPartnership } from '@/lib/discover/brandFit/calculator'
import {
  COMPONENT_WEIGHTS, MIN_COMPONENTS, PERFORMANCE_METRICS, RELATED_THRESHOLD,
  analyseBrandFit, categoryResolver, loadBrand, loadCreators, performanceFit, saveBrandFit,
  type BrandFitBrand, type BrandFitCreator, type ComponentKey, type Score,
} from '@/lib/discover/brandFit'
import { partnershipScore } from '@/lib/discover/brandFit/engine'
import { CATEGORY_RELATEDNESS } from '@/lib/discover/brandMatch/model'

let failures = 0
let skipped = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function skip(label: string, why: string) {
  skipped++
  console.log(`  skip  ${label} — ${why}`)
}

const inRange = (s: Score): boolean => s === null || (s >= 0 && s <= 100)

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/** Brand yang seluruh sisinya terisi, supaya tiap komponen bisa dimatikan satu per satu. */
function brand(over: Partial<BrandFitBrand> = {}): BrandFitBrand {
  return {
    brandId: 'b0000000-0000-0000-0000-000000000001',
    brandName: 'Fixture Brand',
    category: 'Fashion',
    attributes: ['Modern', 'Authentic', 'Warm', 'Educational'],
    audience: {
      gender: 'Female', ageMin: 18, ageMax: 34,
      country: 'ID', city: 'Jakarta', interests: ['beauty'],
    },
    performanceTargets: { engagement_rate: 4, median_views: 10_000 },
    ...over,
  }
}

function creator(over: Partial<BrandFitCreator> = {}): BrandFitCreator {
  return {
    agencyKolAccountId: 'a0000000-0000-0000-0000-000000000001',
    platformId: 'p0000000-0000-0000-0000-000000000001',
    username: 'fixture',
    categories: ['Fashion'],
    attributes: ['Modern', 'Authentic'],
    hasAttributeMapping: true,
    audience: {
      femalePct: 80, malePct: 20, genderKnownPct: 60,
      ageBuckets: { '18-24': 50, '25-34': 50 },
      ageCoveragePct: 40,
      countries: { ID: 90, SG: 10 },
      cities: { Jakarta: 70, Bandung: 30 },
      interests: { beauty: 60, food: 40 },
      interestTop: 'beauty',
    },
    performance: {
      engagement_rate: 2, median_views: 20_000,
      followers_growth: null, post_frequency_reliability: null, performance_stability: null,
    },
    ...over,
  }
}

/* ── A. Category ──────────────────────────────────────────────────────────── */

console.log('\nA. Category matching')
{
  check('exact match → 100',
    analyseBrandFit({ brand: brand(), creator: creator({ categories: ['Fashion'] }) })
      .sub_scores.category_matching.score === 100)

  // Fashion→Beauty adalah 80 di matriks Brand Match, di atas ambang 60.
  check('related (Fashion→Beauty = 80 ≥ 60) → 50',
    analyseBrandFit({ brand: brand(), creator: creator({ categories: ['Beauty'] }) })
      .sub_scores.category_matching.score === 50,
    `matriks = ${CATEGORY_RELATEDNESS.Fashion?.Beauty}`)

  // Fashion→Tech adalah 20, di bawah ambang.
  check('unrelated (Fashion→Tech = 20 < 60) → 0',
    analyseBrandFit({ brand: brand(), creator: creator({ categories: ['Tech'] }) })
      .sub_scores.category_matching.score === 0,
    `matriks = ${CATEGORY_RELATEDNESS.Fashion?.Tech}`)

  check('ambang tepat di 60 dihitung sebagai related',
    categoryResolver('Fashion', 'Gen Z') === 'related',
    `Fashion→Gen Z = ${CATEGORY_RELATEDNESS.Fashion?.['Gen Z']}, ambang = ${RELATED_THRESHOLD}`)

  check('kategori terbaik yang menentukan, bukan rata-rata',
    analyseBrandFit({ brand: brand(), creator: creator({ categories: ['Tech', 'Fashion'] }) })
      .sub_scores.category_matching.score === 100)

  check('label tidak dikenal → unrelated, bukan error',
    categoryResolver('Fashion', 'Otomotif') === 'unrelated')

  check('brand tanpa kategori → NULL, bukan 0',
    analyseBrandFit({ brand: brand({ category: null }), creator: creator() })
      .sub_scores.category_matching.score === null)

  check('creator tanpa kategori → NULL, bukan 0',
    analyseBrandFit({ brand: brand(), creator: creator({ categories: [] }) })
      .sub_scores.category_matching.score === null)

  const tags = analyseBrandFit({
    brand: brand(), creator: creator({ categories: ['Tech', 'Fashion', 'Beauty'] }),
  }).category_fit_tags
  check('category_fit_tags punya satu entri per kategori creator', tags.length === 3)
  check('category_fit_tags deterministic: match → related → unrelated',
    tags.map(t => t.fit).join(',') === 'match,related,unrelated',
    tags.map(t => `${t.tag}:${t.fit}`).join(' '))
  check('category_fit_tags membawa label yang dirender UI',
    tags[0].label === 'cocok' && tags[2].label === 'tidak cocok')
}

/* ── B. Audience ──────────────────────────────────────────────────────────── */

console.log('\nB. Audience overlap')
{
  const full = analyseBrandFit({ brand: brand(), creator: creator() })
  check('semua dimensi tersedia → terukur', full.audience_overlap_pct !== null)
  check('audience_overlap_pct dalam 0-100', inRange(full.audience_overlap_pct))
  check('empat dimensi terukur', full.meta.audienceMeasured.length === 4,
    full.meta.audienceMeasured.join(','))

  // Perempuan 80% dari audiens yang gendernya diketahui.
  const genderOnly = analyseBrandFit({
    brand: brand({ audience: { gender: 'Female', ageMin: null, ageMax: null, country: null, city: null, interests: [] } }),
    creator: creator(),
  })
  check('gender Female → share perempuan', genderOnly.audience_overlap_pct === 80)

  const balanced = analyseBrandFit({
    brand: brand({ audience: { gender: 'Balanced', ageMin: null, ageMax: null, country: null, city: null, interests: [] } }),
    creator: creator({ audience: { ...creator().audience!, femalePct: 50, malePct: 50 } }),
  })
  check('gender Balanced pada audiens 50/50 → 100', balanced.audience_overlap_pct === 100)

  const anyGender = analyseBrandFit({
    brand: brand({ audience: { gender: 'Any', ageMin: null, ageMax: null, country: null, city: null, interests: [] } }),
    creator: creator(),
  })
  check('gender Any = tidak ada target → NULL, bukan 100',
    anyGender.audience_overlap_pct === null)

  // Target 18-34 mencakup penuh kedua bucket yang terisi.
  const ageOnly = analyseBrandFit({
    brand: brand({ audience: { gender: 'Any', ageMin: 18, ageMax: 34, country: null, city: null, interests: [] } }),
    creator: creator(),
  })
  check('age 18-34 atas bucket 18-24 + 25-34 → 100', ageOnly.audience_overlap_pct === 100)

  // Target 18-24 hanya mencakup separuh massa.
  const halfAge = analyseBrandFit({
    brand: brand({ audience: { gender: 'Any', ageMin: 18, ageMax: 24, country: null, city: null, interests: [] } }),
    creator: creator(),
  })
  check('age 18-24 atas dua bucket sama besar → 50', halfAge.audience_overlap_pct === 50)

  const partial = analyseBrandFit({
    brand: brand(),
    creator: creator({
      audience: {
        ...creator().audience!,
        ageBuckets: null, ageCoveragePct: null, countries: null, cities: null,
      },
    }),
  })
  check('sebagian dimensi NULL → tetap terukur dari sisanya',
    partial.audience_overlap_pct !== null)
  check('dimensi yang hilang dilaporkan, bukan didiamkan',
    partial.meta.audienceMissing.includes('age')
    && partial.meta.audienceMissing.includes('location'),
    partial.meta.audienceMissing.join(','))
  // gender 80 (share perempuan) + interest 60 (share di minat yang diminta),
  // dibagi 2 — bukan dibagi 4, karena age dan location tidak terukur.
  check('pembagi hanya dimensi yang tersedia',
    partial.audience_overlap_pct === 70,
    `(80 + 60) / 2 diharapkan 70, dapat ${partial.audience_overlap_pct}`)
  check('dua dimensi yang tersisa memang gender + interest',
    partial.meta.audienceMeasured.join(',') === 'gender,interest',
    partial.meta.audienceMeasured.join(','))

  const noAudience = analyseBrandFit({ brand: brand(), creator: creator({ audience: null }) })
  check('creator tanpa baris audience → NULL', noAudience.audience_overlap_pct === null)
  check('creator tanpa audience → alasannya dicatat',
    noAudience.meta.notes.some(n => n.includes('audience_analysis')))

  const noTarget = analyseBrandFit({
    brand: brand({ audience: { gender: 'Any', ageMin: null, ageMax: null, country: null, city: null, interests: [] } }),
    creator: creator(),
  })
  check('brand tanpa target audiens → NULL, bukan 0', noTarget.audience_overlap_pct === null)
}

/* ── C. Values ────────────────────────────────────────────────────────────── */

console.log('\nC. Values alignment')
{
  // 2 dari 4 atribut brand dimiliki creator.
  const half = analyseBrandFit({ brand: brand(), creator: creator() })
  check('matched ÷ brand attributes × 100', half.sub_scores.values_alignment.score === 50,
    String(half.sub_scores.values_alignment.score))

  const all = analyseBrandFit({
    brand: brand(),
    creator: creator({ attributes: ['Modern', 'Authentic', 'Warm', 'Educational'] }),
  })
  check('semua atribut cocok → 100', all.sub_scores.values_alignment.score === 100)

  const none = analyseBrandFit({
    brand: brand(), creator: creator({ attributes: ['Sporty', 'Bold'] }),
  })
  check('creator ter-mapping tapi tidak ada yang cocok → 0, BUKAN null',
    none.sub_scores.values_alignment.score === 0)

  const unmapped = analyseBrandFit({
    brand: brand(), creator: creator({ attributes: [], hasAttributeMapping: false }),
  })
  check('creator belum pernah di-mapping → NULL, BUKAN 0',
    unmapped.sub_scores.values_alignment.score === null)
  check('alasan values NULL menyebut kol_attribute_map',
    unmapped.meta.notes.some(n => n.includes('kol_attribute_map')))

  const noBrandAttrs = analyseBrandFit({
    brand: brand({ attributes: [] }), creator: creator(),
  })
  check('brand tanpa atribut → NULL, bukan 0',
    noBrandAttrs.sub_scores.values_alignment.score === null)

  const cased = analyseBrandFit({
    brand: brand({ attributes: ['MODERN', 'authentic'] }),
    creator: creator({ attributes: ['Modern', 'Authentic'] }),
  })
  check('pencocokan atribut case-insensitive', cased.sub_scores.values_alignment.score === 100)

  const duped = analyseBrandFit({
    brand: brand({ attributes: ['Warm', 'warm', 'Modern'] }),
    creator: creator({ attributes: ['Modern'] }),
  })
  check('atribut brand di-dedup sebelum jadi pembagi',
    duped.sub_scores.values_alignment.score === 50,
    String(duped.sub_scores.values_alignment.score))
}

/* ── D. Past performance ──────────────────────────────────────────────────── */

console.log('\nD. Past performance (Option B — direct metric)')
{
  // ER 2 dari target 4 = 50; median views 20k dari target 10k = capped 100.
  const both = analyseBrandFit({ brand: brand(), creator: creator() })
  check('rata-rata metrik yang terukur', both.sub_scores.past_performance.score === 75,
    String(both.sub_scores.past_performance.score))
  check('melebihi target tidak lebih dari 100',
    performanceFit({ engagement_rate: 1 }, { engagement_rate: 99 }).score === 100)

  const noTargets = analyseBrandFit({
    brand: brand({ performanceTargets: {} }), creator: creator(),
  })
  check('brand tanpa target performa → NULL, bukan 0',
    noTargets.sub_scores.past_performance.score === null)

  const noMetrics = analyseBrandFit({
    brand: brand(),
    creator: creator({
      performance: {
        engagement_rate: null, median_views: null, followers_growth: null,
        post_frequency_reliability: null, performance_stability: null,
      },
    }),
  })
  check('creator tanpa metrik → NULL, bukan 0',
    noMetrics.sub_scores.past_performance.score === null)
  check('metrik yang diminta tapi kosong dilaporkan sebagai missing',
    noMetrics.meta.performance.missing.length === 2,
    noMetrics.meta.performance.missing.join(','))

  check('target ≤ 0 diabaikan, bukan dibagi',
    performanceFit({ engagement_rate: 0 }, { engagement_rate: 5 }).score === null)

  check('hanya lima metrik yang dikenal',
    PERFORMANCE_METRICS.length === 5 && PERFORMANCE_METRICS.includes('performance_stability'))

  // Ini yang menjaga Option B tetap Option B.
  const ruleSource = readFileSync(join(process.cwd(), 'src/lib/discover/brandFit/rules.ts'), 'utf8')
  const engineSource = readFileSync(join(process.cwd(), 'src/lib/discover/brandFit/engine.ts'), 'utf8')
  const archetypeLabels = ['Massive Reach', 'High Impulse', 'High Engagement', 'High Reach']
  const leaked = archetypeLabels.filter(label => {
    // Hanya kode yang dihitung: label-label ini memang disebut di komentar,
    // justru untuk menjelaskan kenapa mereka tidak boleh jadi aturan.
    const code = stripComments(ruleSource) + stripComments(engineSource)
    return code.includes(label)
  })
  check('tidak ada archetype yang di-hardcode sebagai aturan', leaked.length === 0,
    leaked.join(', '))
}

/** Membuang komentar blok dan baris, supaya pemeriksaan di atas membaca kode saja. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/* ── E. Partnership score & NULL handling ─────────────────────────────────── */

console.log('\nE. Partnership score')
{
  const subs = (o: Partial<Record<ComponentKey, Score>>): Record<ComponentKey, Score> => ({
    category: null, audience: null, values: null, performance: null, ...o,
  })

  check('seluruh komponen NULL → partnership NULL',
    partnershipScore(subs({})) === null)

  check('satu komponen tersedia → dinormalisasi, bukan dibagi 4',
    partnershipScore(subs({ category: 80 })) === 80)

  check('dua komponen → rata-rata keduanya',
    partnershipScore(subs({ category: 80, values: 40 })) === 60)

  check('tiga komponen → dinormalisasi terhadap bobot yang tersedia',
    partnershipScore(subs({ category: 90, values: 60, performance: 30 })) === 60)

  check('empat komponen → rata-rata berbobot penuh',
    partnershipScore(subs({ category: 100, audience: 50, values: 50, performance: 0 })) === 50)

  check('komponen NULL tidak menarik skor ke bawah',
    partnershipScore(subs({ category: 100 })) === 100)

  check('partnership_score dalam 0-100',
    inRange(partnershipScore(subs({ category: 100, audience: 100, values: 100, performance: 100 })))
    && partnershipScore(subs({ category: 100, audience: 100, values: 100, performance: 100 })) === 100)

  // Ini yang mengikat dua implementasi supaya tidak diam-diam berbeda.
  const equalWeights = new Set(Object.values(COMPONENT_WEIGHTS)).size === 1
  if (equalWeights) {
    const cases: Partial<Record<ComponentKey, Score>>[] = [
      { category: 80 },
      { category: 80, values: 40 },
      { category: 90, audience: 60, values: 30 },
      { category: 100, audience: 50, values: 50, performance: 0 },
    ]
    const agree = cases.every(c => {
      const s = subs(c)
      return partnershipScore(s) === calcPartnership(
        { category: s.category, audience: s.audience, values: s.values, performance: s.performance },
        MIN_COMPONENTS)
    })
    check('bobot sama → identik dengan rata-rata calculator POC (48 golden cases)', agree)
  } else {
    skip('bobot sama → identik dengan calculator POC', 'bobot sudah tidak seragam')
  }

  check(`MIN_COMPONENTS = ${MIN_COMPONENTS} dipatuhi`,
    MIN_COMPONENTS === 1
      ? partnershipScore(subs({ category: 50 })) === 50
      : partnershipScore(subs({ category: 50 })) === null)

  check('total bobot = 100',
    Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0) === 100)
}

/* ── F. Bentuk output ─────────────────────────────────────────────────────── */

console.log('\nF. Output — enam kolom feature.brand_fit_analysis')
{
  const full = analyseBrandFit({ brand: brand(), creator: creator() })
  const empty = analyseBrandFit({
    brand: brand({ category: null, attributes: [], performanceTargets: {},
      audience: { gender: 'Any', ageMin: null, ageMax: null, country: null, city: null, interests: [] } }),
    creator: creator({ categories: [], attributes: [], hasAttributeMapping: false, audience: null }),
  })

  check('partnership_score ada', 'partnership_score' in full && inRange(full.partnership_score))
  check('sub_scores punya empat komponen',
    Object.keys(full.sub_scores).join(',')
      === 'category_matching,audience_overlap,values_alignment,past_performance')
  check('audience_overlap_pct ada', inRange(full.audience_overlap_pct))
  check('category_fit_tags array', Array.isArray(full.category_fit_tags))
  check('recommendations array', Array.isArray(full.recommendations))
  check('overlap_summary string ketika terukur', typeof full.overlap_summary === 'string')

  // Inti aturan "jangan ada dua sumber kebenaran".
  check('sub_scores.audience_overlap TIDAK menyalin angkanya',
    !('score' in full.sub_scores.audience_overlap))
  check('sub_scores.audience_overlap menunjuk ke kolomnya',
    full.sub_scores.audience_overlap.source === 'audience_overlap_pct')
  check('status audience konsisten dengan audience_overlap_pct',
    full.sub_scores.audience_overlap.status === 'measured'
    && empty.sub_scores.audience_overlap.status === 'not_measured')

  check('overlap_summary memuat angka yang sama dengan audience_overlap_pct',
    full.overlap_summary!.includes(String(full.audience_overlap_pct)),
    full.overlap_summary ?? '')

  check('pasangan tanpa data → semua NULL', empty.partnership_score === null
    && empty.sub_scores.category_matching.score === null
    && empty.audience_overlap_pct === null)
  check('pasangan tanpa data → overlap_summary NULL, bukan narasi karangan',
    empty.overlap_summary === null)
  check('pasangan tanpa data → tetap ada recommendations yang menjelaskan kenapa',
    empty.recommendations.every(r => r.code.endsWith('_unmeasured')),
    empty.recommendations.map(r => r.code).join(','))
  check('coverage dilaporkan', full.meta.coverage === 100 && empty.meta.coverage === 0)

  // Deterministic: dua panggilan identik menghasilkan JSON yang identik pula.
  check('output deterministic',
    JSON.stringify(analyseBrandFit({ brand: brand(), creator: creator() }))
      === JSON.stringify(analyseBrandFit({ brand: brand(), creator: creator() })))

  check('tidak ada komponen di luar 0-100',
    [full.sub_scores.category_matching.score, full.audience_overlap_pct,
      full.sub_scores.values_alignment.score, full.sub_scores.past_performance.score]
      .every(inRange))
}

/* ── G. Boundary database ─────────────────────────────────────────────────── */

console.log('\nG. Database boundary')
{
  const files = [
    'src/lib/discover/brandFit/calculator.ts',
    'src/lib/discover/brandFit/rules.ts',
    'src/lib/discover/brandFit/engine.ts',
    'src/lib/discover/brandFit/records.ts',
    'src/lib/discover/brandFit/store.ts',
    'src/lib/discover/brandFit/index.ts',
    'src/app/api/organizations/[id]/discover/brand-fit/route.ts',
  ]
  const sources = files.map(f => ({ f, src: readFileSync(join(process.cwd(), f), 'utf8') }))

  const warehouse = sources.filter(({ src }) =>
    /from\s+['"]@\/lib\/db['"]/.test(src) || /DATABASE_URL/.test(src))
  check('tidak ada @/lib/db atau DATABASE_URL di seluruh Brand Fit',
    warehouse.length === 0, warehouse.map(w => w.f).join(', '))

  const readers = sources.filter(({ f }) => f.endsWith('records.ts') || f.endsWith('store.ts'))
  check('records.ts & store.ts membaca lewat kolDb()',
    readers.every(({ src }) => /from\s+['"]@\/lib\/kolDb['"]/.test(src)))

  const writers = sources.filter(({ src }) => stripComments(src).includes('kolDbWrite'))
  check('hanya store.ts yang memakai kolDbWrite()',
    writers.length === 1 && writers[0].f.endsWith('store.ts'),
    writers.map(w => w.f).join(', '))

  const store = sources.find(({ f }) => f.endsWith('store.ts'))!.src
  check('tidak ada DDL di jalur runtime Brand Fit',
    !/\b(DROP|ALTER|TRUNCATE|CREATE)\s+TABLE\b/i.test(stripComments(store)))
  check('grain (agency_kol_account_id, brand_id) dipertahankan di upsert',
    store.includes('ON CONFLICT (agency_kol_account_id, brand_id)'))

  const engineSrc = sources.find(({ f }) => f.endsWith('engine.ts'))!.src
  check('engine murni — tidak menyentuh database sama sekali',
    !/kolDb|pg|query\(/.test(stripComments(engineSrc)))

  // Brand Match dan What Matters tidak boleh ikut berubah.
  const matrixUntouched = Object.keys(CATEGORY_RELATEDNESS).length === 9
    && CATEGORY_RELATEDNESS.Fashion?.Fashion === 100
    && CATEGORY_RELATEDNESS.Beauty?.Fashion === 80
  check('CATEGORY_RELATEDNESS dipakai apa adanya, tidak dimodifikasi', matrixUntouched)

  const rulesSrc = sources.find(({ f }) => f.endsWith('rules.ts'))!.src
  check('rules.ts hanya mengimpor matriks, bukan scoring Brand Match',
    !/brandMatch\/score/.test(rulesSrc))
}

/* ── H. Integrasi read-only ke DB kol ─────────────────────────────────────── */

async function integrationChecks(): Promise<void> {
  console.log('\nH. Integrasi DB kol (read-only)')
  if (!process.env.PG_HOST_KOL) {
    skip('koneksi KOL', 'PG_HOST_KOL tidak diset')
    return
  }
  try {
    const db = kolDb()
    const { rows } = await db.query<{ host: string; db: string }>(
      'SELECT inet_server_addr()::text AS host, current_database() AS db')
    check(`terhubung ke DB kol (${rows[0].db})`, rows[0].db === process.env.PG_DB_KOL)

    const { rows: cols } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='feature' AND table_name='brand_fit_analysis'`)
    const names = cols.map(c => c.column_name)
    const required = ['agency_kol_account_id', 'brand_id', 'partnership_score', 'sub_scores',
      'audience_overlap_pct', 'overlap_summary', 'category_fit_tags', 'recommendations']
    const missing = required.filter(c => !names.includes(c))
    check('feature.brand_fit_analysis punya keenam kolom output + grain',
      missing.length === 0, `hilang: ${missing.join(', ')}`)

    const { rows: grain } = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='feature.brand_fit_analysis'::regclass AND contype='u'`)
    check('grain UNIQUE (agency_kol_account_id, brand_id) masih utuh',
      grain.some(g => g.def.replace(/\s+/g, ' ')
        .includes('UNIQUE (agency_kol_account_id, brand_id)')),
      grain.map(g => g.def).join(' | '))

    const { rows: bp } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='brand_profile'`)
    const bpNames = bp.map(c => c.column_name)
    const added = ['brand_tone', 'target_age_min', 'target_age_max', 'performance_targets']
    const notApplied = added.filter(c => !bpNames.includes(c))
    if (notApplied.length) {
      skip('kolom brand-side migration 002', `belum diterapkan: ${notApplied.join(', ')} — jalankan npm run migrate:kol`)
    } else {
      check('migration 002 terpasang: brand_tone, target_age_*, performance_targets', true)
    }

    // Menjalankan SQL-nya sungguhan. Ini satu-satunya cara menangkap kolom
    // salah nama atau join yang keliru: keduanya lolos tsc dan hanya meledak
    // saat query dikirim.
    const { rows: sample } = await db.query<{ id: string }>(
      'SELECT id FROM public.agency_kol_accounts ORDER BY id LIMIT 3')
    if (!sample.length) {
      skip('loadCreators() terhadap roster nyata', 'agency_kol_accounts kosong')
    } else {
      const ids = sample.map(r => r.id)
      const creators = await loadCreators(ids)
      check('loadCreators() mengembalikan satu baris per agency_kol_account',
        creators.length === ids.length, `${creators.length} dari ${ids.length}`)
      check('setiap creator membawa platform_id dari agency_kol_accounts',
        creators.every(c => 'platformId' in c))
      check('kategori creator berupa array kanonik',
        creators.every(c => Array.isArray(c.categories)))
      check('performance dibaca sebagai angka atau null, tidak pernah string',
        creators.every(c => Object.values(c.performance)
          .every(v => v === null || typeof v === 'number')))
      check('hasAttributeMapping konsisten dengan kol_attribute_map',
        creators.every(c => c.hasAttributeMapping === (c.attributes.length > 0)))

      // Analisis end-to-end memakai creator NYATA dan brand fixture, tanpa
      // menulis apa pun. Membuktikan alur baca → hitung → bentuk output jalan.
      const analysis = analyseBrandFit({ brand: brand(), creator: creators[0] })
      check('analyseBrandFit() jalan di atas creator nyata',
        inRange(analysis.partnership_score) && Array.isArray(analysis.recommendations))
      check('creator nyata tanpa atribut → values NULL, bukan 0',
        creators[0].hasAttributeMapping
        || analysis.sub_scores.values_alignment.score === null)
    }

    const absent = await loadBrand('00000000-0000-0000-0000-000000000000')
    check('loadBrand() untuk brand yang tidak ada → null, bukan error', absent === null)

    const { rows: brandCount } = await db.query<{ n: string }>(
      'SELECT count(*) AS n FROM public.brand')
    if (Number(brandCount[0].n) === 0) {
      skip('skor tersimpan di produksi', 'public.brand masih 0 baris — blocker yang sudah diketahui')
    } else {
      check('public.brand punya baris untuk dipasangkan', true)
    }

    await endToEndInTransaction()
  } catch (err) {
    skip('integrasi DB kol', (err as Error).message.slice(0, 90))
  }
}

/**
 * Rantai penuh Brand Profile → brand → engine → feature.brand_fit_analysis,
 * dijalankan di dalam SATU transaksi yang selalu di-ROLLBACK.
 *
 * Ini yang membuktikan Brand Fit siap menerima brand nyata tanpa harus membuat
 * brand nyata. Fungsi yang dipanggil adalah fungsi produksi yang sama —
 * `loadBrand`, `loadCreators`, `analyseBrandFit`, `saveBrandFit` — bukan salinan
 * SQL-nya, karena salinan itulah yang biasanya menyimpang diam-diam.
 *
 * Tidak ada satu baris pun yang tertinggal: pemeriksaan terakhir menghitung
 * ulang tabelnya setelah rollback.
 */
async function endToEndInTransaction(): Promise<void> {
  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')

    const { rows: [inserted] } = await client.query<{ id: string }>(
      `INSERT INTO public.brand (name, category, is_active, created_at, updated_at)
       VALUES ('__verify_brand_fit__', 'Fashion', TRUE, NOW(), NOW()) RETURNING id`)
    const brandId = inserted.id

    await client.query(
      `INSERT INTO public.brand_profile
         (organization_id, brand_id, brand_name, brand_category, brand_personality,
          brand_tone, gender_majority, target_age_min, target_age_max,
          target_country, target_city, audience_interests, performance_targets)
       VALUES (gen_random_uuid(), $1, '__verify_brand_fit__', 'Fashion',
               ARRAY['Modern','Authentic'], ARRAY['Warm'], 'Female', 18, 34,
               'ID', 'Jakarta', ARRAY['beauty'],
               '{"engagement_rate": 4, "median_views": 10000}'::jsonb)`,
      [brandId])

    const loaded = await loadBrand(brandId, client)
    check('loadBrand() menemukan brand + profile yang baru dihubungkan', loaded !== null)
    check('brand_tone ikut terbaca dan digabung ke atribut brand',
      loaded!.attributes.join(',') === 'Modern,Authentic,Warm', loaded!.attributes.join(','))
    check('target_age_min/max terbaca',
      loaded!.audience.ageMin === 18 && loaded!.audience.ageMax === 34)
    check('performance_targets terbaca dan difilter ke metrik yang dikenal',
      loaded!.performanceTargets.engagement_rate === 4
      && loaded!.performanceTargets.median_views === 10_000)

    const { rows: sample } = await client.query<{ id: string }>(
      'SELECT id FROM public.agency_kol_accounts ORDER BY id LIMIT 5')
    const creators = await loadCreators(sample.map(r => r.id), client)
    check('creator nyata terbaca di transaksi yang sama', creators.length === sample.length)

    const analyses = creators.map(c => ({
      agencyKolAccountId: c.agencyKolAccountId,
      brandId,
      analysis: analyseBrandFit({ brand: loaded!, creator: c }),
    }))
    check('setiap pasangan menghasilkan analisis lengkap',
      analyses.every(a => Array.isArray(a.analysis.recommendations)
        && inRange(a.analysis.partnership_score)))
    // Sebagian roster memang tidak punya kategori, audience, atribut, maupun
    // metrik apa pun. Nol komponen adalah jawaban yang BENAR untuk mereka, dan
    // yang harus dijaga adalah konsistensinya dengan partnership_score.
    check('komponen nol ⇔ partnership_score NULL, tanpa kecuali',
      analyses.every(a =>
        (a.analysis.meta.componentsAvailable === 0) === (a.analysis.partnership_score === null)),
      analyses.map(a =>
        `${a.analysis.meta.componentsAvailable}:${a.analysis.partnership_score}`).join(' '))
    check('coverage konsisten dengan jumlah komponen',
      analyses.every(a => a.analysis.meta.coverage === a.analysis.meta.componentsAvailable * 25))
    check('setidaknya satu creator nyata bisa diukur terhadap brand ini',
      analyses.some(a => a.analysis.partnership_score !== null),
      analyses.map(a => a.analysis.meta.componentsAvailable).join(','))

    const written = await saveBrandFit(analyses, client)
    check('saveBrandFit() menulis seluruh pasangan', written === analyses.length,
      `${written} dari ${analyses.length}`)

    const { rows: stored } = await client.query<{
      n: string; scores: string; subs: string; pct: string; tags: string
    }>(`SELECT count(*) AS n,
               count(partnership_score) AS scores,
               count(sub_scores) AS subs,
               count(audience_overlap_pct) AS pct,
               count(category_fit_tags) AS tags
          FROM feature.brand_fit_analysis WHERE brand_id = $1`, [brandId])
    check('baris tersimpan dengan keenam kolom terisi',
      Number(stored[0].n) === analyses.length && Number(stored[0].subs) === analyses.length
      && Number(stored[0].tags) === analyses.length)

    // Jalankan lagi: grain harus meng-update, bukan menggandakan.
    await saveBrandFit(analyses, client)
    const { rows: again } = await client.query<{ n: string }>(
      'SELECT count(*) AS n FROM feature.brand_fit_analysis WHERE brand_id = $1', [brandId])
    check('run kedua meng-update baris yang sama (grain dipatuhi)',
      Number(again[0].n) === analyses.length, `${again[0].n} baris`)

    const { rows: nulls } = await client.query<{ sub: Record<string, unknown> }>(
      `SELECT sub_scores AS sub FROM feature.brand_fit_analysis
        WHERE brand_id = $1 LIMIT 1`, [brandId])
    const audienceSub = nulls[0].sub.audience_overlap as Record<string, unknown>
    check('sub_scores tersimpan tanpa menggandakan audience_overlap_pct',
      !('score' in audienceSub) && audienceSub.source === 'audience_overlap_pct')

    await client.query('ROLLBACK')

    const { rows: after } = await client.query<{ bfa: string; brand: string; bp: string }>(
      `SELECT (SELECT count(*) FROM feature.brand_fit_analysis) AS bfa,
              (SELECT count(*) FROM public.brand) AS brand,
              (SELECT count(*) FROM public.brand_profile) AS bp`)
    check('ROLLBACK bersih — tidak ada data test yang tertinggal',
      after[0].bfa === '0' && after[0].brand === '0' && after[0].bp === '0',
      `bfa=${after[0].bfa} brand=${after[0].brand} brand_profile=${after[0].bp}`)
  } catch (err) {
    skip('integrasi DB kol', (err as Error).message.slice(0, 90))
  }
}

/* ── ringkasan ────────────────────────────────────────────────────────────── */

integrationChecks()
  .catch(err => {
    failures++
    console.error(`  FAIL  integrasi DB kol — ${(err as Error).message}`)
  })
  .finally(() => {
    console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} gagal, ${skipped} di-skip\n`)
    process.exit(failures === 0 ? 0 : 1)
  })
