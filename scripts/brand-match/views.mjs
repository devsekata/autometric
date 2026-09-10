/**
 * The reading surfaces: Match_Explanation, Discovery_Filters, Filter_Logic,
 * Discovery_Ranking, Sample_Brands, Sample_Output and the README.
 *
 * None of these recompute anything. Every number on them is pulled out of
 * `Matching_Engine` or `KOL_Database` by lookup, which is the only way a
 * workbook with seven sheets of scores can be trusted: one engine, six views.
 * Where a sheet needs a value the engine does not already publish, the column
 * is added to the engine rather than recalculated here.
 */

import {
  LK, MX, K, listRef, banner, subhead, headers, labelCell, groupBand,
  bd, fillOf, T, BASE, F, A, cellA, rangeA, SCORE_FMT, PCT1, INT, IDR,
} from './build.mjs'
import { KOLS, BRANDS, BRAND_FIELDS } from './dataset.mjs'
import { DISCOVERY_FILTERS, RANKING_PRESETS } from './catalogue.mjs'
import {
  AXES, TAXONOMY_COVERAGE, CLASSIFICATION_RULES, aliasTable,
  nodes, brandNodes,
} from './taxonomy.mjs'
import { crosswalkRows } from './vocabulary.mjs'
import {
  BR, KC, kd, MEC, me, meRange, BRAND_COLS, KOL_FIRST, ME_FIRST, N_KOL, N_BRAND,
  ACTIVE_BRAND, bpActive,
} from './engine.mjs'

// Lazy: `LK` is only populated once buildLookups has run, and this module is
// imported before that happens.
const compList = () => listRef('Component')
/** Engine block for brand `b`, on one column — used for the per-brand rollups. */
const meBlock = (name, b) =>
  rangeA('Matching_Engine', MEC[name], ME_FIRST + b * N_KOL, MEC[name], ME_FIRST + b * N_KOL + N_KOL - 1)

/* ══════════════════════════════════════════════════════════════════════════
   Match_Explanation
   ══════════════════════════════════════════════════════════════════════════ */

const EX_COLUMNS = [
  'KOL ID', 'Creator', 'Handle', 'Platform', 'Category',
  'Final Match Score', 'Match Level', 'Confidence',
  'Why This Creator Matches', 'Strength 1', 'Strength 2', 'Strength 3',
  'Consideration 1', 'Consideration 2', 'Consideration 3',
  'Risk', 'Recommendation',
  'Brand Business Reason', 'Audience Match Reason', 'Content Match Reason',
  'Personality Match Reason', 'Safety Reason',
  'Engine Row', 'adj 1', 'adj 2', 'adj 3', 'adj 4', 'adj 5', 'adj 6',
]
const XC = {}
EX_COLUMNS.forEach((n, i) => { XC[n] = i + 1 })

const COMPONENT_COLUMNS = [
  'Brand & Business Relevance', 'Target Audience Relevance', 'Content & Category Relevance',
  'Brand Personality Fit', 'Performance Quality', 'Brand Safety',
]

export function buildMatchExplanation(wb) {
  const ws = wb.addWorksheet('Match_Explanation', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] })
  const SPAN = EX_COLUMNS.length
  banner(ws, 1, SPAN, 'MATCH EXPLANATION  ·  why each creator scored what they scored, for the Active Brand',
    'Reads the brand named in Brand_Profile!B4. Every sentence is assembled from the component scores next door — the strengths are '
    + 'literally the three highest components and the considerations the three lowest, so an explanation cannot drift away from the '
    + 'number it is explaining. Change the active brand and all thirty explanations change with it.')
  headers(ws, 4, 1, EX_COLUMNS, 30)

  for (let i = 0; i < N_KOL; i++) {
    const r = 5 + i
    const kr = KOL_FIRST + i
    const put = (name, value, fmt) => {
      const c = ws.getCell(r, XC[name])
      c.value = value
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      c.alignment = { vertical: 'top', wrapText: true }
      if (fmt) c.numFmt = fmt
      return c
    }
    const X = name => `$${A(XC[name])}$${r}`
    const engineRow = `$${A(XC['Engine Row'])}${r}`
    const pick = name => `INDEX(${meRange(name)},${engineRow},1)`
    const adjRange = `$${A(XC['adj 1'])}${r}:$${A(XC['adj 6'])}${r}`

    put('KOL ID', F(`=${kd('KOL ID', kr)}`))
    put('Creator', F(`=${kd('Creator Name', kr)}`))
    put('Handle', F(`=${kd('Handle', kr)}`))
    put('Platform', F(`=${kd('Platform', kr)}`))
    put('Category', F(`=${kd('Category', kr)}`))

    // The one lookup everything else on the row hangs off.
    put('Engine Row', F(`=MATCH(${ACTIVE_BRAND}&"|"&${kd('KOL ID', kr)},${meRange('Match Key')},0)`))

    COMPONENT_COLUMNS.forEach((name, ci) => {
      // A hair of separation per component so LARGE/SMALL break ties in a stated
      // order instead of an accidental one — two components on 78 must still
      // resolve to two different names.
      put(`adj ${ci + 1}`, F(`=${pick(name)}+${(6 - ci) / 1000}`), '0.000')
    })

    put('Final Match Score', F(`=${pick('Final Match Score')}`), SCORE_FMT).font = { ...BASE, size: 10, bold: true }
    put('Match Level', F(`=${pick('Match Level')}`))
    put('Confidence', F(`=${pick('Confidence')}`))

    const top1 = `INDEX(${compList()},MATCH(LARGE(${adjRange},1),${adjRange},0),1)`
    put('Why This Creator Matches',
      F(`="Strongest on "&${top1}&" at "&ROUND(LARGE(${adjRange},1),0)&"/100. "`
        + `&"Audience overlap "&${pick('Target Audience Relevance')}&"/100 against the "&${bpActive('primary_age_range')}&" / "`
        + `&${bpActive('secondary_age_range')}&" target; "&${kd('Category', kr)}&" content against a "&${bpActive('industry')}&" brief. "`
        + `&"Final Brand Match "&${pick('Final Match Score')}&"/100 ("&${pick('Match Level')}&")."`))

    for (let s = 1; s <= 3; s++) {
      put(`Strength ${s}`,
        F(`=IFERROR(INDEX(${compList()},MATCH(LARGE(${adjRange},${s}),${adjRange},0),1)&" — "&ROUND(LARGE(${adjRange},${s}),0)&"/100","")`))
      put(`Consideration ${s}`,
        F(`=IFERROR(IF(SMALL(${adjRange},${s})>=${K.EXP_CONSIDERATION},`
          + `"No material gap — "&INDEX(${compList()},MATCH(SMALL(${adjRange},${s}),${adjRange},0),1)&" at "&ROUND(SMALL(${adjRange},${s}),0)&"/100",`
          + `INDEX(${compList()},MATCH(SMALL(${adjRange},${s}),${adjRange},0),1)&" only "&ROUND(SMALL(${adjRange},${s}),0)&"/100"),"")`))
    }

    put('Risk',
      F(`=IF(${pick('Risk Flag')}="None","No risk flag — competitor saturation "&${pick('Competitor Saturation')}&"/100",`
        + `${pick('Risk Flag')}&" risk flag — competitor saturation "&${pick('Competitor Saturation')}&"/100")`))
    put('Recommendation', F(`=${pick('Recommendation')}`))

    put('Brand Business Reason',
      F(`="Industry "&${pick('Industry Match')}&"/100, category "&${pick('Category Match')}&"/100, keywords "&${pick('Keyword Match')}`
        + `&"/100 — a "&${bpActive('industry')}&" brief against a "&${kd('Category', kr)}&" / "&${kd('Sub Category', kr)}&" creator."`))
    put('Audience Match Reason',
      F(`="Age "&${pick('Age Match Score')}&"/100, gender "&${pick('Gender Match Score')}&"/100, location "&${pick('Location Match Score')}`
        + `&"/100, interests "&${pick('Interest Match Score')}&"/100. Weighted with priority on "&${bpActive('audience_priority')}&"."`))
    put('Content Match Reason',
      F(`="Category "&${pick('Category Match (content)')}&"/100, sub category "&${pick('Sub Category Match')}&"/100, topics "`
        + `&${pick('Topic Match')}&"/100, style "&${pick('Content Style Match')}&"/100 — brief wants "&${bpActive('preferred_content_style')}`
        + `&", creator delivers "&${kd('Content Style', kr)}&"."`))
    put('Personality Match Reason',
      F(`="Personality "&${pick('Personality Match')}&"/100, tone vs style "&${pick('Tone vs Content Style')}&"/100, values "`
        + `&${pick('Values Match')}&"/100, communication "&${pick('Communication Style Match')}&"/100 — a "&${bpActive('brand_personality')}`
        + `&" / "&${bpActive('brand_positioning')}&" brand against a "&${kd('Creator Personality', kr)}&" creator."`))
    put('Safety Reason',
      F(`=IF(${pick('Risk Flag')}="None","No risk flag. ",${pick('Risk Flag')}&" risk flag. ")`
        + `&"Brand Safety "&${pick('Brand Safety Base')}&"/100, competitor saturation "&${pick('Competitor Saturation')}&"/100"`
        + `&IF(${pick('Competitor Saturation')}>=70," — high, so treat it as a consideration rather than an automatic exclusion.",".")`))
  }

  EX_COLUMNS.forEach((name, i) => { ws.getColumn(i + 1).width = 16 })
  for (const n of ['Why This Creator Matches', 'Brand Business Reason', 'Audience Match Reason',
    'Content Match Reason', 'Personality Match Reason', 'Safety Reason']) ws.getColumn(XC[n]).width = 62
  for (const n of ['Strength 1', 'Strength 2', 'Strength 3', 'Consideration 1', 'Consideration 2',
    'Consideration 3', 'Risk', 'Recommendation', 'Match Level']) ws.getColumn(XC[n]).width = 32
  for (let c = XC['Engine Row']; c <= XC['adj 6']; c++) ws.getColumn(c).width = 9
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + N_KOL, column: SPAN } }

  ws.addConditionalFormatting({
    ref: `${A(XC['Final Match Score'])}5:${A(XC['Final Match Score'])}${4 + N_KOL}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 40 }, { type: 'num', value: 70 }, { type: 'num', value: 95 }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  ws.addConditionalFormatting({
    ref: `${A(XC.Recommendation)}5:${A(XC.Recommendation)}${4 + N_KOL}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'Highly Recommended', priority: 1, style: { fill: fillOf('FFBBF7D0'), font: { bold: true, color: { argb: 'FF14532D' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Excluded', priority: 2, style: { fill: fillOf('FFFEE2E2'), font: { bold: true, color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Low Priority', priority: 3, style: { fill: fillOf('FFFEF3C7'), font: { color: { argb: 'FF92400E' } } } },
    ],
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   Discovery_Filters
   ══════════════════════════════════════════════════════════════════════════ */

export function buildDiscoveryFilters(wb) {
  const ws = wb.addWorksheet('Discovery_Filters', { views: [{ state: 'frozen', ySplit: 4 }] })
  const COLS = ['Group', 'Filter', 'Filter Key', 'Type', 'Control', 'Brand_Profile input',
    'KOL_Database field', 'Status in prototype', 'KOL database source', 'Coverage (8 Sep 2026)']
  banner(ws, 1, COLS.length, 'DISCOVERY FILTERS  ·  every control on the Creator Database panel, grouped',
    'Type is the load-bearing column: HARD FILTER removes a creator from Discovery, SOFT MATCH only moves them down the list. '
    + 'The last three columns are carried over from deliv.xlsx (Mapping Filter-DB) and the 8 Sep 2026 filter audit — a spec that '
    + 'defines a filter without saying whether the database can answer it is how "Max Rate Card" came to be marked DONE while '
    + 'returning zero creators at every price.')

  ws.addTable({
    name: 'tblDiscoveryFilters',
    ref: 'A4',
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: COLS.map(name => ({ name, filterButton: true })),
    rows: DISCOVERY_FILTERS.map(r => r.slice()),
  })

  const last = 4 + DISCOVERY_FILTERS.length
  const widths = [16, 26, 26, 13, 22, 26, 28, 17, 44, 26]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  for (let r = 5; r <= last; r++) {
    for (let c = 1; c <= COLS.length; c++) {
      const cell = ws.getCell(r, c)
      cell.font = { ...BASE, size: 9 }
      cell.alignment = { vertical: 'top', wrapText: true }
    }
  }
  ws.addConditionalFormatting({
    ref: `D5:D${last}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'HARD', priority: 1, style: { fill: fillOf('FFFEE2E2'), font: { bold: true, color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'SOFT', priority: 2, style: { fill: fillOf('FFDBEAFE'), font: { bold: true, color: { argb: 'FF1E40AF' } } } },
    ],
  })
  ws.addConditionalFormatting({
    ref: `H5:H${last}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'BLOCKED', priority: 1, style: { fill: fillOf('FFFEE2E2'), font: { color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'PARTIAL', priority: 2, style: { fill: fillOf('FFFEF3C7'), font: { color: { argb: 'FF92400E' } } } },
      { type: 'containsText', operator: 'containsText', text: 'DONE', priority: 3, style: { fill: fillOf('FFDCFCE7'), font: { color: { argb: 'FF166534' } } } },
      { type: 'containsText', operator: 'containsText', text: 'NEW', priority: 4, style: { fill: fillOf('FFE0E7FF'), font: { color: { argb: 'FF3730A3' } } } },
    ],
  })

  let r = last + 2
  r = subhead(ws, r, COLS.length, 'ROLL-UP  ·  counted from the table above, not typed')
  const rows = [
    ['Filters defined', `=COUNTA($B$5:$B$${last})`],
    ['— of which HARD FILTER', `=COUNTIF($D$5:$D$${last},"HARD FILTER")`],
    ['— of which SOFT MATCH', `=COUNTIF($D$5:$D$${last},"SOFT MATCH")`],
    ['Wired end to end today (DONE)', `=COUNTIF($H$5:$H$${last},"DONE")`],
    ['Working on part of the roster (PARTIAL)', `=COUNTIF($H$5:$H$${last},"PARTIAL")`],
    ['Correct code, empty column (BLOCKED BY DATA)', `=COUNTIF($H$5:$H$${last},"BLOCKED BY DATA")`],
    ['Defined here, no column yet (NEW)', `=COUNTIF($H$5:$H$${last},"NEW")`],
  ]
  rows.forEach(([label, formula], i) => {
    labelCell(ws, r + i, 1, label, { size: 9, bold: i === 0 })
    ws.mergeCells(r + i, 1, r + i, 3)
    const c = ws.getCell(r + i, 4)
    c.value = F(formula)
    c.font = { ...BASE, size: 9, bold: true }
    c.fill = fillOf(T.calc)
    c.border = bd()
    c.alignment = { horizontal: 'center' }
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   Filter_Logic
   ══════════════════════════════════════════════════════════════════════════ */

const FILTER_LOGIC = [
  ['HARD FILTER', 'Platform', 'The creator platform must appear in Preferred Platform.',
    'ISERROR(SEARCH(KOL.Platform, Brand.preferred_platform)) → excluded',
    'Removed from Discovery entirely.', 'WHERE platforms.key = ANY($platforms)'],
  ['HARD FILTER', 'Minimum Followers', 'Followers must reach Preferred Follower Range — Min. 0 turns the rule off.',
    'AND(min>0, KOL.Followers < min) → excluded', 'Removed from Discovery entirely.',
    'WHERE followers_count >= $minFollowers'],
  ['HARD FILTER', 'Maximum Followers', 'Followers must not exceed Preferred Follower Range — Max. 0 turns the rule off.',
    'AND(max>0, KOL.Followers > max) → excluded', 'Removed from Discovery entirely.',
    'WHERE followers_count <= $maxFollowers — a creator whose follower count was never measured is excluded when a ceiling is set, because "below X" is not satisfied by "unknown".'],
  ['HARD FILTER', 'Minimum Engagement Rate', 'Engagement Rate must reach Minimum Engagement Rate. A blank ER counts as 0.',
    'AND(min>0, IF(ER="",0,ER) < min) → excluded', 'Removed from Discovery entirely.',
    'WHERE er_pct >= $minErPct, over the ER_CLEAN subset only'],
  ['HARD FILTER', 'Tier', 'The creator tier must appear in Preferred Tier.',
    'ISERROR(SEARCH(KOL.Tier, Brand.preferred_tier)) → excluded', 'Removed from Discovery entirely.',
    'WHERE tier = ANY($tiers), with the __untiered sentinel for creators in no band'],
  ['HARD FILTER', 'Minimum Audience Quality', 'Audience Quality must reach Minimum Audience Quality. 0 turns the rule off.',
    'AND(min>0, AudienceQualityScore < min) → excluded', 'Removed from Discovery entirely.',
    'Needs feature.{ig,tt}_audience_analysis; 23 of 7.721 creators today, so ship it disabled with the reason shown.'],
  ['HARD FILTER', 'Minimum Brand Safety', 'Brand Safety Score must reach Minimum Brand Safety. 0 turns the rule off.',
    'AND(min>0, BrandSafetyBase < min) → excluded', 'Removed from Discovery entirely.',
    'No column exists yet. Until one does, this must not be presented as an active filter.'],
  ['HARD FILTER', 'Audience Country', 'Only when Audience Country is a Hard Filter = Yes.',
    'AND(flag="Yes", KOL.AudienceCountry <> Brand.target_country) → excluded', 'Removed from Discovery entirely.',
    'audience_geo_daily at geo_level=country; 23 creators today.'],
  ['HARD FILTER', 'Category', 'Only when Category is a Hard Filter = Yes. Off by default — category is normally a ranking signal, not a gate.',
    'AND(flag="Yes", KOL.Category <> Brand.preferred_category) → excluded', 'Removed from Discovery entirely.',
    'WHERE category_ids && $categories — overlap, not equality: 1.183 creators carry more than one category.'],
  ['HARD FILTER', 'Max Competitor Saturation', 'Only when Max Competitor Saturation > 0. This is the one place saturation can exclude.',
    'AND(max>0, CompetitorSaturation > max) → excluded',
    'Removed from Discovery entirely — but only because the brand asked for it.',
    'No column exists yet.'],
  ['HARD FILTER', 'Exclusion — Already Selected', 'Only when Exclude Already Selected = Yes.',
    'AND(flag="Yes", KOL.AlreadySelected="Yes") → excluded', 'Removed from Discovery entirely.',
    'discover_creator_links (migration 053).'],
  ['HARD FILTER', 'Exclusion — Already in Cart', 'Only when Exclude Already in Cart = Yes.',
    'AND(flag="Yes", KOL.InCart="Yes") → excluded', 'Removed from Discovery entirely.', 'Discover cart state.'],
  ['HARD FILTER', 'Exclusion — Existing Partner', 'Only when Exclude Existing Partner = Yes.',
    'AND(flag="Yes", KOL.ExistingPartner="Yes") → excluded', 'Removed from Discovery entirely.',
    'public.campaign_kols — 0 rows today.'],
  ['HARD FILTER', 'Exclusion — Excluded Creator', 'Only when Exclude Excluded Creator = Yes.',
    'AND(flag="Yes", KOL.ExcludedCreator="Yes") → excluded', 'Removed from Discovery entirely.',
    'No exclusion list exists yet.'],
  ['HARD FILTER', 'Minimum Brand Match', 'Only when Minimum Brand Match > 0. Off by default: a Low Match stays visible.',
    'AND(min>0, FinalMatchScore < min) → excluded',
    'Removed from Discovery — the one filter that acts on the score itself.',
    'Computed, not stored. Apply after ranking, never inside the SQL.'],

  ['SOFT MATCH', 'Brand Match', 'The Final Match Score. Orders the list; never removes anyone.',
    'ROUND(Σ component × weight ÷ Σ weight, 0)', 'Creator stays visible, position changes.',
    'ORDER BY score DESC, computed in the application layer.'],
  ['SOFT MATCH', 'Audience Match', 'Target Audience Relevance. The heaviest single component at 30%.',
    'Age×w + Gender×w + Location×w + Interest×w, ÷ Σw', 'Creator stays visible, position changes.', '—'],
  ['SOFT MATCH', 'Content Relevance', 'Content & Category Relevance.',
    'Category×30 + SubCategory×20 + Topic×30 + Style×20, ÷100', 'Creator stays visible, position changes.', '—'],
  ['SOFT MATCH', 'Personality Fit', 'Brand Personality Fit, from the two personality matrices plus values overlap.',
    'Personality×35 + Tone×25 + Values×25 + Communication×15, ÷100', 'Creator stays visible, position changes.', '—'],
  ['SOFT MATCH', 'Performance', 'Performance Quality, normalised against the calibration targets.',
    'ER×35 + AudienceQuality×20 + Consistency×20 + Community×10 + Views×10 + Growth×5, ÷100',
    'Creator stays visible, position changes.', '—'],
  ['SOFT MATCH', 'Opportunity', 'Head-room, cost efficiency, growth and engagement — how much is still on the table.',
    '(100−saturation)×35 + CostEfficiency×25 + Growth×25 + ER×15, ÷100',
    'Creator stays visible, position changes.', '—'],
  ['SOFT MATCH', 'Estimated ROI', 'Modelled earned value over the rate card.',
    'EstimatedReach × ER% × value-per-engagement ÷ Rate', 'Creator stays visible, position changes.',
    'Blocked: unified_rate_card holds 0 rows.'],
  ['SOFT MATCH', 'Competitor Saturation', 'A consideration and a warning, never an automatic rejection.',
    'Lowers Brand Safety by its 20% share; excludes only via Max Competitor Saturation.',
    'Creator stays visible and is flagged in Match_Explanation.', '—'],
]

export function buildFilterLogic(wb) {
  const ws = wb.addWorksheet('Filter_Logic', { views: [{ state: 'frozen', ySplit: 4 }] })
  const COLS = ['Type', 'Rule', 'Condition', 'Excel implementation', 'What happens when it fails', 'Backend note']
  banner(ws, 1, COLS.length, 'FILTER LOGIC  ·  hard filter versus soft match',
    'A HARD FILTER answers "should this creator be in the result set at all". A SOFT MATCH answers "where in it". '
    + 'Confusing the two is the expensive mistake: a modelled figure used as a hard filter silently drops creators on the strength '
    + 'of a guess, and — because the roster pages server-side — filters only the rows already fetched, giving a count that means nothing.')

  ws.addTable({
    name: 'tblFilterLogic',
    ref: 'A4',
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: COLS.map(name => ({ name, filterButton: true })),
    rows: FILTER_LOGIC.map(r => r.slice()),
  })
  const last = 4 + FILTER_LOGIC.length;
  [13, 30, 52, 58, 46, 60].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  for (let r = 5; r <= last; r++) {
    for (let c = 1; c <= COLS.length; c++) {
      const cell = ws.getCell(r, c)
      cell.font = { ...BASE, size: 9 }
      cell.alignment = { vertical: 'top', wrapText: true }
    }
  }
  ws.addConditionalFormatting({
    ref: `A5:A${last}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'HARD', priority: 1, style: { fill: fillOf('FFFEE2E2'), font: { bold: true, color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'SOFT', priority: 2, style: { fill: fillOf('FFDBEAFE'), font: { bold: true, color: { argb: 'FF1E40AF' } } } },
    ],
  })

  let r = last + 2
  r = subhead(ws, r, COLS.length, 'MATCH LEVEL LADDER  ·  read straight off the bands on Lookup_Lists, so the ladder and the engine cannot disagree')
  headers(ws, r, 1, ['Final Match Score', 'Match Level', 'Recommendation', 'Visible in Discovery?'], 20)
  r++
  const LADDER = [
    [`=${K.BAND_EXCELLENT}&"–100"`, 'Excellent Match', 'Highly Recommended', 'Yes'],
    [`=${K.BAND_STRONG}&"–"&(${K.BAND_EXCELLENT}-1)`, 'Strong Match', 'Highly Recommended / Recommended', 'Yes'],
    [`=${K.BAND_GOOD}&"–"&(${K.BAND_STRONG}-1)`, 'Good Match', 'Recommended', 'Yes'],
    [`=${K.BAND_MODERATE}&"–"&(${K.BAND_GOOD}-1)`, 'Moderate Match', 'Consider', 'Yes'],
    [`="0–"&(${K.BAND_MODERATE}-1)`, 'Low Match', 'Low Priority', 'Yes — unless Minimum Brand Match is set above the score'],
  ]
  LADDER.forEach((row, i) => {
    const c = ws.getCell(r + i, 1)
    c.value = F(row[0])
    c.font = { ...BASE, size: 9, bold: true }
    c.border = bd()
    c.alignment = { horizontal: 'center' }
    labelCell(ws, r + i, 2, row[1], { size: 9, bold: true })
    labelCell(ws, r + i, 3, row[2], { size: 9 })
    labelCell(ws, r + i, 4, row[3], { size: 9, color: T.sub, wrap: true })
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   Discovery_Ranking
   ══════════════════════════════════════════════════════════════════════════ */

const DR_COLUMNS = [
  'Rank', 'KOL', 'Handle', 'Platform', 'Category', 'Tier', 'Followers', 'Engagement Rate (%)',
  'Audience Match', 'Brand Match', 'Content Relevance', 'Performance', 'Brand Safety',
  'Opportunity', 'Estimated ROI', 'Match Level', 'Recommendation', 'Status',
  'Default Sort Key', 'Preset Rank', 'Preset Metric Value', 'KOL ID', 'Engine Row',
]
const DC = {}
DR_COLUMNS.forEach((n, i) => { DC[n] = i + 1 })
const PRESET_COL0 = DR_COLUMNS.length + 1
const DR_FIRST = 7
const DR_LAST = DR_FIRST + N_KOL - 1

/** The 30 preset metrics, one column each. `pick` reads the engine row. */
function presetFormula(idx, kr, pick) {
  const kdc = name => kd(name, kr)
  const blank0 = name => `IF(${kdc(name)}="",0,${kdc(name)})`
  switch (idx) {
    case 0: return `=${pick('Final Match Score')}`
    case 1: return `=${blank0('Average Views')}`
    case 2: return `=${blank0('Median Views')}`
    case 3: return `=ROUND(${pick('Engagement Rate Score')}*0.6+${pick('Audience Quality Score')}*0.4,1)`
    case 4: return `=${blank0('Share Rate (%)')}`
    case 5: return `=${blank0('Save Rate (%)')}`
    case 6: return `=${blank0('Consistency Score')}`
    case 7: return `=${blank0('View-to-Follower Ratio')}`
    case 8: return `=${blank0('Recent Performance')}`
    case 9: return `=${blank0('30D Growth (%)')}`
    case 10: return `=${blank0('90D Growth (%)')}`
    case 11: return `=ROUND(MIN(100,${blank0('30D Growth (%)')}*8+${blank0('90D Growth (%)')}*2+${blank0('Engagement Rate (%)')}*3),1)`
    case 12: return `=${blank0('Audience Quality')}`
    case 13: return `=${blank0('Audience Authenticity')}`
    case 14: return `=${pick('Target Audience Relevance')}`
    case 15: return `=${blank0('Community Score')}`
    case 16: return `=IF(${kdc('CPV')}="",999999999,${kdc('CPV')})`
    case 17: return `=IF(${kdc('CPE')}="",999999999,${kdc('CPE')})`
    case 18: return `=IF(${kdc('CPM')}="",999999999,${kdc('CPM')})`
    case 19: return `=${blank0('Cost Efficiency')}`
    case 20: return `=${blank0('Estimated ROI')}`
    case 21: return `=${pick('Brand Fit Index')}`
    case 22: return `=${pick('Opportunity Score')}`
    case 23: return `=${blank0('Competitor Saturation')}`
    case 24: return `=${pick('Content & Category Relevance')}`
    case 25: return `=IF(${kdc('Added Date')}="",0,${kdc('Added Date')}+0)`
    case 26: return `=IF(${kdc('Last Updated')}="",0,${kdc('Last Updated')}+0)`
    case 27: return `=ROUND(${blank0('Recent Performance')}*0.6+MIN(100,${blank0('30D Growth (%)')}*10)*0.4,1)`
    case 28: return `=ROUND(MIN(100,${blank0('Engagement Rate (%)')}/8*100)*0.35+${blank0('Audience Quality')}*0.25`
      + `+(100-${blank0('Competitor Saturation')})*0.25+(100-MIN(100,${blank0('Followers')}/5000))*0.15,1)`
    case 29: return `=ROUND(${pick('Final Match Score')}*IF(${pick('Confidence')}="High",1,IF(${pick('Confidence')}="Medium",0.92,0.8)),1)`
    default: return '=0'
  }
}

export function buildDiscoveryRanking(wb) {
  const ws = wb.addWorksheet('Discovery_Ranking', { views: [{ state: 'frozen', ySplit: 6, xSplit: 2 }] })
  const SPAN = PRESET_COL0 + RANKING_PRESETS.length - 1
  banner(ws, 1, SPAN, 'DISCOVERY RANKING  ·  the Active Brand’s result page',
    'Default ranking is Brand Match, then Audience Match, then Content Relevance, then Performance, then Brand Safety — encoded in '
    + 'the Default Sort Key column as one number, so the tie-break order is inspectable rather than implied. Rank is computed over the '
    + 'creators that passed the hard filters only; an excluded creator shows "—" and keeps its scores, because the reason it is out '
    + 'should stay legible.')

  labelCell(ws, 4, 1, 'Ranking Preset →', { bold: true, size: 10, fill: T.soft })
  const sel = ws.getCell(4, 2)
  sel.value = RANKING_PRESETS[0][0]
  sel.font = { ...BASE, bold: true, size: 11 }
  sel.fill = fillOf(T.input)
  sel.border = bd('FFF59E0B')
  sel.alignment = { horizontal: 'center' }
  sel.dataValidation = { type: 'list', allowBlank: false, formulae: [listRef('RankingPreset')] }
  ws.mergeCells(4, 2, 4, 3)
  ws.getRow(4).height = 22

  const presetIdx = 'Discovery_Ranking!$K$4'
  const presetDir = 'Discovery_Ranking!$F$4'
  labelCell(ws, 4, 4, 'ranked by', { size: 9, color: T.sub })
  ws.getCell(4, 5).value = F(`=INDEX(${rangeA('Lookup_Lists', LK.PresetMetric.col, LK.PresetMetric.r1, LK.PresetMetric.col, LK.PresetMetric.r2)},${presetIdx},1)`)
  ws.getCell(4, 5).font = { ...BASE, size: 9, bold: true }
  labelCell(ws, 4, 6, '', { noBorder: true })
  ws.getCell(4, 6).value = F(`=INDEX(${rangeA('Lookup_Lists', LK.PresetDir.col, LK.PresetDir.r1, LK.PresetDir.col, LK.PresetDir.r2)},${presetIdx},1)`)
  ws.getCell(4, 6).font = { ...BASE, size: 9, bold: true }
  ws.getCell(4, 6).alignment = { horizontal: 'center' }
  labelCell(ws, 4, 7, 'available today', { size: 9, color: T.sub })
  ws.getCell(4, 8).value = F(`=INDEX(${rangeA('Lookup_Lists', LK.PresetAvail.col, LK.PresetAvail.r1, LK.PresetAvail.col, LK.PresetAvail.r2)},${presetIdx},1)`)
  ws.getCell(4, 8).font = { ...BASE, size: 9, bold: true }
  labelCell(ws, 4, 10, 'preset # →', { size: 8, color: T.sub, noBorder: true })
  ws.getCell(4, 11).value = F(`=MATCH($B$4,${rangeA('Lookup_Lists', LK.PresetName.col, LK.PresetName.r1, LK.PresetName.col, LK.PresetName.r2)},0)`)
  ws.getCell(4, 11).font = { ...BASE, size: 8, color: { argb: T.sub } }

  labelCell(ws, 5, 1, 'Active Brand', { size: 9, color: T.sub, noBorder: true })
  ws.getCell(5, 2).value = F(`=${ACTIVE_BRAND}&" — "&${bpActive('brand_name')}`)
  ws.getCell(5, 2).font = { ...BASE, size: 10, bold: true }

  groupBand(ws, 5, PRESET_COL0, SPAN,
    'PRESET METRIC BLOCK  ·  one column per preset; the picker above reads the column it names')
  headers(ws, 6, 1, DR_COLUMNS, 34)
  headers(ws, 6, PRESET_COL0, RANKING_PRESETS.map(p => p[0]), 34)

  for (let i = 0; i < N_KOL; i++) {
    const r = DR_FIRST + i
    const kr = KOL_FIRST + i
    const engineRow = `$${A(DC['Engine Row'])}${r}`
    const pick = name => `INDEX(${meRange(name)},${engineRow},1)`
    const put = (name, value, fmt) => {
      const c = ws.getCell(r, DC[name])
      c.value = value
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      if (fmt) c.numFmt = fmt
      return c
    }
    put('KOL ID', F(`=${kd('KOL ID', kr)}`))
    put('Engine Row', F(`=MATCH(${ACTIVE_BRAND}&"|"&${kd('KOL ID', kr)},${meRange('Match Key')},0)`))
    put('KOL', F(`=${kd('Creator Name', kr)}`))
    put('Handle', F(`=${kd('Handle', kr)}`))
    put('Platform', F(`=${kd('Platform', kr)}`))
    put('Category', F(`=${kd('Category', kr)}`))
    put('Tier', F(`=${kd('Tier', kr)}`))
    put('Followers', F(`=${kd('Followers', kr)}`), INT)
    put('Engagement Rate (%)', F(`=${kd('Engagement Rate (%)', kr)}`), PCT1)
    put('Audience Match', F(`=${pick('Target Audience Relevance')}`), SCORE_FMT)
    put('Brand Match', F(`=${pick('Final Match Score')}`), SCORE_FMT).font = { ...BASE, size: 10, bold: true }
    put('Content Relevance', F(`=${pick('Content & Category Relevance')}`), SCORE_FMT)
    put('Performance', F(`=${pick('Performance Quality')}`), SCORE_FMT)
    put('Brand Safety', F(`=${pick('Brand Safety')}`), SCORE_FMT)
    put('Opportunity', F(`=${pick('Opportunity Score')}`), SCORE_FMT)
    put('Estimated ROI', F(`=IF(${kd('Estimated ROI', kr)}="","—",${kd('Estimated ROI', kr)})`), '0.00')
    put('Match Level', F(`=${pick('Match Level')}`))
    put('Recommendation', F(`=${pick('Recommendation')}`))
    put('Status', F(`=${pick('Hard Filter Result')}`))

    const st = `$${A(DC.Status)}${r}`
    put('Default Sort Key',
      F(`=IF(${st}="EXCLUDED",-1,$${A(DC['Brand Match'])}${r}+$${A(DC['Audience Match'])}${r}/1000`
        + `+$${A(DC['Content Relevance'])}${r}/100000+$${A(DC.Performance)}${r}/10000000`
        + `+$${A(DC['Brand Safety'])}${r}/1000000000)`), '0.00000000')
    put('Rank',
      F(`=IF(${st}="EXCLUDED","—",COUNTIFS($${A(DC['Default Sort Key'])}$${DR_FIRST}:$${A(DC['Default Sort Key'])}$${DR_LAST},`
        + `">"&$${A(DC['Default Sort Key'])}${r},$${A(DC.Status)}$${DR_FIRST}:$${A(DC.Status)}$${DR_LAST},"PASS")+1)`))

    for (let p = 0; p < RANKING_PRESETS.length; p++) {
      const c = ws.getCell(r, PRESET_COL0 + p)
      c.value = F(presetFormula(p, kr, pick))
      c.font = { ...BASE, size: 8, color: { argb: T.sub } }
      c.border = bd()
      c.numFmt = '0.00'
    }
    put('Preset Metric Value',
      F(`=INDEX($${A(PRESET_COL0)}${r}:$${A(SPAN)}${r},1,${presetIdx})`), '0.00')
    put('Preset Rank',
      F(`=IF(${st}="EXCLUDED","—",IF(${presetDir}="asc",`
        + `COUNTIFS($${A(DC['Preset Metric Value'])}$${DR_FIRST}:$${A(DC['Preset Metric Value'])}$${DR_LAST},"<"&$${A(DC['Preset Metric Value'])}${r},$${A(DC.Status)}$${DR_FIRST}:$${A(DC.Status)}$${DR_LAST},"PASS")+1,`
        + `COUNTIFS($${A(DC['Preset Metric Value'])}$${DR_FIRST}:$${A(DC['Preset Metric Value'])}$${DR_LAST},">"&$${A(DC['Preset Metric Value'])}${r},$${A(DC.Status)}$${DR_FIRST}:$${A(DC.Status)}$${DR_LAST},"PASS")+1))`))
  }

  DR_COLUMNS.forEach((name, i) => {
    ws.getColumn(i + 1).width = name.length > 18 ? 17 : Math.max(9, Math.min(18, name.length + 3))
  })
  ws.getColumn(DC.KOL).width = 20
  ws.getColumn(DC.Handle).width = 22
  ws.getColumn(DC['Match Level']).width = 17
  ws.getColumn(DC.Recommendation).width = 19
  ws.getColumn(DC['Default Sort Key']).width = 15
  for (let p = 0; p < RANKING_PRESETS.length; p++) ws.getColumn(PRESET_COL0 + p).width = 13
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + N_KOL, column: DR_COLUMNS.length } }

  ws.addConditionalFormatting({
    ref: `${A(DC['Brand Match'])}${DR_FIRST}:${A(DC['Brand Match'])}${DR_LAST}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 40 }, { type: 'num', value: 70 }, { type: 'num', value: 95 }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  ws.addConditionalFormatting({
    ref: `${A(DC.Status)}${DR_FIRST}:${A(DC.Status)}${DR_LAST}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'EXCLUDED', priority: 1, style: { fill: fillOf('FFFEE2E2'), font: { bold: true, color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'PASS', priority: 2, style: { fill: fillOf('FFDCFCE7'), font: { color: { argb: 'FF166534' } } } },
    ],
  })
  ws.addConditionalFormatting({
    ref: `${A(DC['Match Level'])}${DR_FIRST}:${A(DC['Match Level'])}${DR_LAST}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'Excellent', priority: 1, style: { fill: fillOf('FFBBF7D0'), font: { bold: true, color: { argb: 'FF14532D' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Strong', priority: 2, style: { fill: fillOf('FFDCFCE7'), font: { color: { argb: 'FF166534' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Low', priority: 3, style: { fill: fillOf('FFFEE2E2'), font: { color: { argb: 'FF991B1B' } } } },
    ],
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   Sample_Brands
   ══════════════════════════════════════════════════════════════════════════ */

export function buildSampleBrands(wb) {
  const ws = wb.addWorksheet('Sample_Brands', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] })
  const COLS = [
    'Brand ID', 'Brand Name', 'Industry', 'Product / Service Category', 'Brand Niche',
    'Primary Age', 'Secondary Age', 'Gender Majority', 'Target Country', 'Target Region',
    'Target City', 'Audience Interests', 'Audience Priority', 'Brand Personality', 'Brand Tone',
    'Brand Values', 'Communication Style', 'Preferred Platform', 'Preferred Tier',
    'Preferred Category', 'Preferred Content Style', 'Min ER (%)', 'Min Audience Quality',
    'Min Brand Safety', 'Eligible Creators', 'Excluded Creators', 'Average Match (eligible)',
    'Highest Match', 'Best-Matched Creator', 'Excellent + Strong',
  ]
  banner(ws, 1, COLS.length, 'SAMPLE BRANDS  ·  three briefs, one roster',
    'Columns A–X mirror Brand_Profile — they are lookups, not copies, so a change on Brand_Profile lands here. '
    + 'Columns Y–AD are the outcome: how many creators each brief keeps, how well they score and who wins. Three different answers '
    + 'from one KOL_Database is the whole claim of the workbook, and this is where it is legible in six numbers.')
  headers(ws, 4, 1, COLS, 34)

  const FIELDS = [
    'brand_id', 'brand_name', 'industry', 'product_category', 'brand_niche',
    'primary_age_range', 'secondary_age_range', 'gender_majority', 'target_country',
    'target_region', 'target_city', 'audience_interests', 'audience_priority',
    'brand_personality', 'brand_tone', 'brand_values', 'communication_style',
    'preferred_platform', 'preferred_tier', 'preferred_category', 'preferred_content_style',
    'min_engagement_rate', 'min_audience_quality', 'min_brand_safety',
  ]
  for (let b = 0; b < N_BRAND; b++) {
    const r = 5 + b
    const col = BRAND_COLS[b]
    FIELDS.forEach((key, i) => {
      const c = ws.getCell(r, i + 1)
      c.value = F(`=Brand_Profile!$${col}$${BR[key]}`)
      c.font = { ...BASE, size: 9, bold: i < 2 }
      c.border = bd()
      c.alignment = { vertical: 'top', wrapText: true }
      if (key === 'min_engagement_rate') c.numFmt = PCT1
      if (key.startsWith('min_')) c.numFmt = SCORE_FMT
    })
    const put = (i, formula, fmt) => {
      const c = ws.getCell(r, FIELDS.length + i)
      c.value = F(formula)
      c.font = { ...BASE, size: 9, bold: true }
      c.fill = fillOf(T.calc)
      c.border = bd()
      c.alignment = { horizontal: 'center' }
      if (fmt) c.numFmt = fmt
    }
    const pass = meBlock('Hard Filter Result', b)
    const eligible = meBlock('Final Match Score (eligible only)', b)
    put(1, `=COUNTIF(${pass},"PASS")`)
    put(2, `=COUNTIF(${pass},"EXCLUDED")`)
    put(3, `=IF(COUNT(${eligible})=0,0,ROUND(AVERAGE(${eligible}),1))`, '0.0')
    put(4, `=IF(COUNT(${eligible})=0,0,MAX(${eligible}))`, SCORE_FMT)
    const best = ws.getCell(r, FIELDS.length + 5)
    best.value = F(`=IF(COUNT(${eligible})=0,"—",INDEX(${meBlock('Creator', b)},MATCH(MAX(${eligible}),${eligible},0),1))`)
    best.font = { ...BASE, size: 9, bold: true }
    best.fill = fillOf(T.calc)
    best.border = bd()
    put(6, `=COUNTIF(${meBlock('Match Level', b)},"Excellent Match")+COUNTIF(${meBlock('Match Level', b)},"Strong Match")`)
  }

  COLS.forEach((name, i) => { ws.getColumn(i + 1).width = Math.max(12, Math.min(30, name.length + 6)) })
  ws.getColumn(12).width = 34
  ws.getColumn(16).width = 34
  ws.getColumn(29).width = 24
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   Sample_Output
   ══════════════════════════════════════════════════════════════════════════ */

export function buildSampleOutput(wb) {
  const ws = wb.addWorksheet('Sample_Output', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] })
  const COLS = ['KOL ID', 'Creator', 'Platform', 'Category', 'Tier']
  BRANDS.forEach(b => COLS.push(`${b.brand_id} Score`, `${b.brand_id} Level`, `${b.brand_id} Rank`))
  COLS.push('Score Spread', 'Best-Fit Brand', 'Same score for all three?')
  banner(ws, 1, COLS.length, 'SAMPLE OUTPUT  ·  the same creator, scored against all three brands',
    'The proof that Brand Match is a function of (brand, creator). If this engine were really ranking creators globally, the three '
    + 'score columns would be identical and Score Spread would be zero on every row. Read the roll-up under the table.')
  headers(ws, 4, 1, COLS, 26)

  for (let i = 0; i < N_KOL; i++) {
    const r = 5 + i
    const kr = KOL_FIRST + i
    const put = (c, value, fmt, bold) => {
      const cell = ws.getCell(r, c)
      cell.value = value
      cell.font = { ...BASE, size: 9, bold: !!bold }
      cell.border = bd()
      if (fmt) cell.numFmt = fmt
      return cell
    }
    put(1, F(`=${kd('KOL ID', kr)}`))
    put(2, F(`=${kd('Creator Name', kr)}`), null, true)
    put(3, F(`=${kd('Platform', kr)}`))
    put(4, F(`=${kd('Category', kr)}`))
    put(5, F(`=${kd('Tier', kr)}`))
    BRANDS.forEach((b, bi) => {
      const c0 = 6 + bi * 3
      const key = `"${b.brand_id}|"&${kd('KOL ID', kr)}`
      put(c0, F(`=INDEX(${meRange('Final Match Score')},MATCH(${key},${meRange('Match Key')},0),1)`), SCORE_FMT, true)
      put(c0 + 1, F(`=INDEX(${meRange('Match Level')},MATCH(${key},${meRange('Match Key')},0),1)`))
      const sc = `$${A(c0)}`
      put(c0 + 2, F(`=COUNTIF(${sc}$5:${sc}$${4 + N_KOL},">"&${sc}${r})+1`))
    })
    const a = `$F${r}`, b2 = `$I${r}`, c2 = `$L${r}`
    put(15, F(`=MAX(${a},${b2},${c2})-MIN(${a},${b2},${c2})`), SCORE_FMT, true)
    put(16, F(`=IF(${a}=MAX(${a},${b2},${c2}),$B$5&"",IF(${b2}=MAX(${a},${b2},${c2}),"",""))`))
    // Written the long way rather than with a nested lookup, so the tie rule —
    // first brand wins — is visible in the cell instead of implied by it.
    ws.getCell(r, 16).value = F(
      `=IF(${a}>=${b2},IF(${a}>=${c2},Sample_Brands!$B$5,Sample_Brands!$B$7),IF(${b2}>=${c2},Sample_Brands!$B$6,Sample_Brands!$B$7))`)
    put(17, F(`=IF($O${r}=0,"YES — identical","no")`))
  }

  const last = 4 + N_KOL
  COLS.forEach((name, i) => { ws.getColumn(i + 1).width = Math.max(11, Math.min(24, name.length + 4)) })
  ws.getColumn(2).width = 20
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: COLS.length } }
  for (const c of [6, 9, 12]) {
    ws.addConditionalFormatting({
      ref: `${A(c)}5:${A(c)}${last}`,
      rules: [{
        type: 'colorScale', priority: 1,
        cfvo: [{ type: 'num', value: 40 }, { type: 'num', value: 70 }, { type: 'num', value: 95 }],
        color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
      }],
    })
  }

  let r = last + 2
  r = subhead(ws, r, COLS.length, 'VERIFICATION  ·  counted from the table above')
  const CHECKS = [
    ['Creators scored', `=COUNTA($A$5:$A$${last})`, ''],
    ['Creators whose three scores are identical', `=COUNTIF($O$5:$O$${last},0)`,
      'Should be 0. Any row here would mean the brand inputs made no difference to that creator.'],
    ['Average score spread across the three brands', `=ROUND(AVERAGE($O$5:$O$${last}),1)`,
      'How far apart the three briefs place the average creator.'],
    ['Largest score spread', `=MAX($O$5:$O$${last})`, ''],
    ['Smallest score spread', `=MIN($O$5:$O$${last})`, ''],
    ['Brand-dependence verdict',
      `=IF(COUNTIF($O$5:$O$${last},0)=0,"PASS — every creator scores differently for at least two of the three brands",`
      + `"CHECK — "&COUNTIF($O$5:$O$${last},0)&" creator(s) score identically for all three brands")`, ''],
  ]
  CHECKS.forEach(([label, formula, note], i) => {
    ws.mergeCells(r + i, 1, r + i, 4)
    labelCell(ws, r + i, 1, label, { size: 9, bold: true })
    const c = ws.getCell(r + i, 5)
    c.value = F(formula)
    c.font = { ...BASE, size: 9, bold: true }
    c.fill = fillOf(T.calc)
    c.border = bd()
    c.alignment = { horizontal: 'center' }
    ws.mergeCells(r + i, 6, r + i, COLS.length)
    labelCell(ws, r + i, 6, note, { size: 9, color: T.sub, wrap: true })
  })
  r += CHECKS.length + 1

  r = subhead(ws, r, COLS.length, 'TOP 5 PER BRAND  ·  pulled from the score columns above, so it re-sorts itself when an input changes')
  headers(ws, r, 1, ['#', ...BRANDS.map(b => `${b.brand_id} — ${b.brand_name}`)], 22)
  for (let k = 1; k <= 5; k++) {
    const rr = r + k
    labelCell(ws, rr, 1, k, { size: 9, bold: true }).alignment = { horizontal: 'center' }
    BRANDS.forEach((b, bi) => {
      const sc = `$${A(6 + bi * 3)}$5:$${A(6 + bi * 3)}$${last}`
      const c = ws.getCell(rr, 2 + bi)
      c.value = F(`=IFERROR(INDEX($B$5:$B$${last},MATCH(LARGE(${sc},${k}),${sc},0),1)&" — "&LARGE(${sc},${k})&"/100","—")`)
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      ws.getColumn(2 + bi).width = 34
    })
  }
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   Taxonomy
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The tree every other sheet classifies against, on one page.
 *
 * It is one sheet rather than four because the whole argument is that the four
 * are the same object: a brand niche, a creator sub category, a raw
 * `kol_categories` row and a keyword are four views of one taxonomy, and the
 * reason Discovery cannot filter by category today is that the product has been
 * keeping them in four unrelated places. Splitting them across sheets here
 * would reproduce the bug in the document meant to fix it.
 *
 * Every count on the sheet is a COUNTIF over the tables below it. Add a node and
 * the roll-up moves; it can never describe a tree that is not there.
 */
export function buildTaxonomy(wb) {
  const ws = wb.addWorksheet('Taxonomy', { views: [{ state: 'frozen', ySplit: 3 }] })
  const SPAN = 9
  banner(ws, 1, SPAN, 'TAXONOMY  ·  one tree, two sides, three axes',
    'The creator side (Category → Sub Category → Content Topic) and the brand side (Industry → Niche) joined by a crosswalk, '
    + 'plus the map from the 28 raw kol_categories rows onto it and the rules that classify a creator who has no category at all. '
    + 'Lookup_Lists derives its Category, Sub Category, Industry and Niche dropdowns from this sheet’s tree, so the two cannot drift.')

  const W = [20, 18, 18, 28, 28, 46, 13, 13, 13]
  W.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  /** One row of merged cells: `[startCol, span, text, opts]`. */
  const line = (r, cells) => {
    for (const [c1, span, text, opts = {}] of cells) {
      if (span > 1) ws.mergeCells(r, c1, r, c1 + span - 1)
      const cell = labelCell(ws, r, c1, text, { size: 9, wrap: true, ...opts })
      for (let i = c1; i < c1 + span; i++) ws.getCell(r, i).border = bd()
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: opts.center ? 'center' : 'left' }
    }
    return r + 1
  }
  /** Headers over merged spans. */
  const headSpans = (r, cells) => {
    for (const [c1, span, text] of cells) {
      if (span > 1) ws.mergeCells(r, c1, r, c1 + span - 1)
      const cell = ws.getCell(r, c1)
      cell.value = text
      cell.font = { ...BASE, bold: true, size: 9, color: { argb: T.headText } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      for (let i = c1; i < c1 + span; i++) {
        ws.getCell(r, i).fill = fillOf(T.head)
        ws.getCell(r, i).border = bd('FF0F172A')
      }
    }
    ws.getRow(r).height = 24
    return r + 1
  }

  const codeOpts = { size: 9, color: T.sub }
  let r = 4

  /* A. the three axes */
  r = subhead(ws, r, SPAN, 'A. THE THREE AXES  ·  a label answers exactly one of these questions. kol_categories mixes all three, which is why the category chip barely narrows a search.')
  r = headSpans(r, [[1, 1, 'Axis'], [2, 1, 'Question'], [3, 3, 'What belongs to it'], [6, 4, 'Where it is stored today']])
  for (const [axis, question, belongs, stored] of AXES) {
    r = line(r, [
      [1, 1, axis, { bold: true }], [2, 1, question], [3, 3, belongs], [6, 4, stored, { color: T.sub }],
    ])
  }
  r += 1

  /* B. the levels, and how much of each one exists */
  r = subhead(ws, r, SPAN, 'B. LEVELS AND COVERAGE  ·  what each level is, where it lives, and how much of it the database can answer on 8 Sep 2026')
  r = headSpans(r, [[1, 1, 'Level'], [2, 1, 'Nodes'], [3, 2, 'Stored in'], [5, 1, 'Coverage today'], [6, 4, 'What is missing']])
  const covRows = []
  for (const [level, stored, coverage, missing] of TAXONOMY_COVERAGE) {
    covRows.push(r)
    r = line(r, [
      [1, 1, level, { bold: true }], [2, 1, '', { center: true }], [3, 2, stored, { color: T.sub }],
      [5, 1, coverage], [6, 4, missing],
    ])
  }
  r += 1

  /* C. the creator tree */
  const nodeRows = nodes()
  r = subhead(ws, r, SPAN, 'C. CREATOR TAXONOMY  ·  Category → Sub Category → Content Topic. Codes are namespaced by parent and are what a migration would key on; labels can be retranslated, codes cannot.')
  r = headSpans(r, [[1, 1, 'Code'], [2, 1, 'Level'], [3, 1, 'Parent'], [4, 1, 'Label (EN)'],
    [5, 1, 'Label (ID)'], [6, 4, 'Matching keywords  ·  what classifies a bio or a caption into this node']])
  const nodeFirst = r
  for (const n of nodeRows) {
    const isL1 = n.level === 'L1 Category'
    r = line(r, [
      [1, 1, n.code, { ...codeOpts, bold: isL1, color: isL1 ? T.ink : T.sub }],
      [2, 1, n.level], [3, 1, n.parent, codeOpts],
      [4, 1, n.label, { bold: isL1, indent: n.level === 'L3 Content Topic' ? 2 : n.level === 'L2 Sub Category' ? 1 : 0 }],
      [5, 1, n.labelId], [6, 4, n.kw.join(' · '), { color: T.sub }],
    ])
    if (isL1) for (let c = 1; c <= SPAN; c++) ws.getCell(r - 1, c).fill = fillOf(T.soft)
  }
  const nodeLast = r - 1
  r += 1

  /* D. the brand tree */
  r = subhead(ws, r, SPAN, 'D. BRAND TAXONOMY  ·  Industry → Niche. Industry drives Industry Match through matrix 5; Niche drives nothing at all today, which is what section E is for.')
  r = headSpans(r, [[1, 1, 'Code'], [2, 1, 'Level'], [3, 1, 'Parent'], [4, 1, 'Label (EN)'],
    [5, 1, 'Label (ID)'], [6, 4, 'Matching keywords']])
  const brandFirst = r
  for (const n of brandNodes()) {
    const isB1 = n.level === 'B1 Industry'
    r = line(r, [
      [1, 1, n.code, { ...codeOpts, color: isB1 ? T.ink : T.sub, bold: isB1 }],
      [2, 1, n.level], [3, 1, n.parent, codeOpts],
      [4, 1, n.label, { bold: isB1, indent: isB1 ? 0 : 1 }],
      [5, 1, n.labelId], [6, 4, n.kw.join(' · '), { color: T.sub }],
    ])
    if (isB1) for (let c = 1; c <= SPAN; c++) ws.getCell(r - 1, c).fill = fillOf(T.soft)
  }
  const brandLast = r - 1
  r += 1

  /* E. the crosswalk */
  r = subhead(ws, r, SPAN, 'E. CROSSWALK  ·  brand niche → creator sub category. Every sub category of every category a niche spoke about, so the ladder can be read whole. A category absent here is one no niche has an opinion about, and matrix 5 governs it.')
  r = headSpans(r, [[1, 1, 'Industry'], [2, 1, 'Brand Niche'], [3, 1, 'Sub Cat. Code'],
    [4, 1, 'Creator Sub Category'], [5, 1, 'Parent Category'], [6, 1, 'Why'],
    [7, 1, 'Score'], [8, 1, 'Matrix 5 says'], [9, 1, 'Δ']])
  const WHY = {
    PRIMARY: 'Named by the niche — this is the creator the brief is describing.',
    SECONDARY: 'Reached by the niche, but not what it centres on.',
    SIBLING: 'Not named, while a sibling in this category was — so the silence is an answer.',
  }
  const xFirst = r
  for (const o of crosswalkRows()) {
    r = line(r, [
      [1, 1, o.industry], [2, 1, o.niche, { bold: true }], [3, 1, o.subCode, codeOpts],
      [4, 1, o.subLabel], [5, 1, o.catLabel], [6, 1, WHY[o.rule]],
      [7, 1, o.score, { center: true, bold: true, fill: o.rule === 'SIBLING' ? T.note : T.input }],
      [8, 1, o.derived, { center: true, fill: T.note }],
      [9, 1, o.score - o.derived, { center: true, color: T.sub }],
    ])
  }
  const xLast = r - 1
  // The two directions the taxonomy moves the matrix, coloured apart: a lift is
  // the niche naming a creator, a cut is the niche naming somebody else.
  ws.addConditionalFormatting({
    ref: `I${xFirst}:I${xLast}`,
    rules: [
      { type: 'cellIs', operator: 'greaterThan', formulae: [0], priority: 1, style: { font: { bold: true, color: { argb: 'FF166534' } } } },
      { type: 'cellIs', operator: 'lessThan', formulae: [0], priority: 2, style: { font: { bold: true, color: { argb: 'FF991B1B' } } } },
    ],
  })
  r += 1

  /* F. the alias map */
  const codeLabel = new Map(nodeRows.map(n => [n.code, n.label]))
  const alias = aliasTable()
  r = subhead(ws, r, SPAN, 'F. kol_categories → TAXONOMY  ·  the alias table the backend plan is waiting on (backend-validation-10-filters.md:170, owner: Product)'
    + (alias.measuredAt ? `  ·  read from the KOL server on ${alias.measuredAt}` : '  ·  the five names the 8 Sep 2026 audit measured'))
  r = headSpans(r, [[1, 1, 'Raw kol_categories.name'], [2, 1, 'Creators'], [3, 1, 'Axis'],
    [4, 1, 'Maps to code'], [5, 1, 'Node'], [6, 4, 'Decision']])
  const aliasFirst = r
  for (const [name, n, axis, code, note] of alias.rows) {
    const open = axis === 'UNMAPPED'
    r = line(r, [
      [1, 1, name, { bold: true }], [2, 1, n, { center: true }], [3, 1, axis, { center: true }],
      [4, 1, code, codeOpts], [5, 1, codeLabel.get(code) ?? '—'],
      [6, 4, note, open ? { color: T.sub } : {}],
    ])
    ws.getCell(r - 1, 2).numFmt = INT
  }
  const aliasLast = r - 1
  if (alias.missing > 0) {
    r = line(r, [
      [1, 1, `${alias.missing} more`, { bold: true, fill: T.note }],
      [2, 1, alias.measuredAt ? 'listed above' : 'not read', { center: true, fill: T.note }],
      [3, 1, '?', { center: true, fill: T.note }],
      [4, 1, '—', { ...codeOpts, fill: T.note }],
      [5, 1, '—', { fill: T.note }],
      [6, 4, alias.measuredAt
        ? 'Master rows with no decision yet. Each one needs an axis before it needs a node: a label that turns out to describe an audience belongs on the audience filter, not on a category chip.'
        : 'The master table holds 28 rows and all 28 are in use; the 8 Sep 2026 audit measured only the five above. They are left blank rather than guessed — run npm run taxonomy:fetch on the office VPN and they fill in from the server itself.',
      { fill: T.note }],
    ])
  }
  ws.addConditionalFormatting({
    ref: `C${aliasFirst}:C${aliasLast}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'AUDIENCE', priority: 1, style: { fill: fillOf('FFFEE2E2'), font: { bold: true, color: { argb: 'FF991B1B' } } } },
      { type: 'containsText', operator: 'containsText', text: 'CONTENT', priority: 2, style: { fill: fillOf('FFDCFCE7'), font: { color: { argb: 'FF166534' } } } },
      { type: 'containsText', operator: 'containsText', text: 'UNMAPPED', priority: 3, style: { fill: fillOf('FFFEF3C7'), font: { color: { argb: 'FF92400E' } } } },
    ],
  })
  r += 1

  /* G. classification */
  r = subhead(ws, r, SPAN, 'G. CLASSIFYING THE 3.547 CREATORS WITH NO CATEGORY  ·  how a node gets assigned, and what the assignment is then allowed to do')
  r = headSpans(r, [[1, 1, 'Step'], [2, 2, 'Rule'], [4, 6, 'Detail']])
  for (const [step, rule, detail] of CLASSIFICATION_RULES) {
    r = line(r, [[1, 1, step, { bold: true }], [2, 2, rule, { bold: true }], [4, 6, detail]])
  }
  r += 1

  /* roll-up — counted off the tables above */
  const lvl = `$B$${nodeFirst}:$B$${nodeLast}`
  const blvl = `$B$${brandFirst}:$B$${brandLast}`
  r = subhead(ws, r, SPAN, 'ROLL-UP  ·  counted from the tables above, not typed')
  const ROLLUP = [
    ['L1 Categories', `=COUNTIF(${lvl},"L1 Category")`],
    ['L2 Sub Categories', `=COUNTIF(${lvl},"L2 Sub Category")`],
    ['L3 Content Topics', `=COUNTIF(${lvl},"L3 Content Topic")`],
    ['Creator nodes in total', `=COUNTA($A$${nodeFirst}:$A$${nodeLast})`],
    ['Brand industries', `=COUNTIF(${blvl},"B1 Industry")`],
    ['Brand niches', `=COUNTIF(${blvl},"B2 Niche")`],
    ['Crosswalk rows', `=COUNTA($A$${xFirst}:$A$${xLast})`],
    ['— PRIMARY, named by the niche', `=COUNTIF($G$${xFirst}:$G$${xLast},100)`],
    ['— SECONDARY, reached by the niche', `=COUNTIF($G$${xFirst}:$G$${xLast},85)`],
    ['— siblings the niche passed over', `=COUNTIF($G$${xFirst}:$G$${xLast},"<85")`],
    ['Rows the taxonomy lifts above matrix 5', `=COUNTIF($I$${xFirst}:$I$${xLast},">0")`],
    ['Rows it cuts below matrix 5', `=COUNTIF($I$${xFirst}:$I$${xLast},"<0")`],
    ['kol_categories rows mapped so far, of 28', `=COUNTA($A$${aliasFirst}:$A$${aliasLast})`],
  ]
  for (const [label, formula] of ROLLUP) {
    ws.mergeCells(r, 1, r, 5)
    labelCell(ws, r, 1, label, { size: 9 })
    for (let c = 1; c <= 5; c++) ws.getCell(r, c).border = bd()
    const c = ws.getCell(r, 6)
    c.value = F(formula)
    c.font = { ...BASE, size: 9, bold: true }
    c.fill = fillOf(T.calc)
    c.border = bd()
    c.alignment = { horizontal: 'center' }
    r++
  }

  /* the node counts in section B, filled from the tables that came after it */
  const COUNTS = [
    `=COUNTIF(${lvl},"L1 Category")`, `=COUNTIF(${lvl},"L2 Sub Category")`,
    `=COUNTIF(${lvl},"L3 Content Topic")`, `=COUNTIF(${blvl},"B1 Industry")`,
    `=COUNTIF(${blvl},"B2 Niche")`, null,
  ]
  covRows.forEach((row, i) => {
    const c = ws.getCell(row, 2)
    if (COUNTS[i]) {
      c.value = F(COUNTS[i])
      c.fill = fillOf(T.calc)
    } else {
      c.value = '—'
    }
    c.font = { ...BASE, size: 9, bold: true }
    c.alignment = { horizontal: 'center', vertical: 'top' }
    c.border = bd()
  })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   README
   ══════════════════════════════════════════════════════════════════════════ */

const README = [
  ['H', '1. PURPOSE', ''],
  ['P', '', 'This workbook is the source of truth for the Autometric KOL Discovery Brand Match calculation. It is not a mock-up: '
    + 'every score on every sheet is an Excel formula over the values in Brand_Profile and KOL_Database, weighted by the constants on '
    + 'Lookup_Lists. Change an input and the workbook re-answers. Hand it to a backend developer and the formulas are the specification — '
    + 'there is no second document that says what the code should do.'],
  ['P', '', 'It exists because the product needs a Brand Match today and the KOL database cannot supply one: feature.brand_fit_analysis '
    + 'holds 0 rows, which is why four of the eight Smart Preset chips in the running prototype are disabled. The logic has to be agreed '
    + 'and written down before the pipeline is built, not after.'],

  ['H', '2. BRAND_PROFILE — the brand half of the inputs', ''],
  ['P', '', 'Four sections, matching the Brand Profile & Matching UI: A. Company Profile, B. Target Audience, C. Brand Identification, '
    + 'D. Ideal Creator Profile. A fifth block, E. Matching Configuration, holds the switches that decide which rules act as hard filters.'],
  ['P', '', 'Columns D, E and F are the three brands. Column G is whichever brand cell B4 names, and that is the column the active-brand '
    + 'views (Match_Explanation, Discovery_Ranking) read. Two calculated blocks sit under the fields: a token helper that splits the '
    + 'comma-separated list fields into five addressable slots, and the audience sub-weights, which move weight onto whichever dimension '
    + 'Audience Demographics Priority names.'],

  ['H', '3. KOL_DATABASE — the creator half of the inputs', ''],
  ['P', '', 'Thirty creators on Instagram and TikTok, in six blocks: identity, performance, audience, content, commercial, safety — plus '
    + 'the exclusion state and the freshness columns Discovery needs. Tier, CPV, CPE, CPM, Estimated Reach, Estimated ROI, '
    + 'View-to-Follower Ratio, Cost Efficiency, Data Completeness and Data Status are calculated from the columns beside them.'],
  ['P', '', 'Several creators are missing a field on purpose — a blank Median Views, a blank rate card, a blank audience city. The real '
    + 'roster is full of holes, the Confidence column exists to report them, and every formula here is written to survive one without '
    + 'printing #DIV/0!.'],

  ['H', '4. THE SIX COMPONENTS', ''],
  ['P', 'Brand & Business Relevance', 'Brand Industry, Product / Service Category, Main Business Keywords, Brand Keywords and Brand Niche '
    + 'against the creator Category, Sub Category, Content Topics and Audience Interests. Industry Match 40%, Category Match 30%, '
    + 'Keyword Match 30% — the last being the two keyword lists scored separately and averaged.'],
  ['P', 'Target Audience Relevance', 'Age 25%, Gender 15%, Location 30%, Interest 30% — before Audience Demographics Priority moves '
    + '12 points onto one of them and takes a third of that off each of the others.'],
  ['P', 'Content & Category Relevance', 'Preferred Category 30%, Preferred Sub Category 20%, Preferred Content Topics 30%, '
    + 'Preferred Content Style 20%.'],
  ['P', 'Brand Personality Fit', 'Personality 35%, Tone against Content Style 25%, Values overlap 25%, Communication Style 15%. '
    + 'Related matches count: Innovative is answered by a Tech-savvy or Creative creator, not only by one who calls themselves Innovative.'],
  ['P', 'Performance Quality', 'Engagement Rate 35%, Audience Quality 20%, Consistency 20%, Community 10%, Average Views 10%, '
    + 'Recent Growth 5%, each normalised to 0–100 against a calibration target on Lookup_Lists.'],
  ['P', 'Brand Safety', 'Brand Safety Score 80%, head-room from Competitor Saturation 20%, multiplied by the Risk Flag discount '
    + '(High 0.6, Medium 0.85, Low 0.95). Saturation lowers the score; it never excludes on its own.'],

  ['H', '5. WEIGHTING — the master formula', ''],
  ['F', 'FINAL MATCH =', '20% Brand & Business  +  30% Target Audience  +  20% Content & Category  +  10% Brand Personality  '
    + '+  10% Performance  +  10% Brand Safety'],
  ['P', '', 'The six weights live in the COMPONENT WEIGHTS block on Lookup_Lists and nowhere else. The engine divides by their sum '
    + 'rather than by a literal 100, so a workbook whose weights have been edited still produces a 0–100 score; the CHECK_WEIGHT_TOTAL '
    + 'cell beside them says out loud whether they still total 100.'],

  ['H', '6. FORMULA LOGIC — how a comparison becomes a number', ''],
  ['P', 'Category-style comparisons', 'A matrix lookup on Lookup_Lists, on the 100 / 80 / 60 / 40 / 20 ladder: exact, strongly related, '
    + 'partially related, weakly related, unrelated. Five matrices — Industry × Category, Category × Category, Brand Personality × '
    + 'Creator Personality, Brand Tone × Content Style, Communication Style × Content Style, Content Style × Content Style. Every cell '
    + 'is editable, which is what makes a disputed score a conversation about one number rather than about a model.'],
  ['P', 'List comparisons', 'Overlap counting. The brand list is split into five slots by the token helper; each slot is looked for in '
    + 'the creator text with SEARCH; the score is matches ÷ slots filled × 100. A brand that names three keywords is judged out of three.'],
  ['P', 'Numeric comparisons', 'Normalisation against a target on Lookup_Lists: MIN(100, value ÷ target × 100). Engagement Rate scores '
    + '100 at 6%; views per follower at 0.5; 30-day growth at 8%, and 0 at −2%.'],
  ['P', 'Missing data', 'A blank input scores the neutral 50 where the brand left a preference blank, and 0 where the creator is missing '
    + 'a measurement — those are different situations and the formulas keep them apart. Nothing ever divides by an unguarded cell.'],
  ['P', 'Two inputs that carry no weight', 'Company Description is free text for the brief. Brand Positioning is carried and printed in '
    + 'the Personality Match Reason, but it is deliberately not weighted: the honest thing to weigh a Premium or Luxury positioning '
    + 'against is production quality, and there is no measured production-quality signal on the roster to weigh it against. Inventing '
    + 'one would be the same mistake as the four Smart Preset chips that used to rank by a hash of the creator id. Give it a weight '
    + 'the day a real signal exists.'],

  ['H', '7. HARD FILTERS — remove the creator', ''],
  ['P', '', 'Platform, Minimum and Maximum Followers, Minimum Engagement Rate, Tier, Minimum Audience Quality, Minimum Brand Safety, '
    + 'Audience Country and Category (both switchable), Max Competitor Saturation, the four exclusion toggles, and Minimum Brand Match. '
    + 'The engine computes the reason first and the verdict from it, so an excluded creator always carries the sentence that explains '
    + 'why. See Filter_Logic.'],

  ['H', '8. SOFT MATCHING — reorder the list', ''],
  ['P', '', 'Brand Match, Audience Match, Content Relevance, Personality Fit, Performance, Opportunity, Estimated ROI and Competitor '
    + 'Saturation. A low soft score never removes a creator. Competitor Saturation in particular is a warning, not a rejection: it can '
    + 'only exclude through the explicit Max Competitor Saturation setting.'],

  ['H', '9. DISCOVERY RANKING', ''],
  ['P', '', 'Default order is Brand Match, then Audience Match, then Content Relevance, then Performance, then Brand Safety, encoded '
    + 'as one Default Sort Key so the tie-break order is inspectable. Thirty presets are defined on Lookup_Lists; the picker on '
    + 'Discovery_Ranking reads the metric column each one names. The "Available today" column tells you which of them the KOL database '
    + 'can actually answer — the prototype ships four of its eight chips disabled for exactly this reason.'],

  ['H', '10. MATCH EXPLANATION', ''],
  ['P', '', 'Generated, not written. The three strengths are the three highest components and the three considerations the three lowest, '
    + 'read with LARGE and SMALL over the same cells the score came from, so an explanation cannot drift away from the number it explains. '
    + 'Each component also carries its own reason line naming its sub-scores.'],

  ['H', '11. SAMPLE BRANDS AND SAMPLE OUTPUT', ''],
  ['P', '', 'Three briefs — Technology / SaaS, Beauty & Skincare, Food & Beverage — run against one roster of thirty. Sample_Output puts '
    + 'the three scores for each creator side by side and reports the spread. If the engine were ranking creators globally rather than '
    + 'matching brand to creator, that spread would be zero on every row; the verdict cell says whether it is.'],

  ['H', '12. TAXONOMY — the tree everything classifies against', ''],
  ['P', '', 'One sheet, because the whole point is that the four things are one object: a creator sub category, a brand niche, a raw '
    + 'kol_categories row and a matching keyword are four views of a single tree. Lookup_Lists derives its Category, Sub Category, '
    + 'Industry and Niche dropdowns from it, so no list in this workbook can drift from another.'],
  ['P', 'Three axes', 'A label answers one question — what the creator makes, who watches, or how it is shot. public.kol_categories '
    + 'mixes all three: "Moms" is an audience and "Gen Z" is an age band, both sitting in a content column. Only the content axis may '
    + 'feed the Category and Sub Category ladders; the audience axis already has its own 30% of the score.'],
  ['P', 'The crosswalk', 'Brand Niche is collected on Brand_Profile and read by no formula in the engine. Section E is what would give '
    + 'it weight: it names the sub categories each niche is actually asking for, over a default that comes from matrix 5 rather than from '
    + 'nowhere. The derived value is printed beside every override so an override reads as an override.'],
  ['P', 'What it is for', 'Category covers 54,1% of the roster, Sub Category has no column at all, and Content Topic has none of its '
    + '0 rows filled. Section F is the alias table the backend plan is waiting on, and section G is how the 3.547 creators with no '
    + 'category get one — including the rule that a modelled category may rank but must never act as a hard filter.'],

  ['H', '13. FOR THE BACKEND — translating this into code', ''],
  ['P', 'Shape', 'One pure function: score(brand, creator) → { components, subScores, final, level, confidence, reasons, exclusion }. '
    + 'No I/O, no database access, deterministic. The Field Key column on Brand_Profile is the payload shape; the KOL_Database headers '
    + 'are the creator shape.'],
  ['P', 'Where the constants live', 'Load the Lookup_Lists blocks — weights, matrices, calibration, bands — from configuration, not from '
    + 'constants in the source. They are meant to be tuned by whoever owns the matching quality, and a redeploy is the wrong unit of change.'],
  ['P', 'Order of operations', 'Compute all six components, then the Final Match Score, then evaluate the hard filters (Minimum Brand '
    + 'Match needs the score), then rank. Never fold a hard filter into the SQL when it rests on a computed value — the roster pages '
    + 'server-side, and filtering the page you already fetched gives a result count that means nothing.'],
  ['P', 'Provenance', 'Carry a per-field basis flag the way @/lib/discover/creatorMatch does with SignalBasis. A score built from '
    + 'modelled inputs is useful for ranking and must never be presented as a measurement, and it must never be used as a hard filter.'],
  ['P', 'What to build first', 'The columns the KOL database cannot answer today are listed with their coverage on Discovery_Filters. '
    + 'The short list: populate feature.brand_fit_analysis; fill audience_demographics_daily with audience_type=\'age\'; widen '
    + 'feature.{ig,tt}_audience_analysis past 23 creators; fill creator_city; populate l1_silver.unified_rate_card. Until then, a filter '
    + 'that rests on one of those must ship disabled with its reason shown, not silently returning nothing.'],
]

export function buildReadme(wb) {
  const ws = wb.addWorksheet('README', { views: [{ state: 'frozen', ySplit: 3 }] })
  banner(ws, 1, 3, 'AUTOMETRIC — KOL DISCOVERY BRAND MATCH ENGINE',
    'Specification and calculation workbook. Twelve sheets: two of inputs, one engine, seven views, one lookup sheet and this page. '
    + 'Generated by scripts/build-brand-match-workbook.mjs and verified by scripts/verify-brand-match-workbook.mjs.')
  let r = 4
  for (const [kind, label, body] of README) {
    if (kind === 'H') {
      ws.mergeCells(r, 1, r, 3)
      const c = ws.getCell(r, 1)
      c.value = label
      c.font = { ...BASE, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = fillOf(T.head)
      c.alignment = { vertical: 'middle', indent: 1 }
      ws.getRow(r).height = 20
      r += 1
      continue
    }
    if (kind === 'F') {
      ws.mergeCells(r, 1, r, 3)
      const c = ws.getCell(r, 1)
      c.value = `${label}  ${body}`
      c.font = { ...BASE, size: 12, bold: true, color: { argb: 'FF15325B' } }
      c.fill = fillOf('FFEFF6FF')
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      c.border = bd('FF15325B')
      ws.getRow(r).height = 34
      r += 2
      continue
    }
    labelCell(ws, r, 1, label, { size: 9, bold: true, wrap: true, noBorder: true })
    ws.mergeCells(r, 2, r, 3)
    labelCell(ws, r, 2, body, { size: 10, wrap: true, noBorder: true })
    ws.getRow(r).height = Math.max(16, Math.ceil(body.length / 118) * 15 + 4)
    r += 1
  }
  ws.getColumn(1).width = 32
  ws.getColumn(2).width = 118
  ws.getColumn(3).width = 30
  return ws
}
