/**
 * Builds `Autometric_Brand_Match_Engine.xlsx`.
 *
 * The rule this file follows, everywhere: **no score is ever written as a
 * number.** Every score cell is a formula over input cells, and every constant
 * the formulas lean on — the six component weights, the audience sub-weights,
 * the normalisation targets, the match-level bands — lives in a labelled cell on
 * `Lookup_Lists` rather than inside the formula. Change the weight, the whole
 * workbook moves. That is what makes the file a source of truth instead of a
 * screenshot of one.
 *
 * The engine sheet holds three blocks of thirty rows — every creator scored
 * against every brand — because the claim the workbook has to be able to prove
 * is that Brand Match is a function of (brand, creator) and not a global ranking
 * of creators. `Sample_Output` puts the three scores for one creator side by
 * side so that claim is checkable at a glance.
 */

import ExcelJS from 'exceljs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLATFORMS, TIERS, CATEGORIES, SUBCATS, INDUSTRIES, AGE_BANDS, GENDER_MAJORITY,
  COUNTRIES, REGIONS, CITIES, INTERESTS, CONTENT_STYLES, CREATOR_PERSONALITIES,
  BRAND_PERSONALITIES, BRAND_TONES, COMM_STYLES, VALUES, POSITIONING, NICHES,
  PURCHASE_INTENT, RISK_FLAGS, YES_NO, AUDIENCE_PRIORITY, MATCH_LEVELS,
  RECOMMENDATIONS, CONFIDENCE, DATA_STATUS,
  INDUSTRY_CATEGORY, PERSONALITY_FIT, TONE_STYLE, COMM_STYLE_FIT, catRel, styleRel,
} from './vocabulary.mjs'
import { KOLS, BRANDS, BRAND_FIELDS, TOKEN_FIELDS } from './dataset.mjs'
import { DISCOVERY_FILTERS, RANKING_PRESETS } from './catalogue.mjs'

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'Autometric_Brand_Match_Engine.xlsx')

/* ── address helpers ──────────────────────────────────────────────────────── */

export function colLetter(n) {
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26 }
  return s
}
const A = colLetter
const cellA = (sheet, c, r) => `${sheet}!$${A(c)}$${r}`
const rangeA = (sheet, c1, r1, c2, r2) => `${sheet}!$${A(c1)}$${r1}:$${A(c2)}$${r2}`
const F = f => ({ formula: f.replace(/^=/, '') })

/* ── theme ────────────────────────────────────────────────────────────────── */

const T = {
  ink: 'FF111827', sub: 'FF6B7280', line: 'FFE5E7EB',
  head: 'FF1F2937', headText: 'FFFFFFFF',
  band: 'FF15325B', bandText: 'FFFFFFFF',
  group: 'FF334E68', soft: 'FFF3F4F6',
  input: 'FFFFF8E1', calc: 'FFF0F6FF', note: 'FFFAFAFA',
}
const BASE = { name: 'Calibri', size: 10, color: { argb: T.ink } }
const bd = (c = T.line) => ({
  top: { style: 'thin', color: { argb: c } }, left: { style: 'thin', color: { argb: c } },
  bottom: { style: 'thin', color: { argb: c } }, right: { style: 'thin', color: { argb: c } },
})
const fillOf = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

function banner(ws, row, span, text, subtitle) {
  ws.mergeCells(row, 1, row, span)
  const c = ws.getCell(row, 1)
  c.value = text
  c.font = { ...BASE, size: 13, bold: true, color: { argb: T.bandText } }
  c.fill = fillOf(T.band)
  c.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(row).height = 24
  if (subtitle) {
    ws.mergeCells(row + 1, 1, row + 1, span)
    const s = ws.getCell(row + 1, 1)
    s.value = subtitle
    s.font = { ...BASE, size: 9, italic: true, color: { argb: T.sub } }
    s.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
    ws.getRow(row + 1).height = 30
  }
}

function groupBand(ws, row, c1, c2, text, argb = T.group) {
  if (c2 > c1) ws.mergeCells(row, c1, row, c2)
  const c = ws.getCell(row, c1)
  c.value = text
  c.font = { ...BASE, size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
  c.fill = fillOf(argb)
  c.alignment = { vertical: 'middle', horizontal: 'center' }
  c.border = bd('FF1F2937')
  for (let i = c1; i <= c2; i++) ws.getCell(row, i).fill = fillOf(argb)
}

function headers(ws, row, col, labels, height = 32) {
  labels.forEach((label, i) => {
    const c = ws.getCell(row, col + i)
    c.value = label
    c.font = { ...BASE, bold: true, size: 9, color: { argb: T.headText } }
    c.fill = fillOf(T.head)
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = bd('FF0F172A')
  })
  ws.getRow(row).height = height
}

function labelCell(ws, row, col, text, opts = {}) {
  const c = ws.getCell(row, col)
  c.value = text
  c.font = { ...BASE, bold: opts.bold ?? false, size: opts.size ?? 10, color: { argb: opts.color ?? T.ink } }
  if (opts.fill) c.fill = fillOf(opts.fill)
  c.alignment = { vertical: 'middle', wrapText: opts.wrap ?? false, indent: opts.indent ?? 0 }
  c.border = opts.noBorder ? undefined : bd()
  return c
}

/** Section title inside a sheet — a light band, not the page banner. */
function subhead(ws, row, span, text) {
  ws.mergeCells(row, 1, row, span)
  const c = ws.getCell(row, 1)
  c.value = text
  c.font = { ...BASE, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
  c.fill = fillOf(T.head)
  c.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(row).height = 18
  return row + 1
}

const SCORE_FMT = '0'
const PCT1 = '0.0'
const INT = '#,##0'
const IDR = '#,##0'

/**
 * Every constant the engine formulas lean on: block, label, key, value, note.
 *
 * Lifted to module scope and exported so there is exactly one place these
 * numbers live. `buildLookups` writes them into Lookup_Lists cells, and the
 * JavaScript scorer in `scoring.mjs` reads the same array to reproduce the
 * workbook's arithmetic outside Excel. Two copies of a weight is two weights.
 */
export const ENGINE_CONSTS = [
  ['COMPONENT WEIGHTS (must total 100)', 'Brand & Business Relevance', 'W_BRAND_BUSINESS', 20, 'Weight of component 1 in the Final Match Score.'],
  [null, 'Target Audience Relevance', 'W_TARGET_AUDIENCE', 30, 'Weight of component 2.'],
  [null, 'Content & Category Relevance', 'W_CONTENT_CATEGORY', 20, 'Weight of component 3.'],
  [null, 'Brand Personality Fit', 'W_PERSONALITY', 10, 'Weight of component 4.'],
  [null, 'Performance Quality', 'W_PERFORMANCE', 10, 'Weight of component 5.'],
  [null, 'Brand Safety', 'W_SAFETY', 10, 'Weight of component 6.'],

  ['BRAND & BUSINESS SUB-WEIGHTS', 'Industry Match', 'W_BB_INDUSTRY', 40, 'Brand Industry against the creator Category, via matrix 5.'],
  [null, 'Category Match', 'W_BB_CATEGORY', 30, 'Product / Service Category against the creator Sub Category.'],
  [null, 'Keyword Match', 'W_BB_KEYWORD', 30, 'Main Business Keywords and Brand Keywords found in the creator topics, interests, category and sub category — the two overlap scores averaged.'],

  ['TARGET AUDIENCE SUB-WEIGHTS (base)', 'Age Match', 'W_TA_AGE', 25, 'Base weight before Audience Demographics Priority is applied.'],
  [null, 'Gender Match', 'W_TA_GENDER', 15, 'Base weight.'],
  [null, 'Location Match', 'W_TA_LOCATION', 30, 'Base weight.'],
  [null, 'Interest Match', 'W_TA_INTEREST', 30, 'Base weight.'],
  [null, 'Priority bonus', 'W_TA_PRIORITY_BONUS', 12, 'Points added to the dimension named by Audience Demographics Priority; the other three give up a third each, so the four still total 100.'],

  ['LOCATION SUB-WEIGHTS', 'Country', 'W_LOC_COUNTRY', 50, 'Share of Location Match carried by Audience Country.'],
  [null, 'Region', 'W_LOC_REGION', 25, 'Share carried by Audience Region.'],
  [null, 'City', 'W_LOC_CITY', 25, 'Share carried by Audience City.'],

  ['CONTENT & CATEGORY SUB-WEIGHTS', 'Category Match', 'W_CC_CATEGORY', 30, 'Preferred Category against creator Category, via matrix 6.'],
  [null, 'Sub Category Match', 'W_CC_SUBCATEGORY', 20, 'Preferred Sub Category against creator Sub Category.'],
  [null, 'Topic Match', 'W_CC_TOPIC', 30, 'Preferred Content Topics found in creator topics and interests.'],
  [null, 'Content Style Match', 'W_CC_STYLE', 20, 'Preferred Content Style against creator Content Style, via matrix 9.'],

  ['PERSONALITY SUB-WEIGHTS', 'Personality Match', 'W_BP_PERSONALITY', 35, 'Brand Personality against Creator Personality, via matrix 7.'],
  [null, 'Tone vs Content Style', 'W_BP_TONE', 25, 'Brand Tone against Content Style, via matrix 8.'],
  [null, 'Values Match', 'W_BP_VALUES', 25, 'Brand Values and Preferred Creator Values against Creator Values.'],
  [null, 'Communication Style Match', 'W_BP_COMM', 15, 'Communication Style against Content Style, via matrix 8b.'],

  ['PERFORMANCE SUB-WEIGHTS', 'Engagement Rate', 'W_PQ_ER', 35, 'Share of Performance Quality.'],
  [null, 'Audience Quality', 'W_PQ_AUDIENCE', 20, 'Share of Performance Quality.'],
  [null, 'Consistency', 'W_PQ_CONSISTENCY', 20, 'Share of Performance Quality.'],
  [null, 'Community', 'W_PQ_COMMUNITY', 10, 'Share of Performance Quality.'],
  [null, 'Average Views', 'W_PQ_VIEWS', 10, 'Share of Performance Quality, normalised as views per follower.'],
  [null, 'Recent Growth', 'W_PQ_GROWTH', 5, 'Share of Performance Quality, from 30D Growth.'],

  ['BRAND SAFETY SUB-WEIGHTS', 'Brand Safety Score', 'W_BS_BASE', 80, 'Brand Safety Score is the primary metric, as the spec requires.'],
  [null, 'Competitor Saturation', 'W_BS_SATURATION', 20, 'Saturation lowers the score but never excludes on its own — only Max Competitor Saturation does.'],

  ['RISK MULTIPLIERS', 'Risk Flag = High', 'RISK_HIGH', 0.6, 'Applied to Brand Safety. A flag discounts the score; it does not zero it.'],
  [null, 'Risk Flag = Medium', 'RISK_MEDIUM', 0.85, 'Applied to Brand Safety.'],
  [null, 'Risk Flag = Low', 'RISK_LOW', 0.95, 'Applied to Brand Safety.'],
  [null, 'Risk Flag = None', 'RISK_NONE', 1, 'No discount.'],

  ['NORMALISATION TARGETS', 'Engagement Rate = 100 at', 'CAL_ER_TARGET', 6, 'ER in percent that scores 100 on the Performance component.'],
  [null, 'Primary-band audience share = 100 at', 'CAL_AGE_TARGET', 45, 'Primary age band share (plus half the secondary) that scores 100 on Age Match.'],
  [null, 'Gender majority = 100 at', 'CAL_GENDER_TARGET', 65, 'Female (or Male) share that scores 100 when Gender Majority names one.'],
  [null, 'Views per follower = 100 at', 'CAL_VFR_TARGET', 0.5, 'View-to-follower ratio that scores 100 on Average Views.'],
  [null, '30D Growth = 100 at', 'CAL_GROWTH_TARGET', 8, 'Monthly follower growth in percent that scores 100. -2% scores 0.'],
  [null, 'Value per engagement (IDR)', 'CAL_VALUE_PER_ENG', 9000, 'Earned value of one engagement, used by Estimated ROI.'],
  [null, 'Estimated Reach — views factor', 'CAL_REACH_VIEWS', 1.15, 'Estimated Reach = Average Views x this + Followers x the next.'],
  [null, 'Estimated Reach — followers factor', 'CAL_REACH_FOLL', 0.12, 'See above.'],
  [null, 'Median CPE across the roster', 'CAL_MEDIAN_CPE', null, 'Derived. Cost Efficiency is this divided by the creator CPE.'],
  [null, 'No-preference score', 'CAL_NEUTRAL', 50, 'What a comparison scores when the brand left the field blank — neither a reward nor a penalty.'],
  [null, 'Unrelated floor', 'CAL_UNRELATED', 20, 'Bottom of the 100/80/60/40/20 relevance ladder.'],

  ['MATCH LEVEL BANDS', 'Excellent Match at', 'BAND_EXCELLENT', 90, 'Final Match Score at or above this.'],
  [null, 'Strong Match at', 'BAND_STRONG', 80, ''],
  [null, 'Good Match at', 'BAND_GOOD', 70, ''],
  [null, 'Moderate Match at', 'BAND_MODERATE', 60, 'Below this is a Low Match — still visible unless Minimum Brand Match is set.'],

  ['RECOMMENDATION BANDS', 'Highly Recommended at', 'REC_HIGH', 85, 'Final Match Score at or above this, and not excluded.'],
  [null, 'Recommended at', 'REC_MID', 72, ''],
  [null, 'Consider at', 'REC_LOW', 60, 'Below this is Low Priority.'],

  ['CONFIDENCE BANDS', 'High at data completeness', 'CONF_HIGH', 100, 'Percent of the 12 tracked KOL fields that carry a value.'],
  [null, 'Medium at data completeness', 'CONF_MEDIUM', 84, 'Below this is Limited Data.'],

  ['EXPLANATION', 'Consideration threshold', 'EXP_CONSIDERATION', 75, 'A component below this is written up as a consideration rather than a strength.'],

  ['OPPORTUNITY SUB-WEIGHTS', 'Head-room (100 - saturation)', 'W_OP_HEADROOM', 35, 'Share of Opportunity Score.'],
  [null, 'Cost Efficiency', 'W_OP_COST', 25, 'Share of Opportunity Score.'],
  [null, 'Recent Growth', 'W_OP_GROWTH', 25, 'Share of Opportunity Score.'],
  [null, 'Engagement Rate', 'W_OP_ER', 15, 'Share of Opportunity Score.'],
]

/* ══════════════════════════════════════════════════════════════════════════
   LOOKUP_LISTS — every list, matrix and constant the engine reads
   ══════════════════════════════════════════════════════════════════════════ */

const LK = {}          // name → { col, r1, r2 } for the dropdown lists
const MX = {}          // name → { data:[c1,r1,c2,r2], rows:[...], cols:[...] }
const K = {}           // name → absolute address of a single constant cell

/**
 * `brands` defaults to the engine workbook's own three, so calling this with one
 * argument behaves exactly as it always has. The comparison workbook passes its
 * five instead — the BrandID dropdown is the only list on the sheet that is a
 * property of the dataset rather than of the vocabulary, and a sheet offering
 * brand ids that exist in neither workbook would be worse than no list at all.
 */
function buildLookups(wb, brands = BRANDS) {
  const ws = wb.addWorksheet('Lookup_Lists', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 0 }],
  })
  banner(ws, 1, 30, 'LOOKUP LISTS — vocabularies, relevance matrices and calibration',
    'Everything the engine reads that is not a Brand_Profile field or a KOL_Database field lives here. '
    + 'Edit a weight or a matrix cell and every score in the workbook moves — that is the point of the sheet.')

  /* 1. dropdown lists, one per column */
  let row = subhead(ws, 4, 30, '1. DROPDOWN LISTS  ·  the allowed values for every list field in Brand_Profile and KOL_Database')
  const LISTS = [
    ['Platform', PLATFORMS], ['Industry', INDUSTRIES], ['Category', CATEGORIES],
    ['SubCategory', SUBCATS.map(s => s[0])], ['Tier', TIERS.map(t => t.name)],
    ['AgeBand', AGE_BANDS], ['GenderMajority', GENDER_MAJORITY], ['Country', COUNTRIES],
    ['Region', REGIONS], ['City', CITIES], ['Interest', INTERESTS],
    ['ContentStyle', CONTENT_STYLES], ['CreatorPersonality', CREATOR_PERSONALITIES],
    ['BrandPersonality', BRAND_PERSONALITIES], ['BrandTone', BRAND_TONES],
    ['CommStyle', COMM_STYLES], ['Value', VALUES], ['Positioning', POSITIONING],
    ['Niche', NICHES], ['PurchaseIntent', PURCHASE_INTENT], ['RiskFlag', RISK_FLAGS],
    ['YesNo', YES_NO], ['AudiencePriority', AUDIENCE_PRIORITY], ['MatchLevel', MATCH_LEVELS],
    ['Recommendation', RECOMMENDATIONS], ['Confidence', CONFIDENCE], ['DataStatus', DATA_STATUS],
    ['BrandID', brands.map(b => b.brand_id)],
    ['Component', ['Brand & Business Relevance', 'Target Audience Relevance',
      'Content & Category Relevance', 'Brand Personality Fit', 'Performance Quality', 'Brand Safety']],
    ['RankingPreset', RANKING_PRESETS.map(p => p[0])],
  ]
  const headRow = row
  headers(ws, headRow, 1, LISTS.map(l => l[0]), 26)
  const first = headRow + 1
  let maxLen = 0
  LISTS.forEach(([name, values], i) => {
    values.forEach((v, j) => {
      const c = ws.getCell(first + j, i + 1)
      c.value = v
      c.font = { ...BASE, size: 9 }
      c.border = bd()
    })
    maxLen = Math.max(maxLen, values.length)
    LK[name] = { col: i + 1, r1: first, r2: first + values.length - 1 }
    ws.getColumn(i + 1).width = Math.max(11, Math.min(24, name.length + 6))
  })
  row = first + maxLen + 1

  /* 2. sub category → parent */
  row = subhead(ws, row, 30, '2. SUB CATEGORY → PARENT CATEGORY  ·  used by the Category Match and Sub Category Match ladders')
  headers(ws, row, 1, ['Sub Category', 'Parent Category'], 20)
  const subFirst = row + 1
  SUBCATS.forEach(([s, p], i) => {
    labelCell(ws, subFirst + i, 1, s, { size: 9 })
    labelCell(ws, subFirst + i, 2, p, { size: 9 })
  })
  LK.SubParent = { col: 2, r1: subFirst, r2: subFirst + SUBCATS.length - 1 }
  LK.SubName = { col: 1, r1: subFirst, r2: subFirst + SUBCATS.length - 1 }
  row = subFirst + SUBCATS.length + 1

  /* 3. tier bands */
  row = subhead(ws, row, 30, '3. TIER BANDS  ·  the thresholds tierOf() uses in @/lib/discover/vocab; KOL_Database.Tier is derived from them')
  headers(ws, row, 1, ['Tier', 'Min Followers', 'Max Followers'], 20)
  const tierFirst = row + 1
  TIERS.forEach((t, i) => {
    labelCell(ws, tierFirst + i, 1, t.name, { size: 9 })
    labelCell(ws, tierFirst + i, 2, t.min, { size: 9 }).numFmt = INT
    labelCell(ws, tierFirst + i, 3, t.max ?? '—', { size: 9 }).numFmt = INT
  })
  LK.TierName = { col: 1, r1: tierFirst, r2: tierFirst + TIERS.length - 1 }
  LK.TierMin = { col: 2, r1: tierFirst, r2: tierFirst + TIERS.length - 1 }
  row = tierFirst + TIERS.length + 1

  /* 4. constants — every number the formulas lean on, named and editable */
  row = subhead(ws, row, 30, '4. WEIGHTS, BANDS AND CALIBRATION  ·  every constant the engine uses. Nothing is hard-coded inside a formula.')
  headers(ws, row, 1, ['Block', 'Constant', 'Key', 'Value', 'What it does'], 26)
  let cr = row + 1
  const CONSTS = ENGINE_CONSTS

  CONSTS.forEach(([block, name, key, value, note]) => {
    if (block) labelCell(ws, cr, 1, block, { bold: true, size: 9, fill: T.soft })
    else labelCell(ws, cr, 1, '', { size: 9 })
    labelCell(ws, cr, 2, name, { size: 9 })
    labelCell(ws, cr, 3, key, { size: 9, color: T.sub })
    const v = labelCell(ws, cr, 4, value, { size: 9, bold: true, fill: T.input })
    v.alignment = { horizontal: 'center', vertical: 'middle' }
    labelCell(ws, cr, 5, note, { size: 9, color: T.sub, wrap: true })
    K[key] = cellA('Lookup_Lists', 4, cr)
    cr++
  })
  ws.getColumn(2).width = 34
  ws.getColumn(3).width = 26
  ws.getColumn(4).width = 11
  ws.getColumn(5).width = 78

  // The weight-total guard: a spec workbook whose weights quietly stop summing
  // to 100 is worse than one with no weights at all.
  labelCell(ws, cr, 1, 'CHECK', { bold: true, size: 9, fill: T.soft })
  labelCell(ws, cr, 2, 'Component weights total', { size: 9, bold: true })
  labelCell(ws, cr, 3, 'CHECK_WEIGHT_TOTAL', { size: 9, color: T.sub })
  const tot = ws.getCell(cr, 4)
  tot.value = F(`=${K.W_BRAND_BUSINESS}+${K.W_TARGET_AUDIENCE}+${K.W_CONTENT_CATEGORY}+${K.W_PERSONALITY}+${K.W_PERFORMANCE}+${K.W_SAFETY}`)
  tot.font = { ...BASE, size: 9, bold: true }
  tot.fill = fillOf(T.calc)
  tot.border = bd()
  tot.alignment = { horizontal: 'center' }
  K.CHECK_WEIGHT_TOTAL = cellA('Lookup_Lists', 4, cr)
  const verdict = labelCell(ws, cr, 5, '', { size: 9, bold: true })
  verdict.value = F(`=IF(${K.CHECK_WEIGHT_TOTAL}=100,"OK — the six components total 100%","ERROR — the six components total "&${K.CHECK_WEIGHT_TOTAL}&"%, they must total 100")`)
  cr += 2

  /* 5–9. the relevance matrices */
  function matrix(name, title, rowKeys, colKeys, valueOf) {
    cr = subhead(ws, cr, Math.max(30, colKeys.length + 1), title)
    const hr = cr
    labelCell(ws, hr, 1, '', { fill: T.head })
    headers(ws, hr, 2, colKeys, 44)
    const c0 = ws.getCell(hr, 1)
    c0.value = '↓ brand / creator →'
    c0.font = { ...BASE, bold: true, size: 8, color: { argb: T.headText } }
    c0.fill = fillOf(T.head)
    c0.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' }
    rowKeys.forEach((rk, i) => {
      labelCell(ws, hr + 1 + i, 1, rk, { size: 9, bold: true, fill: T.soft })
      colKeys.forEach((ck, j) => {
        const c = ws.getCell(hr + 1 + i, 2 + j)
        c.value = valueOf(rk, ck)
        c.font = { ...BASE, size: 9 }
        c.numFmt = SCORE_FMT
        c.alignment = { horizontal: 'center' }
        c.border = bd()
      })
    })
    MX[name] = {
      rows: rangeA('Lookup_Lists', 1, hr + 1, 1, hr + rowKeys.length),
      cols: rangeA('Lookup_Lists', 2, hr, 1 + colKeys.length, hr),
      data: rangeA('Lookup_Lists', 2, hr + 1, 1 + colKeys.length, hr + rowKeys.length),
    }
    cr = hr + rowKeys.length + 2
  }

  matrix('IND_CAT',
    '5. INDUSTRY × CREATOR CATEGORY  ·  drives Industry Match. 100 exact · 80 strongly related · 60 partially · 40 weakly · 20 unrelated',
    INDUSTRIES, CATEGORIES, (ind, cat) => INDUSTRY_CATEGORY[ind]?.[cat] ?? 20)

  matrix('CAT_CAT',
    '6. CATEGORY × CATEGORY  ·  drives Content Category Match and the Category Match fallback',
    CATEGORIES, CATEGORIES, (a, b) => catRel(a, b))

  matrix('PERS',
    '7. BRAND PERSONALITY × CREATOR PERSONALITY  ·  related matches count. Innovative is answered by Tech-savvy and Creative, not only by "Innovative".',
    BRAND_PERSONALITIES, CREATOR_PERSONALITIES, (b, c) => PERSONALITY_FIT[b]?.[c] ?? 40)

  matrix('TONE',
    '8. BRAND TONE × CONTENT STYLE  ·  drives Tone vs Content Style',
    BRAND_TONES, CONTENT_STYLES, (t, s) => TONE_STYLE[t]?.[s] ?? 45)

  matrix('COMM',
    '8b. COMMUNICATION STYLE × CONTENT STYLE  ·  drives Communication Style Match',
    COMM_STYLES, CONTENT_STYLES, (t, s) => COMM_STYLE_FIT[t]?.[s] ?? 45)

  matrix('STYLE',
    '9. CONTENT STYLE × CONTENT STYLE  ·  drives Content Style Match',
    CONTENT_STYLES, CONTENT_STYLES, (a, b) => styleRel(a, b))

  /* 10. ranking presets */
  cr = subhead(ws, cr, 30, '10. RANKING PRESETS  ·  the Discovery_Ranking preset picker reads this table. "Available today" is the prototype answer, not an aspiration.')
  headers(ws, cr, 1, ['#', 'Preset', 'Ranked by', 'Direction', 'Available today'], 22)
  const pFirst = cr + 1
  RANKING_PRESETS.forEach(([name, metric, dir, avail], i) => {
    labelCell(ws, pFirst + i, 1, i + 1, { size: 9 }).alignment = { horizontal: 'center' }
    labelCell(ws, pFirst + i, 2, name, { size: 9, bold: true })
    labelCell(ws, pFirst + i, 3, metric, { size: 9 })
    labelCell(ws, pFirst + i, 4, dir, { size: 9 }).alignment = { horizontal: 'center' }
    labelCell(ws, pFirst + i, 5, avail, { size: 9, color: T.sub })
  })
  LK.PresetName = { col: 2, r1: pFirst, r2: pFirst + RANKING_PRESETS.length - 1 }
  LK.PresetMetric = { col: 3, r1: pFirst, r2: pFirst + RANKING_PRESETS.length - 1 }
  LK.PresetDir = { col: 4, r1: pFirst, r2: pFirst + RANKING_PRESETS.length - 1 }
  LK.PresetAvail = { col: 5, r1: pFirst, r2: pFirst + RANKING_PRESETS.length - 1 }

  ws.getColumn(1).width = 30
  return ws
}

/** `Lookup_Lists!$B$5:$B$16` for a named list. */
const listRef = name => rangeA('Lookup_Lists', LK[name].col, LK[name].r1, LK[name].col, LK[name].r2)
const listCol = name => rangeA('Lookup_Lists', LK[name].col, LK[name].r1, LK[name].col, LK[name].r2)

export { buildLookups, LK, MX, K, listRef, listCol, banner, subhead, headers, labelCell, groupBand, bd, fillOf, T, BASE, F, A, cellA, rangeA, SCORE_FMT, PCT1, INT, IDR, OUT, ExcelJS }
