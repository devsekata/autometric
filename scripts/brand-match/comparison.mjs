/**
 * `Autometric_Brand_Match_Comparison.xlsx` — the three input/engine sheets.
 *
 * Same discipline as `engine.mjs`, and the same constants and matrices: no score
 * is ever written as a number. Every score cell on Matching_Engine is a formula
 * over KOL_Source_Data and Brand_Profile, weighted by constants that live in
 * labelled cells on Lookup_Lists. Change W_TARGET_AUDIENCE and all 120 rows move.
 *
 * The difference from the engine workbook is the data, and it changes what the
 * formulas have to survive. The engine workbook runs on 30 hand-built creators
 * whose every field is populated by construction. This one runs on 24 real rows
 * off the KOL server, where whole columns do not exist:
 *
 *   Age                 no signal anywhere on the server
 *   Sub Category        no column exists
 *   Content Style       no column exists
 *   Creator Personality no column exists — with tone, values and comm style,
 *                       this empties Brand Personality Fit completely
 *   Community           no column exists
 *   Content risk        comments_analysis holds 0 rows
 *
 * So this file adds one mechanism the engine workbook does not need: every score
 * is either a number or the literal text `N/A`, and every formula that consumes
 * one guards with ISNUMBER. A missing input never becomes a zero. Zero is a
 * measurement — "we looked, and there was none" — and using it for "nobody has
 * looked" is how a creator with no data ends up ranked below a creator with bad
 * data.
 *
 * Weights renormalise over what is present, at both levels: a sub-score that is
 * N/A drops out of its component, and a component that is entirely N/A drops out
 * of the Final Match Score. The six nominal component weights still total 100 —
 * that is what CHECK_WEIGHT_TOTAL asserts — and the Available Weight column says
 * how much of that 100 each row could actually be scored on.
 */

import {
  buildLookups, LK, K, listRef, banner, subhead, headers, labelCell,
  groupBand, bd, fillOf, T, BASE, F, A, cellA, rangeA, SCORE_FMT, PCT1, INT,
} from './build.mjs'
import {
  INTEREST_KEYS, BRAND_FIELDS, CANONICAL_CATEGORIES, CATEGORY_RELATEDNESS,
} from './comparison-brands.mjs'

/* ── layout ───────────────────────────────────────────────────────────────── */

export const KOL_FIRST = 6       // first KOL_Source_Data data row
export const ME_FIRST = 6        // first Matching_Engine data row
/**
 * Brand_Profile columns, one per brand. Five brands, E through I.
 *
 * Column D carries the Source column — which database column each brand field
 * speaks to — so the brands start one column further right than the engine
 * workbook's do. Every formula addresses a brand value through these letters.
 */
export const BRAND_COLS = ['E', 'F', 'G', 'H', 'I']

/** Extra calibration constants, appended to Lookup_Lists as section 11. */
export const K2 = {}
/** Brand_Profile row of each field key. */
export const BR = {}
/** Brand_Profile row of each interest flag. */
export const BRI = {}
/** KOL_Source_Data column of each field name. */
export const KC = {}
/** Matching_Engine column of each field name. */
export const MEC = {}

const kd = (name, row) => `KOL_Source_Data!$${A(KC[name])}$${row}`
const me = (name, row) => `Matching_Engine!$${A(MEC[name])}$${row}`
const bp = (key, col) => `Brand_Profile!$${col}$${BR[key]}`

/** The text a cell carries when the database had nothing to put in it. */
const NA = 'N/A'

/* ══════════════════════════════════════════════════════════════════════════
   LOOKUP_LISTS — the shared sheet, plus the constants this workbook adds
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Calibration this workbook needs and the engine workbook does not, because the
 * engine workbook's inputs are already 0-100 scores while these are raw
 * measurements off the server.
 *
 * Every one is a target: the value of the real quantity that scores 100. They
 * are choices, not readings, which is exactly why they sit in editable cells
 * with the rest of the calibration rather than inside a formula.
 */
export const EXTRA_CONSTS = [
  ['AUDIENCE NORMALISATION', 'Audience in target country = 100 at', 'CAL_COUNTRY_TARGET', 60,
    'Share of the KNOWN-country audience sitting in Target Country that scores 100. Known-country share is itself only 10-20% of the sample for most creators — the Country Known % column is what says how far to trust it.'],
  [null, 'Audience in target city = 100 at', 'CAL_CITY_TARGET', 25,
    'Share of the known-city audience in Target City that scores 100. Lower than the country target because city shares fragment across dozens of keys.'],
  [null, 'Audience interest overlap = 100 at', 'CAL_INTEREST_TARGET', 45,
    'Combined share of the known-interest audience falling inside the brand interest set that scores 100.'],

  ['PERFORMANCE NORMALISATION', 'Posts per month = 100 at', 'CAL_CONSISTENCY_TARGET', 12,
    'Posting cadence that scores 100 on Consistency.'],
  [null, 'Minimum observation days for cadence', 'CAL_MIN_OBS_DAYS', 21,
    'A post_frequency_monthly extrapolated from a 1-2 day window is arithmetic, not a cadence — the roster carries readings of 300/month off a single observed day. Below this many days Consistency reports N/A instead.'],
  [null, 'View-to-follower ratio = 100 at', 'CAL_VFR_TARGET_ROSTER', 1.5,
    'Replaces CAL_VFR_TARGET (0,5) for this roster. Every one of the 15 creators carrying a ratio is above 0,5, so the shared target scored all of them 100 and the sub-score carried no information at all. The observed range here is 0,54 to 50,1 — the high end coming off accounts where only one or two posts were analysed, which is why the target is set near the middle of the credible band rather than the top of the observed one.'],

  ['BRAND SAFETY SCREEN', 'Authenticity weight', 'W_BS_AUTHENTICITY', 40,
    'Share of the safety screen carried by feature.*_audience_analysis.authenticity_score.'],
  [null, 'Follower quality weight', 'W_BS_FOLLOWER_QUALITY', 30,
    'Share carried by follower_quality_score.'],
  [null, 'Verification weight', 'W_BS_VERIFICATION', 15,
    'Share carried by platform verification — the one identity signal that is complete for this roster.'],
  [null, 'Paid-ratio weight', 'W_BS_PAID', 15,
    'Share carried by the sponsored-post ratio. An account that is mostly paid placements is a weaker endorsement, not an unsafe one.'],
  [null, 'Verified scores', 'CAL_VERIFIED_YES', 100, 'Score when verified_status = verified.'],
  [null, 'Unverified scores', 'CAL_VERIFIED_NO', 50,
    'Not zero: unverified is an unanswered question about identity, not evidence of harm.'],
  [null, 'Paid ratio = 0 at', 'CAL_PAID_CEILING', 40,
    'Sponsored share of posts, in percent, at which the paid-ratio component reaches 0.'],

  ['SAFETY LEVEL BANDS', 'Low Risk at', 'BAND_SAFE_LOW', 80, 'Safety Score at or above this.'],
  [null, 'Moderate Risk at', 'BAND_SAFE_MOD', 65, ''],
  [null, 'Elevated Risk at', 'BAND_SAFE_ELEV', 50, 'Below this is High Risk.'],

  /**
   * These three supersede the section-4 Brand & Business sub-weights, and they
   * are not 40/30/30 like those are.
   *
   * The split is set by how much each signal actually discriminates on this
   * roster, measured on the built workbook rather than assumed. Category Match
   * takes 8 distinct values across the 120 pairs and separates creators cleanly.
   * Keyword Match takes 3 and is 0 for the large majority; Hashtag Match takes 2
   * and is 0 or N/A for almost all. Weighting the two sparse signals at 60% of
   * the component, as an even-handed split would, does not make the score
   * fairer — it makes Brand & Business Relevance mostly measure whether a
   * celebrity writes marketing copy in their captions, which none of them does,
   * and drags every creator toward the same low number.
   *
   * They stay in the score because when they DO hit they are strong evidence,
   * and because they will get better as `bio` and the hashtag harvest fill out.
   * They do not get to outvote the signal that works.
   */
  ['BRAND & BUSINESS SUB-WEIGHTS', 'Category Match', 'W_BB_CAT', 60,
    'Brand category against the creator\'s TAGGED canonical category, via matrix 11d. Supersedes W_BB_INDUSTRY on section 4: this workbook has no Industry field, because the database has no industry concept — public.brand carries `category` and nothing else.'],
  [null, 'Keyword Match', 'W_BB_KW', 25,
    'public.brand.brand_keywords found in the creator bio, captions and category names. Sparse: kol_directory.bio is ~12% filled server-wide and several of these creators caption in English or Spanish, so an Indonesian keyword list cannot reach them.'],
  [null, 'Hashtag Match', 'W_BB_HASH', 15,
    'public.brand.brand_hashtags found in the creator\'s own hashtags. A separate question from keywords because the schema treats it as one — a hashtag is what a post is filed under, a keyword is a word that appeared in a sentence. Sparser still: only 312 of 503 harvested posts carry any hashtag.'],

  ['CONTENT & CATEGORY SUB-WEIGHTS', 'Content Category Match', 'W_CC_CAT', 60,
    'Brand category against Category From Captions — what the creator\'s own posts show them doing, as opposed to the tag they carry. Supersedes the section-4 content sub-weights, which split across a sub-category and a content-style column that do not exist on this server.'],
  [null, 'Topic Match', 'W_CC_TOPICS', 40,
    'The brand\'s caption search terms found in the creator\'s captions. Same sparsity caveat as Keyword Match, and the same reasoning for not letting it carry half the component.'],
]

export function buildComparisonLookups(wb, brands, snapshot) {
  const ws = buildLookups(wb, brands)
  let cr = ws.rowCount + 2

  /**
   * The category master, printed before anything scores against it.
   *
   * This section is the workbook's evidence that the categories it uses are the
   * database's. It is written from the snapshot, so it is the list as the server
   * held it at fetch time rather than a list maintained here — and if a category
   * is added, renamed or retired, this section changes on the next fetch without
   * anybody editing a file.
   */
  cr = subhead(ws, cr, 30,
    '11a. AVAILABLE CATEGORIES FROM THE EXISTING KOL DATABASE  ·  public.kol_categories, read at fetch time. '
    + 'Every category in this workbook comes from this table. Nothing here was invented, re-spelled or given a synonym.')
  headers(ws, cr, 1, ['#', 'Category name (raw)', 'Creators', 'taxonomy_key (canonical)', 'Note'], 24)
  cr++
  const master = snapshot.categoryMaster ?? []
  master.forEach((c, i) => {
    labelCell(ws, cr, 1, i + 1, { size: 9 }).alignment = { horizontal: 'center' }
    labelCell(ws, cr, 2, c.name, { size: 9, bold: true })
    labelCell(ws, cr, 3, c.creators, { size: 9 }).numFmt = INT
    labelCell(ws, cr, 4, c.taxonomy_key ?? '(null)', { size: 9, color: c.taxonomy_key ? T.ink : T.sub })
    labelCell(ws, cr, 5,
      c.taxonomy_key
        ? (c.taxonomy_key === c.name ? 'canonical name' : `folds into ${c.taxonomy_key}`)
        : 'the database assigns this no taxonomy_key, so a creator carrying only this row stays uncategorised',
      { size: 9, color: T.sub, wrap: true })
    cr++
  })
  cr++
  labelCell(ws, cr, 1, 'CANONICAL', { bold: true, size: 9, fill: T.soft })
  labelCell(ws, cr, 2, `${CANONICAL_CATEGORIES.length} keys`, { size: 9, bold: true })
  ws.mergeCells(cr, 3, cr, 5)
  labelCell(ws, cr, 3, CANONICAL_CATEGORIES.join(' · '), { size: 9, bold: true })
  cr += 2

  cr = subhead(ws, cr, 30,
    '11. COMPARISON-WORKBOOK CALIBRATION  ·  targets for the raw server measurements this workbook scores. '
    + 'Section 4 above still governs every weight and band; nothing here overrides it.')
  headers(ws, cr, 1, ['Block', 'Constant', 'Key', 'Value', 'What it does'], 26)
  cr++
  for (const [block, name, key, value, note] of EXTRA_CONSTS) {
    labelCell(ws, cr, 1, block ?? '', { bold: !!block, size: 9, fill: block ? T.soft : undefined })
    labelCell(ws, cr, 2, name, { size: 9 })
    labelCell(ws, cr, 3, key, { size: 9, color: T.sub })
    const v = labelCell(ws, cr, 4, value, { size: 9, bold: true, fill: T.input })
    v.alignment = { horizontal: 'center', vertical: 'middle' }
    labelCell(ws, cr, 5, note, { size: 9, color: T.sub, wrap: true })
    K2[key] = cellA('Lookup_Lists', 4, cr)
    cr++
  }

  /**
   * Engagement rate normalises against the creator's TIER, not against one
   * global target.
   *
   * CAL_ER_TARGET on section 4 is 6%, which is a reasonable bar for the micro
   * and mid-tier creators the engine workbook models. This roster is 24 accounts
   * between 10M and 686M followers, where engagement rate falls with reach as a
   * matter of arithmetic — the observed range here is 0,01% to 3,07%. Scoring
   * @cristiano's 2,21% against a 6% bar returns 37 and calls the best-engaging
   * mega account on the roster a failure. These targets are per-tier so the
   * question becomes "well engaged FOR AN ACCOUNT THIS SIZE", which is the only
   * version of it a brand can act on.
   */
  cr += 1
  cr = subhead(ws, cr, 30,
    '11b. ENGAGEMENT RATE TARGET BY TIER  ·  the ER, in percent, that scores 100. Overrides CAL_ER_TARGET for this workbook, '
    + 'because engagement rate falls with follower count and one global bar would rank the roster by size.')
  headers(ws, cr, 1, ['Tier', 'ER = 100 at (%)', 'Why'], 20)
  const ER_TARGETS = [
    ['Nano', 8, 'Small, close audiences engage hardest.'],
    ['Micro', 6, 'The bar CAL_ER_TARGET was set for.'],
    ['Mid-tier', 4.5, ''],
    ['Macro', 3, ''],
    ['Mega', 2, 'Every creator on this roster is Mega. 2% is at the top of what accounts above 10M followers reach; @cristiano at 2,21% is the only one clearing it.'],
  ]
  const erFirst = cr + 1
  ER_TARGETS.forEach(([tier, target, why], i) => {
    labelCell(ws, erFirst + i, 1, tier, { size: 9, bold: true })
    const v = labelCell(ws, erFirst + i, 2, target, { size: 9, bold: true, fill: T.input })
    v.alignment = { horizontal: 'center' }
    labelCell(ws, erFirst + i, 3, why, { size: 9, color: T.sub, wrap: true })
  })
  K2.ER_TIER_NAMES = rangeA('Lookup_Lists', 1, erFirst, 1, erFirst + ER_TARGETS.length - 1)
  K2.ER_TIER_TARGETS = rangeA('Lookup_Lists', 2, erFirst, 2, erFirst + ER_TARGETS.length - 1)
  cr = erFirst + ER_TARGETS.length + 2

  /**
   * Matrix 11d: canonical category x canonical category.
   *
   * Replaces matrices 5 and 6 for this workbook. Those are keyed on a 14-label
   * list written for the engine workbook; this one is keyed on the nine values
   * `kol_categories.taxonomy_key` actually holds, so a lookup cannot miss
   * because two files spelled a category differently.
   *
   * Every cell is editable, and that is the point: a reviewer who thinks Tech
   * against Gen Z should not be 50 changes one cell and all 120 scores move.
   * That is not true of a model.
   */
  cr = subhead(ws, cr, 30,
    '11d. CANONICAL CATEGORY × CANONICAL CATEGORY  ·  drives Category Match and Content Category Match. '
    + 'Row = what the brand wants, column = what the creator is. 100 exact · 80 strongly related · 60 partially · 40 weakly · 20 unrelated. '
    + 'Both axes are kol_categories.taxonomy_key values — there is no third list.')
  const mhr = cr
  labelCell(ws, mhr, 1, '', { fill: T.head })
  headers(ws, mhr, 2, CANONICAL_CATEGORIES, 30)
  const corner = ws.getCell(mhr, 1)
  corner.value = '↓ brand / creator →'
  corner.font = { ...BASE, bold: true, size: 8, color: { argb: T.headText } }
  corner.fill = fillOf(T.head)
  corner.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' }
  CANONICAL_CATEGORIES.forEach((rk, i) => {
    labelCell(ws, mhr + 1 + i, 1, rk, { size: 9, bold: true, fill: T.soft })
    CANONICAL_CATEGORIES.forEach((ck, j) => {
      const c = ws.getCell(mhr + 1 + i, 2 + j)
      c.value = CATEGORY_RELATEDNESS[rk]?.[ck] ?? 20
      c.font = { ...BASE, size: 9 }
      c.numFmt = SCORE_FMT
      c.alignment = { horizontal: 'center' }
      c.border = bd()
    })
  })
  K2.DBCAT = {
    rows: rangeA('Lookup_Lists', 1, mhr + 1, 1, mhr + CANONICAL_CATEGORIES.length),
    cols: rangeA('Lookup_Lists', 2, mhr, 1 + CANONICAL_CATEGORIES.length, mhr),
    data: rangeA('Lookup_Lists', 2, mhr + 1, 1 + CANONICAL_CATEGORIES.length, mhr + CANONICAL_CATEGORIES.length),
  }
  cr = mhr + CANONICAL_CATEGORIES.length + 2

  /* the interest axis, exactly as the database spells it */
  cr = subhead(ws, cr, 30,
    '12. AUDIENCE INTEREST KEYS  ·  every distinct l2_gold.audience_interest_daily.interest_key, spelled as the '
    + 'database spells it. Brands target these strings directly, so no crosswalk sits between the two halves to '
    + "disagree with itself. 'sports' and 'fitness' stay separate because the database keeps them separate.")
  headers(ws, cr, 1, ['#', 'interest_key', 'In the scoring axis', 'Targeted by'], 20)
  const served = (snapshot.interestKeys ?? INTEREST_KEYS).filter(k => k !== 'unknown')
  const targeters = key => brands.filter(b => b.interests.includes(key)).map(b => b.brand_name).join(', ')
  served.forEach((k, i) => {
    labelCell(ws, cr + 1 + i, 1, i + 1, { size: 9 }).alignment = { horizontal: 'center' }
    labelCell(ws, cr + 1 + i, 2, k, { size: 9, bold: true })
    labelCell(ws, cr + 1 + i, 3, INTEREST_KEYS.includes(k) ? 'yes' : 'no', { size: 9, color: T.sub })
    labelCell(ws, cr + 1 + i, 4, targeters(k) || '— no brand targets it', { size: 9, color: T.sub, wrap: true })
  })
  cr += served.length + 2

  labelCell(ws, cr, 1, "'unknown'", { size: 9, bold: true })
  ws.mergeCells(cr, 2, cr, 5)
  labelCell(ws, cr, 2,
    'Not an interest: the share of the sampled audience the pipeline could not classify — often 80-89% of it. '
    + 'Counted in the denominator of every interest share so the shares stay honest, reported separately as '
    + 'Interest Known %, and never targeted by a brand.', { size: 9, color: T.sub, wrap: true })
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   BRAND_PROFILE — five brands, one column each
   ══════════════════════════════════════════════════════════════════════════ */

export function buildBrandProfile(wb, brands) {
  const SPAN = 4 + brands.length
  const ws = wb.addWorksheet('Brand_Profile', { views: [{ state: 'frozen', ySplit: 4, xSplit: 4 }] })
  banner(ws, 1, SPAN, 'BRAND PROFILE  ·  five brands, every category taken from the KOL database',
    'One column per brand. The Category row holds a kol_categories.taxonomy_key value — Tech, Beauty, Food, Fitness, Fashion — '
    + 'and the Audience Interests rows hold audience_interest_daily.interest_key values, both exactly as the database spells them. '
    + 'The Source column says which database column each field speaks to, or states that none does; the three fields where none does score nothing.')

  headers(ws, 4, 1, ['Section', 'Brand Field', 'Key', 'Source in the database', ...brands.map(b => b.brand_name)], 30)
  let r = 5
  const FIRST_BRAND_COL = 5

  for (const [section, label, key, kind, source] of BRAND_FIELDS) {
    if (key === 'interests') {
      // The interest axis is not one cell: it is one 0/1 row per interest key,
      // so Interest Match can be a SUMPRODUCT against the creator's real
      // per-interest shares rather than a text search.
      labelCell(ws, r, 1, section ?? '', { bold: !!section, size: 9, fill: section ? T.soft : undefined })
      labelCell(ws, r, 2, label, { size: 9, bold: true })
      labelCell(ws, r, 3, 'interests', { size: 9, color: T.sub })
      labelCell(ws, r, 4, source, { size: 9, color: T.sub, wrap: true })
      brands.forEach((b, i) => {
        labelCell(ws, r, FIRST_BRAND_COL + i, b.interests.join(', '), { size: 9, wrap: true, fill: T.input })
      })
      r++
      for (const key2 of INTEREST_KEYS) {
        labelCell(ws, r, 1, '', { size: 9 })
        labelCell(ws, r, 2, `    · ${key2}`, { size: 9, color: T.sub })
        labelCell(ws, r, 3, `interest_${key2}`, { size: 9, color: T.sub })
        labelCell(ws, r, 4, `interest_key = '${key2}'`, { size: 9, color: T.sub })
        brands.forEach((b, i) => {
          const c = labelCell(ws, r, FIRST_BRAND_COL + i, b.interests.includes(key2) ? 1 : 0, { size: 9, fill: T.input })
          c.alignment = { horizontal: 'center' }
        })
        BRI[key2] = r
        r++
      }
      continue
    }

    labelCell(ws, r, 1, section ?? '', { bold: !!section, size: 9, fill: section ? T.soft : undefined })
    labelCell(ws, r, 2, label, { size: 9, bold: true })
    labelCell(ws, r, 3, key, { size: 9, color: T.sub })
    const srcCell = labelCell(ws, r, 4, source, { size: 9, color: T.sub, wrap: true })
    if (source.startsWith('NO ')) srcCell.font = { ...BASE, size: 9, bold: true, color: { argb: 'FF991B1B' } }
    brands.forEach((b, i) => {
      const raw = b[key]
      const value = raw == null ? ''
        : kind === 'tokens' ? (Array.isArray(raw) ? raw.join(', ') : raw)
          : raw
      const c = labelCell(ws, r, FIRST_BRAND_COL + i, value, { size: 9, wrap: kind !== 'list', fill: T.input })
      if (kind !== 'list') c.alignment = { vertical: 'top', wrapText: true }
      if (key === 'category') c.font = { ...BASE, size: 9, bold: true }
    })
    BR[key] = r
    r++
  }

  /* the token slots Keyword, Hashtag and Topic Match search, one row per term */
  r += 1
  r = subhead(ws, r, SPAN, 'TOKEN SLOTS  ·  each term on its own row, because the match tests them one at a time')
  headers(ws, r, 1, ['Token set', 'Slot', 'Key', 'Searched in', ...brands.map(b => b.brand_name)], 20)
  r++
  const TOKEN_SETS = [
    ['brand_keywords', 'creator bio + captions + category names'],
    ['brand_hashtags', "the creator's own hashtags (l1_silver.unified_post.hashtags)"],
    ['caption_terms', 'l1_silver.unified_post.caption'],
  ]
  const TOK = {}
  for (const [set, searchedIn] of TOKEN_SETS) {
    const width = Math.max(...brands.map(b => (b[set] ?? []).length))
    const slots = []
    for (let s2 = 0; s2 < width; s2++) {
      labelCell(ws, r, 1, s2 === 0 ? set : '', { size: 9, bold: s2 === 0, fill: s2 === 0 ? T.soft : undefined })
      labelCell(ws, r, 2, `slot ${s2 + 1}`, { size: 9, color: T.sub })
      labelCell(ws, r, 3, `${set}_${s2 + 1}`, { size: 9, color: T.sub })
      labelCell(ws, r, 4, s2 === 0 ? searchedIn : '', { size: 9, color: T.sub, wrap: true })
      brands.forEach((b, i) => {
        labelCell(ws, r, FIRST_BRAND_COL + i, (b[set] ?? [])[s2] ?? '', { size: 9 })
      })
      slots.push(r)
      r++
    }
    // The count is a formula, not a number: delete a term and the denominator
    // follows, instead of scoring the creator against a blank slot.
    labelCell(ws, r, 1, '', { size: 9 })
    labelCell(ws, r, 2, 'terms filled', { size: 9, italic: true })
    labelCell(ws, r, 3, `${set}_count`, { size: 9, color: T.sub })
    labelCell(ws, r, 4, '', { size: 9 })
    brands.forEach((b, i) => {
      const col = BRAND_COLS[i]
      const c = labelCell(ws, r, FIRST_BRAND_COL + i,
        F(`=COUNTIF(${col}${slots[0]}:${col}${slots[slots.length - 1]},"<>")`),
        { size: 9, bold: true, fill: T.calc })
      c.alignment = { horizontal: 'center' }
    })
    TOK[set] = { slots, count: r }
    r++
  }

  ws.getColumn(1).width = 26
  ws.getColumn(2).width = 30
  ws.getColumn(3).width = 24
  ws.getColumn(4).width = 46
  brands.forEach((_, i) => { ws.getColumn(FIRST_BRAND_COL + i).width = 32 })
  return { ws, TOK }
}

/* ══════════════════════════════════════════════════════════════════════════
   KOL_SOURCE_DATA — the 24 requested accounts, exactly as the server has them
   ══════════════════════════════════════════════════════════════════════════ */

/** name, group band, number format, width */
const KOL_COLUMNS = [
  ['KOL ID', 'IDENTITY', null, 9],
  ['Requested Handle', null, null, 20],
  ['Handle', null, null, 20],
  ['Creator Name', null, null, 20],
  ['Platform', null, null, 11],
  ['Found In Database', null, null, 16],
  ['Followers', null, INT, 13],
  ['Tier', null, null, 11],
  ['Verified', null, null, 9],

  ['Directory Category (raw)', 'CATEGORY & CONTENT', null, 24],
  ['Category', null, null, 14],
  ['Category Basis', null, null, 13],
  ['Category From Captions', null, null, 16],
  ['Content Topics', null, null, 30],
  ['Classification Evidence', null, null, 40],
  ['Sub Category', null, null, 12],
  ['Content Style', null, null, 12],
  ['Creator City', null, null, 12],
  ['Bio', null, null, 40],
  ['Caption Digest', null, null, 60],
  ['Hashtag Digest', null, null, 46],

  ['Audience Age 13-17 %', 'AUDIENCE', null, 11],
  ['Audience Age 18-24 %', null, null, 11],
  ['Audience Age 25-34 %', null, null, 11],
  ['Audience Age 35-44 %', null, null, 11],
  ['Audience Age 45+ %', null, null, 11],
  ['Female %', null, PCT1, 10],
  ['Male %', null, PCT1, 10],
  ['Gender Known %', null, PCT1, 12],
  ['Audience Country', null, null, 14],
  ['Country Share %', null, PCT1, 12],
  ['Country Known %', null, PCT1, 12],
  ['Audience City 1', null, null, 14],
  ['City 1 Share %', null, PCT1, 11],
  ['Audience City 2', null, null, 14],
  ['City 2 Share %', null, PCT1, 11],
  ['Audience City 3', null, null, 14],
  ['City 3 Share %', null, PCT1, 11],
  ['City Known %', null, PCT1, 11],
  ['Interest Known %', null, PCT1, 12],
]
for (const key of INTEREST_KEYS) {
  KOL_COLUMNS.push([`Interest: ${key} %`, null, PCT1, 13])
}
KOL_COLUMNS.push(
  ['Engagement Rate (%)', 'PERFORMANCE', '0.00', 12],
  ['Engagement Rate Source', null, null, 34],
  ['Average Views', null, INT, 13],
  ['Median Views', null, INT, 13],
  ['View-to-Follower Ratio', null, '0.0000', 13],
  ['Posts Analyzed', null, INT, 11],
  ['Posts / Month', null, '0.00', 11],
  ['Observation Days', null, INT, 12],
  ['Cadence Usable', null, null, 12],
  ['Followers Growth %', null, '0.000', 13],
  ['Paid Ratio %', null, PCT1, 11],
  ['Community Score', null, null, 12],

  ['Audience Quality', 'INTEGRITY', SCORE_FMT, 12],
  ['Authenticity', null, SCORE_FMT, 11],
  ['Follower Quality', null, SCORE_FMT, 12],
  ['Content Risk', null, null, 12],

  ['Data Completeness %', 'COVERAGE', SCORE_FMT, 13],
  ['Confidence', null, null, 13],
  ['Data Note', null, null, 52],
)
KOL_COLUMNS.forEach(([name], i) => { KC[name] = i + 1 })

/**
 * The 12 fields Data Completeness is measured over.
 *
 * Chosen because each one drives at least one score, so the percentage answers
 * "how much of this creator could be scored" rather than "how many columns are
 * non-empty". The engine workbook measures the same count over its own field
 * list; CONF_HIGH and CONF_MEDIUM are shared with it.
 */
const TRACKED = [
  'Category', 'Engagement Rate (%)', 'Average Views', 'View-to-Follower Ratio',
  'Female %', 'Country Share %', 'City 1 Share %', 'Interest Known %',
  'Audience Quality', 'Authenticity', 'Follower Quality', 'Posts / Month',
]

export function buildKolSourceData(wb, records) {
  const SPAN = KOL_COLUMNS.length
  const ws = wb.addWorksheet('KOL_Source_Data', { views: [{ state: 'frozen', ySplit: 5, xSplit: 4 }] })
  banner(ws, 1, SPAN, 'KOL SOURCE DATA  ·  the 24 requested accounts, read from the KOL server',
    'Nothing on this sheet is invented, estimated to fill a gap, or carried over from the engine workbook\'s sample roster. '
    + 'A cell reading N/A means the column exists and is empty, or the column does not exist at all — the Data Note says which. '
    + 'Every one of the five age columns is N/A for every creator: there is no age signal anywhere on this server.')

  let gStart = 1
  let gName = 'IDENTITY'
  KOL_COLUMNS.forEach(([, group], i) => {
    if (group && i > 0) { groupBand(ws, 4, gStart, i, gName); gStart = i + 1; gName = group }
  })
  groupBand(ws, 4, gStart, SPAN, gName)
  headers(ws, 5, 1, KOL_COLUMNS.map(([n]) => n), 44)

  records.forEach((rec, i) => {
    const r = KOL_FIRST + i
    const put = (name, value, fmt) => {
      const c = ws.getCell(r, KC[name])
      c.value = value === null || value === undefined ? NA : value
      c.font = { ...BASE, size: 9 }
      c.border = bd()
      if (fmt && typeof value === 'number') c.numFmt = fmt
      if (c.value === NA) c.font = { ...BASE, size: 9, color: { argb: T.sub }, italic: true }
      return c
    }

    put('KOL ID', `KOL-${String(i + 1).padStart(2, '0')}`).font = { ...BASE, size: 9, bold: true }
    put('Requested Handle', `@${rec.requested}`)

    if (!rec.found) {
      put('Handle', NA)
      put('Creator Name', NA)
      put('Platform', NA)
      put('Found In Database', 'NOT FOUND')
      for (const [name, , fmt] of KOL_COLUMNS.slice(6)) put(name, null, fmt)
      put('Data Note', 'NOT FOUND IN KOL DATABASE — no row in public.kol_directory under this handle or any alias of it. No substitute creator was used.')
      put('Data Completeness %', 0)
      put('Confidence', 'Limited Data')
      return
    }

    const topCity = rec.cityShares ?? []
    // Keyed on the database's own interest_key. Nothing is folded together:
    // 'sports' and 'fitness' stay separate columns because they are separate
    // keys, and a fitness brand targets both rather than making the database
    // pick one.
    const interestPct = new Map()
    for (const it of rec.interests ?? []) interestPct.set(it.key, it.pct)
    const idShare = (rec.countryShares ?? []).find(c => c.key === 'ID')?.pct ?? null

    put('Handle', `@${rec.resolved}`)
    put('Creator Name', rec.name)
    put('Platform', rec.platform)
    put('Found In Database', rec.aliased ? 'FOUND (alias)' : 'FOUND')
    put('Followers', rec.followers, INT)
    // Tier is derived, not read. `kol_profile_card.tier` is NULL for a third of
    // this roster, and it is only ever followers_count run through the same
    // bands — so deriving it here from the bands on Lookup_Lists section 3 makes
    // the column complete and makes the tier move if the thresholds are edited.
    put('Tier', F(`=IFERROR(INDEX(${rangeA('Lookup_Lists', LK.TierName.col, LK.TierName.r1, LK.TierName.col, LK.TierName.r2)},`
      + `MATCH(${kd('Followers', r)},${rangeA('Lookup_Lists', LK.TierMin.col, LK.TierMin.r1, LK.TierMin.col, LK.TierMin.r2)},1)),"${NA}")`))
    put('Verified', rec.verified)

    put('Directory Category (raw)', (rec.rawCategories ?? []).join(' | ') || null)
    put('Category', rec.category)
    put('Category Basis', rec.categoryBasis)
    // What the creator's own captions say, independent of the tag they carry.
    // Business Relevance reads the tagged category; Content Relevance reads this
    // one. They are different questions — what the roster says a creator is, and
    // what their last ten posts show them doing.
    put('Category From Captions', rec.classifiedCategory)
    put('Content Topics', (rec.classification?.topics ?? []).map(t => t.label).join(', ') || null)
    put('Classification Evidence',
      (rec.classification?.categoryScores ?? []).slice(0, 2)
        .map(c => `${c.label} ${c.points}pt [${c.evidence.slice(0, 3).join('; ')}]`).join('  ·  ') || null)
    put('Sub Category', null)
    put('Content Style', null)
    put('Creator City', rec.creatorCity)
    put('Bio', rec.bio)
    put('Caption Digest', rec.captionDigest)
    put('Hashtag Digest', rec.hashtagDigest)

    for (const band of ['13-17', '18-24', '25-34', '35-44', '45+']) put(`Audience Age ${band} %`, null)
    put('Female %', rec.femalePct, PCT1)
    put('Male %', rec.malePct, PCT1)
    put('Gender Known %', rec.genderKnownPct, PCT1)
    put('Audience Country', idShare == null ? null : 'Indonesia')
    put('Country Share %', idShare, PCT1)
    put('Country Known %', rec.countryKnownPct, PCT1)
    for (let c = 0; c < 3; c++) {
      put(`Audience City ${c + 1}`, topCity[c]?.key ?? null)
      put(`City ${c + 1} Share %`, topCity[c]?.pct ?? null, PCT1)
    }
    put('City Known %', rec.cityKnownPct, PCT1)
    put('Interest Known %', rec.interestKnownPct, PCT1)
    for (const key of INTEREST_KEYS) {
      put(`Interest: ${key} %`, interestPct.has(key) ? Math.round(interestPct.get(key) * 10) / 10 : null, PCT1)
    }

    put('Engagement Rate (%)', rec.er, '0.00')
    put('Engagement Rate Source', rec.erSource)
    put('Average Views', rec.avgViews, INT)
    put('Median Views', rec.medianViews, INT)
    put('View-to-Follower Ratio', rec.vfr, '0.0000')
    put('Posts Analyzed', rec.postsAnalyzed, INT)
    put('Posts / Month', rec.postFrequencyMonthly, '0.00')
    put('Observation Days', rec.observationDays, INT)
    put('Cadence Usable',
      rec.observationDays == null || rec.postFrequencyMonthly == null ? NA
        : rec.observationDays >= 21 ? 'Yes' : 'No')
    put('Followers Growth %', rec.followersGrowth, '0.000')
    put('Paid Ratio %', rec.paidRatio, PCT1)
    put('Community Score', null)

    put('Audience Quality', rec.audienceQuality, SCORE_FMT)
    put('Authenticity', rec.authenticity, SCORE_FMT)
    put('Follower Quality', rec.followerQuality, SCORE_FMT)
    put('Content Risk', null)

    // Completeness is a formula so it tracks the row rather than a memory of it.
    const parts = TRACKED.map(n => `IF(ISNUMBER(${kd(n, r)}),1,IF(AND(ISTEXT(${kd(n, r)}),${kd(n, r)}<>"${NA}"),1,0))`)
    put('Data Completeness %', F(`=ROUND((${parts.join('+')})/${TRACKED.length}*100,0)`), SCORE_FMT)
    put('Confidence',
      F(`=IF(${kd('Data Completeness %', r)}>=${K.CONF_HIGH},"High",`
        + `IF(${kd('Data Completeness %', r)}>=${K.CONF_MEDIUM},"Medium","Limited Data"))`))

    const notes = []
    if (rec.aliased) notes.push(`requested @${rec.requested}; resolved to @${rec.resolved}`)
    if (!rec.category) notes.push('no category: kol_categories carries none and caption evidence did not reach the threshold')
    else if (rec.categoryBasis !== 'live') notes.push(`category ${rec.categoryBasis} from captions, not from kol_categories`)
    if (rec.er == null) notes.push('no engagement rate on any of the three sources')
    if (rec.audienceQuality == null) notes.push('no audience analysis row')
    if (!(rec.interests ?? []).length) notes.push('no audience interest rows')
    if (rec.observationDays != null && rec.observationDays < 21) notes.push(`cadence unusable: ${rec.postFrequencyMonthly}/month extrapolated from ${rec.observationDays} observed day(s)`)
    put('Data Note', notes.join(' · ') || 'complete on every tracked field')
  })

  KOL_COLUMNS.forEach(([name, , , width], i) => { ws.getColumn(i + 1).width = width })
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + records.length, column: SPAN } }
  return ws
}

/* ══════════════════════════════════════════════════════════════════════════
   MATCHING_ENGINE — 24 creators x 5 brands
   ══════════════════════════════════════════════════════════════════════════ */

const ME_COLUMNS = [
  ['Brand ID', 'KEY'], ['Brand'], ['KOL ID'], ['KOL'], ['Creator'], ['Platform'],
  ['Category'], ['Followers'], ['Engagement Rate (%)'],

  ['Category Match', 'BRAND & BUSINESS RELEVANCE — 20%'], ['Keyword Match'], ['Hashtag Match'],
  ['Business Score'], ['Business Available'],

  ['Age Score', 'TARGET AUDIENCE RELEVANCE — 30%'], ['Gender Score'], ['Location Score'],
  ['Interest Score'], ['Audience Score'], ['Audience Available'],

  ['Content Category Match', 'CONTENT & CATEGORY RELEVANCE — 20%'], ['Sub Category Match'],
  ['Topic Match'], ['Content Style Match'], ['Content Score'], ['Content Available'],

  ['Personality Match', 'BRAND PERSONALITY FIT — 10%'], ['Tone Match'], ['Values Match'],
  ['Communication Match'], ['Personality Score'], ['Personality Available'],

  ['ER Score', 'PERFORMANCE QUALITY — 10%'], ['Audience Quality Score'], ['Consistency Score'],
  ['Community Score'], ['Average Views Score'], ['Recent Growth Score'],
  ['Performance Score'], ['Performance Available'],

  ['Authenticity Score', 'BRAND SAFETY — 10%'], ['Follower Quality Score'], ['Verification Score'],
  ['Paid Ratio Score'], ['Content Risk Score'], ['Safety Score'], ['Safety Available'],
  ['Safety Level'], ['Risk Note'],

  ['Available Weight', 'RESULT'], ['Final Match Score'], ['Match Level'],
  ['Data Completeness %'], ['Confidence'], ['Rank Key'],

  ['Keyword Haystack', 'HELPERS (intermediate lookups, kept visible on purpose)'],
  ['Topic Haystack'], ['Hashtag Haystack'], ['Match Key'],
]
ME_COLUMNS.forEach(([name], i) => { MEC[name] = i + 1 })

/**
 * `INDEX/MATCH` into matrix 11d, the canonical-category grid.
 *
 * Both axes are `kol_categories.taxonomy_key` values, so this is the only
 * category lookup in the workbook and it cannot miss because two files spelled
 * a category differently.
 */
const dbcat = (rowExpr, colExpr, fallback) =>
  `IFERROR(INDEX(${K2.DBCAT.data},MATCH(${rowExpr},${K2.DBCAT.rows},0),MATCH(${colExpr},${K2.DBCAT.cols},0)),${fallback})`

/** Share of a brand's token slots that appear in `haystack`, as 0-100. */
function overlap(TOK, set, bcol, haystack) {
  const t = TOK[set]
  const terms = t.slots
    .map(s => `IF(Brand_Profile!$${bcol}$${s}="",0,IF(ISNUMBER(SEARCH(Brand_Profile!$${bcol}$${s},${haystack})),1,0))`)
    .join('+')
  return `IF(Brand_Profile!$${bcol}$${t.count}=0,${K.CAL_NEUTRAL},ROUND((${terms})/Brand_Profile!$${bcol}$${t.count}*100,0))`
}

/**
 * Weighted mean over only the sub-scores that are numbers.
 *
 * `parts` is [cell, weight] pairs. A sub-score reading N/A contributes to
 * neither the numerator nor the denominator, so the remaining weights
 * renormalise to 100 by themselves — Location Match over country and city alone
 * when region is missing, Content Relevance over category and topic alone when
 * sub category and style do not exist as columns. If every part is N/A the whole
 * component is N/A rather than 0.
 */
function weightedAvailable(parts) {
  const num = parts.map(([c, w]) => `IF(ISNUMBER(${c}),${c}*${w},0)`).join('+')
  const den = parts.map(([c, w]) => `IF(ISNUMBER(${c}),${w},0)`).join('+')
  return `IF((${den})=0,"${NA}",ROUND((${num})/(${den}),0))`
}

export function buildMatchingEngine(wb, records, brands, TOK) {
  const SPAN = ME_COLUMNS.length
  const N_KOL = records.length
  const ws = wb.addWorksheet('Matching_Engine', { views: [{ state: 'frozen', ySplit: 5, xSplit: 5 }] })
  banner(ws, 1, SPAN, 'MATCHING ENGINE  ·  every creator scored against every brand',
    `${N_KOL * brands.length} rows: ${brands.length} brands x ${N_KOL} creators. Not one score here is typed — each is a formula over `
    + 'KOL_Source_Data and Brand_Profile, weighted by the constants on Lookup_Lists. Filter column A to one Brand ID to read a '
    + 'single brand; compare one KOL ID down the five blocks to see that the score is a function of the pair, not a ranking of creators.')

  let gStart = 1
  let gName = 'KEY'
  ME_COLUMNS.forEach(([, group], i) => {
    if (group && i > 0) { groupBand(ws, 4, gStart, i, gName); gStart = i + 1; gName = group }
  })
  groupBand(ws, 4, gStart, SPAN, gName)
  headers(ws, 5, 1, ME_COLUMNS.map(([n]) => n), 46)

  brands.forEach((brand, b) => {
    records.forEach((rec, i) => {
      writeRow(ws, ME_FIRST + b * N_KOL + i, KOL_FIRST + i, BRAND_COLS[b], brand, TOK, N_KOL, i)
    })
  })

  ME_COLUMNS.forEach(([name], i) => {
    ws.getColumn(i + 1).width = name.length > 22 ? 20 : Math.max(9, Math.min(20, name.length + 2))
  })
  ws.getColumn(MEC['Risk Note']).width = 58
  ws.getColumn(MEC['Keyword Haystack']).width = 50
  ws.getColumn(MEC['Topic Haystack']).width = 42
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: SPAN } }

  const last = ME_FIRST + N_KOL * brands.length - 1
  ws.addConditionalFormatting({
    ref: `${A(MEC['Final Match Score'])}${ME_FIRST}:${A(MEC['Final Match Score'])}${last}`,
    rules: [{
      type: 'colorScale', priority: 1,
      cfvo: [{ type: 'num', value: 30 }, { type: 'num', value: 55 }, { type: 'num', value: 80 }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  for (const [col, rules] of [
    [MEC['Match Level'], [
      ['Excellent', 'FFBBF7D0', 'FF14532D'], ['Strong', 'FFDCFCE7', 'FF166534'],
      ['Good', 'FFFEF9C3', 'FF854D0E'], ['Moderate', 'FFFEF3C7', 'FF92400E'],
      ['Low', 'FFFEE2E2', 'FF991B1B'],
    ]],
    [MEC['Safety Level'], [['High Risk', 'FFFEE2E2', 'FF991B1B'], ['Elevated', 'FFFEF3C7', 'FF92400E'], ['Low Risk', 'FFDCFCE7', 'FF166534']]],
    [MEC.Confidence, [['Limited', 'FFFEE2E2', 'FF991B1B'], ['Medium', 'FFFEF3C7', 'FF92400E'], ['High', 'FFDCFCE7', 'FF166534']]],
  ]) {
    ws.addConditionalFormatting({
      ref: `${A(col)}${ME_FIRST}:${A(col)}${last}`,
      rules: rules.map(([text, bg, fg], i) => ({
        type: 'containsText', operator: 'containsText', text, priority: i + 1,
        style: { fill: fillOf(bg), font: { bold: true, color: { argb: fg } } },
      })),
    })
  }
  return ws
}

function writeRow(ws, r, kr, bcol, brand, TOK, nKol, kolIndex) {
  const put = (name, value, fmt) => {
    const c = ws.getCell(r, MEC[name])
    c.value = value
    c.font = { ...BASE, size: 9 }
    c.border = bd()
    if (fmt) c.numFmt = fmt
    return c
  }
  const B = key => bp(key, bcol)
  const Kd = name => kd(name, kr)
  const M = name => me(name, r)
  /** True when a KOL_Source_Data cell carries a real reading rather than N/A. */
  const has = name => `ISNUMBER(${Kd(name)})`
  const hasText = name => `AND(ISTEXT(${Kd(name)}),${Kd(name)}<>"${NA}")`

  /* keys — read through from the input sheets, never retyped */
  put('Brand ID', brand.brand_id).font = { ...BASE, size: 9, bold: true }
  put('Brand', F(`=${B('brand_name')}`))
  put('KOL ID', F(`=${Kd('KOL ID')}`))
  put('KOL', F(`=${Kd('Handle')}`))
  put('Creator', F(`=${Kd('Creator Name')}`))
  put('Platform', F(`=${Kd('Platform')}`))
  put('Category', F(`=${Kd('Category')}`))
  put('Followers', F(`=${Kd('Followers')}`), INT)
  put('Engagement Rate (%)', F(`=${Kd('Engagement Rate (%)')}`), '0.00')

  /* helpers */
  /**
   * The creator's own words. Caption Digest is the load-bearing part: the brand
   * keyword lists are Indonesian and the taxonomy's node labels are English, so
   * a haystack of bio plus labels gives them nothing to meet. Bio is ~12% filled
   * across the server; captions are present for 20 of these 24 accounts.
   *
   * A creator with neither — no bio and no captions — produces an empty haystack.
   * SEARCH against "" finds nothing, so every term misses and the score is 0.
   * That is wrong here: 0 means "searched, found nothing", and nothing was
   * searched. The guard below returns N/A instead, and the sub-score drops out
   * of its component rather than dragging it down.
   */
  /**
   * "Nothing but separators" is the real emptiness test.
   *
   * The haystacks are built by concatenating four fields with " | " between
   * them, so a creator with none of the four still produces " |  |  | ", whose
   * TRIM is three pipes and whose LEN is therefore not 0. Testing LEN(TRIM(...))
   * alone never fired: the three creators with no bio and no harvested posts
   * were scoring Keyword and Topic Match 0 — "we searched and found nothing" —
   * when nothing had been searched. Stripping the separators first makes the
   * guard test what it always claimed to.
   */
  const stripped = hay => `LEN(TRIM(SUBSTITUTE(${hay},"|","")))=0`
  const haystackEmpty = stripped(M('Keyword Haystack'))
  put('Hashtag Haystack',
    F(`=IF(${hasText('Hashtag Digest')},${Kd('Hashtag Digest')},"")`))
  put('Keyword Haystack',
    F(`=IF(${hasText('Bio')},${Kd('Bio')},"")&" | "&IF(${hasText('Caption Digest')},${Kd('Caption Digest')},"")`
      + `&" | "&IF(${hasText('Content Topics')},${Kd('Content Topics')},"")`
      + `&" | "&IF(${hasText('Category')},${Kd('Category')},"")&" | "&IF(${hasText('Directory Category (raw)')},${Kd('Directory Category (raw)')},"")`))
  put('Topic Haystack',
    F(`=IF(${hasText('Caption Digest')},${Kd('Caption Digest')},"")&" | "&IF(${hasText('Content Topics')},${Kd('Content Topics')},"")`
      + `&" | "&IF(${hasText('Classification Evidence')},${Kd('Classification Evidence')},"")`
      + `&" | "&IF(${hasText('Bio')},${Kd('Bio')},"")`))

  /* ── 1. Brand & Business Relevance — 20% ───────────────────────────────── */
  /**
   * An unknown category scores CAL_NEUTRAL, not N/A and not CAL_UNRELATED.
   *
   * The three options are not close. N/A drops the sub-score out, which sounds
   * neutral and is not: with Industry and Category both gone, Business Relevance
   * collapses onto Keyword Match alone, and the nine uncategorised creators were
   * scoring 0 while categorised ones held a floor of 20. Missing data was
   * costing more than being measured and found irrelevant.
   *
   * CAL_UNRELATED (20) is worse still — it asserts irrelevance nobody measured.
   *
   * CAL_NEUTRAL is the workbook's own value for "the field was left blank:
   * neither a reward nor a penalty". It has one consequence worth stating
   * plainly: a creator nobody has categorised can outscore one who is known to
   * be a poor fit. That is correct. Knowing @cristiano makes fitness content is
   * real evidence against a SaaS brief; knowing nothing about @leomessi is not
   * evidence for or against anything, and the Category Basis and Confidence
   * columns are what tell the two apart.
   */
  const catKnown = hasText('Category')
  // Brand category against the creator's TAGGED canonical category, through
  // matrix 11d. Both sides are kol_categories.taxonomy_key values.
  put('Category Match',
    F(`=IF(NOT(${catKnown}),${K.CAL_NEUTRAL},`
      + `IF(${B('category')}=${Kd('Category')},100,${dbcat(B('category'), Kd('Category'), K.CAL_UNRELATED)}))`), SCORE_FMT)
  put('Keyword Match',
    F(`=IF(${haystackEmpty},"${NA}",${overlap(TOK, 'brand_keywords', bcol, M('Keyword Haystack'))})`), SCORE_FMT)
  // public.brand.brand_hashtags against the creator's own hashtags. N/A rather
  // than 0 where the creator has none: four of the 24 have no posts harvested at
  // all, and scoring them 0 would read as "they post nothing on topic".
  put('Hashtag Match',
    F(`=IF(NOT(${hasText('Hashtag Digest')}),"${NA}",${overlap(TOK, 'brand_hashtags', bcol, M('Hashtag Haystack'))})`), SCORE_FMT)
  put('Business Score', F(`=${weightedAvailable([
    [M('Category Match'), K2.W_BB_CAT],
    [M('Keyword Match'), K2.W_BB_KW],
    [M('Hashtag Match'), K2.W_BB_HASH],
  ])}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
  put('Business Available', F(`=IF(ISNUMBER(${M('Business Score')}),1,0)`))

  /* ── 2. Target Audience Relevance — 30% ────────────────────────────────── */
  // Age: the five band columns are N/A for every creator on this server, so this
  // resolves to N/A and drops out of the weighting. Written as a live formula
  // rather than the constant "N/A" so it starts working the day the pipeline
  // fills audience_demographics_daily with an age row.
  const ageList = listRef('AgeBand')
  const ageRange = `${kd('Audience Age 13-17 %', kr)}:${kd('Audience Age 45+ %', kr)}`
  const pri = `IFERROR(INDEX(${ageRange},1,MATCH(${B('primary_age_range')},${ageList},0)),"")`
  const sec = `IFERROR(INDEX(${ageRange},1,MATCH(${B('secondary_age_range')},${ageList},0)),"")`
  put('Age Score',
    F(`=IF(NOT(ISNUMBER(${pri})),"${NA}",MIN(100,ROUND((${pri}+0.5*IF(ISNUMBER(${sec}),${sec},0))/${K.CAL_AGE_TARGET}*100,0)))`), SCORE_FMT)

  put('Gender Score',
    F(`=IF(${B('gender_majority')}="Any",100,`
      + `IF(NOT(${has('Female %')}),"${NA}",`
      + `IF(${B('gender_majority')}="Female",MIN(100,ROUND(${Kd('Female %')}/${K.CAL_GENDER_TARGET}*100,0)),`
      + `IF(${B('gender_majority')}="Male",MIN(100,ROUND(IF(${has('Male %')},${Kd('Male %')},100-${Kd('Female %')})/${K.CAL_GENDER_TARGET}*100,0)),`
      + `MAX(0,ROUND(100-ABS(${Kd('Female %')}-50)*2,0))))))`), SCORE_FMT)

  // Country and city only. audience_geo_daily carries no usable region level —
  // 9 of its 33 region keys sit at the wrong level — so Region contributes
  // nothing and W_LOC_REGION renormalises away.
  const countryPart = `IF(NOT(${has('Country Share %')}),"${NA}",`
    + `IF(${Kd('Audience Country')}<>${B('target_country')},${K.CAL_UNRELATED},`
    + `MIN(100,ROUND(${Kd('Country Share %')}/${K2.CAL_COUNTRY_TARGET}*100,0))))`
  const cityHit = [1, 2, 3]
    .map(n => `IF(${kd(`Audience City ${n}`, kr)}=${B('target_city')},IF(ISNUMBER(${kd(`City ${n} Share %`, kr)}),${kd(`City ${n} Share %`, kr)},0),0)`)
    .join('+')
  const cityPart = `IF(NOT(${has('City Known %')}),"${NA}",MIN(100,ROUND((${cityHit})/${K2.CAL_CITY_TARGET}*100,0)))`
  put('Location Score', F(`=${weightedAvailable([[countryPart, K.W_LOC_COUNTRY], [cityPart, K.W_LOC_CITY]])}`), SCORE_FMT)

  // Interest Match is a SUMPRODUCT of the creator's real per-interest shares
  // against the brand's 0/1 flags — not a text search. The shares are of the
  // KNOWN-interest audience, which for most of this roster is 10-20% of the
  // sample; Interest Known % on the source sheet is what says so.
  const interestTerms = INTEREST_KEYS
    .map(k => `IF(ISNUMBER(${kd(`Interest: ${k} %`, kr)}),${kd(`Interest: ${k} %`, kr)}*Brand_Profile!$${bcol}$${BRI[k]},0)`)
    .join('+')
  put('Interest Score',
    F(`=IF(NOT(${has('Interest Known %')}),"${NA}",MIN(100,ROUND((${interestTerms})/${K2.CAL_INTEREST_TARGET}*100,0)))`), SCORE_FMT)

  put('Audience Score', F(`=${weightedAvailable([
    [M('Age Score'), K.W_TA_AGE],
    [M('Gender Score'), K.W_TA_GENDER],
    [M('Location Score'), K.W_TA_LOCATION],
    [M('Interest Score'), K.W_TA_INTEREST],
  ])}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
  put('Audience Available', F(`=IF(ISNUMBER(${M('Audience Score')}),1,0)`))

  /* ── 3. Content & Category Relevance — 20% ─────────────────────────────── */
  // Content Relevance asks a different question from Business Relevance: not
  // "what is this creator filed as" but "what do their last ten posts show them
  // doing". So it reads Category From Captions — the classifier's own answer,
  // expressed as a canonical key — rather than the tag on the roster.
  const capCatKnown = hasText('Category From Captions')
  put('Content Category Match',
    F(`=IF(NOT(${capCatKnown}),${K.CAL_NEUTRAL},`
      + `IF(${B('category')}=${Kd('Category From Captions')},100,`
      + `${dbcat(B('category'), Kd('Category From Captions'), K.CAL_UNRELATED)}))`), SCORE_FMT)
  // No sub-category column exists on the server, so this is N/A for everyone and
  // W_CC_SUBCATEGORY renormalises away. Same for Content Style.
  put('Sub Category Match', F(`=IF(NOT(${hasText('Sub Category')}),"${NA}",${dbcat(B('category'), Kd('Sub Category'), K.CAL_UNRELATED)})`), SCORE_FMT)
  put('Topic Match',
    F(`=IF(${stripped(M('Topic Haystack'))},"${NA}",${overlap(TOK, 'caption_terms', bcol, M('Topic Haystack'))})`), SCORE_FMT)
  put('Content Style Match',
    F(`=IF(NOT(${hasText('Content Style')}),"${NA}",${K.CAL_NEUTRAL})`), SCORE_FMT)
  put('Content Score', F(`=${weightedAvailable([
    [M('Content Category Match'), K2.W_CC_CAT],
    [M('Sub Category Match'), K.W_CC_SUBCATEGORY],
    [M('Topic Match'), K2.W_CC_TOPICS],
    [M('Content Style Match'), K.W_CC_STYLE],
  ])}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
  put('Content Available', F(`=IF(ISNUMBER(${M('Content Score')}),1,0)`))

  /* ── 4. Brand Personality Fit — 10% ────────────────────────────────────── */
  // All four inputs are creator-side columns that do not exist anywhere on this
  // server: personality, tone-answering content style, values, communication
  // style. The component is therefore N/A for all 120 rows and its 10% is
  // redistributed. The matrices it would use are still on Lookup_Lists and the
  // formulas still point at them, so the day a creator-DNA feature lands this
  // column starts scoring without an edit.
  put('Personality Match', F(`=IF(NOT(${hasText('Content Style')}),"${NA}",${K.CAL_NEUTRAL})`), SCORE_FMT)
  put('Tone Match', F(`=IF(NOT(${hasText('Content Style')}),"${NA}",${K.CAL_NEUTRAL})`), SCORE_FMT)
  put('Values Match', F(`="${NA}"`), SCORE_FMT)
  put('Communication Match', F(`=IF(NOT(${hasText('Content Style')}),"${NA}",${K.CAL_NEUTRAL})`), SCORE_FMT)
  put('Personality Score', F(`=${weightedAvailable([
    [M('Personality Match'), K.W_BP_PERSONALITY],
    [M('Tone Match'), K.W_BP_TONE],
    [M('Values Match'), K.W_BP_VALUES],
    [M('Communication Match'), K.W_BP_COMM],
  ])}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
  put('Personality Available', F(`=IF(ISNUMBER(${M('Personality Score')}),1,0)`))

  /* ── 5. Performance Quality — 10% ──────────────────────────────────────── */
  // Normalised against the target for the creator's own tier (section 11b), not
  // against the single CAL_ER_TARGET, which is calibrated for micro creators.
  const erTarget = `IFERROR(INDEX(${K2.ER_TIER_TARGETS},MATCH(${Kd('Tier')},${K2.ER_TIER_NAMES},0)),${K.CAL_ER_TARGET})`
  put('ER Score',
    F(`=IF(NOT(${has('Engagement Rate (%)')}),"${NA}",MIN(100,ROUND(${Kd('Engagement Rate (%)')}/${erTarget}*100,0)))`), SCORE_FMT)
  put('Audience Quality Score', F(`=IF(NOT(${has('Audience Quality')}),"${NA}",MIN(100,MAX(0,${Kd('Audience Quality')})))`), SCORE_FMT)
  // Gated on observation window: a cadence extrapolated from one observed day is
  // arithmetic, not a habit.
  put('Consistency Score',
    F(`=IF(OR(NOT(${has('Posts / Month')}),NOT(${has('Observation Days')}),${Kd('Observation Days')}<${K2.CAL_MIN_OBS_DAYS}),"${NA}",`
      + `MIN(100,ROUND(${Kd('Posts / Month')}/${K2.CAL_CONSISTENCY_TARGET}*100,0)))`), SCORE_FMT)
  put('Community Score', F(`=IF(NOT(${has('Community Score')}),"${NA}",${Kd('Community Score')})`), SCORE_FMT)
  put('Average Views Score',
    F(`=IF(NOT(${has('View-to-Follower Ratio')}),"${NA}",MIN(100,ROUND(${Kd('View-to-Follower Ratio')}/${K2.CAL_VFR_TARGET_ROSTER}*100,0)))`), SCORE_FMT)
  put('Recent Growth Score',
    F(`=IF(NOT(${has('Followers Growth %')}),"${NA}",MIN(100,MAX(0,ROUND((${Kd('Followers Growth %')}+2)/(${K.CAL_GROWTH_TARGET}+2)*100,0))))`), SCORE_FMT)
  put('Performance Score', F(`=${weightedAvailable([
    [M('ER Score'), K.W_PQ_ER],
    [M('Audience Quality Score'), K.W_PQ_AUDIENCE],
    [M('Consistency Score'), K.W_PQ_CONSISTENCY],
    [M('Community Score'), K.W_PQ_COMMUNITY],
    [M('Average Views Score'), K.W_PQ_VIEWS],
    [M('Recent Growth Score'), K.W_PQ_GROWTH],
  ])}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
  put('Performance Available', F(`=IF(ISNUMBER(${M('Performance Score')}),1,0)`))

  /* ── 6. Brand Safety — 10% ─────────────────────────────────────────────── */
  // An INTEGRITY SCREEN, not a content-safety reading. comments_analysis holds
  // 0 rows, so nobody has measured sentiment, spam or toxicity for any of these
  // accounts; Content Risk Score is N/A for all 120 rows and says so.
  put('Authenticity Score', F(`=IF(NOT(${has('Authenticity')}),"${NA}",MIN(100,MAX(0,${Kd('Authenticity')})))`), SCORE_FMT)
  put('Follower Quality Score', F(`=IF(NOT(${has('Follower Quality')}),"${NA}",MIN(100,MAX(0,${Kd('Follower Quality')})))`), SCORE_FMT)
  put('Verification Score',
    F(`=IF(${Kd('Verified')}="Yes",${K2.CAL_VERIFIED_YES},IF(${Kd('Verified')}="No",${K2.CAL_VERIFIED_NO},"${NA}"))`), SCORE_FMT)
  put('Paid Ratio Score',
    F(`=IF(NOT(${has('Paid Ratio %')}),"${NA}",MAX(0,ROUND(100-${Kd('Paid Ratio %')}/${K2.CAL_PAID_CEILING}*100,0)))`), SCORE_FMT)
  put('Content Risk Score', F(`=IF(NOT(${hasText('Content Risk')}),"${NA}",${Kd('Content Risk')})`), SCORE_FMT)
  put('Safety Score', F(`=${weightedAvailable([
    [M('Authenticity Score'), K2.W_BS_AUTHENTICITY],
    [M('Follower Quality Score'), K2.W_BS_FOLLOWER_QUALITY],
    [M('Verification Score'), K2.W_BS_VERIFICATION],
    [M('Paid Ratio Score'), K2.W_BS_PAID],
  ])}`), SCORE_FMT).font = { ...BASE, size: 9, bold: true }
  put('Safety Available', F(`=IF(ISNUMBER(${M('Safety Score')}),1,0)`))
  put('Safety Level',
    F(`=IF(NOT(ISNUMBER(${M('Safety Score')})),"Not Screened",`
      + `IF(${M('Safety Score')}>=${K2.BAND_SAFE_LOW},"Low Risk",`
      + `IF(${M('Safety Score')}>=${K2.BAND_SAFE_MOD},"Moderate Risk",`
      + `IF(${M('Safety Score')}>=${K2.BAND_SAFE_ELEV},"Elevated Risk","High Risk"))))`))
  put('Risk Note',
    F(`=IF(NOT(ISNUMBER(${M('Safety Score')})),"No integrity signal: no audience-analysis row for this account.",`
      + `"Integrity screen only — no content-risk reading exists (comments_analysis: 0 rows). "`
      + `&IF(ISNUMBER(${M('Authenticity Score')}),"Authenticity "&${M('Authenticity Score')}&". ","Authenticity N/A. ")`
      + `&IF(ISNUMBER(${M('Follower Quality Score')}),"Follower quality "&${M('Follower Quality Score')}&". ","Follower quality N/A. ")`
      + `&IF(${Kd('Verified')}="Yes","Platform-verified.","Not platform-verified."))`))

  /* ── result ────────────────────────────────────────────────────────────── */
  const flags = [
    ['Business Available', K.W_BRAND_BUSINESS, 'Business Score'],
    ['Audience Available', K.W_TARGET_AUDIENCE, 'Audience Score'],
    ['Content Available', K.W_CONTENT_CATEGORY, 'Content Score'],
    ['Personality Available', K.W_PERSONALITY, 'Personality Score'],
    ['Performance Available', K.W_PERFORMANCE, 'Performance Score'],
    ['Safety Available', K.W_SAFETY, 'Safety Score'],
  ]
  put('Available Weight', F(`=${flags.map(([f, w]) => `${M(f)}*${w}`).join('+')}`), SCORE_FMT)
  const numerator = flags.map(([f, w, s]) => `IF(${M(f)}=1,${M(s)}*${w},0)`).join('+')
  const final = put('Final Match Score',
    F(`=IF(${M('Available Weight')}=0,"${NA}",ROUND((${numerator})/${M('Available Weight')},0))`), SCORE_FMT)
  final.font = { ...BASE, size: 10, bold: true }
  put('Match Level',
    F(`=IF(NOT(ISNUMBER(${M('Final Match Score')})),"Not Scored",`
      + `IF(${M('Final Match Score')}>=${K.BAND_EXCELLENT},"Excellent Match",`
      + `IF(${M('Final Match Score')}>=${K.BAND_STRONG},"Strong Match",`
      + `IF(${M('Final Match Score')}>=${K.BAND_GOOD},"Good Match",`
      + `IF(${M('Final Match Score')}>=${K.BAND_MODERATE},"Moderate Match","Low Match")))))`))
  put('Data Completeness %', F(`=${Kd('Data Completeness %')}`), SCORE_FMT)
  put('Confidence', F(`=${Kd('Confidence')}`))
  // Ties are broken by roster position so LARGE/MATCH on the ranking sheets
  // always lands on exactly one row. Two creators on 61 would otherwise both
  // resolve to whichever appears first, and one of them would vanish.
  put('Rank Key',
    F(`=IF(NOT(ISNUMBER(${M('Final Match Score')})),-1,${M('Final Match Score')}*1000+${nKol - kolIndex})`), '0')
  put('Match Key', F(`=${M('Brand ID')}&"|"&${M('KOL ID')}`))
}

export { ME_COLUMNS, KOL_COLUMNS, TRACKED, kd, me, bp, NA }
