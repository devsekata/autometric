/**
 * Brand Match validation workbook — real creators, three brands, absolute and
 * relative scores, distribution statistics.
 *
 *   npm run brandmatch:validation
 *
 * ── What this is, and what it is NOT ───────────────────────────────────────
 * It is an ANALYSIS of the existing engine. It changes no weight, no constant
 * and no formula: every score here comes from `score()` in
 * `./brand-match/scoring.mjs`, which `verify-brand-match-port.ts` pins to the
 * published workbook value for value. If a number here looks wrong, the model
 * is what to argue with — not this file.
 *
 * ── Real creators, not fixtures ────────────────────────────────────────────
 * The population is `brand-match/population.json`, which `population-fetch.mjs`
 * read from `public.kol_directory` on the KOL server (10.100.14.216/kol). 6.991
 * real creators after de-duplication. Nothing here invents a creator, an
 * attribute, or a score, and nothing is written back to any database.
 *
 * ── Absolute against relative ──────────────────────────────────────────────
 * ABSOLUTE is the Final Match Score: the six weighted components, N/A parts
 * renormalised out. It is comparable across brands.
 *
 * RELATIVE is `absolute / MAX(absolute in THAT brand's population) x 100`,
 * computed by `normalise()` from the same scoring module rather than re-derived
 * here — one implementation of the rule, not two. A relative 100 means "the
 * highest-scoring creator in this comparison population". It does NOT mean a
 * perfect or 100% brand fit, and the sheet says so where a reader will see it.
 *
 * ── Values, not formulas ───────────────────────────────────────────────────
 * Unlike `build-brand-match-distribution.mjs`, every statistic here is written
 * as a COMPUTED VALUE. `exceljs` caches no formula results, so a workbook of
 * formulas cannot be read back by anything but Excel — and the validation
 * report has to quote real medians and skewness. The two workbooks are
 * complementary: that one lets a reviewer audit the arithmetic inside Excel,
 * this one can be read by a machine.
 *
 * Skewness is Excel's own sample skewness, written out so the two agree:
 *
 *     n / ((n-1)(n-2)) * SUM( ((xi - mean) / stdev_sample)^3 )
 */
import ExcelJS from 'exceljs'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PREFERENCES } from './brand-match/distribution-preferences.mjs'
import { score, toScoringRecord, normalise, isNum, NA } from './brand-match/scoring.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const OUT = path.join(ROOT, 'Autometric_Brand_Match_Validation.xlsx')

/* ── statistics ───────────────────────────────────────────────────────────── */

/** Excel PERCENTILE.INC — linear interpolation between order statistics. */
function percentile(sorted, p) {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function stats(values) {
  const v = values.filter(isNum).slice().sort((a, b) => a - b)
  const n = v.length
  if (!n) return { n: 0 }
  const mean = v.reduce((a, b) => a + b, 0) / n
  // Sample variance (n-1), matching Excel STDEV.S — the population is a sample
  // of a roster that keeps growing, not the whole of anything.
  const sd = n > 1
    ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1))
    : 0
  let skew = null
  if (n > 2 && sd > 0) {
    const cubed = v.reduce((a, x) => a + ((x - mean) / sd) ** 3, 0)
    skew = (n / ((n - 1) * (n - 2))) * cubed
  }
  return {
    n,
    min: v[0],
    max: v[n - 1],
    mean,
    median: percentile(v, 0.5),
    p25: percentile(v, 0.25),
    p75: percentile(v, 0.75),
    sd,
    skew,
  }
}

/** Ten fixed 0–100 bins. Fixed rather than over the observed range so the three
 *  brands' histograms can be laid beside each other and read as one picture. */
const BINS = Array.from({ length: 10 }, (_, i) => [i * 10, i * 10 + 10])
function histogram(values) {
  const v = values.filter(isNum)
  return BINS.map(([lo, hi], i) => ({
    label: `${lo}–${hi}`,
    // The last bin is closed on the right so a score of exactly 100 lands
    // somewhere rather than being dropped.
    n: v.filter(x => (i === 9 ? x >= lo && x <= hi : x >= lo && x < hi)).length,
  }))
}

/* ── score the real population ────────────────────────────────────────────── */

const population = JSON.parse(
  readFileSync(path.join(HERE, 'brand-match', 'population.json'), 'utf8'))

const results = PREFERENCES.map(pref => {
  const eligible = population.records.filter(rec => pref.test(rec))
  const rows = eligible.map(rec => {
    const k = toScoringRecord(rec)
    const s = score(k, pref.brand)
    return { rec, k, s }
  })
  // The SAME `normalise` the engine ships. Re-deriving abs/max here would be a
  // second copy of the one rule this whole exercise is about.
  const rel = normalise(rows.map(r => r.s), r => r.finalScore)
  rows.forEach((r, i) => { r.relative = rel[i] })
  return { pref, rows }
})

/* ── workbook ─────────────────────────────────────────────────────────────── */

const wb = new ExcelJS.Workbook()
wb.creator = 'autometric · build-brand-match-validation.mjs'
wb.created = new Date()

const HEAD = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
const FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF327488' } }
const NOTE = { italic: true, size: 9, color: { argb: 'FF667788' } }

function titleRow(ws, text, sub) {
  ws.getCell('A1').value = text
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF1B4450' } }
  ws.getCell('A2').value = sub
  ws.getCell('A2').font = NOTE
  ws.getRow(2).height = 30
  ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' }
}

function headerRow(ws, r, labels, widths) {
  const row = ws.getRow(r)
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1)
    c.value = l
    c.font = HEAD
    c.fill = FILL
    c.alignment = { wrapText: true, vertical: 'middle' }
  })
  row.height = 30
  if (widths) widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  ws.views = [{ state: 'frozen', ySplit: r }]
}

/** N/A is written as the engine's own sentinel, never as 0 or blank. */
const cell = v => (v === null || v === undefined || v === NA ? NA : v)
const dec2 = v => (isNum(v) ? Math.round(v * 100) / 100 : NA)

/* 1 ── Brand_Profile ───────────────────────────────────────────────────────── */
{
  const ws = wb.addWorksheet('Brand_Profile')
  titleRow(ws, 'BRAND PROFILE  ·  the three references this validation scores against',
    'Each row is a brand and the eligibility rule that decides its comparison population. '
    + 'The rule matters as much as the brand: Relative Score divides by the maximum within '
    + 'THAT population, so a preference is not just a scoring profile — it is a population. '
    + 'Every filter used is one that is wired end to end today; none gates on an empty column.')
  headerRow(ws, 4,
    ['Preference', 'Brand', 'Category', 'Keywords', 'Hashtags', 'Gender', 'Country', 'City',
      'Interests', 'Eligibility rule', 'N eligible'],
    [12, 16, 12, 30, 22, 10, 12, 12, 24, 40, 11])
  results.forEach(({ pref, rows }, i) => {
    const b = pref.brand
    ws.getRow(5 + i).values = [
      pref.label, b.brand_name, b.category,
      (b.brand_keywords ?? []).join(', ') || NA,
      (b.brand_hashtags ?? []).join(', ') || NA,
      b.gender_majority ?? NA, b.target_country ?? NA, b.target_city ?? NA,
      (b.interests ?? []).join(', ') || NA,
      pref.criteria.map(c => `${c[0]}: ${c[1]}`).join(" · "), rows.length,
    ]
  })
}

/* 2 ── Creator_DB ──────────────────────────────────────────────────────────── */
{
  const ws = wb.addWorksheet('Creator_DB')
  const c = population.coverage
  titleRow(ws, 'CREATOR DB  ·  the real population, straight from public.kol_directory',
    `Read ${population.measuredAt} from ${population.server}. `
    + `${c.activeRowsRead} active rows, ${c.duplicateRowsDropped} cross-platform duplicates dropped, `
    + `${c.unidentifiableExcluded} unidentifiable — ${c.total} creators scored. `
    + 'Every column below is DB DATA. Blank means the database holds nothing there; it is not a zero.')

  // The coverage block is the honest caption on every statistic downstream.
  ws.getCell('A4').value = 'COVERAGE  ·  how much of the population each input actually covers'
  ws.getCell('A4').font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
  const cov = [
    ['Creators (de-duplicated)', c.total, '100%'],
    ['with a category', c.withCategory, `${(c.withCategory / c.total * 100).toFixed(1)}%`],
    ['with engagement rate', c.withEngagementRate, `${(c.withEngagementRate / c.total * 100).toFixed(1)}%`],
    ['with a bio', c.withBio, `${(c.withBio / c.total * 100).toFixed(1)}%`],
    ['with captions harvested', c.withCaptions, `${(c.withCaptions / c.total * 100).toFixed(1)}%`],
    ['with audience analysis', c.withAudienceAnalysis, `${(c.withAudienceAnalysis / c.total * 100).toFixed(1)}%`],
    ['with audience interests', c.withInterests, `${(c.withInterests / c.total * 100).toFixed(1)}%`],
    ['with view ratio', c.withViewRatio, `${(c.withViewRatio / c.total * 100).toFixed(1)}%`],
    ['verified', c.verified, `${(c.verified / c.total * 100).toFixed(1)}%`],
  ]
  cov.forEach((r, i) => { ws.getRow(5 + i).values = r })
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 12; ws.getColumn(3).width = 10

  const top = 5 + cov.length + 1
  ws.getCell(`A${top}`).value = 'POPULATION  ·  one row per creator, as the database holds them'
  ws.getCell(`A${top}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
  headerRow(ws, top + 1,
    ['Creator ID', 'Username', 'Platform', 'Followers', 'Verified', 'Category',
      'Category basis', 'Engagement rate %', 'Audience quality', 'Authenticity', 'Added'],
    [38, 24, 11, 13, 10, 14, 14, 16, 15, 13, 12])
  population.records.forEach((r, i) => {
    ws.getRow(top + 2 + i).values = [
      r.id, r.name, r.platform, cell(r.followers), r.verified ?? NA,
      cell(r.category), cell(r.categoryBasis), cell(r.er),
      cell(r.audienceQuality), cell(r.authenticity), cell(r.addedDate),
    ]
  })
}

/* 3 ── Brand_Match_Result ──────────────────────────────────────────────────── */
{
  const ws = wb.addWorksheet('Brand_Match_Result')
  titleRow(ws, 'BRAND MATCH RESULT  ·  one row per creator per brand',
    'ABSOLUTE is the Final Match Score from the unchanged engine — the six weighted components, '
    + 'N/A parts renormalised out of both numerator and denominator. RELATIVE is absolute ÷ the '
    + 'MAXIMUM ABSOLUTE WITHIN THAT BRAND\'S population × 100, so RELATIVE 100 means "the highest '
    + 'scorer in this comparison group" and NOT a perfect or 100% fit. '
    + 'Component columns are CALCULATED; "N/A" means the database holds nothing to compute it from '
    + 'and its weight renormalised away — it is never a zero.')
  headerRow(ws, 4,
    ['Brand', 'Creator ID', 'Username', 'Platform', 'Followers',
      'Absolute Score', 'Relative Score', 'Match Status',
      'Brand & Business (20)', 'Content & Category (20)', 'Target Audience (30)',
      'Brand Personality (10)', 'Performance Quality (10)', 'Brand Safety (10)',
      'Available weight %', 'Data completeness %', 'Confidence'],
    [14, 38, 22, 11, 13, 14, 14, 16, 14, 14, 14, 14, 14, 13, 14, 14, 13])

  let r = 5
  for (const { pref, rows } of results) {
    // Highest first, so the relative-100 creator heads each brand's block.
    const ordered = rows.slice().sort((a, b) => {
      const x = isNum(a.s.finalScore) ? a.s.finalScore : -1
      const y = isNum(b.s.finalScore) ? b.s.finalScore : -1
      return y - x
    })
    for (const row of ordered) {
      ws.getRow(r++).values = [
        pref.brand.brand_name, row.rec.id, row.rec.name, row.rec.platform,
        cell(row.rec.followers),
        cell(row.s.finalScore), dec2(row.relative), row.s.level,
        cell(row.s.businessScore), cell(row.s.contentScore), cell(row.s.audienceScore),
        cell(row.s.personalityScore), cell(row.s.performanceScore), cell(row.s.safetyScore),
        cell(row.s.availableWeight), cell(row.s.dataCompleteness), row.s.confidence,
      ]
    }
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: 17 } }
}

/* 4 ── Distribution ────────────────────────────────────────────────────────── */
const summary = []
{
  const ws = wb.addWorksheet('Distribution')
  titleRow(ws, 'DISTRIBUTION  ·  summary statistics and histograms, per brand and score type',
    'Computed in JavaScript over the same arrays the Brand_Match_Result sheet lists, and written '
    + 'as VALUES so the numbers can be read without Excel. Skewness is the sample skewness Excel\'s '
    + 'SKEW() uses. Positive skew = a thin upper tail (few creators score high); '
    + 'negative = a thin lower tail.')
  headerRow(ws, 4,
    ['Brand', 'Score Type', 'N', 'Min', 'Max', 'Mean', 'Median', 'P25', 'P75',
      'Std Dev', 'Skewness', 'Reading'],
    [14, 12, 8, 9, 9, 10, 10, 9, 9, 10, 11, 34])

  let r = 5
  for (const { pref, rows } of results) {
    for (const [type, values] of [
      ['Absolute', rows.map(x => x.s.finalScore)],
      ['Relative', rows.map(x => x.relative)],
    ]) {
      const st = stats(values)
      summary.push({ brand: pref.brand.brand_name, label: pref.label, type, ...st })
      const reading = st.skew === null ? NA
        : Math.abs(st.skew) < 0.5 ? 'roughly symmetric'
          : st.skew > 0 ? 'right-skewed — a thin upper tail'
            : 'left-skewed — a thin lower tail'
      ws.getRow(r++).values = [
        pref.brand.brand_name, type, st.n,
        dec2(st.min), dec2(st.max), dec2(st.mean), dec2(st.median),
        dec2(st.p25), dec2(st.p75), dec2(st.sd), dec2(st.skew), reading,
      ]
    }
  }

  r += 1
  ws.getCell(`A${r}`).value = 'HISTOGRAM  ·  creators per 10-point band, fixed 0–100 bins'
  ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
  r += 1
  const hdr = ['Band']
  for (const { pref } of results) hdr.push(`${pref.brand.brand_name} Absolute`, `${pref.brand.brand_name} Relative`)
  ws.getRow(r).values = hdr
  ws.getRow(r).eachCell(c => { c.font = HEAD; c.fill = FILL })
  const histRow = r
  const hists = results.map(({ rows }) => ({
    abs: histogram(rows.map(x => x.s.finalScore)),
    rel: histogram(rows.map(x => x.relative)),
  }))
  BINS.forEach((_, bi) => {
    const line = [hists[0].abs[bi].label]
    hists.forEach(h => line.push(h.abs[bi].n, h.rel[bi].n))
    ws.getRow(histRow + 1 + bi).values = line
  })

  for (let i = 0; i < results.length; i++) {
    const chart = { abs: 2 + i * 2, rel: 3 + i * 2 }
    void chart // charts are added by the Excel pass in the distribution workbook
  }
}

/* 5 ── CPE_CPV ─────────────────────────────────────────────────────────────── */
{
  const ws = wb.addWorksheet('CPE_CPV')
  titleRow(ws, 'CPE / CPV  ·  campaign × creator, deliberately OUTSIDE Brand Match',
    'CPE and CPV are cost metrics whose grain is a campaign paired with a creator — they need a '
    + 'deal price, which only exists once a campaign has been negotiated. Brand Match scores a '
    + 'creator against a BRAND PROFILE, before any campaign exists. They are not components of it '
    + 'and are not added to it.')
  const defs = [
    ['CPE', 'deal_price ÷ (likes + comments + shares)',
      'public.campaign_kols.deal_price ÷ public.campaign_kol_deliverables metrics',
      'Per one engagement. No multiplier.'],
    ['CPV', 'deal_price ÷ total views',
      'public.campaign_kols.deal_price ÷ deliverable views',
      'Per ONE view. Deliberately not × 1000 — that would be CPM.'],
  ]
  headerRow(ws, 4, ['Metric', 'Formula', 'Source', 'Note'], [10, 42, 54, 40])
  defs.forEach((d, i) => { ws.getRow(5 + i).values = d })

  let r = 8
  ws.getCell(`A${r}`).value = 'DATA AVAILABILITY  ·  measured on the KOL server'
  ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
  r += 1
  ws.getRow(r).values = ['Table', 'Rows', 'Consequence']
  ws.getRow(r).eachCell(c => { c.font = HEAD; c.fill = FILL })
  const avail = [
    ['public.campaign_kols', 0, 'No deal price exists for any creator — the numerator of both metrics.'],
    ['public.campaign_kol_deliverables', 0, 'No per-deliverable likes, comments, shares or views.'],
    ['public.campaign_orders', 0, 'Not usable as a substitute: total_amount is an order total, not a per-creator cost.'],
  ]
  avail.forEach((a, i) => { ws.getRow(r + 1 + i).values = a })

  r += avail.length + 2
  ws.getCell(`A${r}`).value =
    'RESULT: CPE and CPV are NOT COMPUTABLE for any creator today, and no value is shown for them. '
    + 'A number here would have to be invented. They become computable the moment a campaign carries '
    + 'a deal price and its deliverables carry metrics — the formulas above need no further decision.'
  ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FFA33A3A' } }
  ws.getCell(`A${r}`).alignment = { wrapText: true }
  ws.getRow(r).height = 34
  ws.mergeCells(`A${r}:D${r}`)
}

await wb.xlsx.writeFile(OUT)

/* ── console report ───────────────────────────────────────────────────────── */

console.log(`\nwrote ${OUT}\n`)
console.log(`population      ${population.records.length} real creators · ${population.server}`)
console.log(`read at         ${population.measuredAt}\n`)
for (const s of summary) {
  if (s.type !== 'Absolute') continue
  const rel = summary.find(x => x.brand === s.brand && x.type === 'Relative')
  console.log(`${s.label} · ${s.brand}`)
  console.log(`  N ${s.n}`)
  console.log(`  absolute  min ${s.min} max ${s.max} median ${s.median.toFixed(1)} `
    + `P25 ${s.p25.toFixed(1)} P75 ${s.p75.toFixed(1)} sd ${s.sd.toFixed(2)} skew ${s.skew.toFixed(3)}`)
  console.log(`  relative  min ${rel.min.toFixed(2)} max ${rel.max.toFixed(2)} `
    + `median ${rel.median.toFixed(2)} P75 ${rel.p75.toFixed(2)} skew ${rel.skew.toFixed(3)}`)
}
console.log('\nCPE / CPV       not computable — campaign_kols 0 rows, deliverables 0 rows')
