/**
 * Verifikasi POC Brand Fit.  TESTING ONLY — bukan bukti bahwa Brand Fit siap produksi.
 *
 *   npm run verify:brand-fit-poc
 *
 * Dua lapis:
 *
 *   GOLDEN   Membaca `Brand_Fit_Dummy_Data.xlsx` LANGSUNG dan membandingkan
 *            hasil calculator dengan kolom hasil di workbook. Angka harapan
 *            tidak pernah disalin ke file ini — kalau workbook berubah, test
 *            ikut berubah, dan itu memang yang diinginkan.
 *   UNIT     Cabang yang workbook-nya TIDAK punya contoh: null, kosong,
 *            duplikat, pembulatan, batas 0..100.
 *
 * Workbook adalah fixture, bukan data produksi. Nol koneksi database, nol
 * tulis, nol baris masuk `feature.brand_fit_analysis`.
 *
 * Kalau workbook tidak ada di workspace, seluruh blok GOLDEN melewati dirinya
 * sendiri dengan jujur dan blok UNIT tetap jalan.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import {
  audienceFit, buildOutput, categoryFit, partnershipScore, performanceFit,
  toScore, valuesFit,
  type CategoryVerdict, type PerformanceVerdict, type SubScores,
} from '@/lib/discover/brandFit/calculator'

let failures = 0
let skipped = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const skip = (label: string, why: string) => { skipped++; console.log(`  skip  ${label} — ${why}`) }

const WB = join(process.cwd(), 'Brand_Fit_Dummy_Data.xlsx')
const near = (a: number | null, b: number, tol = 0.06) => a !== null && Math.abs(a - b) < tol
const split = (s: string) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)

async function golden() {
  console.log('\nGOLDEN — terhadap Brand_Fit_Dummy_Data.xlsx\n')
  if (!existsSync(WB)) {
    skip('seluruh blok golden', 'Brand_Fit_Dummy_Data.xlsx tidak ada di workspace')
    skipped += 3
    return
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(WB)
  const txt = (x: unknown): string => {
    if (x === null || x === undefined) return ''
    if (typeof x === 'object') {
      const o = x as { text?: string; result?: unknown; richText?: { text: string }[] }
      if (o.richText) return o.richText.map(t => t.text).join('')
      return String(o.text ?? o.result ?? '')
    }
    return String(x)
  }
  const grid = (name: string): string[][] => {
    const ws = wb.getWorksheet(name)
    if (!ws) return []
    const rows: string[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values
      const a = (Array.isArray(v) ? v.slice(1) : []).map(txt)
      if (a.some(x => x !== '')) rows.push(a)
    }
    return rows
  }

  const tax = grid('Complete Brand Taxonomy')
  const creators = grid('Dummy Creators')
  const scores = grid('Brand Fit Scores')
  check('workbook punya 3 sheet yang dibutuhkan',
    tax.length > 1 && creators.length > 1 && scores.length > 1,
    `tax=${tax.length} creators=${creators.length} scores=${scores.length}`)
  if (!scores.length) return

  const th = tax[0]
  const brand: Record<string, { pers: string; tone: string }> = {}
  for (let i = 1; i < tax.length; i++) {
    brand[tax[i][0]] = {
      pers: tax[i][th.indexOf('Brand Personality')],
      tone: tax[i][th.indexOf('Brand Tone')],
    }
  }
  const creator: Record<string, { pers: string; tone: string }> = {}
  for (let i = 1; i < creators.length; i++) {
    creator[creators[i][0]] = { pers: creators[i][3], tone: creators[i][4] }
  }

  /* Values Fit dihitung ULANG dari atribut mentah, bukan dibaca dari kolom
     hasil — inilah yang membuktikan formulanya, bukan sekadar menyalinnya. */
  let vOk = 0
  const vBad: string[] = []
  for (let i = 1; i < scores.length; i++) {
    const [bn, cn, , , expected] = scores[i]
    const b = brand[bn]; const c = creator[cn]
    if (!b || !c) continue
    const got = valuesFit([...split(b.pers), ...split(b.tone)],
      [...split(c.pers), ...split(c.tone)])
    if (near(got, Number(expected))) vOk++
    else vBad.push(`${bn}/${cn} got=${got} xlsx=${expected}`)
  }
  check(`Values Fit direproduksi dari atribut mentah — ${vOk}/${scores.length - 1} baris`,
    vBad.length === 0, vBad.slice(0, 2).join(' · '))

  /* Partnership = rata-rata 4 sub-skor workbook. */
  let pOk = 0
  const pBad: string[] = []
  for (let i = 1; i < scores.length; i++) {
    const [bn, cn, cat, aud, val, perf, expected] = scores[i]
    const subs: SubScores = {
      category: toScore(Number(cat)), audience: toScore(Number(aud)),
      values: toScore(Number(val)), performance: toScore(Number(perf)),
    }
    const got = partnershipScore(subs)
    if (near(got, Number(expected))) pOk++
    else pBad.push(`${bn}/${cn} got=${got} xlsx=${expected}`)
  }
  check(`Partnership Score = rata-rata 4 — ${pOk}/${scores.length - 1} baris`,
    pBad.length === 0, pBad.slice(0, 2).join(' · '))

  /* Cakupan workbook: mencatat apa yang TIDAK pernah dibuktikannya. */
  const seen = { cat: new Set<string>(), aud: new Set<string>(), perf: new Set<string>() }
  for (let i = 1; i < scores.length; i++) {
    seen.cat.add(scores[i][2]); seen.aud.add(scores[i][3]); seen.perf.add(scores[i][5])
  }
  console.log(`        nilai yang muncul di workbook — Category {${[...seen.cat]}} · `
    + `Audience {${[...seen.aud]}} · Performance {${[...seen.perf]}}`)
  check('Category 100/50 memang TIDAK pernah muncul (rule belum terbukti)',
    !seen.cat.has('100') && !seen.cat.has('50'), [...seen.cat].join(','))
  check('Audience konstan — bukan hasil perhitungan',
    seen.aud.size === 1, [...seen.aud].join(','))
}

function unit() {
  console.log('\nUNIT — cabang yang workbook tidak punya contohnya\n')

  /* Category — resolver disuntik, jadi test memilih verdict-nya sendiri. */
  const cr = (v: CategoryVerdict) => () => v
  check('category exact match → 100',
    categoryFit('Beauty', ['Beauty'], cr('match')).score === 100)
  check('category related → 50',
    categoryFit('Beauty', ['Lifestyle'], cr('related')).score === 50)
  check('category no match → 0',
    categoryFit('Beauty', ['Tech'], cr('unrelated')).score === 0)
  check('kategori terbaik yang menentukan skor, semua tetap jadi tag', (() => {
    const r = categoryFit('Beauty', ['Tech', 'Beauty'],
      (_b, c) => (c === 'Beauty' ? 'match' : 'unrelated'))
    return r.score === 100 && r.tags.length === 2
  })())
  check('brand tanpa kategori → null, bukan 0',
    categoryFit(null, ['Beauty'], cr('match')).score === null)
  check('creator tanpa kategori → null, bukan 0',
    categoryFit('Beauty', [], cr('match')).score === null)

  /* Audience — penyebut hanya dimensi yang tersedia. */
  check('4 dimensi tersedia → rata-rata keempatnya',
    audienceFit({ gender: 80, age: 60, location: 40, interest: 20 }).score === 50)
  check('2 dari 4 tersedia → penyebut 2, BUKAN 4',
    audienceFit({ gender: 80, age: null, location: 40, interest: null }).score === 60)
  check('dimensi hilang tidak menjadi 0', (() => {
    const r = audienceFit({ gender: 80, age: null })
    return r.score === 80 && r.measured.join() === 'gender' && r.missing.join() === 'age'
  })())
  check('audiens kosong → null, bukan 0', audienceFit({}).score === null)
  check('semua dimensi null → null', audienceFit({ gender: null, age: null }).score === null)

  /* Values — satu-satunya rule yang terverifikasi penuh. */
  check('values full match → 100', valuesFit(['Modern', 'Warm'], ['Modern', 'Warm']) === 100)
  check('values partial → 50', valuesFit(['Modern', 'Warm'], ['Modern', 'Bold']) === 50)
  check('values no match → 0', valuesFit(['Modern'], ['Bold']) === 0)
  check('brand attributes kosong → null, bukan 0', valuesFit([], ['Modern']) === null)
  check('creator attributes kosong → 0 (brand meminta, creator tidak punya)',
    valuesFit(['Modern'], []) === 0)
  check('case-insensitive', valuesFit(['Modern'], ['MODERN']) === 100)
  check('duplikat tidak menggandakan penyebut',
    valuesFit(['Warm', 'warm', 'Bold'], ['Warm']) === 50)
  check('penyebut adalah atribut BRAND, bukan creator',
    valuesFit(['Modern'], ['Modern', 'Bold', 'Warm', 'Elegant']) === 100)
  check('3 dari 7 → 42.86 (pola Kala Basics / Creator A)',
    near(valuesFit(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['a', 'b', 'c']), 42.86))

  /* Performance — resolver disuntik. */
  const pr = (v: PerformanceVerdict) => () => v
  check('performance same → 100', performanceFit('X', 'X', pr('same')) === 100)
  check('performance related → 70', performanceFit('X', 'Y', pr('related')) === 70)
  check('performance less aligned → 50', performanceFit('X', 'Y', pr('less_aligned')) === 50)
  check('performance incompatible → 0', performanceFit('X', 'Y', pr('incompatible')) === 0)
  check('archetype null → null, bukan 0', performanceFit(null, 'Y', pr('same')) === null)

  /* Partnership + numeric(5,2). */
  const full: SubScores = { category: 100, audience: 40, values: 42.9, performance: 70 }
  check('partnership rata-rata 4 → 63.23', near(partnershipScore(full), 63.23))
  check('3 komponen → penyebut 3',
    partnershipScore({ ...full, performance: null }) === toScore((100 + 40 + 42.9) / 3))
  check('2 komponen → masih dihitung',
    partnershipScore({ category: 100, audience: 50, values: null, performance: null }) === 75)
  check('1 komponen → null (asumsi minComponents=2, ditandai di kode)',
    partnershipScore({ category: 100, audience: null, values: null, performance: null }) === null)
  check('minComponents=1 mengembalikan renormalisasi naif',
    partnershipScore({ category: 100, audience: null, values: null, performance: null }, 1) === 100)
  check('semua null → null',
    partnershipScore({ category: null, audience: null, values: null, performance: null }) === null)
  check('presisi numeric(5,2)', toScore(63.234567) === 63.23 && toScore(1 / 3) === 0.33)
  check('tidak ada skor negatif', toScore(-25) === 0)
  check('tidak ada skor > 100', toScore(140) === 100)

  /* Output shape. */
  console.log('\nOUTPUT SHAPE\n')
  const aud = audienceFit({ gender: 80, age: null, location: 40, interest: null })
  const subs: SubScores = { category: 100, audience: aud.score, values: 42.9, performance: null }
  const out = buildOutput(subs, [{ tag: 'Beauty', fit: 'match' }], aud)
  check('enam kolom output hadir',
    ['partnership_score', 'sub_scores', 'audience_overlap_pct', 'overlap_summary',
      'category_fit_tags', 'recommendations'].every(k => k in out), Object.keys(out).join(','))
  check('sub_scores punya tepat 4 aspek',
    Object.keys(out.sub_scores).join(',')
      === 'category_matching,audience_overlap,values_alignment,past_performance')
  check('audience_overlap_pct = skor audiens (single source of truth)',
    out.audience_overlap_pct === aud.score)
  check('sub_scores.audience_overlap TIDAK menduplikasi angkanya',
    !('score' in out.sub_scores.audience_overlap)
    && out.sub_scores.audience_overlap.source === 'audience_overlap_pct')
  check('komponen tak terukur berstatus not_measured, skornya null',
    out.sub_scores.past_performance.status === 'not_measured'
    && out.sub_scores.past_performance.score === null)
  check('overlap_summary deterministik, menyebut yang belum terukur',
    !!out.overlap_summary && out.overlap_summary.includes('Belum terukur'),
    out.overlap_summary ?? '')
  check('recommendations deterministik dan punya code',
    Array.isArray(out.recommendations) && out.recommendations.every(r => !!r.code))
  check('output JSON-serialisable', (() => {
    try { JSON.parse(JSON.stringify(out)); return true } catch { return false }
  })())
}

async function main() {
  console.log('\nBrand Fit POC — TESTING ONLY, bukan production rule')
  await golden()
  unit()
  console.log(failures === 0
    ? `\nSemua pemeriksaan lulus.${skipped ? ` ${skipped} dilewati.` : ''}\n`
    : `\n${failures} pemeriksaan gagal.${skipped ? ` ${skipped} dilewati.` : ''}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
